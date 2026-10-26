import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as devextreme from '../../bench/devextreme.mjs';
import * as sampled from '../../bench/devextreme-sampled.mjs';

import * as recharts from '../../bench/recharts.mjs';
import {verifyHover} from '../../bench/hover.mjs';

const length = 55001, epoch = 1700000000000;
const keys = ['cpu', 'ram', 'tcp'], names = ['CPU', 'RAM', 'TCP Out'];
const rows = Array.from({length}, (_, i) => Object.freeze({time: epoch + i * 60000, cpu: 20 + i / 10000, ram: 40 + i / 10000, tcp: 1000 + i}));
const xPixel = x => 85 + (+x - epoch) / 60000 / 50;
const yPixel = (value, s) => 400 - value / (s === 2 ? 200 : 1);
const bounds = {left: 37, top: 59, width: 1920, height: 600};

function element(text = '', parent = null) {
	return {
		nodeType: 1, textContent: text, style: {}, isConnected: true, parentElement: parent,
		getBoundingClientRect: () => ({...bounds}),
		ownerDocument: {defaultView: {getComputedStyle: node => ({display: 'block', visibility: 'visible', opacity: '1', ...node.style})}},
		querySelector: () => null, querySelectorAll: () => [],
	};
}

function dxFixture() {
	const host = element(), tooltip = element(), text = element('', tooltip);
	const series = names.map((name, s) => ({name, getPointByPos: index => points[s][index]}));
	const points = series.map((series, s) => rows.map((row, index) => ({
		series, index, argument: new Date(row.time), value: row[keys[s]],
		getCoords: () => ({x: xPixel(row.time), y: yPixel(row[keys[s]], s)}),
	})));
	const chart = {
		option: key => key === 'size' ? {width: 1920, height: 600} : false,
		getSeriesByPos: s => series[s], _tracker: {}, _tooltip: {_text: {element: text}},
	};
	function select(target, index = target.index, s = target.seriesIndex) {
		const point = points[s][index];
		chart._tracker.pointAtShownTooltip = point;
		chart._tooltip._eventData = {target: point};
		const entries = points.map(series => {
			const point = series[index];
			return {point, value: point.value, argument: point.argument, seriesName: point.series.name, valueText: String(point.value)};
		});
		const lines = entries.map(entry => `${entry.seriesName}: ${entry.valueText}`);
		chart._tooltip._state = {eventData: {target: point}, formatObject: {
			point, value: point.value, argument: point.argument, seriesName: point.series.name, valueText: lines.join('\n'), points: entries,
		}};
		text.querySelectorAll = selector => selector === 'tspan' ? lines.map(line => element(line, text)) : [];
		text.textContent = lines.join('');
	}
	return {host, chart, input: rows, tooltip, text, select,
		clear: () => { chart._tracker.pointAtShownTooltip = null; },
		wrongValue: () => { chart._tracker.pointAtShownTooltip.value++; },
		wrongModel: () => { chart._tooltip._state.formatObject.value++; },
	};
}


async function rechartsFixture() {
	const host = element(), wrapper = element(), tooltip = element('', wrapper);
	const item = element('', tooltip), name = element('', item), text = element('', item);
	wrapper.getBoundingClientRect = () => ({...host.getBoundingClientRect(), top: 99, height: host.getBoundingClientRect().height * 560 / 600});
	host.querySelector = selector => selector === '.recharts-wrapper' ? wrapper : null;
	wrapper.querySelector = selector => selector === '.recharts-tooltip-wrapper' ? tooltip : null;
	tooltip.querySelectorAll = selector => selector === '.recharts-tooltip-item' ? [item] : [];
	item.querySelector = selector => selector.endsWith('-name') ? name : selector.endsWith('-value') ? text : null;
	const paths = Array.from({length: 3}, () => ({getAttribute: () => 'M0,0L100,100'}));
	const mounted = {style: {}, querySelectorAll: () => paths, remove() {}};
	host.ownerDocument.createElement = () => mounted;
	host.append = () => {};
	const cleanups = [], records = [];
	let renders = 0, tree;
	globalThis.benchmarkReact = {
		Component: class {}, Fragment: 'Fragment',
		createElement: (type, props, ...children) => ({type, props: {...props, children: children.length === 1 ? children[0] : children}}),
		useState: initial => [initial, () => { throw new Error('Unexpected React state update'); }],
		useLayoutEffect: effect => { cleanups.push(effect()); },
	};
	function render(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) { node.forEach(render); return; }
		records.push(node);
		if (typeof node.type === 'function') {
			if (node.type.prototype.render) {
				const instance = new node.type(); instance.props = node.props;
				render(instance.render());
			}
			else render(node.type(node.props));
		}
		else render(node.props.children);
	}
	globalThis.benchmarkReactDOM = {flushSync: fn => fn()};
	globalThis.benchmarkReactDOMClient = {createRoot: () => ({
		render(node) { renders++; tree = node; render(node); },
		unmount() { cleanups.splice(0).forEach(cleanup => cleanup?.()); },
	})};
	globalThis.benchmarkRecharts = {
		...Object.fromEntries('LineChart CartesianGrid XAxis YAxis Legend Tooltip Line'.split(' ').map(key => [key, key])),
		useXAxisScale: () => xPixel,
		useYAxisScale: id => { assert.ok(['percent', 'mb'].includes(id)); return value => yPixel(value, id === 'mb' ? 2 : 0); },
		usePlotArea: () => ({x: 85, y: 40, width: 1100, height: 450}),
	};
	globalThis.benchmarkD3Scale = {scaleTime: () => ({domain() { return this; }, ticks: () => []})};
	const chart = await recharts.makeChart(rows, host);
	function select(target, index = target.index, s = target.seriesIndex) {
		const row = rows[index], value = row[keys[s]];
		tooltip.__reactProps$test = {children: {props: {
			active: true, activeIndex: String(index), label: row.time,
			payload: [{dataKey: keys[s], name: names[s], payload: row, value}],
		}}};
		name.textContent = names[s]; text.textContent = String(value);
		item.textContent = `${names[s]} : ${value}`; tooltip.textContent = item.textContent;
	}
	return {host, chart, input: rows, tooltip, text, select, records,
		clear: () => { tooltip.__reactProps$test.children.props.active = false; },
		wrongValue: () => { tooltip.__reactProps$test.children.props.payload[0].value++; },
		wrongModel: () => { tooltip.__reactProps$test.children.props.label++; },
		renders: () => renders,
		recommit: () => { cleanups.splice(0).forEach(cleanup => cleanup?.()); render(tree); },
	};
}

const adapters = {devextreme, recharts};
const fixtures = {devextreme: dxFixture, recharts: rechartsFixture};
const globals = ['devicePixelRatio', 'DevExpress', 'benchmarkReact', 'benchmarkReactDOM', 'benchmarkReactDOMClient', 'benchmarkRecharts', 'benchmarkD3Scale'];

describe('unsampled DevExtreme and Recharts native hover', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.devicePixelRatio = 3;
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries(adapters)) {
		async function fixture(scale = 1) {
			const f = await fixtures[id]();
			f.host.getBoundingClientRect = () => ({...bounds, width: bounds.width * scale, height: bounds.height * scale});
			f.plan = adapter.getHoverPlan(f.chart, f.input, f.host);
			return f;
		}
		it(`${id}: projects ten cycling native points in viewport CSS coordinates`, async () => {
			const f = await fixture();
			assert.equal(f.plan.then, undefined);
			assert.equal(f.plan.targets.length, 10);
			f.plan.targets.forEach((target, i) => {
				const index = Math.round((i + 1) * (length - 1) / 11), s = i % 3;
				assert.equal(target.index, index); assert.equal(target.seriesIndex, s);
				assert.equal(target.x, bounds.left + xPixel(rows[index].time));
				assert.equal(target.y, (id === 'recharts' ? 99 : bounds.top) + yPixel(rows[index][keys[s]], s));
				assert.equal(f.plan.verify(target), null);
			});
		});
		it(`${id}: diagnostic returns ten distinct ACTUAL indices and source values`, async () => {
			const f = await fixture();
			let n = 0;
			const result = await verifyHover(f.plan, {move: async () => {
				const target = f.plan.targets[n++];
				assert.equal(f.plan.verify(target), null, 'stale preceding selection');
				f.select(target, target.index + 20);
			}, wait: async () => {}});
			assert.equal(new Set(result.moves.map(move => move.index)).size, 10);
			for (const move of result.moves) {
				assert.equal(move.index, move.targetIndex + 20);
				assert.equal(move.value, rows[move.index][keys[move.seriesIndex]]);
				assert.ok(move.text);
			}
			if (id === 'recharts') assert.equal(f.renders(), 1);
		});
		it(`${id}: permits one CSS pixel, not arbitrary nearby rows, independent of DPR`, async () => {
			for (const scale of [1, 0.5]) {
				const f = await fixture(scale), target = f.plan.targets[0];
				assert.equal(target.x, bounds.left + xPixel(rows[target.index].time) * scale);
				assert.equal(target.y, (id === 'recharts' ? 99 : bounds.top) + yPixel(rows[target.index].cpu, 0) * scale);
				for (const direction of [-1, 1]) {
					const index = target.index + direction * 50 / scale;
					f.select(target, index); assert.equal(f.plan.verify(target)?.index, index);
					f.select(target, index + direction); assert.equal(f.plan.verify(target), null);
				}
			}
		});
		for (const failure of ['stale text', 'wrong series', 'wrong value', 'wrong model', 'empty selection', 'hidden ancestor', 'detached', 'zero size']) {
			it(`${id}: rejects ${failure}`, async () => {
				const f = await fixture(), target = f.plan.targets[0];
				f.select(target); assert.ok(f.plan.verify(target));
				switch (failure) {
					case 'stale text': f.text.textContent = 'unrelated 123'; break;
					case 'wrong series':
						if (id === 'devextreme') f.chart._tooltip._state.formatObject.points[0].seriesName = 'wrong';
						else f.select(target, target.index, 1);
						break;
					case 'wrong value': f.wrongValue(); break;
					case 'wrong model': f.wrongModel(); break;
					case 'empty selection': f.clear(); break;
					case 'hidden ancestor': f.tooltip.style.visibility = 'hidden'; break;
					case 'detached': f.text.isConnected = false; break;
					case 'zero size': f.text.getBoundingClientRect = () => ({width: 0, height: 0}); break;
				}
				assert.equal(f.plan.verify(target), null);
			});
		}
		it(`${id}: has no synthetic hover, custom tooltip, or custom picking`, () => {
			const source = readFileSync(new URL(`../../bench/${id}.mjs`, import.meta.url), 'utf8');
			assert.doesNotMatch(source, /\b(?:dispatchEvent|showTooltip|_showTooltip|setActiveElements|getPointByCoord|elementFromPoint|onTooltipShown)\s*[:(]/);
			assert.doesNotMatch(source, /\b(?:onMouseMove|onPointerMove|customizeTooltip|contentTemplate)\s*:/);
		});
	}

	it('DevExtreme: only the unsampled options enable native tooltip', async () => {
		const options = [];
		globalThis.DevExpress = {viz: {dxChart: class {
			constructor(host, opts) { options.push(opts); opts.onInitialized({component: this}); opts.onDone(); }
		}}};
		await devextreme.makeChart(rows, {});
		await sampled.makeChart(rows, {});
		assert.deepEqual(options[0].tooltip, {enabled: true, shared: true});
		assert.equal(options[0].commonSeriesSettings.aggregation.enabled, false);
		assert.equal(options[1].tooltip, undefined);
		assert.equal(options[1].commonSeriesSettings.aggregation.enabled, true);
		assert.equal(sampled.getHoverPlan, undefined);
		const f = dxFixture(); f.chart.option = () => true;
		assert.throws(() => devextreme.getHoverPlan(f.chart, rows, f.host), /unsampled/);
	});

	it('DevExtreme: checks all three shared native rows when another series is nearest', () => {
		const f = dxFixture(), plan = devextreme.getHoverPlan(f.chart, rows, f.host), target = plan.targets[0];
		f.select(target, target.index, 2);
		assert.equal(plan.verify(target).seriesIndex, 0);
		assert.equal(plan.verify(target).value, rows[target.index].cpu);
		f.chart._tooltip._state.formatObject.points[1].value++;
		assert.equal(plan.verify(target), null);
	});


	it('Recharts: keeps native Tooltip and source data; probe uses no tooltip subscription or state', async () => {
		const f = await rechartsFixture();
		const props = type => f.records.find(node => node.type === type).props;
		assert.equal(props('LineChart').data, rows);
		assert.equal(props('Tooltip').isAnimationActive, false);
		assert.equal(props('Tooltip').content, undefined);
		const plan = recharts.getHoverPlan(f.chart, rows, f.host), target = plan.targets[0];
		f.select(target); assert.ok(plan.verify(target));
		f.recommit(); assert.equal(plan.verify(target), null, 'old scale snapshot');
		const fresh = recharts.getHoverPlan(f.chart, rows, f.host);
		assert.ok(fresh.verify(target));
		recharts.destroyChart(f.chart);
		assert.equal(fresh.verify(target), null);
		assert.throws(() => recharts.getHoverPlan(f.chart, rows, f.host), /not ready/);
		const source = readFileSync(new URL('../../bench/recharts.mjs', import.meta.url), 'utf8');
		assert.doesNotMatch(source, /useState|useActiveTooltip|useIsTooltipActive/);
	});
});
