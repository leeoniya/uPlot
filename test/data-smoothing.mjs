import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const demoUrl = new URL('../demos/data-smoothing.html', import.meta.url);
const html = readFileSync(demoUrl, 'utf8');
const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), ([, attrs, source]) => ({
	src: attrs.match(/\bsrc=["']([^"']+)["']/)?.[1],
	source,
}));
const plotSrc = '../dist/uPlot.iife.js';
const synthetic = () => Array.from({length: 201}, (_, i) =>
	16000 + 3000 * Math.sin(i / 13) + 500 * Math.cos(i * 1.7) + (i % 47 === 0 ? 9000 : 0));

function fakeTimers() {
	let nextId = 0;
	const pending = new Map();
	const cancelled = [];
	return {
		pending,
		cancelled,
		setTimeout(callback, delay) {
			const id = ++nextId;
			pending.set(id, {callback, delay});
			return id;
		},
		clearTimeout(id) {
			cancelled.push(id);
			pending.delete(id);
		},
		flush() {
			// Run only timers pending at the start of this deterministic turn.
			for (const [id, {callback}] of Array.from(pending)) {
				if (pending.delete(id)) callback();
			}
		},
	};
}

// Marker curves exercise wiring and reuse without invoking the ADMM solver.
function createQuantileStub() {
	const curves = [[], [], []];
	const result = {curves, iterations: [3, 5, 4], converged: [true, true, true]};
	return (data, {x, quantiles, knots, lambda}) => {
		for (let q = 0; q < curves.length; q++) {
			curves[q].length = data.length;
			for (let i = 0; i < data.length; i++)
				curves[q][i] = Number.isFinite(data[i]) ? data[i] + 2000 * (quantiles[q] - 0.5) +
					3 * knots + 50 * Math.log10(lambda) + 100 * (x[i] - x[0]) / (x.at(-1) - x[0]) : null;
		}
		return result;
	};
}

function setContextGlobal(context, name, value) {
	// Bun does not sync host-side sandbox writes to existing global var bindings.
	vm.runInContext(`value => { ${name} = value; }`, context)(value);
}

async function loadDemo(t, {data = synthetic(), window: hostWindow, Plot, realQuantiles = false} = {}) {
	if (realQuantiles) assert.equal(process.env.TEST_QUANTILE_GAM, '1', 'real quantile fits require explicit opt-in');
	const window = hostWindow ?? new Window({settings: {errorCapture: 'disabled'}});
	const original = data.slice();
	const existingNodes = new Set(window.document.body.childNodes);
	const charts = [];
	const calls = {loess: [], mean: [], gam: []};
	const factoryCreations = {loess: 0, mean: 0, gam: 0};
	const oneShotCalls = {loess: 0, mean: 0, gam: 0};
	const timers = fakeTimers();
	const fetched = [];
	let nextGamResponse;
	t.after(async () => {
		timers.pending.clear();
		for (const chart of charts) chart.plot?.destroy();
		for (const node of Array.from(window.document.body.childNodes)) {
			if (!existingNodes.has(node)) node.remove();
		}
		if (!hostWindow) await window.happyDOM.close();
	});

	class Chart {
		constructor(opts, data, target) {
			if (opts.title === 'Taxi Trips (LOESS)') {
				assert.equal(calls.loess.length, 1, 'LOESS fits before chart construction');
				assert.equal(data[2], calls.loess[0].result);
			}
			if (opts.title === 'Taxi Trips (GAM)') {
				assert.equal(calls.mean.length, 1, 'mean GAM fits before chart construction');
				assert.equal(calls.gam.length, 0);
				assert.equal(data[2], calls.mean[0].result);
			}
			this.opts = opts;
			this.series = Array.from(opts.series);
			this.seriesOps = [];
			this.data = data;
			this.updates = 0;
			this.plot = Plot ? new Plot(opts, data, target) : null;
			charts.push(this);
		}
		setData(data) {
			assert.equal(data.length, this.series.length, 'each data column has a series');
			this.data = data;
			this.updates++;
			this.plot?.setData(data);
		}
		addSeries(series, index = this.series.length) {
			this.series.splice(index, 0, series);
			this.seriesOps.push(['add', index, series.label]);
			this.plot?.addSeries(series, index);
		}
		delSeries(index) {
			assert.ok(index >= 2 && index < this.series.length, 'remove only a fitted series');
			this.seriesOps.push(['del', index, this.series[index].label]);
			this.series.splice(index, 1);
			this.plot?.delSeries(index);
		}
	}

	const context = vm.createContext({
		document: window.document,
		devicePixelRatio: window.devicePixelRatio,
		console: {time() {}, timeEnd() {}},
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		fetch(url) {
			fetched.push(url);
			return Promise.resolve({json: () => Promise.resolve(data)});
		},
	});

	// Load every classic script in page order; only quantile fitting is stubbed by default.
	for (const {src, source} of scripts) {
		if (src === plotSrc)
			context.uPlot = Chart;
		else if (src) {
			vm.runInContext(readFileSync(new URL(src, demoUrl), 'utf8'), context, {filename: src});
			for (const [file, kind, name, factory] of [
				['/loess.js', 'loess', 'loess', 'createLoess'],
				['/mean-gam.js', 'mean', 'meanGAM', 'createMeanGAM'],
			]) {
				if (!src.endsWith(file)) continue;
				const create = context[factory];
				setContextGlobal(context, name, () => {
					oneShotCalls[kind]++;
					assert.fail(`the demo must retain ${factory}(), not call ${name}()`);
				});
				setContextGlobal(context, factory, () => {
					factoryCreations[kind]++;
					const fit = create();
					return (data, options) => {
						const result = fit(data, options);
						calls[kind].push({
							data, optionsRef: options, xRef: options.x, quantilesRef: options.quantiles,
							options: snapshotOptions(options), result, values: Array.from(result),
						});
						return result;
					};
				});
			}
			if (src.endsWith('/quantile-gam.js')) {
				const create = realQuantiles ? context.createQuantileGAM : createQuantileStub;
				setContextGlobal(context, 'quantileGAM', () => {
					oneShotCalls.gam++;
					assert.fail('the demo must retain createQuantileGAM(), not call quantileGAM()');
				});
				setContextGlobal(context, 'createQuantileGAM', () => {
					factoryCreations.gam++;
					const fit = create();
					return (data, options) => {
						const fitted = fit(data, options);
						const overridden = nextGamResponse != null;
						const result = overridden ? nextGamResponse(fitted) : fitted;
						nextGamResponse = null;
						calls.gam.push({
							data, optionsRef: options, xRef: options.x, quantilesRef: options.quantiles,
							options: snapshotOptions(options),
							fitted, result, overridden, curvesRef: fitted.curves, curveRefs: Array.from(fitted.curves),
							iterationsRef: fitted.iterations, convergedRef: fitted.converged,
							values: Array.from(result.curves, curve => Array.from(curve)),
							iterations: Array.from(result.iterations), converged: Array.from(result.converged),
						});
						return result;
					};
				});
			}
		}
		else
			await vm.runInContext(source, context, {filename: demoUrl.pathname});
	}
	assert.deepEqual(fetched, ['./data/taxi-trips.json']);
	assert.equal(charts.length, 8);
	return {
		window, charts, calls, factoryCreations, oneShotCalls, timers, data, original,
		loess: window.document.querySelector('#loess-controls'),
		gam: window.document.querySelector('#gam-controls'),
		nextGamResponse(transform) { nextGamResponse = transform; },
	};
}

function snapshotOptions(options) {
	return {...options, x: Array.from(options.x),
		...(options.quantiles ? {quantiles: Array.from(options.quantiles)} : {})};
}

function toggleQuantiles(demo, checked, expectedData = demo.original) {
	const checkbox = demo.gam.elements.quantile;
	const before = snapshot(demo.charts);
	const pending = Array.from(demo.timers.pending.keys());
	const counts = [demo.calls.mean.length, demo.calls.gam.length];
	checkbox.checked = checked;
	checkbox.dispatchEvent(new demo.window.Event('input', {bubbles: true}));
	assertUpdates(demo, before, -1, expectedData);
	assert.deepEqual(Array.from(demo.timers.pending.keys()), pending, 'checkbox input does not schedule a refit');
	assert.deepEqual([demo.calls.mean.length, demo.calls.gam.length], counts);
	checkbox.dispatchEvent(new demo.window.Event('change', {bubbles: true}));
}

function input(demo, form, name, value) {
	const control = form.elements[name];
	control.value = String(value);
	control.dispatchEvent(new demo.window.Event('input', {bubbles: true}));
}

function submit(demo, form) {
	const event = new demo.window.Event('submit', {bubbles: true, cancelable: true});
	assert.equal(form.dispatchEvent(event), false);
	assert.equal(event.defaultPrevented, true);
}

function assertReadouts({loess, gam}) {
	for (const form of [loess, gam]) {
		for (const slider of form.querySelectorAll('input[type="range"]')) {
			const readout = slider.nextElementSibling;
			assert.equal(readout.tagName, 'SPAN');
			assert.ok(readout.classList.contains('slider-value'));
			const expected = slider.name === 'logSpan' ? String(Number((0.05 * 2 ** slider.valueAsNumber).toPrecision(4))) :
				slider.name === 'logLambda' ? String(Number((10 ** slider.valueAsNumber).toPrecision(3))) : slider.value;
			assert.equal(readout.textContent, expected);
			if (slider.name === 'logSpan') assert.equal(slider.getAttribute('aria-valuetext'), expected);
		}
	}
	assert.equal(gam.elements.tail.disabled, !gam.elements.quantile.checked);
	assert.equal(gam.querySelector('[data-quantile-details]').hidden, !gam.elements.quantile.checked);
}

const snapshot = charts => charts.map(chart => ({
	chart, data: chart.data, buffers: Array.from(chart.data), updates: chart.updates,
	series: Array.from(chart.series), seriesOps: chart.seriesOps.length,
	values: Array.from(chart.data, column => Array.from(column)),
}));

function assertReuse({calls, factoryCreations, oneShotCalls}) {
	assert.deepEqual(factoryCreations, {loess: 1, mean: 1, gam: calls.gam.length ? 1 : 0});
	assert.deepEqual(oneShotCalls, {loess: 0, mean: 0, gam: 0});
	for (const kind of ['loess', 'mean', 'gam']) {
		const first = calls[kind][0];
		if (kind === 'gam' && !first) continue;
		assert.ok(first);
		for (const call of calls[kind]) {
			assert.equal(call.optionsRef, first.optionsRef, `${kind} reuses its options object`);
			assert.equal(call.xRef, first.xRef);
			if (kind !== 'loess') {
				assert.equal(call.optionsRef, calls.mean[0].optionsRef, 'both GAM modes share options');
				assert.equal(call.quantilesRef, calls.mean[0].quantilesRef);
			}
			if (kind !== 'gam')
				assert.equal(call.result, first.result);
			else {
				assert.equal(call.quantilesRef, first.quantilesRef);
				assert.equal(call.fitted, first.fitted);
				assert.equal(call.curvesRef, first.curvesRef);
				assert.equal(call.iterationsRef, first.iterationsRef);
				assert.equal(call.convergedRef, first.convergedRef);
				assert.equal(call.curveRefs.length, 3);
				call.curveRefs.forEach((curve, q) => assert.equal(curve, first.curveRefs[q]));
				assert.equal(call.result.curves, call.curvesRef, 'even overridden diagnostics retain the real curves');
				if (!call.overridden) {
					assert.equal(call.result, first.result);
					assert.equal(call.result.iterations, call.iterationsRef);
					assert.equal(call.result.converged, call.convergedRef);
				}
			}
		}
	}
}

function assertUpdates(demo, before, changed = -1, expectedData = demo.original, modeChanged = false) {
	assertReuse(demo);
	assert.equal(demo.charts.length, 8);
	demo.charts.forEach((chart, i) => {
		assert.equal(chart, before[i].chart);
		assert.equal(chart.data, before[i].data);
		if (i === 7 && modeChanged) {
			for (const j of [0, 1]) {
				assert.equal(chart.data[j], before[i].buffers[j]);
				assert.equal(chart.series[j], before[i].series[j]);
			}
		}
		else {
			assert.equal(chart.data.length, before[i].buffers.length);
			before[i].buffers.forEach((buffer, j) => assert.equal(chart.data[j], buffer));
			assert.equal(chart.series.length, before[i].series.length);
			before[i].series.forEach((series, j) => assert.equal(chart.series[j], series));
			assert.equal(chart.seriesOps.length, before[i].seriesOps);
		}
		assert.equal(chart.updates, before[i].updates + (i === changed ? 1 : 0), chart.opts.title);
		if (i !== changed)
			assert.deepEqual(Array.from(chart.data, column => Array.from(column)), before[i].values);
	});
	assert.deepEqual(demo.data, expectedData);
}

function assertFits(demo, x = demo.original.map((_, i) => i), expectedData = demo.original) {
	const {charts, calls, data, original} = demo;
	assertReuse(demo);
	assert.deepEqual(data, expectedData);
	for (const i of [0, 1, 2, 6, 7]) {
		assert.equal(charts[i].data[1], data);
		assert.deepEqual(Array.from(charts[i].data[0]), i === 0 ? original.map((_, i) => i) : x);
	}
	for (const i of [6, 7]) assert.equal(charts[i].data[0], charts[1].data[0]);
	const quantile = demo.gam.elements.quantile.checked;
	const gamCall = (quantile ? calls.gam : calls.mean).at(-1);
	assert.equal(calls.loess.at(-1).data, data);
	assert.equal(gamCall.data, data);
	assert.equal(calls.loess.at(-1).xRef, charts[6].data[0]);
	assert.equal(gamCall.xRef, charts[7].data[0]);
	const expected = [calls.loess.at(-1).result, ...(quantile ? gamCall.curveRefs : [gamCall.result])];
	const values = [calls.loess.at(-1).values, ...(quantile ? gamCall.values : [gamCall.values])];
	const actual = [charts[6].data[2], ...charts[7].data.slice(2)];
	assert.equal(actual.length, quantile ? 4 : 2);
	assert.deepEqual(charts[7].series.slice(1).map(series => series.label),
		['Trips', ...(quantile ? ['Lower quantile', 'Median', 'Upper quantile'] : ['Mean'])]);
	assert.equal(charts[7].series.length, charts[7].data.length);
	actual.forEach((curve, i) => {
		assert.notEqual(curve, data);
		assert.equal(curve, expected[i], 'charts use fitter outputs directly, without copying');
		assert.equal(curve.length, data.length);
		assert.ok(curve.every(Number.isFinite));
		assert.deepEqual(Array.from(curve), values[i]);
	});
}

function assertFitStatus(demo) {
	if (!demo.gam.elements.quantile.checked) {
		assert.equal(demo.gam.querySelector('output').textContent.trim(), 'Mean · Penalized least squares.');
		return;
	}
	const {options, converged, iterations} = demo.calls.gam.at(-1);
	assert.deepEqual(converged, [true, true, true]);
	const probabilities = options.quantiles.map(q => `p${Math.round(q * 100)}`).join(' / ');
	assert.equal(demo.gam.querySelector('output').textContent.trim(),
		`${probabilities} · Converged in up to ${Math.max(...iterations)} iterations.`);
}

describe('data smoothing demo controls', () => {
	it('references existing external assets and exposes the new classic-script globals', () => {
		const sources = scripts.filter(script => script.src).map(script => script.src);
		const styles = Array.from(html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/g), match => match[1]);
		assert.ok(sources.includes(plotSrc));
		assert.ok(styles.includes('../dist/uPlot.min.css'));
		for (const src of [...sources, ...styles]) {
			const url = new URL(src, demoUrl);
			assert.equal(url.protocol, 'file:');
			assert.ok(statSync(url).isFile(), src);
			assert.ok(statSync(url).size > 0, src);
		}
		for (const [src, names] of [
			['./lib/loess.js', ['loess', 'createLoess']],
			['./lib/mean-gam.js', ['meanGAM', 'createMeanGAM']],
			['./lib/quantile-gam.js', ['quantileGAM', 'createQuantileGAM']],
		]) {
			assert.equal(sources.filter(value => value === src).length, 1);
			assert.ok(scripts.findIndex(script => script.src === src) < scripts.findIndex(script => !script.src));
			const context = vm.createContext({});
			vm.runInContext(readFileSync(new URL(src, demoUrl), 'utf8'), context, {filename: src});
			assert.deepEqual(Object.keys(context).sort(), names.slice().sort());
			for (const name of names) assert.equal(typeof context[name], 'function');
			assert.equal(typeof context[names[1]](), 'function');
		}
		const context = vm.createContext({});
		for (const src of sources.filter(src => src !== plotSrc))
			vm.runInContext(readFileSync(new URL(src, demoUrl), 'utf8'), context, {filename: src});
		for (const name of ['smooth', 'sgg', 'dbscan1d', 'prepareDbscan1d', 'prepareDoubleMad', 'loess', 'createLoess', 'meanGAM', 'createMeanGAM', 'quantileGAM', 'createQuantileGAM'])
			assert.equal(vm.runInContext(`typeof ${name}`, context), 'function', name);
	});

	it('creates exactly eight charts with real LOESS and mean fits, leaving quantiles uninitialized', async t => {
		const demo = await loadDemo(t);
		const {loess, gam, charts, calls, timers} = demo;
		assert.deepEqual(charts.map(chart => chart.opts.title), [
			'Taxi Trips (raw)', 'Taxi Trips (DBSCAN outliers)', 'Taxi Trips (Double MAD, Harrell–Davis)',
			'Savitzky-Golay', 'Taxi Trips (ASAP FFT)', 'Taxi Trips (Moving Avg 300)',
			'Taxi Trips (LOESS)', 'Taxi Trips (GAM)',
		]);
		for (const [form, name, min, max, step, value] of [
			[loess, 'logSpan', '-5', '3', '0.01', '0'],
			[loess, 'robustnessIters', '0', '5', '1', '2'],
			[loess, 'maxFits', '128', '2048', '128', '512'],
			[gam, 'knots', '8', '60', '1', '30'],
			[gam, 'logLambda', '-2', '4', '0.25', '1'],
			[gam, 'tail', '0.05', '0.45', '0.05', '0.1'],
		]) {
			const control = form.elements[name];
			assert.equal(control.type, 'range');
			assert.deepEqual([control.min, control.max, control.step, control.defaultValue, control.value], [min, max, step, value, value]);
			assert.equal(control.disabled, name === 'tail');
		}
		assert.equal(gam.elements.quantile.type, 'checkbox');
		assert.equal(gam.elements.quantile.checked, false);
		assert.equal(gam.elements.quantile.defaultChecked, false);
		assert.equal(gam.querySelector('button').type, 'submit');
		assert.equal(gam.querySelector('button').textContent, 'Fit GAM');
		assert.equal(gam.querySelector('output').getAttribute('aria-live'), 'polite');
		assert.deepEqual(Array.from(charts[6].opts.series, series => series.label), [undefined, 'Trips', 'LOESS']);
		assert.deepEqual(charts[7].series.map(series => series.label), [undefined, 'Trips', 'Mean']);
		assert.equal(calls.loess.length, 1);
		assert.equal(calls.mean.length, 1);
		assert.equal(calls.gam.length, 0);
		assert.deepEqual(demo.factoryCreations, {loess: 1, mean: 1, gam: 0});
		assert.deepEqual(calls.loess[0].options, {x: Array.from(charts[6].data[0]), span: 0.05, robustnessIters: 2, maxFits: 512});
		assert.deepEqual(calls.mean[0].options, {x: Array.from(charts[7].data[0]), quantiles: [0.1, 0.5, 0.9], knots: 30, lambda: 10});
		assert.equal(charts[6].updates, 0);
		assert.equal(charts[7].updates, 0);
		assert.equal(timers.pending.size, 0);
		assertReadouts(demo);
		assertFits(demo);
		assertFitStatus(demo);
	});

	it('gives the LOESS span finer logarithmic steps below 0.01 without changing its default', async t => {
		const demo = await loadDemo(t);
		assert.equal(demo.calls.loess[0].options.span, 0.05);
		let previous = 0;
		for (const position of [-5, -3, -2.99, 0, 2, 3]) {
			const before = snapshot(demo.charts);
			input(demo, demo.loess, 'logSpan', position);
			const span = demo.calls.loess.at(-1).options.span;
			assert.equal(span, 0.05 * 2 ** position);
			assert.ok(span > previous);
			if (position === -5) assert.equal(span, 0.0015625);
			if (position === -2.99) {
				assert.ok(span - previous < 0.00005, 'fine adjustment below a span of 0.01');
				assert.ok(Math.abs(span / previous - 2 ** 0.01) < 1e-12);
			}
			if (position === 3) assert.equal(span, 0.4);
			assertUpdates(demo, before, 6);
			assertReadouts(demo);
			assertFits(demo);
			previous = span;
		}
	});

	it('updates only LOESS synchronously and keeps raw samples, x positions, and buffers unchanged', async t => {
		const demo = await loadDemo(t);
		for (const [name, value] of [['logSpan', 2], ['maxFits', 128], ['robustnessIters', 0], ['robustnessIters', 5], ['logSpan', -3]]) {
			const before = snapshot(demo.charts);
			const count = demo.calls.loess.length;
			input(demo, demo.loess, name, value);
			assert.equal(demo.calls.loess.length, count + 1);
			assert.equal(demo.calls.mean.length, 1);
			assert.equal(demo.calls.gam.length, 0);
			assert.deepEqual(demo.calls.loess.at(-1).options, {
				x: Array.from(demo.charts[6].data[0]),
				span: 0.05 * 2 ** demo.loess.elements.logSpan.valueAsNumber,
				robustnessIters: demo.loess.elements.robustnessIters.valueAsNumber,
				maxFits: demo.loess.elements.maxFits.valueAsNumber,
			});
			assertUpdates(demo, before, 6);
			assert.notDeepEqual(Array.from(demo.charts[6].data[2]), before[6].values[2]);
			assert.equal(demo.timers.pending.size, 0);
			assertReadouts(demo);
			assertFits(demo);
		}
		const before = snapshot(demo.charts);
		demo.loess.elements.logSpan.value = '1';
		demo.loess.elements.robustnessIters.value = '1';
		submit(demo, demo.loess);
		assert.deepEqual(demo.calls.loess.at(-1).options, {x: Array.from(demo.charts[6].data[0]), span: 0.1, robustnessIters: 1, maxFits: 128});
		assertUpdates(demo, before, 6);
		assertReadouts(demo);
		assertFits(demo);
	});

	for (const quantile of [false, true]) {
		it(`reuses options and output buffers across LOESS and ${quantile ? 'quantile' : 'mean'} GAM control changes`, async t => {
			const demo = await loadDemo(t);
			if (quantile) toggleQuantiles(demo, true);
			const gamCalls = quantile ? demo.calls.gam : demo.calls.mean;
			const initial = snapshot(demo.charts);
			for (const [kind, name, value] of [
				['gam', 'knots', 48], ['gam', 'knots', 12], ['gam', 'knots', 36],
				['gam', 'logLambda', 1.25], ['gam', 'logLambda', 2],
				...(quantile ? [['gam', 'tail', 0.2], ['gam', 'tail', 0.35]] : []),
				['loess', 'logSpan', 2], ['loess', 'maxFits', 128],
				['loess', 'robustnessIters', 0], ['loess', 'maxFits', 2048],
			]) {
				const before = snapshot(demo.charts);
				const calls = kind === 'loess' ? demo.calls.loess : gamCalls;
				const count = calls.length;
				input(demo, demo[kind], name, value);
				if (kind === 'gam') {
					assert.equal(calls.length, count);
					assertUpdates(demo, before);
					demo.timers.flush();
				}
				const chartIndex = kind === 'loess' ? 6 : 7;
				assert.equal(calls.length, count + 1);
				assertUpdates(demo, before, chartIndex);
				assertReadouts(demo);
				assertFits(demo);
				assert.notDeepEqual(Array.from(demo.charts[chartIndex].data[2]), before[chartIndex].values[2]);
				assert.equal(demo.timers.pending.size, 0);
			}
			for (const i of [6, 7])
				initial[i].buffers.forEach((buffer, j) => assert.equal(demo.charts[i].data[j], buffer));
			const x = Array.from(demo.charts[6].data[0]);
			const quantiles = quantile ? [0.35, 0.5, 0.65] : [0.1, 0.5, 0.9];
			assert.deepEqual(demo.calls.loess[0].options, {x, span: 0.05, robustnessIters: 2, maxFits: 512});
			assert.deepEqual(demo.calls.loess.at(-1).options, {x, span: 0.2, robustnessIters: 0, maxFits: 2048});
			assert.deepEqual(gamCalls[0].options, {x, quantiles: [0.1, 0.5, 0.9], knots: 30, lambda: 10});
			assert.deepEqual(gamCalls.at(-1).options, {x, quantiles, knots: 36, lambda: 100});
			assert.deepEqual(Array.from(gamCalls[0].quantilesRef), quantiles);
			assert.deepEqual(demo.calls.loess[0].values, initial[6].values[2]);
			assert.deepEqual(gamCalls[0].values, quantile ? initial[7].values.slice(2) : initial[7].values[2]);
			assertFitStatus(demo);
		});
	}

	it('rereads changed raw samples without replacing fitters or output buffers', async t => {
		const demo = await loadDemo(t);
		for (const offset of [2500, -1200]) {
			for (let i = 0; i < demo.data.length; i++) demo.data[i] = demo.original[i] + offset;
			const samples = demo.data.slice();
			for (const [form, chartIndex] of [[demo.loess, 6], [demo.gam, 7]]) {
				const before = snapshot(demo.charts);
				submit(demo, form);
				assertUpdates(demo, before, chartIndex, samples);
				assertFits(demo, undefined, samples);
				assert.notDeepEqual(Array.from(demo.charts[chartIndex].data[2]), before[chartIndex].values[2]);
			}
			assertFitStatus(demo);
		}
	});

	it('uses the chart x coordinates for irregularly spaced time-series fits', async t => {
		const demo = await loadDemo(t);
		const x = demo.charts[6].data[0];
		for (let i = 0; i < x.length; i++) x[i] = 1.7e12 + i * i;
		const coordinates = Array.from(x);
		for (const [form, chartIndex] of [[demo.loess, 6], [demo.gam, 7]]) {
			const before = snapshot(demo.charts);
			submit(demo, form);
			assertUpdates(demo, before, chartIndex);
			assertFits(demo, coordinates);
			assert.deepEqual(Array.from(x), coordinates);
			assert.notDeepEqual(Array.from(demo.charts[chartIndex].data[2]), before[chartIndex].values[2]);
		}
		for (const kind of ['loess', 'mean']) {
			assert.deepEqual(demo.calls[kind][0].options.x, demo.original.map((_, i) => i));
			assert.deepEqual(demo.calls[kind].at(-1).options.x, coordinates);
		}
		assertFitStatus(demo);
	});

	for (const quantile of [false, true]) {
		it(`coalesces ${quantile ? 'quantile' : 'mean'} GAM input events while updating readouts immediately`, async t => {
			const demo = await loadDemo(t);
			if (quantile) toggleQuantiles(demo, true);
			const calls = quantile ? demo.calls.gam : demo.calls.mean;
			const before = snapshot(demo.charts);
			let previousTimer;
			for (const [name, value] of [
				['knots', 18], ['logLambda', -0.5], ...(quantile ? [['tail', 0.2]] : []),
				['knots', 24], ['logLambda', 1.25],
			]) {
				input(demo, demo.gam, name, value);
				assertReadouts(demo);
				assert.equal(demo.gam.querySelector('output').textContent.trim(), 'Waiting to refit…');
				assert.equal(calls.length, 1);
				assert.equal(demo.calls.loess.length, 1);
				assertUpdates(demo, before);
				assert.equal(demo.timers.pending.size, 1);
				const [[id, timer]] = demo.timers.pending;
				assert.equal(timer.delay, 200);
				if (previousTimer !== undefined) {
					assert.ok(demo.timers.cancelled.includes(previousTimer));
					assert.notEqual(id, previousTimer);
				}
				previousTimer = id;
			}
			assert.equal(demo.gam.elements.logLambda.nextElementSibling.textContent, '17.8');
			demo.timers.flush();
			assert.equal(calls.length, 2);
			assert.deepEqual(calls.at(-1).options, {x: Array.from(demo.charts[7].data[0]),
				quantiles: quantile ? [0.2, 0.5, 0.8] : [0.1, 0.5, 0.9], knots: 24, lambda: 10 ** 1.25});
			assert.equal(demo.timers.pending.size, 0);
			assertUpdates(demo, before, 7);
			assert.notDeepEqual(Array.from(demo.charts[7].data[2]), before[7].values[2]);
			assertFits(demo);
			assertFitStatus(demo);
			const fitted = snapshot(demo.charts);
			demo.timers.flush();
			assert.equal(calls.length, 2);
			assertUpdates(demo, fitted);
		});

		it(`submits the latest ${quantile ? 'quantile' : 'mean'} GAM options immediately and cancels its pending timer`, async t => {
			const demo = await loadDemo(t);
			if (quantile) toggleQuantiles(demo, true);
			const calls = quantile ? demo.calls.gam : demo.calls.mean;
			input(demo, demo.gam, 'knots', 18);
			const [pending] = demo.timers.pending.keys();
			const before = snapshot(demo.charts);
			// Values without input events must replace any options captured by the timer.
			demo.gam.elements.knots.value = '20';
			demo.gam.elements.logLambda.value = '2';
			if (quantile) demo.gam.elements.tail.value = '0.25';
			submit(demo, demo.gam);
			assert.equal(calls.length, 2);
			assert.equal(demo.calls.loess.length, 1);
			assert.deepEqual(calls.at(-1).options, {x: Array.from(demo.charts[7].data[0]),
				quantiles: quantile ? [0.25, 0.5, 0.75] : [0.1, 0.5, 0.9], knots: 20, lambda: 100});
			assert.ok(demo.timers.cancelled.includes(pending));
			assert.equal(demo.timers.pending.size, 0);
			assertUpdates(demo, before, 7);
			assertReadouts(demo);
			assertFits(demo);
			assertFitStatus(demo);
			const fitted = snapshot(demo.charts);
			demo.timers.flush();
			assert.equal(calls.length, 2);
			assertUpdates(demo, fitted);
		});
	}

	it('switches mean → quantile → mean → quantile with one lazy fitter and no stale curves or timers', async t => {
		const demo = await loadDemo(t);
		assert.equal(demo.factoryCreations.gam, 0);
		assertFits(demo);
		for (const [quantile, knots, logLambda, tail] of [
			[true, 24, 1.25, 0.1], [false, 20, 2, 0.2], [true, 36, 0.5, 0.2],
		]) {
			input(demo, demo.gam, 'knots', knots);
			input(demo, demo.gam, 'logLambda', logLambda);
			if (!demo.gam.elements.tail.disabled) input(demo, demo.gam, 'tail', tail);
			assert.equal(demo.gam.elements.tail.valueAsNumber, tail);
			const [pending] = demo.timers.pending.keys();
			const before = snapshot(demo.charts);
			const counts = [demo.calls.mean.length, demo.calls.gam.length];
			const inactive = (quantile ? demo.calls.mean : demo.calls.gam).at(-1);
			toggleQuantiles(demo, quantile);
			assertUpdates(demo, before, 7, demo.original, true);
			assert.deepEqual([demo.calls.mean.length, demo.calls.gam.length],
				[counts[0] + (quantile ? 0 : 1), counts[1] + (quantile ? 1 : 0)]);
			assert.deepEqual(demo.factoryCreations, {loess: 1, mean: 1, gam: 1});
			assert.ok(demo.timers.cancelled.includes(pending));
			assert.equal(demo.timers.pending.size, 0);
			assert.deepEqual(demo.charts[7].seriesOps.slice(before[7].seriesOps), quantile ? [
				['del', 2, 'Mean'], ['add', 2, 'Lower quantile'], ['add', 3, 'Median'], ['add', 4, 'Upper quantile'],
			] : [
				['del', 2, 'Lower quantile'], ['del', 2, 'Median'], ['del', 2, 'Upper quantile'], ['add', 2, 'Mean'],
			]);
			const current = (quantile ? demo.calls.gam : demo.calls.mean).at(-1);
			assert.deepEqual(current.options, {x: Array.from(demo.charts[7].data[0]),
				quantiles: [tail, 0.5, 1 - tail], knots, lambda: 10 ** logLambda});
			const inactiveCurves = quantile ? [inactive.result] : inactive.curveRefs;
			assert.ok(inactiveCurves.every(curve => !demo.charts[7].data.includes(curve)));
			assert.deepEqual(quantile ? Array.from(inactive.result) : inactive.curveRefs.map(curve => Array.from(curve)), inactive.values);
			assertReadouts(demo);
			assertFits(demo);
			assertFitStatus(demo);
			const fitted = snapshot(demo.charts);
			const fittedCounts = [demo.calls.mean.length, demo.calls.gam.length];
			demo.timers.flush();
			assertUpdates(demo, fitted);
			assert.deepEqual([demo.calls.mean.length, demo.calls.gam.length], fittedCounts);
		}
		assert.equal(demo.calls.mean.length, 2);
		assert.equal(demo.calls.gam.length, 2);
		assert.notDeepEqual(demo.calls.mean[1].values, demo.calls.mean[0].values);
		assert.notDeepEqual(demo.calls.gam[1].values, demo.calls.gam[0].values);
	});

	it('identifies unfinished lower/upper quantiles honestly and clears the one-response warning on refit', async t => {
		const demo = await loadDemo(t);
		toggleQuantiles(demo, true);
		assertFitStatus(demo);
		demo.gam.elements.tail.value = '0.2';
		// Alter one response's diagnostics without replacing the retained curve arrays.
		demo.nextGamResponse(fit => ({...fit, converged: [false, true, false], iterations: [10000, fit.iterations[1], 10000]}));
		const before = snapshot(demo.charts);
		submit(demo, demo.gam);
		assert.equal(demo.calls.gam.length, 2);
		assert.equal(demo.gam.querySelector('output').textContent.trim(),
			'p20 / p50 / p80 · Iteration limit reached for p20, p80. These fits are approximate.');
		assert.doesNotMatch(demo.gam.querySelector('output').textContent, /converged/i);
		assertUpdates(demo, before, 7);
		assertReadouts(demo);
		assertFits(demo);
		const warned = snapshot(demo.charts);
		submit(demo, demo.gam);
		assert.equal(demo.calls.gam.length, 3);
		assertUpdates(demo, warned, 7);
		assertFits(demo);
		assertFitStatus(demo);
	});

	it('smoke-renders eight taxi charts and mode switches with real uPlot, real mean fits, and stub quantiles', async t => {
		await smokeRender(t);
	});
});

async function smokeRender(t, realQuantiles = false) {
	await import('../scripts/instrument.mjs');
	const {default: uPlot} = await import('../src/uPlot.js');
	const data = JSON.parse(readFileSync(new URL('./data/taxi-trips.json', demoUrl), 'utf8'));
	assert.equal(data.length, 3600);
	const demo = await loadDemo(t, {data, window: globalThis.window, Plot: uPlot, realQuantiles});
	await Promise.resolve();
	for (const {plot, data} of demo.charts) {
		assert.ok(plot.root.classList.contains('uplot'));
		assert.equal(plot.series.length, data.length);
		assert.equal(plot.status, 1);
		assert.ok(plot.root.isConnected);
		assert.equal(plot.data, data);
		assert.ok(plot.ctx.log.some(entry => entry[0] === 'stroke'));
	}
	assertReadouts(demo);
	assertFits(demo);
	assertFitStatus(demo);
	assert.equal(demo.factoryCreations.gam, 0);
	const before = snapshot(demo.charts);
	input(demo, demo.loess, 'logSpan', 1);
	await Promise.resolve();
	assertUpdates(demo, before, 6);
	assertFits(demo);
	assert.equal(demo.charts[6].plot.data[2], demo.calls.loess.at(-1).result);
	const {plot} = demo.charts[7];
	const meanOutput = demo.calls.mean[0].result;
	for (const quantile of [true, false, true]) {
		const before = snapshot(demo.charts);
		const drawCount = plot.ctx.log.length;
		toggleQuantiles(demo, quantile);
		await Promise.resolve();
		assertUpdates(demo, before, 7, demo.original, true);
		assertFits(demo);
		assertReadouts(demo);
		assertFitStatus(demo);
		assert.equal(plot.data, demo.charts[7].data);
		assert.equal(plot.series.length, quantile ? 5 : 3);
		assert.deepEqual(Array.from(plot.series).slice(1).map(series => series.label),
			demo.charts[7].series.slice(1).map(series => series.label));
		assert.ok(plot.ctx.log.length > drawCount, 'mode changes redraw the real chart');
		if (quantile) {
			demo.calls.gam.at(-1).curveRefs.forEach((curve, q) => assert.equal(plot.data[q + 2], curve));
			assert.ok(!plot.data.includes(meanOutput));
		}
		else {
			assert.equal(plot.data.length, 3);
			assert.equal(plot.data[2], meanOutput);
		}
	}
	assert.equal(demo.timers.pending.size, 0);
}

const describeRealQuantiles = process.env.TEST_QUANTILE_GAM === '1' ? describe : describe.skip;
describeRealQuantiles('real quantile GAM numerical/render integration (TEST_QUANTILE_GAM=1)', () => {
	it('fits real quantiles, rereads irregular x and changed samples, and retains the fitter across modes', async t => {
		const demo = await loadDemo(t, {realQuantiles: true});
		toggleQuantiles(demo, true);
		assertFits(demo);
		assertFitStatus(demo);
		const first = snapshot(demo.charts);
		input(demo, demo.gam, 'knots', 24);
		input(demo, demo.gam, 'logLambda', 1.25);
		input(demo, demo.gam, 'tail', 0.2);
		demo.timers.flush();
		assertUpdates(demo, first, 7);
		assertFits(demo);
		assertFitStatus(demo);
		assert.deepEqual(demo.calls.gam.at(-1).options, {x: Array.from(demo.charts[7].data[0]),
			quantiles: [0.2, 0.5, 0.8], knots: 24, lambda: 10 ** 1.25});
		assert.notDeepEqual(demo.calls.gam[0].values, demo.calls.gam[1].values);
		const x = demo.charts[7].data[0];
		for (let i = 0; i < x.length; i++) {
			x[i] = 1.7e12 + i * i;
			demo.data[i] += 2500;
		}
		const coordinates = Array.from(x);
		const samples = demo.data.slice();
		const before = snapshot(demo.charts);
		submit(demo, demo.gam);
		assertUpdates(demo, before, 7, samples);
		assertFits(demo, coordinates, samples);
		assert.notDeepEqual(Array.from(demo.charts[7].data[2]), before[7].values[2]);
		for (const quantile of [false, true]) {
			const before = snapshot(demo.charts);
			toggleQuantiles(demo, quantile, samples);
			assertUpdates(demo, before, 7, samples, true);
			assertFits(demo, coordinates, samples);
		}
		assert.equal(demo.factoryCreations.gam, 1);
	});

	it('renders and switches the real quantile fits on all 3600 taxi samples', async t => {
		await smokeRender(t, true);
	});
});
