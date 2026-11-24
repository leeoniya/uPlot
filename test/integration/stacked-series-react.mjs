import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import {hasPaths, mountReact} from '../../demos/lib/stackedReact.js';
import {createStackedSeriesData, negativeStackData, stackedSeries, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as recharts from '../../demos/stacked-series-recharts.js';

const Recharts = Object.fromEntries(['AreaChart', 'CartesianGrid', 'XAxis', 'YAxis', 'Legend', 'Area'].map(name => [name, Symbol(name)]));
const React = {createElement: (type, props, ...children) => ({type, props, children})};

describe('Recharts signed stacks', () => {
	it('uses independent stackIds, a native Legend, and eight raw data columns including zeros', () => {
		const raw = createStackedSeriesData();
		raw[3][0] += 0.5;
		raw.forEach(Object.freeze);
		Object.freeze(raw);
		const chart = recharts.buildChart(raw, React, Recharts);
		assert.equal(chart.type, Recharts.AreaChart);
		assert.equal(chart.props.stackOffset, 'none');
		const [grid, xAxis, yAxis, legend, ...areas] = chart.children;
		assert.deepEqual([grid.type, xAxis.type, yAxis.type, legend.type], [Recharts.CartesianGrid, Recharts.XAxis, Recharts.YAxis, Recharts.Legend]);
		assert.equal(legend.props.content, undefined);
		assert.deepEqual(xAxis.props.domain, [0, 20]);
		assert.deepEqual(yAxis.props.domain, [-16, 16]);
		assert.deepEqual(chart.props.data.map(row => row.x), raw[0]);
		assert.equal(areas.length, 8);
		assert.equal(new Set(areas.map(area => area.props.dataKey)).size, 8);
		const mirrored = negativeStackData(raw);
		areas.forEach(({type, props}, index) => {
			const i = index % 4, series = stackedSeries[i];
			assert.equal(type, Recharts.Area);
			assert.equal(props.stackId, index < 4 ? 'positive' : 'negative');
			assert.equal(props.name, (index < 4 ? '' : '−') + series.label);
			assert.deepEqual(chart.props.data.map(row => row[props.dataKey]), (index < 4 ? raw : mirrored)[i + 1]);
			assert.deepEqual([props.type, props.stroke, props.strokeWidth, props.fill, props.fillOpacity], ['linear', series.stroke, strokeWidth, series.stroke, fillOpacity]);
			assert.deepEqual([props.dot, props.activeDot, props.isAnimationActive], [false, false, false]);
		});
	});

	it('waits for eight complete area and stroke paths before returning the root', async t => {
		const f = fixture(t);
		const pending = recharts.createDemo(f.host, createStackedSeriesData(), {...f.Library, React, Recharts});
		const addPath = className => {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('class', className);
			path.setAttribute('d', 'M0,0L1,1');
			f.element.append(path);
			return path;
		};
		for (let i = 0; i < 8; i++) {
			addPath('recharts-area-area');
			if (i < 7) addPath('recharts-area-curve');
		}
		f.check();
		await assertPending(pending);
		const last = addPath('recharts-area-curve');
		last.setAttribute('d', 'M0,0L1,NaN');
		f.check();
		await assertPending(pending);
		last.setAttribute('d', 'M0,0L1,1');
		f.check();
		const demo = await pending;
		assertReleased(f);
		assert.equal(demo.plot, f.plot);
		demo.destroy();
		assert.deepEqual([...f.host.childNodes], f.before);
	});
});

function fixture(t, {failure, immediate = false, cleanupFails = false} = {}) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Unrelated content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	const before = [...host.childNodes];
	const error = new Error('native render failed');
	const state = {host, before, error, ready: false};
	const fail = phase => { if (failure === phase) throw error; };
	const win = host.ownerDocument.defaultView;
	const observer = {observe: t.mock.fn(), disconnect: t.mock.fn()};
	t.mock.method(win, 'MutationObserver', class {
		constructor(check) { state.check = check; return observer; }
	});
	t.mock.method(win, 'setTimeout', (callback, delay) => {
		assert.equal(delay, 10000);
		state.timeout = callback;
		return 123;
	});
	state.clear = t.mock.method(win, 'clearTimeout', id => assert.equal(id, 123));
	state.observer = observer;
	state.plot = {
		render: t.mock.fn(() => {
			fail('render');
			if (failure === 'uncaught') state.onUncaughtError(error);
			state.ready = immediate;
		}),
		unmount: t.mock.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); }),
	};
	state.Library = {
		React: {createElement() {}},
		ReactDOM: {flushSync: t.mock.fn(callback => callback())},
		ReactDOMClient: {createRoot: t.mock.fn((element, {onUncaughtError}) => {
			state.element = element;
			state.onUncaughtError = onUncaughtError;
			fail('createRoot');
			return state.plot;
		})},
	};
	state.start = () => mountReact(host, React => {
		assert.equal(React, state.Library.React);
		fail('build');
		return {native: true};
	}, state.Library, 'Test Chart', element => {
		assert.equal(element, state.element);
		fail('predicate');
		return state.ready;
	});
	return state;
}

async function assertPending(promise) {
	const marker = {};
	assert.equal(await Promise.race([
		promise.then(() => 'resolved', () => 'rejected'),
		new Promise(resolve => setImmediate(resolve, marker)),
	]), marker);
}

function assertReleased(f) {
	assert.equal(f.observer.disconnect.mock.callCount(), 1);
	assert.equal(f.clear.mock.callCount(), 1);
}

describe('stacking comparisons shared React lifecycle', {concurrency: false}, () => {
	for (const immediate of [false, true]) {
		it(`waits for native geometry and releases observer/timer (immediate: ${immediate})`, async t => {
			const f = fixture(t, {immediate});
			const pending = f.start();
			assert.equal(f.element.parentNode, f.host);
			assert.equal(f.plot.render.mock.callCount(), 1);
			if (!immediate) {
				await assertPending(pending);
				f.ready = true;
				f.check();
			}
			const demo = await pending;
			assert.equal(demo.plot, f.plot);
			assertReleased(f);
			f.check();
			f.timeout();
			assertReleased(f);
			demo.destroy();
			demo.destroy();
			assert.equal(f.plot.unmount.mock.callCount(), 1);
			assert.deepEqual([...f.host.childNodes], f.before);
		});
	}

	for (const failure of ['createRoot', 'build', 'render', 'uncaught', 'predicate', 'timeout']) {
		it(`cleans up ${failure} failure without replacing the original error`, async t => {
			const f = fixture(t, {failure, cleanupFails: true});
			const pending = f.start();
			if (failure === 'timeout') f.timeout();
			await assert.rejects(pending, error => failure === 'timeout'
				? error.message === 'Test Chart did not render four stacked areas' : error === f.error);
			assertReleased(f);
			assert.equal(f.plot.unmount.mock.callCount(), failure === 'createRoot' ? 0 : 1);
			assert.deepEqual([...f.host.childNodes], f.before);
		});
	}

	it('removes owned DOM even if normal unmount throws', async t => {
		const f = fixture(t, {immediate: true, cleanupFails: true});
		const demo = await f.start();
		assert.throws(demo.destroy, /cleanup failed/);
		assert.deepEqual([...f.host.childNodes], f.before);
		assertReleased(f);
	});

	it('rejects missing React APIs without changing the host', async t => {
		const f = fixture(t);
		for (const Library of [null, {}, {React: {}}, {...f.Library, ReactDOM: {}}, {...f.Library, ReactDOMClient: {}}]) {
			await assert.rejects(mountReact(f.host, () => {}, Library, 'Test Chart', () => false), {message: 'Test Chart did not load'});
			assert.deepEqual([...f.host.childNodes], f.before);
		}
	});

	it('requires an exact count of complete finite paths', () => {
		const element = document.createElement('div');
		for (let i = 0; i < 4; i++) {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M0,0L1,1');
			element.append(path);
		}
		assert.equal(hasPaths(element, 'path'), true);
		assert.equal(hasPaths(element, 'path', 3), false);
		for (const invalid of ['', 'M0,0', 'MNaN,0L1,1', 'M0,0L1,Infinity']) {
			element.lastChild.setAttribute('d', invalid);
			assert.equal(hasPaths(element, 'path'), false);
		}
	});
});
