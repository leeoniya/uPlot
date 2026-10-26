import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import * as master from '../../bench/uplot.mjs';
import * as release from '../../bench/uplot-release.mjs';
import {loadDependency} from '../../bench/demo.mjs';
import {setupDemo} from '../../bench/demo-fixture.mjs';
import {demoDependencies, dependencyUrl} from '../../bench/demo-dependencies.mjs';

function constructor() {
	return class Chart {
		constructor(options, data, host) {
			this.options = options;
			this.data = data;
			this.host = host;
			this.updates = [];
			// Model a release that ignores cache.paths:false and retains native paths.
			this.series = Object.freeze(options.series.map(() => Object.freeze({
				_paths: Object.freeze({}), points: Object.freeze({_paths: Object.freeze({})}),
			})));
		}
		setData(data, resetScales) {
			this.data = data;
			this.updates.push([data, resetScales]);
		}
	};
}

describe('uPlot release adapter', () => {
	let globals;
	beforeEach(() => {
		globals = Object.fromEntries(['uPlot', 'uPlotRelease', 'devicePixelRatio', 'document']
			.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.uPlot = constructor();
		globalThis.uPlotRelease = constructor();
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(globals)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	it('uses the selected constructor without changing either global or shared chart options', async () => {
		const Master = globalThis.uPlot, Release = globalThis.uPlotRelease;
		const input = [[1, 2], [3, 4], [5, 6], [7, 8]];
		const host = {}, wait = {textContent: ''};
		const current = master.makeChart(input, host, wait);
		const published = release.makeChart(input, host, wait);
		assert.ok(current instanceof Master);
		assert.ok(published instanceof Release);
		assert.equal(published instanceof Master, false);
		assert.equal(current.data, input);
		assert.equal(published.data, input);
		assert.equal(current.host, host);
		assert.equal(published.host, host);
		assert.deepEqual(JSON.parse(JSON.stringify(published.options)), JSON.parse(JSON.stringify(current.options)));
		assert.deepEqual(published.options.cache, {paths: false});
		assert.equal(published.options.width, 1920);
		assert.equal(published.options.height, 600);
		assert.deepEqual(published.options.series.slice(1).map(series => series.width), [0.5, 0.5, 0.5]);
		assert.equal(globalThis.uPlot, Master);
		assert.equal(globalThis.uPlotRelease, Release);
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
	});

	it('supports an explicit fourth constructor and release-only pages without a master global', async () => {
		const Selected = constructor(), Release = globalThis.uPlotRelease;
		delete globalThis.uPlot;
		const input = [[], [], [], []], host = {}, wait = {textContent: ''};
		assert.ok(master.makeChart(input, host, wait, Selected) instanceof Selected);
		assert.ok(release.makeChart(input, host, wait) instanceof Release);
		assert.equal(Object.hasOwn(globalThis, 'uPlot'), false);
		await Promise.resolve();
	});

	it('creates empty release charts with four columns and an optional wait handle', async () => {
		const host = {}, wait = {textContent: ''};
		for (const status of [wait, undefined]) {
			const chart = release.makeEmptyChart(host, status);
			assert.ok(chart instanceof globalThis.uPlotRelease);
			assert.deepEqual(chart.data, [[], [], [], []]);
			assert.equal(new Set(chart.data).size, 4);
			assert.equal(chart.host, host);
		}
		await Promise.resolve();
		assert.equal(wait.textContent, 'Done!');
	});

	it('reexports shared preparation and updates without clearing native release paths', async () => {
		assert.equal(release.prepData, master.prepData);
		assert.equal(release.updateChart, master.updateChart);
		const packed = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
			10, 80, 0, 3, 0, 25, 75, 11, 50, 0, 4, 0, 60, 40]);
		const input = release.prepData(packed);
		assert.deepEqual(input, [[600, 660], [20, 50], [25, 60], [3, 4]]);
		const host = {}, wait = {textContent: ''};
		const chart = release.makeEmptyChart(host, wait);
		const series = chart.series;
		const paths = series.map(series => [series._paths, series.points._paths]);
		await Promise.resolve();
		wait.textContent = 'Updating';
		await release.updateChart(chart, input, host, wait);
		assert.equal(chart.data, input);
		assert.equal(chart.updates.length, 1);
		assert.equal(chart.updates[0][0], input);
		assert.equal(chart.updates[0][1], true);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(chart.series, series);
		for (const [i, item] of chart.series.entries()) {
			assert.equal(item._paths, paths[i][0]);
			assert.equal(item.points._paths, paths[i][1]);
		}
	});

	it('captures the demo alias synchronously in onload before resolving or loading master', async () => {
		const elements = [];
		globalThis.document = {
			createElement: tag => ({tag}),
			head: {append: element => elements.push(element)},
		};
		const [script, style] = demoDependencies['uplot-release'];
		const Release = globalThis.uPlotRelease, Master = globalThis.uPlot;
		delete globalThis.uPlotRelease;
		const loading = loadDependency(script);
		assert.equal(elements.length, 1);
		assert.equal(elements[0].tag, 'script');
		assert.equal(elements[0].src, dependencyUrl(script));
		assert.equal(globalThis.uPlotRelease, undefined);
		globalThis.uPlot = Release;
		elements[0].onload();
		assert.equal(globalThis.uPlotRelease, Release);
		globalThis.uPlot = Master;
		await loading;
		await loadDependency(script);
		assert.equal(elements.length, 1, 'the cached load must not insert a second script');
		assert.equal(globalThis.uPlotRelease, Release, 'a cached load must not recapture the master constructor');
		const styling = loadDependency(style);
		assert.equal(elements[1].tag, 'link');
		assert.equal(elements[1].rel, 'stylesheet');
		elements[1].onload();
		await styling;
		assert.equal(globalThis.uPlotRelease, Release);
		assert.equal(globalThis.uPlot, Master);
	});

	it('uses master host sizing and legend styles without retaining another variant class', () => {
		const window = new Window();
		try {
			globalThis.document = window.document;
			const style = window.document.createElement('style');
			style.textContent = readFileSync(new URL('../../bench/demo.css', import.meta.url), 'utf8');
			window.document.head.append(style);
			const parent = window.document.body;
			setupDemo('echarts', parent);
			for (const variant of ['uplot', 'uplot-release']) {
				parent.replaceChildren();
				const host = setupDemo(variant, parent);
				assert.equal(parent.classList.contains(variant), true);
				assert.equal(parent.classList.contains('bench-demo'), true);
				assert.equal(parent.classList.contains('echarts'), false);
				assert.equal(parent.classList.contains(variant === 'uplot' ? 'uplot-release' : 'uplot'), false);
				assert.equal(host.style.width, '');
				assert.equal(host.style.height, '');
				host.innerHTML = '<div class="u-legend u-inline"><div class="u-value"></div></div>';
				assert.equal(window.getComputedStyle(parent).marginTop, '0px');
				const value = window.getComputedStyle(host.querySelector('.u-value'));
				assert.equal(value.width, '150px');
				assert.equal(value.textAlign, 'left');
			}
		}
		finally {
			window.close();
		}
	});
});
