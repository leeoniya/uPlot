import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import {createStackedSeriesData, negativeStackData, stackedSeries, stackDimensions, stackDomain, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as nivo from '../../demos/stacked-series-nivo.js';
import * as victory from '../../demos/stacked-series-victory.js';

const keys = ['A', 'B', 'C', 'D'];
const labels = stackedSeries.map(series => series.label);
const colors = stackedSeries.map(series => series.stroke);
const victoryComponents = ['VictoryChart', 'VictoryContainer', 'VictoryAxis', 'VictoryStack', 'VictoryArea', 'VictoryLegend'];

function rawData() {
	const raw = createStackedSeriesData();
	// Keep all zero runs, but detect substitution of the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map(values => Object.freeze(values)));
}

function assertRaw(data, raw, index) {
	assert.deepEqual(data, raw[0].map((x, i) => ({x, y: raw[index + 1][i]})));
	assert.ok(data.every(point => typeof point.x === 'number' && typeof point.y === 'number'));
	assert.equal(data.filter(point => point.y === 0).length, raw[index + 1].filter(value => value === 0).length);
}

function assertFresh(first, second) {
	assert.deepEqual(first, second);
	function visit(a, b) {
		if (a !== null && typeof a === 'object') {
			assert.notEqual(a, b, 'each build owns its nested objects and arrays');
			for (const key of Object.keys(a)) visit(a[key], b[key]);
		}
	}
	visit(first, second);
}

function elements(t) {
	return {
		React: {createElement: t.mock.fn((type, props, ...children) => ({type, props, children}))},
		Nivo: {Line: Symbol('Line')},
		Victory: Object.fromEntries(victoryComponents.map(name => [name, Symbol(name)])),
	};
}

function hostFor(t) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Existing host content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	return host;
}

describe('Nivo and Victory raw data and native stacking', () => {
	for (const negative of [false, true]) it(`Nivo renders one native ${negative ? 'negative' : 'positive'} stack with signed labels`, t => {
		const raw = negative ? negativeStackData(rawData()) : rawData(), snapshot = structuredClone(raw);
		const min = negative ? -16 : 0, max = negative ? 0 : 16;
		const first = nivo.chartOptions(raw), second = nivo.chartOptions(raw);
		assertFresh(first, second);
		assert.deepEqual(first.data.map(series => series.id), labels.map(label => negative ? `−${label}` : label));
		first.data.forEach((series, i) => assertRaw(series.data, raw, i));
		assert.deepEqual([first.width, first.height], [stackDimensions.width, stackDimensions.height]);
		assert.deepEqual(first.margin, {top: 40, right: 25, bottom: 40, left: 50});
		assert.deepEqual(first.xScale, {type: 'linear', min: stackDomain.x[0], max: stackDomain.x[1], nice: false, stacked: false});
		assert.deepEqual(first.yScale, {type: 'linear', min, max, nice: false, stacked: true});
		assert.deepEqual(first.axisBottom.tickValues, Array.from({length: 11}, (_, i) => i * 2));
		assert.deepEqual(first.axisLeft.tickValues, Array.from({length: 9}, (_, i) => min + i * 2));
		assert.deepEqual(first.gridXValues, first.axisBottom.tickValues);
		assert.deepEqual(first.gridYValues, first.axisLeft.tickValues);
		assert.deepEqual(first.colors, colors);
		assert.equal(first.curve, 'linear');
		assert.equal(first.lineWidth, strokeWidth);
		assert.equal(first.enableArea, true);
		assert.equal(first.areaOpacity, fillOpacity);
		assert.equal(first.areaBlendMode, 'normal');
		assert.equal(first.areaBaselineValue, 0);
		for (const prop of ['enablePoints', 'enablePointLabel', 'animate', 'isInteractive', 'isFocusable', 'useMesh', 'enableSlices', 'enableCrosshair', 'enableTouchCrosshair'])
			assert.equal(first[prop], false, prop);
		assert.equal(first.legends.length, 1);
		assert.equal(first.legends[0].direction, 'row');
		assert.equal(first.legends[0].data, undefined, 'native legend derives its items from signed series IDs');
		// Keep native layer order, zero-baseline fills, clipping, and line styling.
		for (const prop of ['layers', 'defs', 'fill', 'markers', 'theme'])
			assert.equal(Object.hasOwn(first, prop), false, prop);
		const {React, Nivo} = elements(t);
		assert.deepEqual(nivo.buildChart(raw, React, Nivo), {type: Nivo.Line, props: second, children: []});
		first.data[1].data[2].y = 99;
		first.colors.reverse();
		first.yScale.max = 99;
		first.axisBottom.tickValues.push(99);
		assert.deepEqual(second, nivo.chartOptions(raw));
		assert.deepEqual(raw, snapshot);
	});

	it('Victory renders two independent signed VictoryStacks and one native legend', t => {
		const raw = rawData(), snapshot = structuredClone(raw);
		const {React, Victory} = elements(t);
		const first = victory.buildChart(raw, React, Victory), second = victory.buildChart(raw, React, Victory);
		assertFresh(first, second);
		assert.equal(first.type, Victory.VictoryChart);
		assert.deepEqual([first.props.width, first.props.height], [stackDimensions.width, stackDimensions.height]);
		assert.deepEqual(first.props.padding, {top: 50, right: 25, bottom: 40, left: 50});
		assert.deepEqual(first.props.domain, {x: stackDomain.x, y: [-16, 16]});
		assert.equal(first.props.domainPadding, 0);
		assert.deepEqual(first.props.scale, {x: 'linear', y: 'linear'});
		assert.equal(first.props.animate, false);
		assert.deepEqual(first.props.events, []);
		assert.deepEqual(first.props.containerComponent, {
			type: Victory.VictoryContainer, props: {responsive: false, tabIndex: -1}, children: [],
		});
		assert.equal(first.children.length, 5);
		const [xAxis, yAxis, positive, negative, legend] = first.children;
		assert.equal(xAxis.type, Victory.VictoryAxis);
		assert.equal(yAxis.type, Victory.VictoryAxis);
		assert.equal(yAxis.props.dependentAxis, true);
		assert.deepEqual(xAxis.props.tickValues, Array.from({length: 11}, (_, i) => i * 2));
		assert.deepEqual(yAxis.props.tickValues, Array.from({length: 9}, (_, i) => (i - 4) * 4));
		for (const stack of [positive, negative]) {
			assert.equal(stack.type, Victory.VictoryStack);
			assert.equal(stack.props.animate, false);
			assert.deepEqual(stack.props.events, []);
			assert.equal(stack.children.length, 4);
		}
		const mirrored = negativeStackData(raw);
		const areas = [...positive.children, ...negative.children];
		areas.forEach((area, index) => {
			const i = index % 4;
			const label = (index < 4 ? '' : '−') + labels[i];
			assert.equal(area.type, Victory.VictoryArea);
			assert.deepEqual(area.children, []);
			assertRaw(area.props.data, index < 4 ? raw : mirrored, i);
			assert.equal(area.props.name, label);
			assert.equal(area.props['data-stacked-series'], label);
			assert.equal(area.props.x, 'x');
			assert.equal(area.props.y, 'y');
			assert.equal(area.props.interpolation, 'linear');
			assert.equal(area.props.animate, false);
			assert.deepEqual(area.props.events, []);
			assert.deepEqual(area.props.style.data, {
				stroke: colors[i], strokeWidth, strokeOpacity: 1, strokeDasharray: 'none', opacity: 1,
				fill: colors[i], fillOpacity,
			});
			for (const prop of ['y0', 'labels', 'dataComponent', 'groupComponent', 'clipPadding', 'sortOrder'])
				assert.equal(Object.hasOwn(area.props, prop), false, prop);
		});
		assert.equal(legend.type, Victory.VictoryLegend);
		assert.deepEqual(legend.props.data, areas.map(({props}) => ({name: props.name, symbol: {fill: props.style.data.stroke}})));
		first.props.domain.x[0] = -99;
		first.props.domain.y[1] = 99;
		negative.children[1].props.data[2].y = 99;
		positive.children[0].props.style.data.fill = 'black';
		positive.children.reverse();
		assert.deepEqual(second, victory.buildChart(raw, React, Victory));
		assert.deepEqual(raw, snapshot);
	});
});

function appendPaths(element, name, kind) {
	const doc = element.ownerDocument;
	const svg = element.querySelector('svg') ?? element.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'svg'));
	for (const key of name === 'Nivo' ? keys : [...keys, ...keys.map(key => `−${key}`)]) {
		const path = doc.createElementNS(svg.namespaceURI, 'path');
		path.setAttribute('d', kind === 'fill' ? 'M0,10L1,5L1,10Z' : 'M0,10L1,5');
		if (name === 'Nivo') {
			if (kind === 'fill')
				path.setAttribute('fill-opacity', '0.18');
			else {
				path.setAttribute('fill', 'none');
				path.setAttribute('stroke-width', '3');
			}
			svg.append(path);
		}
		else {
			const group = doc.createElementNS(svg.namespaceURI, 'g');
			group.setAttribute('data-stacked-series', key);
			path.setAttribute('style', kind === 'fill' ? 'stroke: none; fill: blue;' : 'fill: none; stroke: blue;');
			group.append(path);
			svg.append(group);
		}
	}
}

describe('Nivo and Victory injected adapters', {timeout: 5000}, () => {
	for (const [name, adapter] of [['Nivo', nivo], ['Victory', victory]]) {
		it(`${name}: builds with the injected library and waits for both native path sets`, async t => {
			const host = hostFor(t), before = host.innerHTML, raw = rawData();
			let element, check;
			const observer = {observe() {}, disconnect() {}};
			t.mock.method(host.ownerDocument.defaultView, 'MutationObserver', class {
				// Explicit return avoids Happy DOM's private-field methods on the mocked instance.
				constructor(callback) { check = callback; return observer; }
			});
			const plot = {render: t.mock.fn(), unmount: t.mock.fn()};
			const Library = {
				...elements(t),
				ReactDOM: {flushSync: callback => callback()},
				ReactDOMClient: {createRoot: target => { element = target; return plot; }},
			};
			const pending = adapter.createDemo(host, raw, Library);
			assert.notEqual(element, host);
			assert.equal(element.parentNode, host);
			assert.equal(plot.render.mock.callCount(), 1);
			assert.deepEqual(plot.render.mock.calls[0].arguments, [adapter.buildChart(raw, Library.React, Library[name])]);
			appendPaths(element, name, 'fill');
			check();
			const marker = {};
			assert.equal(await Promise.race([
				pending.then(() => 'resolved early', () => 'rejected early'),
				new Promise(resolve => setImmediate(resolve, marker)),
			]), marker);
			appendPaths(element, name, 'stroke');
			check();
			const demo = await pending;
			assert.equal(demo.plot, plot);
			demo.destroy();
			assert.equal(plot.unmount.mock.callCount(), 1);
			assert.equal(host.innerHTML, before);
			assert.deepEqual(raw, rawData());
		});

		it(`${name}: rejects missing native components without changing the host`, async t => {
			const host = hostFor(t), before = host.innerHTML, Library = elements(t);
			const missing = [undefined, null, {}, {...Library, [name]: {}}];
			for (const component of name === 'Nivo' ? ['Line'] : victoryComponents)
				missing.push({...Library, [name]: {...Library[name], [component]: undefined}});
			for (const value of missing) {
				await assert.rejects(adapter.createDemo(host, rawData(), value), {message: `${name} did not load`});
				assert.equal(host.innerHTML, before);
			}
		});
	}
});

describe('Nivo and Victory pinned pages', () => {
	for (const [id, name, packageName, version] of [
		['nivo', 'Nivo', '@nivo/line', '0.99.0'],
		['victory', 'Victory', 'victory', '38.1.1'],
	]) {
		it(`${name}: uses exact esm.sh pins and one external React identity`, () => {
			const html = readFileSync(new URL(`../../demos/stacked-series-${id}.html`, import.meta.url), 'utf8');
			const page = new DOMParser().parseFromString(html, 'text/html');
			const {imports} = JSON.parse(page.querySelector('script[type="importmap"]').textContent);
			const deps = 'react@19.3.1,react-dom@19.3.1,react-is@19.3.1';
			const external = '&external=react,react-dom';
			const expected = {
				react: `https://esm.sh/react@19.3.1?target=es2022&deps=${deps}`,
				'react-dom': `https://esm.sh/react-dom@19.3.1?target=es2022&deps=${deps}${external}`,
				'react-dom/client': `https://esm.sh/react-dom@19.3.1/client?target=es2022&deps=${deps}${external}`,
				[packageName]: `https://esm.sh/${packageName}@${version}?bundle&target=es2022&deps=${deps}${id === 'nivo' ? ',d3-time@3.1.1' : ''}${external}`,
			};
			if (id === 'nivo')
				expected['react/jsx-runtime'] = `https://esm.sh/react@19.3.1/jsx-runtime?target=es2022&deps=${deps}${external}`;
			assert.deepEqual(imports, expected);
			assert.doesNotMatch(html, /@latest\b|@[~^]/);
			assert.equal(page.querySelectorAll('script[src]').length, 0);
			assert.ok(page.querySelector('link[href="./stacked-series-compare.css"]'));
			assert.ok(page.querySelector('main#demo'));
			const module = page.querySelector('script[type="module"]').textContent;
			assert.ok(module.includes("import {mountDemo} from './stacked-series-compare.js'"));
			assert.ok(module.includes(`import {createDemo} from './stacked-series-${id}.js'`));
			assert.ok(module.includes(`window.stackedDemo = await mountDemo(document.querySelector('#demo'), '${id}', async (host, data) =>`));
			for (const dependency of ['react', 'react-dom', 'react-dom/client', packageName])
				assert.ok(module.includes(`import('${dependency}')`));
			assert.ok(module.includes(`createDemo(host, data, {React, ReactDOM, ReactDOMClient, ${name}})`));
		});
	}
});
