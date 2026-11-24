import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import {frameworkDependencies} from '../../bench/framework-runtime.mjs';
import {createStackedSeriesData, negativeStackData, stackedSeries, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import {chartOptions, buildChart, createDemo} from '../../demos/stacked-series-muicharts.js';

const keys = ['A', 'B', 'C', 'D', 'negA', 'negB', 'negC', 'negD'];
const args = mock => mock.mock.calls[0].arguments;

function rawData() {
	const raw = createStackedSeriesData();
	// Preserve zero runs while detecting replacement with the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map(Object.freeze));
}

function references(value, result = new Set()) {
	if (value !== null && typeof value === 'object' && !result.has(value)) {
		result.add(value);
		Object.values(value).forEach(child => references(child, result));
	}
	return result;
}

function hostFor(t) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Existing host content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	return host;
}

function reactStub(t, host) {
	let check;
	const observer = {observe() {}, disconnect() {}};
	t.mock.method(host.ownerDocument.defaultView, 'MutationObserver', class {
		constructor(callback) { check = callback; return observer; }
	});
	const plot = {render: t.mock.fn(), unmount: t.mock.fn()};
	const Library = {
		React: {createElement: t.mock.fn((type, props, ...children) => ({type, props, children}))},
		ReactDOM: {flushSync: t.mock.fn(callback => callback())},
		ReactDOMClient: {createRoot: t.mock.fn(() => plot)},
		// The pinned LineChart export is a forwardRef object, not a plain function.
		MuiCharts: {LineChart: {$$typeof: Symbol.for('react.forward_ref'), render() {}}},
	};
	return {Library, plot, check: () => check()};
}

function pathIn(element, className, d = 'M0,0L1,1') {
	const path = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('class', className);
	path.setAttribute('d', d);
	element.appendChild(path);
	return path;
}

async function assertPending(promise) {
	const marker = {};
	assert.equal(await Promise.race([
		promise.then(() => 'resolved early', () => 'rejected early'),
		new Promise(resolve => setImmediate(resolve, marker)),
	]), marker);
}

describe('MUI X Charts native stacked-series configuration', () => {
	it('copies frozen raw values without cumulative data or shared mutable configuration', () => {
		const raw = rawData(), snapshot = structuredClone(raw);
		const first = chartOptions(raw), second = chartOptions(raw);
		assert.deepEqual([first.xAxis[0].data, ...first.series.map(series => series.data)], [...raw, ...negativeStackData(raw).slice(1)]);
		assert.equal(first.series.flatMap(series => series.data).filter(value => value === 0).length, 38);
		assert.deepEqual(first, second);
		const shared = references([raw, stackedSeries, stackDomain, stackDimensions, second]);
		for (const value of references(first)) assert.equal(shared.has(value), false);
		first.xAxis[0].data[0] = -100;
		first.series[0].data.fill(-100);
		first.series[1].highlightScope.highlight = 'series';
		first.slotProps.area.style.fillOpacity = 1;
		assert.deepEqual(second, chartOptions(raw));
		assert.deepEqual(raw, snapshot);
	});

	it('uses native linear areas in two independent signed A–D stacks with fixed numeric axes', () => {
		const raw = rawData(), options = chartOptions(raw);
		assert.deepEqual([options.width, options.height], [1000, 440]);
		assert.deepEqual(options.series.map(series => series.id), keys);
		const mirrored = negativeStackData(raw);
		options.series.forEach((series, i) => {
			const j = i % 4;
			assert.equal(series.label, (i < 4 ? '' : '−') + stackedSeries[j].label);
			assert.equal(series.color, stackedSeries[j].stroke);
			assert.deepEqual(series.data, (i < 4 ? raw : mirrored)[j + 1]);
			assert.deepEqual([series.xAxisId, series.yAxisId], ['x', 'y']);
			assert.deepEqual([series.area, series.stack, series.stackOrder, series.stackOffset, series.curve],
				[true, i < 4 ? 'positive' : 'negative', 'none', 'none', 'linear']);
			for (const key of ['baseline', 'dataKey', 'valueGetter', 'stackedData', 'zIndex'])
				assert.equal(series[key], undefined, key);
		});
		for (const [axis, id, domain, count] of [[options.xAxis[0], 'x', stackDomain.x, 11], [options.yAxis[0], 'y', [-16, 16], 9]]) {
			assert.deepEqual([axis.id, axis.scaleType, axis.min, axis.max, axis.domainLimit], [id, 'linear', ...domain, 'strict']);
			assert.deepEqual(axis.tickInterval, Array.from({length: count}, (_, i) => domain[0] + i * (domain[1] - domain[0]) / (count - 1)));
		}
		assert.deepEqual(options.grid, {horizontal: true, vertical: true});
		for (const key of ['dataset', 'slots', 'children']) assert.equal(options[key], undefined, key);
	});

	it('sets shared colors and opacity without replacing native strokes or paint order', () => {
		const options = chartOptions(rawData());
		assert.deepEqual(options.slotProps.line, {
			style: {strokeWidth, strokeOpacity: 1, strokeDasharray: 'none', opacity: 1, transition: 'none'},
		});
		assert.deepEqual(options.slotProps.area, {
			style: {fillOpacity, opacity: 1, filter: 'none', transition: 'none'},
		});
		for (const slot of [options.slotProps.line, options.slotProps.area]) {
			for (const key of ['strokeLinecap', 'strokeLinejoin', 'stroke', 'fill', 'd']) {
				assert.equal(slot[key], undefined, key);
				assert.equal(slot.style[key], undefined, key);
			}
		}
	});

	it('disables marks, animation, tooltips, highlights, keyboard, and pointer interaction', () => {
		const options = chartOptions(rawData());
		assert.equal(options.hideLegend, false, 'LineChart renders its native legend');
		for (const key of ['skipAnimation', 'disableAxisListener', 'disableKeyboardNavigation', 'disableLineItemHighlight'])
			assert.equal(options[key], true, key);
		assert.deepEqual(options.axisHighlight, {x: 'none', y: 'none'});
		assert.deepEqual(options.slotProps.tooltip, {trigger: 'none'});
		assert.deepEqual(options.sx, {pointerEvents: 'none'});
		for (const series of options.series) {
			assert.equal(series.showMark, false);
			assert.equal(series.disableHighlight, true);
			assert.deepEqual(series.highlightScope, {highlight: 'none', fade: 'none'});
		}
	});

	it('builds exactly one native LineChart without custom rendering children', t => {
		const {Library} = reactStub(t, hostFor(t));
		const raw = rawData();
		const tree = buildChart(raw, Library.React, Library.MuiCharts);
		assert.equal(tree.type, Library.MuiCharts.LineChart);
		assert.deepEqual(tree.props, chartOptions(raw));
		assert.deepEqual(tree.children, []);
		assert.equal(Library.React.createElement.mock.callCount(), 1);
	});

	it('pins benchmark MUI dependencies and shares the external React import-map identity', () => {
		const html = readFileSync(new URL('../../demos/stacked-series-muicharts.html', import.meta.url), 'utf8');
		const rechartsHtml = readFileSync(new URL('../../demos/stacked-series-recharts.html', import.meta.url), 'utf8');
		const importMap = source => JSON.parse(source.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
		const imports = importMap(html), rechartsImports = importMap(rechartsHtml);
		for (const name of ['react', 'react-dom', 'react-dom/client']) assert.equal(imports[name], rechartsImports[name]);
		const dependency = frameworkDependencies.muicharts.find(item => item.name === '@mui/x-charts');
		assert.equal(dependency.version, '9.16.0');
		assert.equal(imports['@mui/x-charts/LineChart'], `${dependency.url}&external=react,react-dom`);
		assert.equal(imports['react/jsx-runtime'], 'https://esm.sh/react@19.3.1/jsx-runtime?target=es2022&deps=react@19.3.1,react-dom@19.3.1,react-is@19.3.1&external=react,react-dom');
		const deps = new URL(imports['@mui/x-charts/LineChart']).searchParams.get('deps');
		assert.equal(deps, 'react@19.3.1,react-dom@19.3.1,react-is@19.3.1,@mui/material@9.5.0,@mui/system@9.5.0,@emotion/react@11.14.0,@emotion/styled@11.14.1');
		assert.ok(html.includes("import {mountDemo} from './stacked-series-compare.js';"));
		assert.ok(html.includes("import {createDemo} from './stacked-series-muicharts.js';"));
		assert.ok(html.includes("window.stackedDemo = await mountDemo(document.querySelector('#demo'), 'muicharts', async (host, data) => {"));
		assert.ok(html.includes('return createDemo(host, data, {React, ReactDOM, ReactDOMClient, MuiCharts});'));
		for (const name of ['react', 'react-dom', 'react-dom/client', '@mui/x-charts/LineChart'])
			assert.ok(html.includes(`import('${name}')`));
		assert.ok(html.includes('href="./stacked-series-compare.css"'));
		assert.equal([...html.matchAll(/<script\b/g)].length, 2);
	});
});

describe('MUI X Charts adapter readiness through the shared React helper', {timeout: 2000}, () => {
	it('awaits exactly eight finite native fills and strokes before returning the React root', async t => {
		const host = hostFor(t), before = [...host.childNodes], raw = rawData();
		const stub = reactStub(t, host);
		const pending = createDemo(host, raw, stub.Library);
		const [element] = args(stub.Library.ReactDOMClient.createRoot);
		assert.equal(element.parentNode, host);
		assert.equal(args(stub.plot.render)[0].type, stub.Library.MuiCharts.LineChart);
		assert.deepEqual(args(stub.plot.render)[0].props, chartOptions(raw));
		await assertPending(pending);
		// Unrelated paths and a non-path class match cannot satisfy readiness.
		pathIn(element, 'unrelated');
		const nonPath = element.appendChild(document.createElement('div'));
		nonPath.className = 'MuiLineChart-area MuiLineChart-line';
		nonPath.setAttribute('d', 'M0,0L1,1');
		const areas = Array.from({length: 8}, () => pathIn(element, 'MuiLineChart-area'));
		const lines = Array.from({length: 7}, () => pathIn(element, 'MuiLineChart-line'));
		stub.check();
		await assertPending(pending);
		lines.push(pathIn(element, 'MuiLineChart-line'));
		for (const className of ['MuiLineChart-area', 'MuiLineChart-line']) {
			const extra = pathIn(element, className);
			stub.check();
			await assertPending(pending);
			extra.remove();
		}
		for (const path of [areas[7], lines[7]]) {
			for (const invalid of ['', 'M0,0', 'M0,NaNL1,1', 'M0,0LInfinity,1']) {
				path.setAttribute('d', invalid);
				stub.check();
				await assertPending(pending);
			}
			path.setAttribute('d', 'M0,0L1,1');
		}
		stub.check();
		const demo = await pending;
		assert.equal(demo.plot, stub.plot);
		assert.deepEqual(Object.keys(demo).sort(), ['destroy', 'plot']);
		demo.destroy();
		assert.equal(stub.plot.unmount.mock.callCount(), 1);
		assert.deepEqual([...host.childNodes], before);
		assert.deepEqual(raw, rawData());
	});

	for (const Library of [undefined, null, {}, {MuiCharts: {}}, {MuiCharts: {LineChart: null}}]) {
		it('rejects a missing LineChart before mounting React', async t => {
			const host = hostFor(t), before = [...host.childNodes];
			await assert.rejects(createDemo(host, rawData(), Library), {message: 'MUI X Charts did not load'});
			assert.deepEqual([...host.childNodes], before);
		});
	}

	for (const [namespace, method] of [['React', 'createElement'], ['ReactDOM', 'flushSync'], ['ReactDOMClient', 'createRoot']]) {
		it(`delegates missing ${namespace}.${method} validation to the shared helper`, async t => {
			const host = hostFor(t), before = [...host.childNodes];
			const {Library} = reactStub(t, host);
			Library[namespace][method] = undefined;
			await assert.rejects(createDemo(host, rawData(), Library), {message: 'MUI X Charts did not load'});
			assert.deepEqual([...host.childNodes], before);
		});
	}
});
