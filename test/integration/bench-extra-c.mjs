import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as amcharts from '../../bench/amcharts.mjs';
import * as lightningchart from '../../bench/lightningchart.mjs';
import * as lightweight from '../../bench/lightweight.mjs';


const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const modules = {amcharts, lightningchart};

function host(variant) {

	// Fixture setup is outside makeChart; any adapter writes must fail this test.
	return Object.freeze({
		id: `benchmark-${variant}`,
		style: Object.freeze({width: '1920px', height: '600px'}),
	});
}

function events() {
	const handlers = new Map();
	return {
		on(type, callback) {
			handlers.set(type, callback);
			return {dispose() { handlers.delete(type); }};
		},
		emit(type) { handlers.get(type)?.(); },
		get size() { return handlers.size; },
	};
}

function amchartsMock() {
	const created = [];
	const make = type => ({new(root, settings) {
		const value = {
			type, settings,
			children: {push(value) { return value; }},
			xAxes: {push(value) { return value; }},
			yAxes: {push(value) { return value; }},
			series: {values: [], push(value) { this.values.push(value); return value; }},
			strokes: {template: {setAll(settings) { this.settings = settings; }}},
			data: {setAll(data) { this.values = data; }},
		};
		created.push(value);
		return value;
	}});
	const root = {
		container: {children: {push(value) { return value; }}},
		events: events(),
		animationTime: 1,
		addDisposer() {},
		dispose() { this.disposed = true; },
	};
	return {
		root, created,
		am5: {registry: {version: '5.21.4'}, Root: {new() { return root; }}, Legend: make('Legend'), color: value => value},
		am5xy: Object.fromEntries(['XYChart', 'DateAxis', 'ValueAxis', 'AxisRendererX', 'AxisRendererY', 'LineSeries'].map(type => [type, make(type)])),
	};
}

describe('additional benchmark adapters C', () => {
	for (const [variant, module] of Object.entries(modules)) {
		it(`${variant}: exports the shared contract and preserves all 55,550 × 3 values`, () => {
			assert.deepEqual(Object.keys(module), ['destroyChart', 'makeChart', 'prepData']);
			const before = packed.slice();
			const data = module.prepData(packed);
			const count = (packed.length - packed[0] - 1) / packed[0];
			assert.equal(count, 55550);
			if (variant === 'amcharts')
				assert.equal(data.length, count);
			else {
				for (const values of Object.values(data)) {
					assert.ok(values instanceof Float64Array);
					assert.equal(values.length, count);
				}
			}

			for (let j = 0; j < count; j++) {
				const i = packed[0] + 1 + j * packed[0];
				const expected = [
					packed[i] * 60000,
					Math.round((100 - packed[i + 1]) * 1000) / 1000,
					Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
					packed[i + 3],
				];
				const actual = variant === 'amcharts' ? Object.values(data[j]) :
					[data.x[j], data.cpu[j], data.ram[j], data.tcp[j]];
				assert.deepEqual(actual, expected);
			}
			assert.deepEqual(packed, before);
		});
	}

	it('amCharts: no grouping or line simplification, exact timestamps, render-loop completion, and root cleanup', async () => {
		const saved = {am5: globalThis.am5, am5xy: globalThis.am5xy};
		const mock = amchartsMock();
		Object.assign(globalThis, {am5: mock.am5, am5xy: mock.am5xy});
		try {
			const element = host('amcharts');
			const wait = {textContent: 'Rendering...'};
			const data = Object.freeze(amcharts.prepData(packed).map(Object.freeze));
			const pending = amcharts.makeChart(data, element, wait);
			let resolved = false;
			pending.then(() => { resolved = true; });
			mock.root.events.emit('frameended');
			await Promise.resolve();
			assert.equal(resolved, false);
			assert.equal(wait.textContent, 'Rendering...');
			mock.root.events.emit('frameended');
			mock.root.animationTime = null;
			assert.equal(await pending, mock.root);
			assert.equal(mock.root.events.size, 0);
			assert.equal(wait.textContent, 'Done!');
			assert.deepEqual(element, {id: 'benchmark-amcharts', style: {width: '1920px', height: '600px'}});
			const dateAxis = mock.created.find(value => value.type === 'DateAxis');
			assert.equal(dateAxis.settings.groupData, false);
			assert.equal(Object.hasOwn(dateAxis.settings, 'groupCount'), false);
			assert.deepEqual(dateAxis.settings.baseInterval, {timeUnit: 'minute', count: 1});
			assert.equal(Object.hasOwn(dateAxis.settings, 'groupIntervals'), false);
			assert.equal(dateAxis.settings.min, undefined);
			assert.equal(dateAxis.settings.max, undefined);
			assert.equal(dateAxis.settings.start, undefined);
			assert.equal(dateAxis.settings.end, undefined);
			const axes = mock.created.filter(value => value.type === 'ValueAxis');
			assert.equal(axes.length, 2);
			assert.equal(axes[0].settings.renderer.settings.opposite, false);
			assert.equal(axes[1].settings.renderer.settings.opposite, true);
			for (const axis of axes) {
				assert.equal(axis.settings.min, undefined);
				assert.equal(axis.settings.max, undefined);
			}
			const series = mock.created.filter(value => value.type === 'LineSeries');
			assert.deepEqual(series.map(value => value.settings.name), ['CPU', 'RAM', 'TCP Out']);
			assert.deepEqual(series.map(value => value.settings.yAxis), [axes[0], axes[0], axes[1]]);
			for (const value of series) {
				assert.equal(value.data.values, data);
				assert.equal(value.settings.interpolationDuration, 0);
				assert.equal(Object.hasOwn(value.settings, 'valueYGrouped'), false);
				assert.equal(value.settings.minDistance, 0);
				assert.equal(value.settings.exactLocationX, true);
				assert.equal(value.settings.xAxis, dateAxis);
			}
			amcharts.destroyChart(mock.root);
			assert.equal(mock.root.disposed, true);
		}
		finally {
			Object.assign(globalThis, saved);
		}
	});

	it('amCharts: shows static branding immediately and disables only its entrance animation', async () => {
		const saved = {am5: globalThis.am5, am5xy: globalThis.am5xy};
		const mock = amchartsMock();
		const animations = [];
		const glyphs = [-50, 50].map(dx => ({
			settings: {dx, strokeOpacity: 0},
			setAll(settings) { Object.assign(this.settings, settings); },
			animate(options) { animations.push({glyph: this, options}); return options; },
		}));
		const click = () => {}, hover = {}, tooltip = {};
		const logo = mock.root._logo = {click, hover, tooltip, children: {length: 2, each: fn => glyphs.forEach(fn)}};
		mock.am5.registry.version = '5.21.4';
		Object.assign(globalThis, {am5: mock.am5, am5xy: mock.am5xy});
		try {
			const pending = amcharts.makeChart([], host('amcharts'), {});
			assert.equal(mock.root._logo, logo);
			assert.deepEqual([logo.click, logo.hover, logo.tooltip], [click, hover, tooltip]);
			for (const glyph of glyphs) {
				assert.deepEqual(glyph.settings, {dx: 0, strokeOpacity: 1});
				for (const key of ['dx', 'strokeOpacity']) {
					const options = {key, to: key === 'dx' ? 0 : 1, duration: 1500};
					assert.equal(glyph.animate(options).duration, 0);
					assert.equal(options.duration, 1500, 'do not mutate vendor animation options');
					assert.equal(animations.at(-1).glyph, glyph);
				}
				const hoverOptions = {key: 'stroke', to: 'blue', duration: 300};
				assert.equal(glyph.animate(hoverOptions), hoverOptions);
			}
			mock.root.animationTime = null;
			mock.root.events.emit('frameended');
			assert.equal(await pending, mock.root);
			amcharts.destroyChart(mock.root);
			assert.equal(mock.root.disposed, true);
		}
		finally {
			Object.assign(globalThis, saved);
		}
	});

	it('amCharts: rejects an unreviewed branding layout or version and disposes the root', async () => {
		const saved = {am5: globalThis.am5, am5xy: globalThis.am5xy};
		try {
			for (const [version, length] of [['5.22.0', 2], ['5.21.4', 3]]) {
				const mock = amchartsMock();
				mock.am5.registry.version = version;
				mock.root._logo = {children: {length}};
				Object.assign(globalThis, {am5: mock.am5, am5xy: mock.am5xy});
				await assert.rejects(amcharts.makeChart([], host('amcharts')), /Review the static amCharts branding adapter/);
				assert.equal(mock.root.disposed, true);
			}
		}
		finally {
			Object.assign(globalThis, saved);
		}
	});

	it('Lightweight: prepares independent, complete series without mutating packed input', () => {
		const data = lightweight.prepData(packed);
		const second = lightweight.prepData(packed);
		for (let s = 0; s < 3; s++) {
			assert.equal(data[s].length, 55550);
			assert.notEqual(data[s], second[s]);
			assert.notEqual(data[s][0], second[s][0]);
		}
		for (let j = 0, i = packed[0] + 1; i < packed.length; j++, i += packed[0]) {
			const values = [Math.round((100 - packed[i + 1]) * 1000) / 1000,
				Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
				packed[i + 3]];
			for (let s = 0; s < 3; s++)
				assert.deepEqual(data[s][j], {time: packed[i] * 60, value: values[s]});
		}
	});

	it('Lightweight: enables native conflation with full data, automatic axes, and no eager precomputation', () => {
		const saved = Object.getOwnPropertyDescriptor(globalThis, 'LightweightCharts');
		const element = () => ({style: {}, append() {}, setAttribute() {}, remove() {}});
		const target = {style: {position: 'static'}, ownerDocument: {createElement: element}, append() {}};
		const data = lightweight.prepData(packed);
		for (const values of data) {
			values.forEach(Object.freeze);
			Object.freeze(values);
		}
		Object.freeze(data);
		let config, fitted = false, removed = false;
		const lines = [];
		const chart = {
			addSeries(type, options) {
				assert.equal(type, 'LineSeries');
				const i = lines.length;
				lines.push(options);
				return {setData(values) { assert.equal(values, data[i]); assert.equal(values.length, 55550); }};
			},
			timeScale: () => ({fitContent() { fitted = true; }}),
			subscribeCrosshairMove() {},
			unsubscribeCrosshairMove() {},
			remove() { removed = true; },
		};
		globalThis.LightweightCharts = {
			LineSeries: 'LineSeries', LastPriceAnimationMode: {Disabled: 0},
			createChart(host, options) { assert.equal(host, target); config = options; return chart; },
		};
		try {
			assert.equal(lightweight.makeChart(data, target), chart);
			assert.equal(config.timeScale.enableConflation, true);
			assert.equal(config.timeScale.conflationThresholdFactor, undefined);
			assert.equal(config.timeScale.precomputeConflationOnInit, undefined);
			assert.ok(config.timeScale.minBarSpacing * 55550 < config.width);
			assert.equal(config.layout.attributionLogo, true);
			for (const axis of [config.leftPriceScale, config.rightPriceScale]) {
				assert.equal(axis.visible, true);
				assert.equal(axis.autoScale, true);
			}
			assert.deepEqual(lines.map(line => line.priceScaleId), ['left', 'left', 'right']);
			for (const line of lines) {
				assert.equal(line.autoscaleInfoProvider, undefined);
				assert.equal(line.pointMarkersVisible, false);
				assert.equal(line.lastPriceAnimation, 0);
			}
			assert.equal(fitted, true);
			lightweight.destroyChart(chart);
			assert.equal(removed, true);
			assert.equal(target.style.position, 'static');
		}
		finally {
			if (saved) Object.defineProperty(globalThis, 'LightweightCharts', saved);
			else delete globalThis.LightweightCharts;
		}
	});

	it('LightningChart: enables native grouping without reducing storage or changing axis fitting', () => {
		// Check configuration without fabricating a license or running the vendor engine.
		const source = readFileSync(new URL('../../bench/lightningchart.mjs', import.meta.url), 'utf8');
		assert.match(source, /allowDataGrouping: true/);
		assert.match(source, /x: \{pattern: 'progressive', storage: Float64Array\}/);
		assert.match(source, /\.setMaxSampleCount\(data\.x\.length\)/);
		assert.match(source, /\.appendSamples\(\{x: data\.x, y: values\}\)/);
		assert.equal(source.match(/\.setScrollStrategy\(AxisScrollStrategies\.fitting\)/g).length, 3);
		assert.match(source, /\.addAxisY\(\{opposite: true\}\)/);
		assert.doesNotMatch(source, /host\.(?:id|style)\b/);
	});

	it('LightningChart: refuses initialization without a supplied license', async () => {
		const saved = Object.getOwnPropertyDescriptor(globalThis, 'benchmarkLightningChartOptions');
		try {
			const element = host('lightningchart');
			for (const license of [undefined, null, '', '  ', 123, true]) {
				globalThis.benchmarkLightningChartOptions = {license, benchmarkPermission: true};
				await assert.rejects(lightningchart.makeChart({}, element), /requires a user-supplied license/);
			}
			delete globalThis.benchmarkLightningChartOptions;
			await assert.rejects(lightningchart.makeChart({}, element), /requires a user-supplied license/);
			assert.equal(element.id, 'benchmark-lightningchart');
			assert.deepEqual(element.style, {width: '1920px', height: '600px'});
		}
		finally {
			if (saved) Object.defineProperty(globalThis, 'benchmarkLightningChartOptions', saved);
			else delete globalThis.benchmarkLightningChartOptions;
		}
	});

	it('LightningChart: forwards license and metadata to the vendor without a permission gate or option mutation', async () => {
		const keys = ['lcjs', 'benchmarkLightningChartOptions'];
		const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		const vendorError = new Error('vendor license validation');
		const licenseInformation = Object.freeze({appTitle: 'test'});
		const calls = [];
		globalThis.lcjs = {lightningChart(options) { calls.push(options); throw vendorError; }};
		try {
			for (const extra of [{}, {benchmarkPermission: false}]) {
				const options = Object.freeze({license: 'test-not-a-vendor-key', licenseInformation, timeoutMs: 100, ...extra});
				globalThis.benchmarkLightningChartOptions = options;
				await assert.rejects(lightningchart.makeChart({}, host('lightningchart')), error => error === vendorError);
				assert.equal(globalThis.benchmarkLightningChartOptions, options);
				assert.deepEqual(calls.at(-1), {license: options.license, licenseInformation});
				assert.equal(calls.at(-1).licenseInformation, licenseInformation);
			}
			assert.equal(calls.length, 2);
		}
		finally {
			keys.forEach((key, i) => {
				if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
				else delete globalThis[key];
			});
		}
	});

});
