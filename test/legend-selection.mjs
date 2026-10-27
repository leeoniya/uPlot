import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [10, 20, 30], [40, null, 60], [70, 80, 90], [25, 50, 75]];
const labels = ['Time', 'Alpha', 'Beta', 'Gamma', 'Delta'];
const frame = async () => { await Promise.resolve(); await new Promise(requestAnimationFrame); };
const rows = u => [...u.root.querySelectorAll('.u-legend tbody tr')];
const rowLabels = u => rows(u).map(row => row.querySelector('.u-label').textContent);
const cells = row => [...row.querySelectorAll('td')].map(cell => cell.textContent);
const selection = u => ({ order: u.legend.order?.slice(), count: u.legend.count, range: u.legend.range?.slice() });
const expectSelection = (u, order, count = order.length, range = [0, count]) =>
	assert.deepEqual(selection(u), { order, count, range });
const move = (u, y, x = 0) => {
	const xPos = u.valToPos(x, 'x'), yPos = u.valToPos(y, 'y');
	u.setCursor(u.scales.x.ori == 0 ? { left: xPos, top: yPos } : { left: yPos, top: xPos });
};
const mouse = (target, type, opts = {}) => target.dispatchEvent(new MouseEvent(type, {
	bubbles: type == 'click', cancelable: true, button: 0, ...opts,
}));


function expectDists(u, expected, reference = u.cursor.dists) {
	assert.ok(Array.isArray(reference), 'cursor.dists is a series-indexed array');
	assert.equal(u.cursor.dists === reference, true, 'distance array retains identity');
	assert.equal(reference.length, expected.length);
	expected.forEach((value, si) => {
		assert.equal(typeof reference[si], 'number', `series ${si} has a numeric distance`);
		if (Number.isFinite(value))
			assert.ok(Math.abs(reference[si] - value) < 1e-8, `series ${si}: ${reference[si]} != ${value}`);
		else
			assert.equal(reference[si], Infinity, `series ${si} is inactive`);
	});
}

const distancesAt = (u, y, values) => [Infinity, ...values.map(value => value == null ? Infinity :
	Math.abs(u.valToPos(value, 'y') - u.valToPos(y, 'y')))];

describe('legend selection', () => {
	let plots;
	beforeEach(() => { plots = []; });
	afterEach(() => { for (const u of plots) u.destroy(); });

	async function plot({ legend = {}, cursor = {}, hooks = {}, multi = false, mode = 1,
		pxRatio = 1, ori = 0, dir = 1, alpha = 0.25, series = {}, plotData = data } = {}) {
		const formats = [];
		const valueAt = (u, si, idx) => idx == null ? null :
			(mode == 1 ? u.data?.[si]?.[idx] : u.data?.[si]?.[1]?.[idx]);
		const u = new uPlot({
			width: 400, height: 300, pxRatio, mode,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			scales: {
				x: { time: false, ori, dir, range: [0, 2] },
				y: { ori: 1 - ori, dir, range: [0, 100] },
			},
			legend,
			cursor: { focus: { prox: -1 }, dataIdx: (u, si, idx) => mode == 1 ? idx : 0, ...cursor },
			focus: { alpha },
			series: labels.map((label, si) => ({
				label,
				...(si > 0 && { stroke: ['red', 'green', 'blue', 'purple'][si - 1], points: { show: false } }),
				value(u, value, si, idx) {
					formats.push([si, idx]);
					return mode == 1 ? value : valueAt(u, si, idx);
				},
				...(multi && si > 0 && {
					values(u, si, idx) {
						formats.push([si, idx]);
						const value = valueAt(u, si, idx);
						return { Value: value ?? '--', Double: value == null ? '--' : 2 * value };
					},
				}),
				...series[si],
			})),
			hooks,
		}, mode == 1 ? plotData : [null, ...plotData.slice(1).map(values => [plotData[0], values])], (self, init) => {
			plots.push(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 });
			document.body.appendChild(self.root);
			init();
		});
		await frame();
		formats.length = 0;
		return { u, formats };
	}

	it('filters only Y indices, sorts only survivors, then limits the sorted set without reindexing values', async () => {
		const calls = [];
		const ranks = [0, 2, 99, 1, 1];
		const { u } = await plot({ legend: {
			filter(self, si) { calls.push(['filter', si]); return si != 2; },
			sort(self, a, b) { calls.push(['sort', a, b]); return ranks[a] - ranks[b]; },
			limit(self, indices) { calls.push(['limit', [...indices]]); return [1, 3]; },
		} });
		const original = u.series.slice();
		calls.length = 0;
		u.setLegend({ idxs: [2, 0, 1, 2, 1] });
		expectSelection(u, [4, 1], 3, [1, 3]);
		assert.deepEqual(calls.slice(0, 4), [1, 2, 3, 4].map(si => ['filter', si]));
		const comparisons = calls.slice(4, -1);
		assert.ok(comparisons.length > 0);
		assert.ok(comparisons.every(([stage, a, b]) => stage == 'sort' && [1, 3, 4].includes(a) && [1, 3, 4].includes(b)));
		assert.deepEqual(calls.at(-1), ['limit', [3, 4, 1]]);
		assert.deepEqual(u.legend.idxs, [2, 0, 1, 2, 1]);
		assert.deepEqual(u.legend.values.map(value => value._), [2, 10, '--', 90, 50]);
		original.forEach((s, si) => assert.equal(u.series[si] === s, true));
		await frame();
		assert.deepEqual(rowLabels(u), ['Time', 'Delta', 'Alpha']);
		assert.deepEqual(rows(u).map(cells), [['2'], ['50'], ['10']]);
	});

	it('reuses the comparator wrapper while reading the current sort callback', async () => {
		let candidates;
		const { u } = await plot({ legend: {
			sort: (u, a, b) => b - a,
			limit(u, indices) { candidates = indices; return [0, indices.length]; },
		} });
		const wrappers = [];
		Object.defineProperty(candidates, 'sort', {
			value(compare) {
				wrappers.push(compare);
				return Array.prototype.sort.call(this, compare);
			},
		});
		u.setLegend({ idx: 0 });
		u.setLegend({ idx: 1 });
		expectSelection(u, [4, 3, 2, 1]);
		u.legend.sort = (u, a, b) => a - b;
		u.setLegend({});
		expectSelection(u, [1, 2, 3, 4]);
		assert.equal(wrappers.length, 3);
		assert.ok(wrappers.every(compare => compare === wrappers[0]));
		await frame();
		assert.deepEqual(rowLabels(u), labels);
	});

	it('copies explicit sparse indices without overwriting omitted series', async () => {
		const { u } = await plot();
		u.setLegend({ idx: 1 });
		const active = u.legend.idxs;
		const idxs = [, 0, , null, 2];
		const observed = [];
		u.hooks.setLegend = [self => observed.push(self.legend.idxs.slice())];
		u.setLegend({ idxs });
		assert.equal(u.legend.idxs === active, true);
		assert.equal(u.cursor.idxs === active, true);
		assert.equal(u.legend.idx, 1);
		assert.deepEqual(active, [1, 0, 1, null, 2]);
		assert.deepEqual(observed, [[1, 0, 1, null, 2]]);
		assert.equal(0 in idxs, false);
		assert.equal(2 in idxs, false);
		await frame();
		assert.deepEqual(rows(u).map(cells), [['1'], ['10'], ['--'], ['--'], ['75']]);
	});

	for (const deferred of [false, true]) {
		it(`preserves sparse hook iteration and list replacement with deferred hooks=${deferred}`, async () => {
			const { u } = await plot();
			const observed = [];
			const opts = { show: true };
			const fns = Array(4);
			fns[0] = function(self, si, options) {
				assert.equal(this, null);
				assert.equal(self, u);
				assert.equal(si, 1);
				assert.equal(options, opts);
				observed.push('first');
				fns[1] = () => observed.push('filled hole');
				delete fns[2];
				fns.push(() => observed.push('appended'));
				u.hooks.setSeries = [() => observed.push('replacement list')];
			};
			fns[2] = () => assert.fail('deleted hook must not run');
			fns[3] = () => observed.push('last');
			u.hooks.setSeries = fns;
			if (deferred)
				u.batch(() => u.setSeries(1, opts), true);
			else
				u.setSeries(1, opts);
			await frame();
			assert.deepEqual(observed, ['first', 'filled hole', 'last']);
			u.setSeries(1, opts);
			assert.deepEqual(observed, ['first', 'filled hole', 'last', 'replacement list']);
		});
	}

	it('skips absent hooks and postpones appended hooks until the next dispatch', async () => {
		const { u } = await plot();
		const observed = [];
		let appended = false;
		const fns = [() => {
			observed.push('first');
			if (!appended) {
				appended = true;
				fns.push(() => observed.push('appended'));
			}
		}, , () => observed.push('last')];
		u.hooks.setLegend = fns;
		u.setLegend({});
		assert.deepEqual(observed, ['first', 'last']);
		u.setLegend({});
		assert.deepEqual(observed, ['first', 'last', 'first', 'last', 'appended']);
	});

	it('breaks comparator ties by original series index rather than the previous display order', async () => {
		let tied = false;
		const { u } = await plot({ legend: { sort: (u, a, b) => tied ? 0 : b - a } });
		expectSelection(u, [4, 3, 2, 1]);
		tied = true;
		u.setLegend({});
		expectSelection(u, [1, 2, 3, 4]);
		await frame();
		assert.deepEqual(rowLabels(u), labels);
	});

	for (const config of [
		{ name: 'all omitted', legend: {}, order: [1, 2, 3, 4], count: 4, range: [0, 4] },
		{ name: 'filter only', legend: { filter: (u, si) => si % 2 == 0 }, order: [2, 4], count: 2, range: [0, 2] },
		{ name: 'sort only', legend: { sort: (u, a, b) => b - a }, order: [4, 3, 2, 1], count: 4, range: [0, 4] },
		{ name: 'limit only', legend: { limit: () => [1, 3] }, order: [2, 3], count: 4, range: [1, 3] },
	]) {
		it(`treats omitted stages as no-ops (${config.name}), including hidden series`, async () => {
			const { u } = await plot({ legend: config.legend, series: { 2: { show: false } } });
			expectSelection(u, config.order, config.count, config.range);
			await frame();
			assert.deepEqual(rowLabels(u), ['Time', ...config.order.map(si => labels[si])]);
			const beta = rows(u).find(row => row.querySelector('.u-label').textContent == 'Beta');
			if (beta)
				assert.equal(beta.classList.contains('u-off'), true);
		});
	}

	for (const show of [true, false]) {
		it(`reuses default identity selection across explicit legend updates with legend.show=${show}`, async () => {
			const { u } = await plot({ legend: { show } });
			const order = u.legend.order;
			const range = u.legend.range;
			let orderReads = 0, notifications = 0;
			// Selection rebuilds and synchronous DOM renders each read order once.
			Object.defineProperty(u.legend, 'order', { get() { orderReads++; return order; } });
			u.hooks.setLegend = [() => notifications++];

			for (const idx of [0, 1, 2, null]) {
				orderReads = 0;
				u.setLegend({ idx });
				assert.equal(orderReads, show ? 1 : 0, 'changed values render without rebuilding identity selection');
				assert.deepEqual(u.legend.idxs, Array(5).fill(idx));
				if (show)
					assert.deepEqual(u.legend.values.map(value => value._), data.map(column => idx == null ? '--' : column[idx] ?? '--'));
				await frame();
				assert.deepEqual(order, [1, 2, 3, 4]);
				assert.equal(u.legend.range === range, true);
				assert.deepEqual(range, [0, 4]);
			}
			assert.equal(notifications, 4, 'value update hooks are unchanged');
			orderReads = 0;
			u.setLegend({ idxs: [2, 0, 1, 2, 1] });
			u.setLegend({});
			assert.equal(orderReads, show ? 1 : 0, 'changed values render once while both calls reuse identity selection');
			orderReads = 0;

			u.addSeries({ label: 'Added', stroke: 'orange' }, 2);
			u.setData([data[0], data[1], [5, 6, 7], ...data.slice(2)], false);
			assert.equal(orderReads, 0, 'structural selection remains deferred');
			u.setLegend({ idx: 1 });
			assert.equal(orderReads, show ? 2 : 1, 'dirty structural selection is rebuilt once and visible rows render once');
			expectSelection(u, [1, 2, 3, 4, 5]);
			orderReads = 0;
			u.setLegend({ idx: 2 });
			assert.equal(orderReads, show ? 1 : 0, 'value update renders without rebuilding selection');
			await frame();
			if (show)
				assert.deepEqual(rowLabels(u), ['Time', 'Alpha', 'Added', 'Beta', 'Gamma', 'Delta']);

			u.delSeries(2);
			u.setData(data, false);
			orderReads = 0;
			u.setLegend({ idx: 0 });
			assert.equal(orderReads, show ? 2 : 1, 'deletion rebuilds identity selection once and renders visible rows once');
			expectSelection(u, [1, 2, 3, 4]);
			orderReads = 0;
			u.setLegend({});
			assert.equal(orderReads, 0);
			await frame();
			if (show)
				assert.deepEqual(rowLabels(u), labels);
		});
	}

	it('restores the identity fast path when all selection callbacks are removed', async () => {
		const { u } = await plot({ legend: {
			filter: (u, si) => si != 2,
			sort: (u, a, b) => b - a,
			limit: () => [1, 2],
		} });
		expectSelection(u, [3], 3, [1, 2]);
		const order = u.legend.order;
		const range = u.legend.range;
		u.legend.filter = u.legend.sort = u.legend.limit = null;
		u.setLegend({});
		expectSelection(u, [1, 2, 3, 4]);
		assert.equal(u.legend.order === order, true);
		assert.equal(u.legend.range === range, true);
		await frame();
		assert.deepEqual(rowLabels(u), labels);

		let orderReads = 0;
		Object.defineProperty(u.legend, 'order', { get() { orderReads++; return order; } });
		u.setLegend({ idx: 1 });
		assert.equal(orderReads, 1, 'changed values render without rebuilding the restored identity order');
		u.legend.sort = (u, a, b) => b - a;
		u.setLegend({});
		expectSelection(u, [4, 3, 2, 1]);
		await frame();
		assert.deepEqual(rowLabels(u), ['Time', 'Delta', 'Gamma', 'Beta', 'Alpha']);
	});

	it('normalizes and clamps pagination without negative slice semantics, including empty filters', async () => {
		let bounds = [0, 4], include = true;
		const inputs = [];
		const { u } = await plot({ legend: {
			filter: () => include,
			limit(u, indices) { inputs.push([...indices]); return bounds; },
		} });
		for (const [requested, effective, order] of [
			[[-2, 2], [0, 2], [1, 2]],
			[[1.9, 3.9], [1, 3], [2, 3]],
			[[2, 99], [2, 4], [3, 4]],
			[[99, 100], [4, 4], []],
			[[2, 1], [2, 2], []],
			[[0, -1], [0, 0], []],
			[[0, Infinity], [0, 4], [1, 2, 3, 4]],
			[[Infinity, Infinity], [4, 4], []],
			[[NaN, 2], [0, 2], [1, 2]],
			[[1, NaN], [1, 1], []],
			[[NaN, NaN], [0, 0], []],
		]) {
			bounds = [...requested];
			u.setLegend({});
			expectSelection(u, order, 4, effective);
			assert.deepEqual(bounds, requested, 'normalization does not mutate callback-owned bounds');
			await frame();
			assert.deepEqual(rowLabels(u), ['Time', ...order.map(si => labels[si])]);
		}
		include = false;
		bounds = [2, 5];
		u.setLegend({});
		expectSelection(u, [], 0, [0, 0]);
		assert.deepEqual(inputs.at(-1), []);
		await frame();
		assert.deepEqual(rowLabels(u), ['Time'], 'X does not consume the page or disappear with empty Y selection');
		include = true;
		bounds = [0, 1];
		u.setLegend({});
		expectSelection(u, [1], 4, [0, 1]);
	});

	it('refreshes external closure state explicitly and snapshots hook observations', async () => {
		let minimum = 1, descending = false, start = 0, limits = 0;
		const { u } = await plot({ legend: {
			filter: (u, si) => si >= minimum,
			sort: (u, a, b) => descending ? b - a : a - b,
			limit() { limits++; return [start, 2]; },
		} });
		expectSelection(u, [1, 2], 4, [0, 2]);

		await frame();
		assert.deepEqual(rowLabels(u), ['Time', 'Alpha', 'Beta']);
		minimum = 2;
		descending = true;
		start = 1;
		const observed = [];
		u.hooks.setLegend = [self => observed.push(selection(self))];
		limits = 0;
		u.redraw();
		await frame();
		assert.equal(limits, 0, 'unrelated redraw does not reevaluate closure state');
		expectSelection(u, [1, 2], 4, [0, 2]);
		assert.deepEqual(observed, []);
		u.setLegend({});
		assert.equal(limits, 1, 'explicit refresh reevaluates closure state once');
		expectSelection(u, [3], 3, [1, 2]);
		assert.deepEqual(observed, [{ order: [3], count: 3, range: [1, 2] }]);
		await frame();
		assert.equal(limits, 1, 'render does not repeat explicit selection');
		assert.deepEqual(rowLabels(u), ['Time', 'Gamma']);
		start = 0;
		u.setLegend({}, false);
		expectSelection(u, [4, 3], 3, [0, 2]);
		assert.equal(observed.length, 1, 'hook suppression does not suppress selection');
		assert.deepEqual(observed, [{ order: [3], count: 3, range: [1, 2] }], 'later updates do not alter the copied snapshot');
		assert.equal(limits, 2);
		await frame();
		assert.equal(limits, 2, 'hook-suppressed refresh does not repeat at render');
		assert.deepEqual(rowLabels(u), ['Time', 'Delta', 'Gamma']);
	});

	for (const config of [
		{ name: 'scalar live', pinned: true },
		{ name: 'multi-value', multi: true },
		{ name: 'nonlive', legend: { live: false } },
		{ name: 'mode 2', mode: 2 },
	]) {
		it(`preserves existing X eligibility and table structure for ${config.name}`, async () => {
			const { u } = await plot({ ...config, legend: { ...config.legend, sort: (u, a, b) => b - a, limit: () => [1, 3] } });
			u.setLegend({ idxs: [0, 2, 0, 1, 2] });
			expectSelection(u, [3, 2], 4, [1, 3]);
			assert.deepEqual(u.legend.idxs, [0, 2, 0, 1, 2]);
			await frame();
			const table = u.root.querySelector('.u-legend');
			assert.deepEqual(rowLabels(u), [...(config.pinned ? ['Time'] : []), 'Gamma', 'Beta']);
			assert.equal(table.className, config.multi ? 'u-legend u-btm' : `u-legend u-btm u-inline${config.legend?.live === false ? '' : ' u-live'}`);
			assert.deepEqual([...table.querySelectorAll('thead th')].map(cell => cell.textContent), config.multi ? ['', 'Value', 'Double'] : []);
			assert.equal(table.querySelectorAll('input, button, select').length, 0);
			if (config.legend?.live === false)
				assert.ok(rows(u).every(row => cells(row).length == 0));
			else {
				assert.deepEqual(cells(rows(u).at(-2)), config.multi ? ['80', '160'] : ['80']);
				assert.deepEqual(cells(rows(u).at(-1)), config.multi ? ['40', '80'] : ['40']);
			}
		});
	}

	for (const live of [true, false]) {
		it(`publishes headless selection and distances before callbacks/hooks with live=${live}`, async () => {
			let armed = false, expected, observed = [];
			const check = (u, stage) => {
				if (armed) {
					expectDists(u, expected.dists);
					observed.push(stage);
				}
			};
			const { u } = await plot({
				legend: {
					show: false, live,
					filter(u, si) { check(u, 'filter'); return Number.isFinite(u.cursor.dists?.[si]); },
					sort(u, a, b) { check(u, 'sort'); return u.cursor.dists[a] - u.cursor.dists[b]; },
					limit(u, indices) {
						check(u, 'limit');
						if (armed) assert.deepEqual(indices, expected.sorted);
						return [0, 1];
					},
				},
				cursor: { trackDists: true, focus: { prox: Infinity } },
			});
			for (const hook of ['setLegend', 'setCursor', 'setSeries']) {
				u.hooks[hook] = [self => {
					check(self, hook);
					expectSelection(self, expected.sorted.slice(0, 1), 4, [0, 1]);
				}];
			}
			armed = true;
			for (const [y, sorted] of [[12, [1, 4, 2, 3]], [68, [3, 2, 4, 1]]]) {
				expected = { sorted, dists: distancesAt(u, y, [10, 40, 70, 25]) };
				observed = [];
				move(u, y);
				expectSelection(u, sorted.slice(0, 1), 4, [0, 1]);
				for (const stage of ['filter', 'sort', 'limit', 'setCursor', 'setSeries'])
					assert.ok(observed.includes(stage), `${stage} observes current state`);
				assert.deepEqual(u.legend.idxs, [0, 0, 0, 0, 0]);
				observed = [];
				u.setLegend({});
				assert.ok(observed.includes('setLegend'), 'explicit headless refresh publishes selection');
				await frame();
				assert.equal(u.root.querySelector('.u-legend') === null, true);
			}
		});
	}

	for (const multi of [false, true]) {
		it(`refreshes a live DOM limit on Y-only moves without reformatting ${multi ? 'multi' : 'scalar'} values`, async () => {
			let limits = 0;
			const { u, formats } = await plot({ multi,
				cursor: { trackDists: true },
				legend: {
					sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
					limit() { limits++; return [0, 2]; },
				},
			});
			move(u, 12);
			await frame();
			expectSelection(u, [1, 4], 4, [0, 2]);
			const oldRows = rows(u);
			const delta = oldRows.at(-1);
			const records = u.legend.values.slice();
			const values = structuredClone(u.legend.values);
			const idxs = u.legend.idxs.slice();
			formats.length = limits = 0;
			move(u, 68);
			expectSelection(u, [3, 2], 4, [0, 2]);
			assert.equal(limits, 1);
			assert.deepEqual(formats, [], 'selection does not run value formatters at unchanged indices');
			assert.deepEqual(u.legend.idxs, idxs);
			assert.deepEqual(u.legend.values, values);
			records.forEach((record, si) => assert.equal(u.legend.values[si] === record, true));
			await frame();
			assert.equal(limits, 1, 'render does not repeat Y-only selection');
			assert.deepEqual(rowLabels(u), [...(multi ? [] : ['Time']), 'Gamma', 'Beta']);
			assert.equal(delta.parentNode === null, true, 'excluded rows are removed, not CSS-hidden');
			assert.equal(rows(u).length, multi ? 2 : 3);
			if (!multi) assert.equal(rows(u)[0] === oldRows[0], true, 'pinned X row retains identity');
			limits = 0;
			move(u, 68);
			assert.equal(limits, 1, 'even an identical cursor update reevaluates selection exactly once');
			assert.deepEqual(formats, []);
			await frame();
			assert.equal(limits, 1);
		});
	}

	for (const show of [true, false]) {
		for (const batched of [false, true]) {
			it(`selects exactly once per cursor update with legend.show=${show} and ${batched ? 'enclosing' : 'focus-queued'} commit`, async () => {
				let limits = 0, draws = 0;
				const { u } = await plot({ cursor: { trackDists: true, focus: { prox: Infinity } }, legend: {
					show,
					sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
					limit() { limits++; return [0, 1]; },
				} });
				u.hooks.draw = [() => draws++];
				for (const [name, y, x, nearest] of [
					['initial', 12, 0, 1],
					['identical', 12, 0, 1],
					['Y-only', 68, 0, 3],
					['X-only', 68, 1, 3],
					['X and Y', 32, 2, 1],
				]) {
					limits = draws = 0;
					if (batched)
						u.batch(() => move(u, y, x));
					else
						move(u, y, x);
					assert.equal(limits, 1, `${name}: cursor and enclosing commit select once`);
					expectSelection(u, [nearest], 4, [0, 1]);
					assert.equal(u.series[nearest]._focus, true);
					assert.deepEqual(u.legend.idxs, Array(5).fill(x));
					if (show)
						assert.deepEqual(rowLabels(u), ['Time', labels[nearest]], 'cursor operation completes DOM synchronously');
					await Promise.resolve();
					assert.equal(limits, 1, `${name}: queued commit does not repeat selection`);
					await frame();
					await frame();
					assert.equal(limits, 1, `${name}: RAF does not repeat selection`);
					if (batched || name == 'initial' || name == 'Y-only' || name == 'X and Y')
						assert.ok(draws > 0, 'the enclosing or focus-queued commit actually ran');
					if (show)
						assert.deepEqual(rowLabels(u), ['Time', labels[nearest]]);
				}
			});
		}
	}

	it('moves retained keyed rows and keeps click, isolate, and hover bound to series identity after index shifts', async () => {
		let descending = false, start = 0;
		const { u } = await plot({ cursor: { focus: { prox: 1 } }, legend: {
			sort: (u, a, b) => descending ? b - a : a - b,
			limit: () => [start, start + 2],
		} });
		const [time, alpha, beta] = rows(u);
		const betaSeries = u.series[2];
		start = 1;
		u.setLegend({});
		await frame();
		assert.equal(alpha.parentNode === null, true, 'paging removes excluded rows');
		assert.equal(rows(u)[1] === beta, true);
		const gamma = rows(u)[2];
		descending = true;
		u.setLegend({});
		await frame();
		assert.equal(rows(u)[0] === time, true);
		assert.equal(rows(u)[1] === gamma, true);
		assert.equal(rows(u)[2] === beta, true);
		mouse(beta.querySelector('.u-marker'), 'click');
		assert.equal(betaSeries.show, false);
		await frame();
		assert.equal(beta.classList.contains('u-off'), true);
		mouse(beta.querySelector('.u-label'), 'click');
		mouse(beta.querySelector('th'), 'mouseenter');
		assert.equal(betaSeries._focus, true);
		assert.equal(u.series[3]._focus, false);
		mouse(u.root.querySelector('.u-legend'), 'mouseleave');
		assert.equal(betaSeries._focus, null);

		u.addSeries({ label: 'Added', stroke: 'orange' }, 1);
		u.setData([data[0], [5, 5, 5], ...data.slice(1)], false);
		u.setLegend({});
		expectSelection(u, [4, 3], 5, [1, 3]);
		assert.equal(u.series[3] === betaSeries, true);
		assert.equal(rows(u)[2] === beta, true);
		mouse(beta.querySelector('.u-label'), 'click', { ctrlKey: true });
		assert.deepEqual(u.series.slice(1).map(s => s.show), [false, false, true, false, false]);
		mouse(beta.querySelector('.u-marker'), 'click', { ctrlKey: true });
		assert.ok(u.series.slice(1).every(s => s.show));
		u.delSeries(1);
		u.setData(data, false);
		u.setLegend({});
		expectSelection(u, [3, 2], 4, [1, 3]);
		assert.equal(rows(u)[2] === beta, true);
		mouse(beta.querySelector('.u-label'), 'click');
		assert.equal(u.series[2] === betaSeries, true);
		assert.equal(betaSeries.show, false);
		assert.equal(u.series[1].show, true);
	});

	for (const refresh of ['setLegend', 'cursor', 'redraw']) {
		it(`keeps headless add/delete pending through microtasks and RAF until ${refresh}`, async () => {
			const calls = [], observed = [];
			const { u } = await plot({ legend: {
				show: false,
				filter(u, si) { calls.push('filter'); return true; },
				sort(u, a, b) {
					calls.push('sort');
					assert.equal(u.data.length, u.series.length, 'callbacks receive aligned data');
					return u.data[a][0] - u.data[b][0];
				},
				limit(u, indices) { calls.push('limit'); return [0, indices.length]; },
			} });
			for (const hook of ['addSeries', 'delSeries', 'setLegend'])
				u.hooks[hook] = [self => observed.push([hook, selection(self), self.series.length])];

			for (const adding of [true, false]) {
				const before = selection(u);
				const hook = adding ? 'addSeries' : 'delSeries';
				calls.length = observed.length = 0;
				if (adding)
					u.addSeries({ label: 'Added', stroke: 'orange' }, 2);
				else
					u.delSeries(2);
				assert.deepEqual(calls, [], 'structural setter does not select');
				assert.deepEqual(observed, [[hook, before, adding ? 6 : 5]], 'structural hook sees new series and old selection');
				assert.deepEqual(selection(u), before);
				await Promise.resolve();
				assert.deepEqual(calls, [], 'no independent selection microtask');
				await frame();
				await frame();
				assert.deepEqual(calls, [], 'headless mutation does not select at RAF');
				assert.deepEqual(selection(u), before);
				assert.equal(observed.length, 1, 'pending mutation does not fire setLegend');

				u.setData(adding ? [data[0], data[1], [15, 35, 55], ...data.slice(2)] : data, false);
				assert.deepEqual(calls, [], 'aligning data does not select synchronously');
				if (refresh == 'setLegend')
					u.setLegend({});
				else if (refresh == 'cursor')
					move(u, 12);
				else
					u.redraw();
				if (refresh != 'redraw')
					assert.equal(calls.filter(stage => stage == 'limit').length, 1, 'explicit update resolves pending selection');
				await frame();
				await frame();
				assert.equal(calls.filter(stage => stage == 'limit').length, 1, 'pending selection runs only once');
				expectSelection(u, adding ? [1, 2, 5, 3, 4] : [1, 4, 2, 3]);
				assert.deepEqual(observed, [[hook, before, adding ? 6 : 5], ['setLegend', selection(u), adding ? 6 : 5]]);
				assert.equal(u.root.querySelector('.u-legend'), null);
			}
		});
	}

	for (const refresh of ['setLegend', 'cursor', 'setData', 'redraw']) {
		it(`keeps visible standalone add/delete pending without frames or canvas work until ${refresh}`, async () => {
			const calls = [], observed = [];
			const { u } = await plot({ legend: {
				filter(u, si) { calls.push('filter'); return true; },
				sort(u, a, b) {
					calls.push('sort');
					assert.equal(u.data.length, u.series.length, 'callbacks receive aligned data');
					return b - a;
				},
				limit(u, indices) { calls.push('limit'); return [0, indices.length]; },
			} });
			for (const hook of ['addSeries', 'delSeries', 'setLegend'])
				u.hooks[hook] = [self => observed.push([hook, selection(self), rowLabels(self)])];
			let frames = 0, draws = 0;
			u.hooks.draw = [() => draws++];
			const raf = globalThis.requestAnimationFrame;
			globalThis.requestAnimationFrame = callback => { frames++; return raf(callback); };
			try {
				for (const adding of [true, false]) {
					const before = selection(u), beforeLabels = rowLabels(u);
					const hook = adding ? 'addSeries' : 'delSeries';
					calls.length = observed.length = draws = 0;
					if (adding)
						u.addSeries({ label: 'Added', stroke: 'orange' }, 2);
					else
						u.delSeries(2);
					assert.deepEqual(calls, [], 'structural setter does not select');
					assert.deepEqual(observed, [[hook, before, beforeLabels]]);
					await Promise.resolve();
					assert.deepEqual(calls, [], 'no independent selection microtask');
					// Bypass the spy for the test's own frame waits.
					await new Promise(raf);
					await new Promise(raf);
					assert.deepEqual(calls, [], 'visible mutation stays pending across frames');
					assert.deepEqual(selection(u), before);
					assert.deepEqual(rowLabels(u), beforeLabels);
					assert.equal(observed.length, 1, 'pending mutation does not fire setLegend');
					assert.equal(frames, 0, 'structural mutation schedules no frame');
					assert.equal(draws, 0, 'structural mutation forces no canvas commit');

					const aligned = adding ? [data[0], data[1], [15, 35, 55], ...data.slice(2)] : data;
					if (refresh == 'setData')
						u.setData(aligned);
					else {
						u.setData(aligned, false);
						assert.deepEqual(calls, [], 'aligning data does not select');
						if (refresh == 'setLegend')
							u.setLegend({});
						else if (refresh == 'cursor')
							move(u, 12);
						else
							u.redraw();
					}
					if (refresh == 'setData' || refresh == 'redraw')
						await Promise.resolve();
					assert.equal(calls.filter(stage => stage == 'limit').length, 1);
					expectSelection(u, adding ? [5, 4, 3, 2, 1] : [4, 3, 2, 1]);
					assert.deepEqual(rowLabels(u), adding ? ['Time', 'Delta', 'Gamma', 'Beta', 'Added', 'Alpha'] : ['Time', 'Delta', 'Gamma', 'Beta', 'Alpha']);
					assert.deepEqual(observed, [[hook, before, beforeLabels], ['setLegend', selection(u), rowLabels(u)]], 'refresh hook sees completed DOM');
					await new Promise(raf);
					assert.equal(calls.filter(stage => stage == 'limit').length, 1);
					assert.equal(frames, 0, 'refresh does not schedule a legend frame');
					if (refresh == 'setLegend')
						assert.equal(draws, 0, 'explicit legend refresh does not force a canvas commit');
				}
			}
			finally {
				globalThis.requestAnimationFrame = raf;
			}
		});
	}

	for (const show of [true, false]) {
		for (const adding of [true, false]) {
			it(`keeps hook-created ${adding ? 'addition' : 'deletion'} pending until explicit refresh with legend.show=${show}`, async () => {
				const { u, formats } = await plot({ legend: {
					show,
					sort(u, a, b) {
						assert.equal(u.data.length, u.series.length, 'hook-created changes select only after data alignment');
						return b - a;
					},
				} });
				const observed = [];
				let frames = 0, draws = 0;
				u.hooks.draw = [() => draws++];
				u.hooks.setLegend = [self => {
					observed.push({ ...selection(self), rows: rowLabels(self) });
					if (observed.length == 1) {
						if (adding)
							self.addSeries({ label: 'Added', stroke: 'orange' }, 1);
						else
							self.delSeries(1);
					}
				}];
				const raf = globalThis.requestAnimationFrame;
				globalThis.requestAnimationFrame = callback => { frames++; return raf(callback); };
				try {
					u.addSeries({ label: 'Trigger', stroke: 'black' }, 2);
					assert.deepEqual(observed, [], 'structural selection requires a refresh');
					const aligned = [data[0], data[1], [15, 35, 55], ...data.slice(2)];
					u.setData(aligned, false);
					u.setLegend({});
					const first = {
						order: [5, 4, 3, 2, 1], count: 5, range: [0, 5],
						rows: show ? ['Time', 'Delta', 'Gamma', 'Beta', 'Trigger', 'Alpha'] : [],
					};
					assert.deepEqual(observed, [first], 'hook sees completed DOM before its structural mutation');
					const firstFormats = show ? [0, 1, 3, 4, 5].map(si => [si, null]) : [];
					assert.deepEqual(formats, firstFormats, 'explicit refresh formats the aligned original series at inactive indices');
					await Promise.resolve();
					await new Promise(raf);
					await new Promise(raf);
					expectSelection(u, first.order);
					assert.deepEqual(rowLabels(u), first.rows, 'hook-created structural work stays pending');
					assert.deepEqual(observed, [first]);
					assert.deepEqual(formats, firstFormats, 'hook-created structural work does not format unaligned data');
					assert.equal(frames, 0);
					assert.equal(draws, 0);

					formats.length = 0;
					u.setData(adding ? [aligned[0], [5, 6, 7], ...aligned.slice(1)] : [aligned[0], ...aligned.slice(2)], false);
					u.setLegend({});
					const order = adding ? [6, 5, 4, 3, 2, 1] : [4, 3, 2, 1];
					const expectedRows = !show ? [] : adding ? ['Time', 'Delta', 'Gamma', 'Beta', 'Trigger', 'Alpha', 'Added'] : ['Time', 'Delta', 'Gamma', 'Beta', 'Trigger'];
					expectSelection(u, order);
					assert.deepEqual(rowLabels(u), expectedRows);
					assert.deepEqual(observed, [first, { order, count: order.length, range: [0, order.length], rows: expectedRows }]);
					assert.equal(u.cursor.idx, null);
					const finalFormats = show ? (adding ? [0, 2, 4, 5, 6] : [0, 2, 3, 4]).map(si => [si, null]) : [];
					assert.deepEqual(formats, finalFormats, 'explicit refresh formats original series at their aligned new indices');
					await new Promise(raf);
					assert.deepEqual(formats, finalFormats, 'completed refresh does not format values again');
					assert.equal(frames, 0);
					assert.equal(draws, 0);
					assert.equal(observed.length, 2, 'explicit refresh leaves no scheduled legend work');
				}
				finally {
					globalThis.requestAnimationFrame = raf;
				}
			});
		}
	}

	for (const refresh of ['setLegend', 'redraw']) {
		it(`defers raw-value selection until inserted/deleted data columns align before ${refresh}`, async () => {
			const added = [15, 35, 55];
			const columns = new Map(labels.map((label, si) => [label, data[si]]));
			columns.set('Added', added);
			let comparisons = 0;
			const { u } = await plot({ legend: {
				sort(u, a, b) {
					comparisons++;
					for (const si of [a, b])
						assert.equal(u.data[si] === columns.get(u.series[si].label), true, `aligned column for ${u.series[si].label}`);
					return (u.data[a][u.legend.idxs[a]] ?? Infinity) - (u.data[b][u.legend.idxs[b]] ?? Infinity);
				},
			} });
			move(u, 12);
			await frame();
			expectSelection(u, [1, 4, 2, 3]);
			comparisons = 0;
			assert.doesNotThrow(() => u.addSeries({ label: 'Added', stroke: 'orange' }, 1));
			assert.equal(comparisons, 0, 'addSeries does not run callbacks against unshifted data');
			u.setData([data[0], added, ...data.slice(1)], false);
			if (refresh == 'setLegend') {
				assert.doesNotThrow(() => u.setLegend({}));
				assert.ok(comparisons > 0, 'explicit selection reads aligned data synchronously');
				assert.deepEqual(u.legend.order.filter(si => si != 1), [2, 5, 3, 4]);
			}
			else
				u.redraw();
			await frame();
			assert.ok(comparisons > 0);
			assert.deepEqual(u.legend.idxs.slice(2), [0, 0, 0, 0], 'retained series keep their active index');
			// Explicit setLegend preserves the new null index; redraw resolves it from the cursor.
			expectSelection(u, refresh == 'setLegend' ? [2, 5, 3, 4, 1] : [2, 1, 5, 3, 4]);

			comparisons = 0;
			assert.doesNotThrow(() => u.delSeries(1));
			assert.equal(comparisons, 0, 'delSeries does not run callbacks against unshifted data');
			u.setData(data, false);
			if (refresh == 'setLegend')
				assert.doesNotThrow(() => u.setLegend({}));
			else
				u.redraw();
			await frame();
			assert.ok(comparisons > 0);
			expectSelection(u, [1, 4, 2, 3]);
			assert.deepEqual(u.legend.idxs, [0, 0, 0, 0, 0]);
			assert.deepEqual(rowLabels(u), ['Time', 'Alpha', 'Delta', 'Beta', 'Gamma']);
		});
	}

	it('keeps default index order pending after standalone add/delete until explicit refresh', async () => {
		const { u } = await plot();
		u.addSeries({ label: 'Added', stroke: 'orange' }, 2);
		await frame();
		expectSelection(u, [1, 2, 3, 4]);
		assert.deepEqual(rowLabels(u), labels);
		u.setData([data[0], data[1], [5, 6, 7], ...data.slice(2)], false);
		u.setLegend({});
		expectSelection(u, [1, 2, 3, 4, 5]);
		const addedLabels = ['Time', 'Alpha', 'Added', 'Beta', 'Gamma', 'Delta'];
		assert.deepEqual(rowLabels(u), addedLabels);
		u.delSeries(2);
		await frame();
		expectSelection(u, [1, 2, 3, 4, 5]);
		assert.deepEqual(rowLabels(u), addedLabels);
		u.setData(data, false);
		u.setLegend({});
		expectSelection(u, [1, 2, 3, 4]);
		assert.deepEqual(rowLabels(u), labels);
	});

	for (const show of [true, false]) {
		it(`reevaluates a size-dependent filter on inactive-cursor resize with legend.show=${show}`, async () => {
			let limits = 0, cursorUpdates = 0;
			const { u, formats } = await plot({ legend: {
				show,
				filter: (u, si) => si <= u.bbox.width / 200,
				limit(u, indices) { limits++; return [0, indices.length]; },
			} });
			u.hooks.setCursor = [() => cursorUpdates++];
			expectSelection(u, [1, 2]);
			for (const [width, order] of [[600, [1, 2, 3]], [300, [1]]]) {
				limits = 0;
				u.setSize({ width, height: 300 });
				await frame();
				expectSelection(u, order);
				assert.equal(limits, 1, 'resize marks selection dirty even without an active cursor');
				assert.equal(u.cursor.idx, null);
				assert.equal(cursorUpdates, 0);
				assert.deepEqual(formats, [], 'inactive resize does not format values');
				if (show)
					assert.deepEqual(rowLabels(u), ['Time', ...order.map(si => labels[si])]);
				await frame();
				assert.equal(limits, 1, 'render does not repeat resize selection');
			}
		});
	}

	for (const tracking of [true, false]) {
		it(`repositions ordinary cursor markers after fixed-range resize with ${tracking ? 'tracking only' : 'filter only'}`, async () => {
			const { u } = await plot({
				cursor: { trackDists: tracking, points: { one: false } },
				legend: tracking ? {} : { filter: (u, si) => si != 2 },
				series: Object.fromEntries([1, 2, 3, 4].map(si => [si, { pxAlign: 0, points: { show: false, width: 0 } }])),
			});
			move(u, 12, 2);
			await frame();
			const markers = [...u.over.querySelectorAll('.u-cursor-pt')];
			assert.equal(markers.length, 4);
			const assertPositions = () => markers.forEach((marker, i) => {
				assert.equal(marker.classList.contains('u-off'), false);
				const actual = marker.style.transform.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
				const expected = [u.valToPos(2, 'x'), u.valToPos(data[i + 1][2], 'y')];
				for (let axis = 0; axis < 2; axis++)
					assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-8, `series ${i + 1}, axis ${axis}: ${actual[axis]} != ${expected[axis]}`);
			});
			assertPositions();
			const idxs = u.legend.idxs.slice();
			const values = structuredClone(u.legend.values);
			u.setSize({ width: 600, height: 450 });
			await frame();
			assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], [0, 2, 0, 100]);
			assert.deepEqual(u.legend.idxs, idxs);
			assert.deepEqual(u.legend.values, values);

			const current = [...u.over.querySelectorAll('.u-cursor-pt')];
			assert.equal(current.length, markers.length);
			markers.forEach((marker, i) => assert.equal(current[i] === marker, true));
			assertPositions();
			if (tracking)
				expectDists(u, distancesAt(u, 12, [30, 60, 90, 75]));
			expectSelection(u, tracking ? [1, 2, 3, 4] : [1, 3, 4]);
		});
	}

	for (const show of [true, false]) {
		it(`refreshes distances and selection after setData(false) plus redraw with cursor.show=${show}`, async () => {
			const { u } = await plot({ cursor: { show, trackDists: true }, legend: {
				sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
				limit: () => [0, 1],
			} });
			move(u, 12);
			await frame();
			expectSelection(u, [1], 4, [0, 1]);
			const dists = u.cursor.dists;
			const position = [u.cursor.left, u.cursor.top];
			const idxs = u.legend.idxs.slice();
			const observed = [];
			u.hooks.setLegend = [self => observed.push({ ...selection(self), dists: self.cursor.dists.slice() })];
			u.setData([data[0], [80, 80, 80], [40, 40, 40], [10, 10, 10], [25, 25, 25]], false);
			u.redraw();
			await frame();
			assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], [0, 2, 0, 100]);
			assert.deepEqual([u.cursor.left, u.cursor.top], position);
			assert.deepEqual(u.legend.idxs, idxs);
			expectDists(u, [Infinity, 204, 84, 6, 39], dists);
			expectSelection(u, [3], 4, [0, 1]);
			assert.ok(observed.length > 0, 'redraw publishes refreshed selection');
			assert.deepEqual(observed.at(-1), { order: [3], count: 4, range: [0, 1], dists: dists.slice() });
			assert.deepEqual(rowLabels(u), ['Time', 'Gamma']);
		});
	}

	for (const show of [true, false]) {
		it(`coalesces visibility setters into one commit selection with legend.show=${show}`, async () => {
			const observed = [];
			const { u } = await plot({ legend: {
				show,
				filter: (u, si) => u.series[si].show,
				limit(u, indices) { observed.push(['limit', [...indices]]); return [0, indices.length]; },
			} });
			observed.length = 0;
			u.hooks.setSeries = [(self, si) => observed.push(['series', si, self.series[si].show, self.legend.order.slice()])];
			u.hooks.setLegend = [self => observed.push(['legend', self.legend.order.slice()])];
			const setters = [
				['series', 2, false, [1, 2, 3, 4]],
				['series', 3, false, [1, 2, 3, 4]],
				['series', 2, true, [1, 2, 3, 4]],
			];
			u.setSeries(2, { show: false });
			u.setSeries(3, { show: false });
			u.setSeries(2, { show: true });
			assert.deepEqual(u.series.slice(1).map(s => s.show), [true, true, false, true]);
			expectSelection(u, [1, 2, 3, 4]);
			assert.deepEqual(observed, setters, 'setSeries hooks see current visibility but selection stays pending');
			await Promise.resolve();
			expectSelection(u, [1, 2, 4]);
			const committed = [...setters, ['limit', [1, 2, 4]], ['legend', [1, 2, 4]]];
			assert.deepEqual(observed, committed, 'one selection and notification follow the setter hooks');
			assert.equal(u.cursor.idx, null);
			if (show)
				assert.deepEqual(rowLabels(u), ['Time', 'Alpha', 'Beta', 'Delta']);
			await frame();
			assert.deepEqual(observed, committed, 'render does not repeat selection');
		});

		for (const alpha of [0.25, 1]) {
			it(`defers focus selection to commit with legend.show=${show} and alpha=${alpha}`, async () => {
				const observed = [];
				const { u } = await plot({ alpha, legend: {
					show,
					filter: (u, si) => u.series[si]._focus !== false,
					limit(u, indices) { observed.push(['limit', [...indices]]); return [0, indices.length]; },
				} });
				u.hooks.setSeries = [(self, si) => observed.push(['series', si, self.series.slice(1).map(s => s._focus), self.legend.order.slice()])];
				u.hooks.setLegend = [self => observed.push(['legend', self.legend.order.slice()])];
				observed.length = 0;
				u.setSeries(2, { focus: true });
				u.setSeries(3, { focus: true });
				const setters = [
					['series', 2, [false, true, false, false], [1, 2, 3, 4]],
					['series', 3, [false, false, true, false], [1, 2, 3, 4]],
				];
				assert.deepEqual(observed, setters, 'focus state changes before selection callbacks or setLegend');
				assert.deepEqual(u.series.slice(1).map(s => s.alpha), [alpha, alpha, 1, alpha]);
				expectSelection(u, [1, 2, 3, 4]);
				await Promise.resolve();
				expectSelection(u, [3]);
				const committed = [...setters, ['limit', [3]], ['legend', [3]]];
				assert.deepEqual(observed, committed);
				if (show)
					assert.deepEqual(rowLabels(u), ['Time', 'Gamma']);
				await frame();
				assert.deepEqual(observed, committed);

				observed.length = 0;
				u.setSeries(null, { focus: true });
				const reset = ['series', null, [null, null, null, null], [3]];
				assert.deepEqual(observed, [reset]);
				expectSelection(u, [3]);
				await Promise.resolve();
				expectSelection(u, [1, 2, 3, 4]);
				assert.deepEqual(observed, [reset, ['limit', [1, 2, 3, 4]], ['legend', [1, 2, 3, 4]]]);
				if (show)
					assert.deepEqual(rowLabels(u), labels, 'focus reset completes DOM at commit without a later frame');
				assert.equal(u.cursor.idx, null);
			});
		}
	}

	it('notifies headless visibility selection changes while the cursor stays inactive', async () => {
		const { u } = await plot({ legend: { show: false, filter: (u, si) => u.series[si].show } });
		assert.equal(u.cursor.idx, null);
		const observed = [];
		let cursorUpdates = 0;
		u.hooks.setLegend = [self => observed.push(selection(self))];
		u.hooks.setCursor = [() => cursorUpdates++];
		u.setSeries(2, { show: false });
		await frame();
		expectSelection(u, [1, 3, 4]);
		assert.ok(observed.length > 0, 'visibility change fires setLegend without a cursor update');
		assert.deepEqual(observed.at(-1), { order: [1, 3, 4], count: 3, range: [0, 3] });
		assert.equal(cursorUpdates, 0);
		assert.equal(u.cursor.idx, null);
		assert.equal(u.root.querySelector('.u-legend') === null, true);
		observed.length = 0;
		u.setSeries(2, { show: true });
		await frame();
		expectSelection(u, [1, 2, 3, 4]);
		assert.ok(observed.length > 0);
		assert.deepEqual(observed.at(-1), { order: [1, 2, 3, 4], count: 4, range: [0, 4] });
		assert.equal(cursorUpdates, 0);
	});

	for (const tracking of [true, false]) {
		it(`clears nonlive active indices on exit with ${tracking ? 'tracking only' : 'selection only'}`, async () => {
			const { u } = await plot({ cursor: { trackDists: tracking }, legend: {
				live: false,
				...(!tracking && { filter: (u, si) => u.legend.idxs[si] != null }),
			} });
			move(u, 12);
			assert.deepEqual(u.legend.idxs, [0, 0, 0, 0, 0]);
			expectSelection(u, [1, 2, 3, 4]);
			mouse(u.over, 'mouseleave');
			assert.equal(u.cursor.idx, null);
			assert.equal(u.legend.idx, null);
			assert.deepEqual(u.cursor.idxs, [null, null, null, null, null]);
			assert.deepEqual(u.legend.idxs, [null, null, null, null, null]);
			if (tracking)
				expectDists(u, Array(5).fill(Infinity));
			else
				expectSelection(u, [], 0, [0, 0]);
		});
	}

	it('keeps physical cursor distances when setLegend explicitly overrides shared or per-series indices', async () => {
		const { u } = await plot({ cursor: { trackDists: true }, legend: {
			sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
			limit: () => [0, 1],
		} });
		move(u, 12);
		await frame();
		const dists = u.cursor.dists;
		expectDists(u, [Infinity, 6, 84, 174, 39], dists);
		const physicalDists = dists.slice();
		const position = [u.cursor.left, u.cursor.top];
		const observed = [];
		u.hooks.setLegend = [self => observed.push({ idxs: self.legend.idxs.slice(), dists: self.cursor.dists.slice() })];
		for (const [opts, idxs] of [
			[{ idx: 2 }, [2, 2, 2, 2, 2]],
			[{ idxs: [2, 2, 0, 1, null] }, [2, 2, 0, 1, null]],
			[{ idx: null }, [null, null, null, null, null]],
		]) {
			u.setLegend(opts);
			assert.deepEqual(u.legend.idxs, idxs);
			assert.deepEqual(observed.at(-1), { idxs, dists: physicalDists });
			await frame();
			assert.equal(u.cursor.idx, 0, 'legend override does not move the physical cursor');
			assert.deepEqual([u.cursor.left, u.cursor.top], position);
			expectDists(u, [Infinity, 6, 84, 174, 39], dists);
			expectSelection(u, [1], 4, [0, 1]);
		}
		move(u, 12);
		assert.deepEqual(u.legend.idxs, [0, 0, 0, 0, 0]);
		expectDists(u, [Infinity, 6, 84, 174, 39], dists);
	});

	it('refreshes a visibility filter without dropping hidden series from the default eligible set', async () => {
		const { u } = await plot({ legend: { filter: (u, si) => u.series[si].show } });
		u.setSeries(2, { show: false });
		await frame();
		expectSelection(u, [1, 3, 4]);
		assert.deepEqual(rowLabels(u), ['Time', 'Alpha', 'Gamma', 'Delta']);
		u.setSeries(2, { show: true });
		await frame();
		expectSelection(u, [1, 2, 3, 4]);
	});

	it('refreshes distance-based selection on data and scale changes with a stationary cursor', async () => {
		const { u } = await plot({ cursor: { trackDists: true }, legend: {
			filter: (u, si) => Number.isFinite(u.cursor.dists?.[si]),
			sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
			limit: () => [0, 1],
		} });
		move(u, 12);
		expectSelection(u, [1], 4, [0, 1]);
		const position = [u.cursor.left, u.cursor.top];
		const replacement = [data[0], [80, 80, 80], [40, 40, 40], [10, 10, 10], [25, 25, 25]];
		u.setData(replacement);
		await frame();
		expectSelection(u, [3], 4, [0, 1]);
		assert.deepEqual([u.cursor.left, u.cursor.top], position);
		u.setScale('y', { min: 0, max: 200 });
		await frame();
		expectSelection(u, [4], 4, [0, 1]);
		assert.deepEqual([u.cursor.left, u.cursor.top], position);
		u.setData([]);
		await frame();
		expectSelection(u, [], 0, [0, 0]);
		expectDists(u, Array(5).fill(Infinity));
		u.setData(replacement);
		await frame();
		const currentY = u.posToVal(u.cursor.top, 'y');
		const expected = distancesAt(u, currentY, [80, 40, 10, 25]);
		const nearest = [1, 2, 3, 4].sort((a, b) => expected[a] - expected[b])[0];
		expectDists(u, expected);
		expectSelection(u, [nearest], 4, [0, 1]);
	});

	it('tracks stable CSS-pixel distances without focus, resets missing/hidden/inactive entries, and clears on exit', async () => {
		const { u } = await plot({ pxRatio: 2, cursor: { trackDists: true } });
		assert.ok(Array.isArray(u.cursor.dists));
		const dists = u.cursor.dists;
		expectDists(u, Array(5).fill(Infinity), dists);
		move(u, 12);
		expectDists(u, [Infinity, 6, 84, 174, 39], dists);
		assert.ok(u.series.slice(1).every(s => s._focus == null), 'tracking does not enable focus');
		move(u, 12, 1);
		expectDists(u, distancesAt(u, 12, [20, null, 80, 50]), dists);
		u.setSeries(1, { show: false });
		await frame();
		expectDists(u, distancesAt(u, 12, [null, null, 80, 50]), dists);
		u.cursor.dataIdx = (u, si, idx) => si == 3 ? null : idx;
		move(u, 12, 1);
		expectDists(u, distancesAt(u, 12, [null, null, null, 50]), dists);
		mouse(u.over, 'mouseleave');
		expectDists(u, Array(5).fill(Infinity), dists);
		u.setSeries(1, { show: true });
		await frame();
		u.cursor.dataIdx = (u, si, idx) => idx;
		move(u, 12);
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
		u.setCursor({ left: -10, top: -10 });
		expectDists(u, Array(5).fill(Infinity), dists);
	});

	for (const [name, ori, dir] of [
		['reversed', 0, -1],
		['rotated', 1, 1],
		['rotated and reversed', 1, -1],
	]) {
		it(`tracks CSS-pixel distances and selects nearest rows with ${name} scales`, async () => {
			const { u } = await plot({ ori, dir, pxRatio: 2, cursor: { trackDists: true }, legend: {
				filter: (u, si) => Number.isFinite(u.cursor.dists?.[si]),
				sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
				limit: () => [0, 1],
			} });
			const dists = u.cursor.dists;
			const pixelsPerUnit = ori == 0 ? 3 : 4;
			move(u, 12);
			assert.equal(u.cursor.idx, 0);
			expectDists(u, [Infinity, ...[2, 28, 58, 13].map(d => d * pixelsPerUnit)], dists);
			expectSelection(u, [1], 4, [0, 1]);
			move(u, 68, 1);
			assert.equal(u.cursor.idx, 1);
			expectDists(u, [Infinity, ...[48, Infinity, 12, 18].map(d => d * pixelsPerUnit)], dists);
			expectSelection(u, [3], 3, [0, 1]);
			await frame();
			assert.deepEqual(rowLabels(u), ['Time', 'Gamma']);
		});
	}

	for (const tracking of [{}, { trackDists: false }]) {
		it(`does not call a custom distance metric with prox < 0 and tracking ${tracking.trackDists === false ? 'disabled' : 'omitted'}`, async () => {
			let calls = 0;
			const { u } = await plot({ cursor: { ...tracking, focus: {
				prox: -1,
				dist() { calls++; return 0; },
			} } });
			assert.equal(calls, 0);
			move(u, 12);
			move(u, 68);
			move(u, 68, 1);
			u.setData(data);
			await frame();
			u.setCursor({ left: -10, top: -10 });
			assert.equal(calls, 0, 'inactive focus and tracking do not evaluate the metric');
		});
	}

	it('normalizes a custom metric NaN to Infinity and clears the previous finite distance', async () => {
		let invalid = false;
		const { u } = await plot({ cursor: { trackDists: true, focus: {
			prox: -1,
			dist: (u, si, idx, valuePos, cursorPos) => invalid && si == 1 ? NaN : valuePos - cursorPos,
		} }, legend: {
			filter: (u, si) => Number.isFinite(u.cursor.dists?.[si]),
			sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
			limit: () => [0, 1],
		} });
		const dists = u.cursor.dists;
		move(u, 12);
		expectDists(u, [Infinity, 6, 84, 174, 39], dists);
		expectSelection(u, [1], 4, [0, 1]);
		invalid = true;
		move(u, 12);
		expectDists(u, [Infinity, Infinity, 84, 174, 39], dists);
		expectSelection(u, [4], 3, [0, 1]);
		invalid = false;
		move(u, 12);
		expectDists(u, [Infinity, 6, 84, 174, 39], dists);
		expectSelection(u, [1], 4, [0, 1]);
	});

	it('uses the absolute custom focus metric even when focus proximity is disabled', async () => {
		const calls = [];
		const { u } = await plot({ cursor: { trackDists: true, focus: {
			prox: -1,
			dist(u, si, idx, valuePos, cursorPos) {
				calls.push({ u, si, idx, valuePos, cursorPos });
				return -(Math.abs(valuePos - cursorPos) / 3 + si);
			},
		} } });
		calls.length = 0;
		move(u, 12);
		expectDists(u, [Infinity, 3, 30, 61, 17]);
		assert.deepEqual(calls.map(call => call.si), [1, 2, 3, 4]);
		for (const call of calls) {
			assert.equal(call.u === u, true);
			assert.equal(call.idx, 0);
			assert.equal(call.valuePos, u.valToPos(data[call.si][0], 'y'));
			assert.equal(call.cursorPos, u.valToPos(12, 'y'));
		}
	});

	it('keeps distances finite for series rejected by focus bias or proximity and resets the old focus', async () => {
		const { u } = await plot({ cursor: { trackDists: true, focus: { prox: Infinity, bias: 1 } } });
		const dists = u.cursor.dists;
		move(u, 12);
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
		assert.equal(u.series[4]._focus, true, 'bias selects the closest value away from zero, not Alpha');
		u.focus.bias = -1;
		move(u, 12);
		assert.equal(u.series[1]._focus, true);
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
		u.focus.prox = 1;
		move(u, 12);
		assert.ok(u.series.slice(1).every(s => s._focus == null), 'out-of-proximity focus is cleared');
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
		u.setCursor({ left: -10, top: -10 });
		expectDists(u, Array(5).fill(Infinity), dists);
	});

	it('keeps the distance array aligned and stable through insertion and deletion', async () => {
		const { u } = await plot({ cursor: { trackDists: true } });
		const dists = u.cursor.dists;
		move(u, 12);
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
		u.addSeries({ label: 'Added', stroke: 'orange' }, 2);
		assert.equal(u.cursor.dists === dists, true);
		assert.equal(dists.length, 6);
		assert.equal(dists[2], Infinity, 'new series starts without an active value');
		u.setData([data[0], data[1], [12, 12, 12], ...data.slice(2)]);
		await frame();
		expectDists(u, distancesAt(u, 12, [10, 12, 40, 70, 25]), dists);
		u.delSeries(2);
		assert.equal(u.cursor.dists === dists, true);
		assert.equal(dists.length, 5);
		u.setData(data);
		await frame();
		expectDists(u, distancesAt(u, 12, [10, 40, 70, 25]), dists);
	});

	it('selects mode 2 series using their own active indices and distances, never a synthetic X row', async () => {
		const idxs = [null, 2, 0, 1, 2];
		const { u } = await plot({ mode: 2, cursor: { trackDists: true, dataIdx: (u, si) => idxs[si] }, legend: {
			sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
			limit: () => [0, 2],
		} });
		move(u, 72);
		expectDists(u, distancesAt(u, 72, [30, 40, 80, 75]));
		expectSelection(u, [4, 3], 4, [0, 2]);
		assert.deepEqual(u.legend.idxs.slice(1), idxs.slice(1));
		assert.deepEqual(u.legend.values.slice(1).map(value => value._), [30, 40, 80, 75]);
		await frame();
		assert.deepEqual(rowLabels(u), ['Delta', 'Gamma']);
		assert.deepEqual(rows(u).map(cells), [['75'], ['80']]);
	});
});
