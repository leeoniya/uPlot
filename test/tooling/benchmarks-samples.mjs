import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { captureBenchmarkSamples } from '../../scripts/benchmarks-samples.mjs';
import { summarizeProcessMemory } from '../../scripts/analyze-benchmarks-process-memory.mjs';

const browserSource = readFileSync(new URL('../../scripts/benchmarks-trace-browser.mjs', import.meta.url), 'utf8');
const collectorSource = readFileSync(new URL('../../scripts/benchmarks-samples.mjs', import.meta.url), 'utf8');
const gc = 'HeapProfiler.collectGarbage';
const memory = () => {
	const metrics = {rssMB: 20, pssMB: 15, privateMB: 10, swapMB: 0, swapPssMB: 0};
	return {complete: true, renderer: {...metrics}, tree: {...metrics}, issues: []};
};
const timing = (variant, id, dpr) => ({id, dpr, effectiveDpr: dpr, variant, dataPrepMs: 3, jsMs: 7, prepAndInitMs: 10, windowMs: 107});

function signal() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return {promise, resolve};
}

async function waitFor(promise) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Test signal timed out')), 1000); }),
		]);
	}
	finally {
		clearTimeout(timer);
	}
}

function fixture(options = {}) {
	const events = [];
	const config = {variants: ['uplot'], dpr: 1, warmups: 0, rounds: 1, ...options.config};
	let activeReads = 0;
	let activeOperation = null;
	let reads = 0;
	let current;
	const api = {
		begin() {
			events.push({method: 'begin'});
			return {captureId: 'capture-id', env: {actualDPR: config.dpr}, config, markerPattern: 'benchmark:<id>:start|js-end|end', limitations: ['fixture limitation']};
		},
	};
	for (const method of ['setup', 'prepare', 'construct', 'destroy']) {
		api[method] = async (variant, id) => {
			if (method === 'destroy')
				assert.equal(activeReads, 0, 'process reads must drain before destroy');
			if (method === 'setup')
				current = timing(variant, id, config.dpr);
			events.push({method, variant, id});
			activeOperation = method;
			try {
				await options.operation?.(method);
				return method === 'construct' ? current : undefined;
			}
			finally {
				activeOperation = null;
				events.push({method: `${method}:end`});
			}
		};
	}
	const page = {
		async send(method) {
			assert.equal(method, gc, 'only checkpoint GC commands are allowed');
			assert.equal(activeReads, 0, 'reads must drain before GC');
			assert.equal(activeOperation, null, 'no GC during lifecycle operations');
			events.push({method});
			await options.gc?.();
			return {};
		},
	};
	const evaluate = async (target, expression) => {
		assert.equal(target, page);
		const value = await runInNewContext(expression, {benchmarkLifecycle: api});
		if (!expression.includes('.begin(') && !expression.includes('.construct('))
			assert.equal(value, undefined, 'no fixture objects returned from setup, prepare, or destroy');
		return structuredClone(value);
	};
	const processRead = async () => {
		assert.equal(activeReads, 0, 'process reads must be serial');
		activeReads++;
		events.push({method: 'read', activeOperation, at: performance.now()});
		try {
			return await options.read?.(++reads, activeOperation) ?? memory();
		}
		finally {
			activeReads--;
			events.push({method: 'read:end', activeOperation, at: performance.now()});
		}
	};
	return {
		events, page, evaluate,
		capture: (captureOptions = {}) => captureBenchmarkSamples(page, evaluate, {
			...(options.memory ? {processRead} : {}), ...captureOptions,
		}),
	};
}

async function assertSettled(fake, assertion) {
	const unhandled = [];
	const listener = error => unhandled.push(error);
	process.on('unhandledRejection', listener);
	try {
		await assertion();
		const count = fake.events.length;
		await delay(30);
		assert.equal(fake.events.length, count, 'no background operations remain');
		assert.deepEqual(unhandled, []);
	}
	finally {
		process.removeListener('unhandledRejection', listener);
	}
}

// Execute the actual lifecycle and report code with deterministic browser primitives.
function browserFixture(options = {}) {
	let clock = 0;
	const events = [];
	const marks = [];
	const context = {
		VARIANTS: ['uplot', 'chartjs', 'idle'], ALL_VARIANTS: ['uplot', 'd3', 'chartjs', 'echarts', 'flot', 'dygraphs', 'idle'],
		WARMUPS: 3, ROUNDS: 7, dpr: 2, WIDTH: 1920, HEIGHT: 600, VIEWPORT_HEIGHT: 900, IDLE_MS: 200, ROWS: 55550,
		packed: {raw: true},
		crypto: {randomUUID: () => 'browser-capture'},
		performance: {
			now: () => clock,
			mark(name) {
				const mark = {name, startTime: clock};
				marks.push(mark);
				events.push(name);
				return mark;
			},
		},
		console: {time() {}, timeEnd() {}},
		environment: () => ({actualDPR: 2}),
		checkPage: () => events.push('checkPage'),
		setup: () => ({host: true}),
		prepFor: () => {
			clock += 50; // Selecting prepData must not be timed.
			return packed => {
				assert.equal(packed, context.packed);
				events.push('prepData');
				clock += 3;
				return {input: true};
			};
		},
		validateInput: sample => {
			assert.ok(sample.input);
			events.push('validateInput');
			clock += 1000;
			options.validateInput?.();
		},
		construct: sample => {
			events.push('construct');
			sample.chart = {chart: true};
			clock += 5;
			options.construct?.();
		},
		finishMicrotask: async () => { events.push('microtask'); clock += 2; },
		settle: async () => { events.push('settle'); clock += 100; await options.settle?.(); },
		nextFrame: async () => { clock += 16; return clock; },
		setTimeout: resolve => { clock += 200; resolve(); },
		validateChart: sample => {
			assert.ok(sample.chart);
			events.push('validateChart');
			clock += 1000;
			return 2;
		},
		teardown: sample => {
			events.push('teardown');
			assert.ok(sample.host);
			options.teardown?.();
		},
	};
	runInNewContext(browserSource.slice(browserSource.indexOf('let invoked = null;')), context);
	return {api: context.benchmarkLifecycle, runTrace: context.runBenchmarkTrace, context, events, marks};
}

describe('shared browser sample lifecycle', () => {
	it('delegates preparation and construction to each shared demo without benchmark options', () => {
		const source = browserSource.slice(browserSource.indexOf('function prepFor('), browserSource.indexOf('function validateChart('));
		const input = {}, host = {}, wait = {}, chart = {};
		const calls = [];
		const sources = Object.fromEntries(['uplot', 'd3', 'chartjs', 'echarts', 'flot', 'dygraphs'].map(variant => [variant, {
			prepData: packed => ({variant, packed}),
			makeChart: (...args) => { calls.push([variant, ...args]); return chart; },
		}]));
		const api = runInNewContext(source + '\n({prepFor, construct});', {sources, wait});
		for (const variant of Object.keys(sources)) {
			assert.equal(api.prepFor(variant), sources[variant].prepData);
			const sample = {variant, input, host};
			api.construct(sample);
			assert.equal(sample.chart, chart);
			assert.deepEqual(calls.at(-1), [variant, input, host, wait]);
		}
		assert.equal(api.prepFor('idle')(), null);
		api.construct({variant: 'idle'});
		assert.equal(calls.length, 6);
		assert.doesNotMatch(browserSource, /function options\(/);
	});

	it('rejects uPlot bundles that retain series or point paths after drawing', () => {
		const source = browserSource.slice(browserSource.indexOf('function validateChart('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1});
		const chart = {pxRatio: 1, series: [{}, {_paths: null, points: {_paths: null}}]};
		assert.equal(validate({variant: 'uplot', chart}), 1);
		chart.series[1]._paths = {};
		assert.throws(() => validate({variant: 'uplot', chart}), /retained paths despite cache.paths:false/);
		chart.series[1]._paths = null;
		chart.series[1].points._paths = {};
		assert.throws(() => validate({variant: 'uplot', chart}), /retained paths despite cache.paths:false/);
	});

	it('uses the preloaded uPlot IIFE and fails rather than importing source modules', () => {
		const startup = browserSource.slice(0, browserSource.indexOf('const WIDTH')) + '\nuPlot;';
		const uPlot = function() {};
		const context = {URL, location: {href: 'http://localhost/?variant=uplot'}, uPlot};
		assert.equal(runInNewContext(startup, context), uPlot);
		assert.throws(() => runInNewContext(startup, {...context, uPlot: undefined}), /Expected \/dist\/uPlot\.iife\.min\.js/);
		assert.equal(runInNewContext(startup, {URL, location: {href: 'http://localhost/?variant=idle'}}), null);
		assert.doesNotMatch(browserSource, /\/src\//);
		assert.match(browserSource, /import\('\/bench\/demo-fixture.mjs'\)/);
	});

	it('returns only metadata and numeric timing fields, with validation outside timers', async () => {
		const fake = browserFixture();
		const begin = fake.api.begin();
		assert.equal(begin.captureId, 'browser-capture');
		assert.equal(begin.source.uplot, '/dist/uPlot.iife.min.js');
		assert.equal(begin.source.uplotCss, '/dist/uPlot.min.css');
		assert.deepEqual(structuredClone(begin.config), {variants: ['uplot', 'chartjs', 'idle'], dpr: 2, warmups: 3, rounds: 7});
		assert.equal(begin.expectedInstances.samples, 30);
		assert.equal(begin.expectedInstances.chartCreations, 20);
		assert.equal(begin.expectedInstances.d3, 0);
		assert.equal(await fake.api.setup('uplot', 'sample-0'), undefined);
		assert.equal(await fake.api.prepare(), undefined);
		const sample = await fake.api.construct();
		assert.deepEqual(structuredClone(sample), timing('uplot', 'sample-0', 2));
		assert.deepEqual(fake.marks.map(mark => mark.name), [
			'benchmark:capture:browser-capture', 'benchmark:sample-0:start', 'benchmark:sample-0:js-end', 'benchmark:sample-0:end',
		]);
		const start = fake.events.indexOf('benchmark:sample-0:start');
		assert.deepEqual(fake.events.slice(start, start + 8), [
			'benchmark:sample-0:start', 'construct', 'microtask', 'benchmark:sample-0:js-end',
			'settle', 'benchmark:sample-0:end', 'checkPage', 'validateChart',
		]);
		assert.equal(await fake.api.destroy(), undefined);
		await fake.api.setup('chartjs', 'sample-1');
		await fake.api.prepare();
		assert.equal((await fake.api.construct()).id, 'sample-1');
		await fake.api.destroy();
	});

	it('requires begin, valid variants and chronological IDs, and enforces phase order', async () => {
		const {api} = browserFixture();
		await assert.rejects(api.setup('uplot', 'sample-0'), /begin/);
		api.begin();
		assert.throws(() => api.begin(), /exclusive/);
		await assert.rejects(api.setup('missing', 'sample-0'), /Unknown variant/);
		await assert.rejects(api.setup('uplot', 'sample-2'), /Expected sample-0/);
		await api.setup('uplot', 'sample-0');
		await assert.rejects(api.construct(), /prepared/);
		await assert.rejects(api.setup('uplot', 'sample-1'), /active sample/);
		await api.prepare();
		await assert.rejects(api.prepare(), /setup sample/);
		await api.construct();
		await assert.rejects(api.construct(), /prepared/);
		await api.destroy();
	});

	it('rejects concurrent lifecycle calls while settling', async () => {
		const pending = signal();
		const {api} = browserFixture({settle: () => pending.promise});
		api.begin();
		const setup = api.setup('uplot', 'sample-0');
		await assert.rejects(api.prepare(), /inactive/);
		await assert.rejects(api.destroy(), /inactive/);
		pending.resolve();
		await setup;
		await api.destroy();
	});

	it('drops state even when teardown fails', async () => {
		const primary = new Error('teardown');
		const fake = browserFixture({teardown: () => { throw primary; }});
		fake.api.begin();
		await fake.api.setup('uplot', 'sample-0');
		await assert.rejects(fake.api.destroy(), error => error === primary);
		await fake.api.destroy();
		assert.equal(fake.events.filter(event => event === 'teardown').length, 1);
		await fake.api.setup('uplot', 'sample-1');
	});

	it('keeps the rAF path functional and mutually exclusive in both directions', async () => {
		const shared = browserFixture();
		shared.api.begin();
		await assert.rejects(shared.runTrace({raf: true}), /exclusive/);
		const raf = browserFixture();
		const report = await raf.runTrace({raf: true});
		assert.equal(report.samples.length, 30);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 9);
		assert.equal(report.raf.enabled, true);
		assert.equal(report.raf.frameIntervalsMs.length, 16);
		assert.equal(report.samples[0].raf1Ms, 23);
		assert.equal(report.samples[0].postJsRaf1Ms, 16);
		assert.throws(() => raf.api.begin(), /exclusive/);
		await assert.rejects(raf.api.setup('uplot', 'sample-0'), /begin/);
	});

	it('defaults to all variants, preserves query variants, and delegates the chart call', () => {
		assert.match(browserSource, /const VARIANTS = selectedVariant \? \[selectedVariant\] : ALL_VARIANTS/);
		assert.match(browserSource, /const ALL_VARIANTS = \['uplot', 'd3', 'chartjs', 'echarts', 'flot', 'dygraphs', 'idle'\]/);
		assert.match(browserSource, /sources\[sample.variant\]\.makeChart\(sample.input, sample.host, wait\)/);
		for (const source of [browserSource, collectorSource]) {
			assert.doesNotMatch(source, /Runtime\.getHeapUsage|HeapProfiler\.enable|usedSize|backingStorageSize|heapMetrics|benchmarkMemory/);
		}
	});
});

describe('shared sample capture', () => {
	it('starts with begin and preserves browser timings and metadata in trace-only mode, without GC', async () => {
		const fake = fixture();
		const report = await fake.capture();
		assert.deepEqual(report.samples, [{...timing('uplot', 'sample-0', 1), round: 0, warmup: false}]);
		assert.equal(report.captureId, 'capture-id');
		assert.deepEqual(report.env, {actualDPR: 1});
		assert.equal(report.phase, 'initial-chart-creation');
		assert.equal(report.markerPattern, 'benchmark:<id>:start|js-end|end');
		assert.ok(report.limitations.includes('fixture limitation'));
		assert.equal(report.processProtocol, undefined);
		assert.deepEqual(fake.events.map(event => event.method), [
			'begin', 'setup', 'setup:end', 'prepare', 'prepare:end', 'construct', 'construct:end', 'destroy', 'destroy:end',
		]);
	});

	it('records process-only checkpoints/endpoints with exactly three GCs and none between prep and init', async () => {
		const fake = fixture({memory: true});
		const report = await fake.capture();
		const sample = report.samples[0];
		assert.deepEqual({...sample, processObservations: undefined}, {...timing('uplot', 'sample-0', 1), round: 0, warmup: false, processObservations: undefined});
		assert.deepEqual(sample.processObservations.map(({phase, kind}) => [phase, kind]), [
			['baseline', 'gc'], ['prepare', 'start'], ['prepare', 'end'], ['prepared', 'snapshot'],
			['construct', 'start'], ['construct', 'end'], ['live', 'gc'], ['cleanup', 'gc'],
		]);
		let previous = 0;
		for (const read of sample.processObservations) {
			assert.deepEqual(Object.keys(read), ['phase', 'kind', 'processMemory', 'processRequestedAtMs', 'processTimestampMs']);
			assert.deepEqual(read.processMemory, memory());
			assert.ok(read.processRequestedAtMs >= previous);
			assert.ok(read.processTimestampMs >= read.processRequestedAtMs);
			previous = read.processTimestampMs;
		}
		assert.deepEqual(fake.events.map(event => event.method).filter(method => !method.endsWith(':end')), [
			'begin', 'setup', gc, 'read', 'read', 'prepare', 'read', 'read', 'read', 'construct', 'read', gc, 'read', 'destroy', gc, 'read',
		]);
		assert.equal(report.processProtocol.requestedProcessPollIntervalMs, 50);
		assert.equal(report.processProtocol.separatePass, false);
		assert.match(report.processProtocol.prepared, /without GC/);
		// The existing raw summary accepts process observations via its observations field.
		const summary = summarizeProcessMemory({samples: [{...sample, observations: sample.processObservations}]});
		assert.equal(summary.groups[0].validObservationCount, 8);
		assert.equal(summary.groups[0].missingCheckpointCount, 0);
	});

	it('collects the actual browser lifecycle through return-by-value evaluation', async () => {
		const fake = browserFixture();
		const page = {send: () => assert.fail('trace-only capture must not send GC commands')};
		const report = await captureBenchmarkSamples(page, async (target, expression) => {
			assert.equal(target, page);
			return structuredClone(await runInNewContext(expression, fake.context));
		});
		assert.equal(report.captureId, 'browser-capture');
		assert.equal(report.samples.length, 30);
		assert.equal(fake.marks.length, 91);
		report.samples.forEach((sample, index) => {
			assert.deepEqual(sample, {...timing(sample.variant, `sample-${index}`, 2), round: Math.floor(index / 3) - 3, warmup: index < 9});
		});
	});

	it('applies process checkpoints to all three warmups and seven measured rounds', async () => {
		const fake = fixture({memory: true, config: {warmups: 3, rounds: 7}});
		const report = await fake.capture();
		assert.equal(report.samples.length, 10);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 3);
		assert.equal(fake.events.filter(event => event.method === gc).length, 30);
		assert.equal(fake.events.filter(event => event.method === 'destroy').length, 10);
		for (const sample of report.samples)
			assert.equal(sample.processObservations.length, 8);
	});

	it('allows explicit null processRead, even with a custom process interval', async () => {
		const fake = fixture({memory: true});
		const report = await fake.capture({processRead: null, processPollIntervalMs: 1});
		assert.equal(report.samples[0].processObservations, undefined);
		assert.equal(report.processProtocol, undefined);
		assert.ok(!fake.events.some(event => event.method === gc || event.method === 'read'));
	});

	it('uses config warmups/rounds, rotation/reversal, and chronological IDs', async () => {
		const variants = ['uplot', 'chartjs', 'idle'];
		const fake = fixture({config: {variants, dpr: 2, warmups: 3, rounds: 7}});
		const report = await fake.capture();
		assert.equal(report.samples.length, 30);
		assert.deepEqual(report.samples.slice(0, 12).map(sample => sample.variant), [
			'uplot', 'chartjs', 'idle', 'uplot', 'idle', 'chartjs', 'idle', 'uplot', 'chartjs', 'idle', 'chartjs', 'uplot',
		]);
		for (const variant of variants) {
			const samples = report.samples.filter(sample => sample.variant === variant);
			assert.deepEqual(samples.map(sample => sample.round), [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
			assert.equal(samples.filter(sample => sample.warmup).length, 3);
			assert.equal(samples.filter(sample => !sample.warmup).length, 7);
		}
		report.samples.forEach((sample, index) => {
			assert.equal(sample.id, `sample-${index}`);
			assert.equal(sample.dpr, 2);
			assert.equal(sample.warmup, sample.round < 0);
		});
	});

	it('polls independently while each renderer evaluation is blocked, waiting the requested interval after responses', async () => {
		const signals = {prepare: signal(), construct: signal()};
		const polls = {prepare: 0, construct: 0};
		const fake = fixture({
			memory: true,
			operation: method => signals[method] && waitFor(signals[method].promise),
			read: async (count, phase) => {
				if (signals[phase]) {
					await delay(8);
					if (++polls[phase] === 3)
						signals[phase].resolve();
				}
			},
		});
		const report = await fake.capture({processPollIntervalMs: 10});
		assert.equal(report.processProtocol.requestedProcessPollIntervalMs, 10);
		for (const phase of ['prepare', 'construct']) {
			const observations = report.samples[0].processObservations.filter(read => read.phase === phase && read.kind === 'poll');
			assert.equal(observations.length, 3);
			for (let i = 1; i < observations.length; i++)
				assert.ok(observations[i].processRequestedAtMs - observations[i - 1].processTimestampMs >= 8);
		}
	});

	it('drains an in-flight read before phase endpoints, GC, and destruction', async () => {
		const started = {prepare: signal(), construct: signal()};
		const fake = fixture({
			memory: true,
			operation: method => started[method] && waitFor(started[method].promise),
			read: async (count, phase) => {
				if (started[phase]) {
					started[phase].resolve();
					await delay(15);
				}
			},
		});
		await assertSettled(fake, () => fake.capture({processPollIntervalMs: 1}));
		for (const phase of ['prepare', 'construct']) {
			const end = fake.events.findIndex(event => event.method === `${phase}:end`);
			assert.equal(fake.events[end + 1].method, 'read:end');
			assert.equal(fake.events[end + 2].method, 'read');
		}
	});

	for (const phase of ['setup', 'prepare', 'construct']) {
		it(`destroys after ${phase} failure and preserves the primary error over destruction errors`, async () => {
			const primary = new Error(phase);
			const fake = fixture({memory: true, operation: method => {
				if (method === phase) throw primary;
				if (method === 'destroy') throw new Error('destroy');
			}});
			await assertSettled(fake, () => assert.rejects(fake.capture(), error => error === primary));
			assert.equal(fake.events.filter(event => event.method === 'destroy').length, 1);
			assert.equal(fake.events.at(-1).method, 'destroy:end');
		});
	}

	for (const readNumber of [1, 2, 3, 4, 5, 6, 7, 8]) {
		it(`propagates process read ${readNumber} failure and still destroys exactly once`, async () => {
			const primary = new Error(`read ${readNumber}`);
			const fake = fixture({memory: true, read: count => { if (count === readNumber) throw primary; }});
			await assertSettled(fake, () => assert.rejects(fake.capture(), error => error === primary));
			assert.equal(fake.events.filter(event => event.method === 'destroy').length, 1);
		});
	}

	for (const phase of ['prepare', 'construct']) {
		for (const evaluationFails of [false, true]) {
			it(`drains a rejecting ${phase} poll and preserves ${evaluationFails ? 'evaluation' : 'poll'} failure over cleanup`, async () => {
				const started = signal();
				const primary = new Error('evaluate');
				const polling = new Error('poll');
				const fake = fixture({
					memory: true,
					operation: async method => {
						if (method === phase) {
							await waitFor(started.promise);
							if (evaluationFails) throw primary;
						}
						if (method === 'destroy') throw new Error('cleanup');
					},
					read: async (count, active) => {
						if (active === phase) {
							started.resolve();
							await delay(15);
							throw polling;
						}
					},
				});
				await assertSettled(fake, () => assert.rejects(fake.capture({processPollIntervalMs: 1}), error => error === (evaluationFails ? primary : polling)));
				const end = fake.events.findIndex(event => event.method === `${phase}:end`);
				assert.deepEqual(fake.events.slice(end + 1).map(event => event.method), ['read:end', 'destroy', 'destroy:end']);
			});
		}
	}

	it('surfaces destruction failure without cleanup GC on an otherwise successful sample', async () => {
		const primary = new Error('destroy');
		const fake = fixture({memory: true, operation: method => { if (method === 'destroy') throw primary; }});
		await assert.rejects(fake.capture(), error => error === primary);
		assert.equal(fake.events.filter(event => event.method === gc).length, 2);
		assert.equal(fake.events.at(-1).method, 'destroy:end');
	});

	it('cleans up on a checkpoint GC rejection', async () => {
		const primary = new Error('GC');
		const fake = fixture({memory: true, gc: () => { throw primary; }});
		await assert.rejects(fake.capture(), error => error === primary);
		assert.equal(fake.events.at(-1).method, 'destroy:end');
	});

	for (const blocked of ['setup', 'GC']) {
		it(`bounds a stalled ${blocked} command and attempts destruction`, async () => {
			const events = [];
			const context = {
				performance, clearTimeout,
				// Shorten only the command deadlines, not the polling schedule.
				setTimeout: (callback, ms) => setTimeout(callback, ms >= 30000 ? 5 : ms),
			};
			runInNewContext(collectorSource.replace(/^import .*\n/, '').replace('export async function', 'async function') + '\nglobalThis.capture = captureBenchmarkSamples;', context);
			const page = {send: async method => {
				events.push(method);
				return new Promise(() => {});
			}};
			const evaluate = async (target, expression) => {
				events.push(expression);
				if (expression === 'benchmarkLifecycle.begin()')
					return {config: {variants: ['uplot'], dpr: 1, warmups: 0, rounds: 1}};
				if (blocked === 'setup' && expression.includes('.setup('))
					return new Promise(() => {});
			};
			await assert.rejects(context.capture(page, evaluate, blocked === 'GC' ? {processRead: memory} : {}), /timed out after (30000|120000)ms/);
			assert.equal(events.at(-1), 'benchmarkLifecycle.destroy()');
		});
	}

	it('validates arguments before begin and config before setup', async () => {
		for (const processPollIntervalMs of [0, -1, NaN, Infinity, '50']) {
			const fake = fixture();
			await assert.rejects(fake.capture({processPollIntervalMs}), /positive and finite/);
			assert.deepEqual(fake.events, []);
		}
		for (const processRead of [false, {}, 1]) {
			const fake = fixture();
			await assert.rejects(fake.capture({processRead}), /function or null/);
			assert.deepEqual(fake.events, []);
		}
		for (const config of [{variants: []}, {variants: ['a', 'a']}, {variants: [1]}, {dpr: 0}, {warmups: -1}, {rounds: 1.5}]) {
			const fake = fixture({config});
			await assert.rejects(fake.capture(), /Invalid benchmarkLifecycle config/);
			assert.deepEqual(fake.events, [{method: 'begin'}]);
		}
	});
});
