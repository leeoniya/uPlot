import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as scichart from '../../bench/scichart.mjs';
import * as lightningchart from '../../bench/lightningchart.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const host = Object.freeze({id: 'benchmark-scientific', style: Object.freeze({width: '1920px', height: '600px'})});
const turn = () => new Promise(resolve => setImmediate(resolve));

function event() {
	const handlers = new Set();
	return {
		subscribe: fn => handlers.add(fn),
		unsubscribe: fn => handlers.delete(fn),
		emit: value => { for (const fn of [...handlers]) fn(value); },
		get size() { return handlers.size; },
	};
}

function sciMock() {
	const licenseTypes = Object.fromEntries([
		'NO_LICENSE', 'TRIAL', 'COMMUNITY', 'FULL', 'FULL_EXPIRED', 'TRIAL_EXPIRED',
		'SUBSCRIPTION_EXPIRED', 'INVALID_DEVELOPER_LICENSE', 'REQUIRES_VALIDATION', 'INVALID_LICENSE',
	].map(name => [`LICENSE_TYPE_${name}`, Symbol(name)]));
	const collection = () => ({items: [], add(value) { this.items.push(value); }});
	const chart = {
		xAxes: collection(), yAxes: collection(), renderableSeries: collection(),
		renderInstructionsCompleted: event(), renderError: event(),
		isDeleted: false, isInvalidated: false, isRunningAnimation: false, hasInvalidState: false,
		getLicenseContext() {
			return {SCRTCredentials: {GetLicenseType: () => mock.licenseType}, SCRTLicenseType: licenseTypes};
		},
		resumeUpdates(options) { this.resumeOptions = options; },
		delete() { this.isDeleted = true; this.deletions = (this.deletions ?? 0) + 1; },
	};
	const mock = {chart, data: [], configs: [], licenses: [], createCalls: 0,
		licenseTypes, licenseType: licenseTypes.LICENSE_TYPE_COMMUNITY};
	const Axis = class { constructor(context, options) { this.options = options; } };
	mock.api = {
		SciChartSurface: {
			configure: config => mock.configs.push(config),
			UseCommunityLicense: () => mock.licenses.push('community'),
			setRuntimeLicenseKey: key => mock.licenses.push(key),
			async createSingle(element, options) {
				assert.equal(element, host);
				mock.createCalls++;
				mock.createOptions = options;
				return {sciChartSurface: chart, wasmContext: {}};
			},
		},
		SciChartDefaults: {}, EUseWasm64: {Never: 'Never'}, EUseWasmSimd: {Auto: 'Auto'},
		EAutoRange: {Always: 'Always'}, EAxisAlignment: {Left: 'Left', Right: 'Right'}, EResamplingMode: {Auto: 'Auto'},
		SciChartJSLightTheme: class {}, DateTimeNumericAxis: Axis, NumericAxis: Axis,
		XyDataSeries: class {
			constructor(context, options) { this.options = options; mock.data.push(this); }
			appendRange(x, y) { this.x = x; this.y = y; }
			delete() { this.deleted = true; }
		},
		FastLineRenderableSeries: class {
			constructor(context, options) { this.options = options; }
			delete() { this.options.dataSeries.delete(); }
		},
	};
	return mock;
}

function lcMock() {
	const engineEvents = new Map(), chartEvents = new Map();
	const axis = () => ({
		setTickStrategy(value) { this.ticks = value; return this; },
		setScrollStrategy(value) { this.scroll = value; return this; },
		setTitle(value) { this.title = value; return this; },
		setAnimationsEnabled(value) { this.animations = value; return this; },
	});
	const axes = [axis(), axis(), axis()];
	const chart = {
		axes, lines: [], engine: {
			addEventListener: (name, fn) => engineEvents.set(name, fn),
			removeEventListener: name => engineEvents.delete(name),
		},
		setAnimationsEnabled(value) { this.animations = value; },
		getDefaultAxisX: () => axes[0], getDefaultAxisY: () => axes[1],
		addAxisY(options) { assert.deepEqual(options, {opposite: true}); return axes[2]; },
		addEventListener: (name, fn) => chartEvents.set(name, fn),
		removeEventListener: name => chartEvents.delete(name),
		addLineSeries(options) {
			const line = {
				options,
				setName(value) { this.name = value; return this; },
				setMaxSampleCount(value) { this.capacity = value; return this; },
				setStrokeStyle(value) { this.stroke = value; return this; },
				appendSamples(value) { this.data = value; return this; },
			};
			this.lines.push(line);
			return line;
		},
	};
	const lc = {ChartXY: () => chart, dispose() { this.disposals = (this.disposals ?? 0) + 1; chartEvents.get('dispose')?.(); }};
	const mock = {chart, lc, engineEvents, chartEvents};
	mock.api = {
		lightningChart(options) { mock.options = options; return lc; },
		AxisTickStrategies: {DateTime: 'DateTime'}, AxisScrollStrategies: {fitting: 'fitting'},
		Themes: {light: {}}, disableThemeEffects: theme => theme,
		SolidLine: class {}, SolidFill: class {}, ColorRGBA: (...values) => values,
	};
	return mock;
}

describe('scientific benchmark adapters', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['SciChart', 'lcjs', 'benchmarkSciChartOptions', 'benchmarkLightningChartOptions'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	function installSci(timeoutMs = 1000) {
		const mock = sciMock();
		globalThis.SciChart = mock.api;
		// Bytes are consumed by the mock only; these are not vendor binaries.
		globalThis.benchmarkSciChartOptions = {wasmBinary: new ArrayBuffer(8), wasmNoSimdBinary: new ArrayBuffer(8), timeoutMs};
		return mock;
	}
	function installLC(timeoutMs = 1000) {
		const mock = lcMock();
		globalThis.lcjs = mock.api;
		// Deliberately not a license key; never passed to the real vendor library.
		globalThis.benchmarkLightningChartOptions = {license: 'unit-test sentinel', timeoutMs};
		return mock;
	}

	for (const [name, adapter, factor] of [['SciChart', scichart, 60], ['LightningChart', lightningchart, 60000]]) {
		it(`${name}: retains every timestamp and all 55,550 × 3 values in independent Float64 columns`, () => {
			assert.deepEqual(Object.keys(adapter).filter(key => key !== 'makeEmptyChart' && key !== 'updateChart'), ['destroyChart', 'makeChart', 'prepData']);
			const data = adapter.prepData(packed), second = adapter.prepData(packed);
			for (const [key, values] of Object.entries(data)) {
				assert.ok(values instanceof Float64Array);
				assert.equal(values.length, 55550);
				assert.notEqual(values.buffer, second[key].buffer);
			}
			for (let j = 0, i = packed[0] + 1; i < packed.length; j++, i += packed[0]) {
				assert.equal(data.x[j], packed[i] * factor);
				assert.equal(data.cpu[j], Math.round((100 - packed[i + 1]) * 1000) / 1000);
				assert.equal(data.ram[j], Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100);
				assert.equal(data.tcp[j], packed[i + 3]);
				if (j) assert.equal(data.x[j] - data.x[j - 1], factor);
			}
		});
	}

	it('SciChart: initializes and ingests inside makeChart; waits for a valid GPU-completed frame', async () => {
		const mock = installSci(), data = scichart.prepData(packed), wait = {textContent: 'Rendering...'};
		assert.equal(mock.createCalls, 0);
		assert.equal(mock.data.length, 0);
		const pending = scichart.makeChart(data, host, wait);
		await turn();
		assert.deepEqual(mock.licenses, ['community']);
		assert.equal(mock.createOptions.createSuspended, true);
		assert.deepEqual(mock.chart.resumeOptions, {invalidateOnResume: true});
		assert.deepEqual(mock.api.SciChartDefaults, {useWasm64: 'Never', useWasmSimd: 'Auto', useNativeText: true});
		const config = mock.configs[0];
		assert.match(config.wasmUrl, /^blob:/);
		assert.match(config.wasmNoSimdUrl, /^blob:/);
		assert.equal((await (await fetch(config.wasmUrl)).arrayBuffer()).byteLength, 8);
		const axes = [...mock.chart.xAxes.items, ...mock.chart.yAxes.items].map(axis => axis.options);
		assert.deepEqual(axes.map(axis => axis.autoRange), ['Always', 'Always', 'Always']);
		assert.deepEqual(axes.slice(1).map(axis => axis.axisAlignment), ['Left', 'Right']);
		const lines = mock.chart.renderableSeries.items.map(line => line.options);
		assert.deepEqual(lines.map(line => line.yAxisId), ['percent', 'percent', 'tcp']);
		for (let i = 0; i < 3; i++) {
			const series = mock.data[i];
			assert.equal(series.x, data.x);
			assert.equal(series.y, [data.cpu, data.ram, data.tcp][i]);
			assert.equal(series.options.capacity, 55550);
			assert.equal(series.options.isSorted, true);
			assert.equal(series.options.dataEvenlySpacedInX, true);
			assert.equal(series.options.containsNaN, false);
			assert.equal(lines[i].resamplingMode, 'Auto');
			assert.equal(lines[i].animation, undefined);
		}
		mock.chart.renderInstructionsCompleted.emit(true);
		await turn();
		assert.equal(wait.textContent, 'Rendering...');
		mock.chart.isInvalidated = true;
		mock.chart.renderInstructionsCompleted.emit(false);
		await turn();
		assert.equal(wait.textContent, 'Rendering...');
		mock.chart.isInvalidated = false;
		mock.chart.renderInstructionsCompleted.emit(false);
		assert.equal(await pending, mock.chart);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(mock.chart.renderInstructionsCompleted.size, 0);
		assert.equal(mock.chart.renderError.size, 0);
		scichart.destroyChart(mock.chart);
		scichart.destroyChart(mock.chart);
		assert.equal(mock.chart.deletions, 1);
		assert.equal((await (await fetch(config.wasmUrl)).arrayBuffer()).byteLength, 8);
		assert.equal((await (await fetch(config.wasmNoSimdUrl)).arrayBuffer()).byteLength, 8);
	});

	for (const name of ['NO_LICENSE', 'FULL_EXPIRED', 'TRIAL_EXPIRED', 'SUBSCRIPTION_EXPIRED', 'INVALID_DEVELOPER_LICENSE', 'INVALID_LICENSE', 'UNKNOWN']) {
		it(`SciChart: rejects native license state ${name} even when hasInvalidState is false`, async () => {
			const mock = installSci(), wait = {textContent: 'Rendering...'};
			const key = 'invalid-key-for-rejection-test';
			globalThis.benchmarkSciChartOptions.runtimeLicenseKey = key;
			mock.licenseType = mock.licenseTypes[`LICENSE_TYPE_${name}`];
			await assert.rejects(scichart.makeChart(scichart.prepData(packed), host, wait), error => {
				assert.match(error.message, /SciChart license blocked/);
				assert.ok(error.message.includes(name));
				assert.ok(!error.message.includes(key), 'do not expose the supplied key');
				return true;
			});
			assert.deepEqual(mock.licenses, [key], 'do not fall back to community on rejection');
			assert.equal(mock.chart.hasInvalidState, false);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(mock.data.length, 0);
			assert.equal(mock.chart.deletions, 1);
			assert.equal(mock.chart.renderInstructionsCompleted.size, 0);
			assert.equal(mock.chart.renderError.size, 0);
		});
	}

	for (const name of ['FULL', 'TRIAL']) {
		it(`SciChart: accepts vendor-approved ${name} status with an explicit runtime key`, async () => {
			const mock = installSci();
			// Mock-only sentinel; acceptance comes from the native status, not the key text.
			globalThis.benchmarkSciChartOptions.runtimeLicenseKey = 'unit-test sentinel';
			mock.licenseType = mock.licenseTypes[`LICENSE_TYPE_${name}`];
			const pending = scichart.makeChart(scichart.prepData(packed), host);
			await turn();
			mock.chart.renderInstructionsCompleted.emit(false);
			scichart.destroyChart(await pending);
			assert.deepEqual(mock.licenses, ['unit-test sentinel']);
			assert.equal(mock.chart.deletions, 1);
		});
	}

	it('SciChart: waits for native license validation, then still requires GPU completion', async () => {
		const mock = installSci(), wait = {textContent: 'Rendering...'};
		mock.licenseType = mock.licenseTypes.LICENSE_TYPE_REQUIRES_VALIDATION;
		const pending = scichart.makeChart(scichart.prepData(packed), host, wait);
		await turn();
		assert.equal(mock.data.length, 0);
		mock.chart.renderInstructionsCompleted.emit(false);
		assert.equal(wait.textContent, 'Rendering...');
		mock.licenseType = mock.licenseTypes.LICENSE_TYPE_FULL;
		await new Promise(resolve => setTimeout(resolve, 70));
		assert.equal(mock.data.length, 3);
		assert.equal(wait.textContent, 'Rendering...');
		mock.chart.renderInstructionsCompleted.emit(false);
		scichart.destroyChart(await pending);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(mock.chart.deletions, 1);
	});

	for (const mode of ['timeout', 'destroy', 'invalid']) {
		it(`SciChart: cleans up when pending license validation ends with ${mode}`, async () => {
			const mock = installSci(mode === 'timeout' ? 15 : 1000), wait = {textContent: 'Rendering...'};
			mock.licenseType = mock.licenseTypes.LICENSE_TYPE_REQUIRES_VALIDATION;
			const pending = scichart.makeChart(scichart.prepData(packed), host, wait);
			const rejected = assert.rejects(pending, mode === 'timeout' ? /license validation timed out/ : mode === 'destroy' ? /disposed/ : /LICENSE_TYPE_INVALID_LICENSE/);
			await turn();
			if (mode === 'destroy') scichart.destroyChart(mock.chart);
			if (mode === 'invalid') mock.licenseType = mock.licenseTypes.LICENSE_TYPE_INVALID_LICENSE;
			await rejected;
			assert.equal(mock.data.length, 0);
			assert.equal(mock.chart.deletions, 1);
			assert.equal(wait.textContent, 'Rendering...');
		});
	}

	for (const name of ['INVALID_LICENSE', 'REQUIRES_VALIDATION']) {
		it(`SciChart: rechecks licensing on GPU completion (${name}) and removes listeners`, async () => {
			const mock = installSci(), wait = {textContent: 'Rendering...'};
			const pending = scichart.makeChart(scichart.prepData(packed), host, wait);
			const rejected = assert.rejects(pending, new RegExp(`LICENSE_TYPE_${name}`));
			await turn();
			assert.equal(mock.data.length, 3);
			mock.licenseType = mock.licenseTypes[`LICENSE_TYPE_${name}`];
			mock.chart.renderInstructionsCompleted.emit(false);
			await rejected;
			assert.equal(mock.chart.deletions, 1);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(mock.chart.renderInstructionsCompleted.size, 0);
			assert.equal(mock.chart.renderError.size, 0);
		});
	}

	it('SciChart: reuses buffer URLs across samples and teardown, without reusing native data', async () => {
		const options = {wasmBinary: new ArrayBuffer(8), wasmNoSimdBinary: new ArrayBuffer(8)};
		const data = scichart.prepData(packed), configs = [], series = [];
		for (let run = 0; run < 3; run++) {
			const mock = installSci();
			if (run === 2) options.wasmBinary = options.wasmBinary.slice(0);
			// Replacing the options object must not change URLs for the same buffers.
			globalThis.benchmarkSciChartOptions = {...options};
			const pending = scichart.makeChart(data, host);
			await turn();
			configs.push(mock.configs[0]);
			series.push(mock.data[0]);
			assert.equal(mock.data.length, 3);
			assert.equal(mock.data[0].x, data.x);
			assert.equal(mock.data[0].y, data.cpu);
			mock.chart.renderInstructionsCompleted.emit(false);
			scichart.destroyChart(await pending);
		}
		assert.deepEqual(configs[0], configs[1]);
		assert.notEqual(series[0], series[1]);
		assert.notEqual(configs[1].wasmUrl, configs[2].wasmUrl);
		assert.equal(configs[1].wasmNoSimdUrl, configs[2].wasmNoSimdUrl);
		assert.equal((await (await fetch(configs[2].wasmUrl)).arrayBuffer()).byteLength, 8);
		assert.equal((await (await fetch(configs[2].wasmNoSimdUrl)).arrayBuffer()).byteLength, 8);
	});

	it('SciChart: prefers stable loader URLs, supports URL-only options, and does not create fallback blobs', async () => {
		const urls = {wasmUrl: '/assets/scichart.wasm', wasmNoSimdUrl: '/assets/scichart-nosimd.wasm'};
		const data = scichart.prepData(packed);
		const createObjectURL = URL.createObjectURL;
		URL.createObjectURL = () => { throw new Error('Must use the loader URLs'); };
		try {
			for (const withBuffers of [true, false]) {
				const mock = installSci();
				globalThis.benchmarkSciChartOptions = withBuffers ? {...globalThis.benchmarkSciChartOptions, ...urls} : {...urls};
				const pending = scichart.makeChart(data, host);
				await turn();
				assert.deepEqual(mock.configs, [urls]);
				mock.chart.renderInstructionsCompleted.emit(false);
				scichart.destroyChart(await pending);
			}
		}
		finally {
			URL.createObjectURL = createObjectURL;
		}
	});

	it('SciChart: rejects invalid explicit URLs instead of silently falling back to buffers', async () => {
		const mock = installSci();
		for (const value of ['', ' ', 123]) {
			globalThis.benchmarkSciChartOptions.wasmUrl = value;
			await assert.rejects(scichart.makeChart({}, host), /wasmUrl must be a nonempty asset URL/);
		}
		assert.equal(mock.createCalls, 0);
	});

	it('SciChart: rejects missing binary preload without creating a surface', async () => {
		const mock = installSci();
		delete globalThis.benchmarkSciChartOptions.wasmNoSimdBinary;
		await assert.rejects(scichart.makeChart({}, host), /wasmNoSimdBinary/);
		assert.equal(mock.createCalls, 0);
	});

	for (const mode of ['error', 'timeout', 'destroy']) {
		it(`SciChart: cleans up after render ${mode}`, async () => {
			const mock = installSci(mode === 'timeout' ? 15 : 1000);
			const wait = {textContent: 'Rendering...'};
			const pending = scichart.makeChart(scichart.prepData(packed), host, wait);
			const rejected = assert.rejects(pending, mode === 'error' ? /render failed/ : mode === 'timeout' ? /timed out/ : /disposed/);
			await turn();
			if (mode === 'error') mock.chart.renderError.emit(new Error('render failed'));
			if (mode === 'destroy') scichart.destroyChart(mock.chart);
			await rejected;
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(mock.chart.deletions, 1);
			assert.equal(mock.chart.renderInstructionsCompleted.size, 0);
			assert.equal(mock.chart.renderError.size, 0);
		});
	}

	it('SciChart: deletes late initialization after timeout', async () => {
		const mock = installSci(10);
		let finish;
		mock.api.SciChartSurface.createSingle = () => new Promise(resolve => { finish = resolve; });
		await assert.rejects(scichart.makeChart({}, host), /initialization timed out/);
		finish({sciChartSurface: mock.chart, wasmContext: {}});
		await turn();
		assert.equal(mock.chart.deletions, 1);
	});

	it('LightningChart: accepts runtime options without a permission gate; retains full native columns', async () => {
		const mock = installLC(), data = lightningchart.prepData(packed), wait = {textContent: 'Rendering...'};
		const pending = lightningchart.makeChart(data, host, wait);
		assert.equal(mock.options.license, globalThis.benchmarkLightningChartOptions.license);
		assert.deepEqual(mock.chart.axes.map(axis => axis.scroll), ['fitting', 'fitting', 'fitting']);
		assert.equal(mock.chart.axes[0].ticks, 'DateTime');
		assert.deepEqual(mock.chart.lines.map(line => line.options.yAxis), [mock.chart.axes[1], mock.chart.axes[1], mock.chart.axes[2]]);
		for (let i = 0; i < 3; i++) {
			const line = mock.chart.lines[i];
			assert.equal(line.data.x, data.x);
			assert.equal(line.data.y, [data.cpu, data.ram, data.tcp][i]);
			assert.equal(line.capacity, 55550);
			assert.equal(line.options.allowDataGrouping, true);
			assert.deepEqual(line.options.schema, {x: {pattern: 'progressive', storage: Float64Array}, y: {pattern: null, storage: Float64Array}});
		}
		mock.engineEvents.get('renderframe')({asyncRenderingPending: true});
		await turn();
		assert.equal(wait.textContent, 'Rendering...');
		mock.engineEvents.get('renderframe')({asyncRenderingPending: false});
		assert.equal(await pending, mock.chart);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(mock.engineEvents.size, 0);
		assert.equal(mock.chartEvents.size, 0);
		lightningchart.destroyChart(mock.chart);
		lightningchart.destroyChart(mock.chart);
		assert.equal(mock.lc.disposals, 1);
	});

	for (const mode of ['timeout', 'destroy']) {
		it(`LightningChart: cleans up after ${mode}`, async () => {
			const mock = installLC(mode === 'timeout' ? 10 : 1000);
			const pending = lightningchart.makeChart(lightningchart.prepData(packed), host);
			const rejected = assert.rejects(pending, mode === 'timeout' ? /timed out/ : /disposed/);
			if (mode === 'destroy') lightningchart.destroyChart(mock.chart);
			await rejected;
			assert.equal(mock.lc.disposals, 1);
			assert.equal(mock.engineEvents.size, 0);
			assert.equal(mock.chartEvents.size, 0);
		});
	}

	it('LightningChart: reports the technical license blocker', async () => {
		delete globalThis.benchmarkLightningChartOptions;
		await assert.rejects(lightningchart.makeChart({}, host), /requires a user-supplied license/);
	});

	it('HTML pages delegate loading, fixture setup, and timing to the shared runner', () => {
		for (const [page, variant] of [['SciChart', 'scichart'], ['LightningChart', 'lightningchart']]) {
			const source = readFileSync(new URL(`../../bench/${page}.html`, import.meta.url), 'utf8');
			const script = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
			assert.equal(script.trim(), `import {runDemo} from './demo.mjs';\n\t\t\trunDemo('${variant}').catch(console.error);`);
			assert.doesNotMatch(source, /<form|<input|<button|fetch\(|performance\.now\(|benchmarkPermission/);
		}
	});
});
