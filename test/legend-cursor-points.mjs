import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [20, 20, 20], [40, null, 40], [60, 60, 60], [80, 80, 80]];
const excludedClass = 'u-excl';
const frame = async () => { await Promise.resolve(); await new Promise(requestAnimationFrame); };
const markers = u => [...u.over.querySelectorAll('.u-cursor-pt')];
const move = (u, y, x = 0) => u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y, 'y') });
const off = pts => pts.map(pt => pt.classList.contains('u-off'));

function expectMembership(u, order) {
	assert.deepEqual(u.legend.order, order);
	const pts = markers(u);
	assert.equal(pts.length, u.series.length - 1, 'excluded series retain their point elements');
	pts.forEach((pt, i) => assert.equal(pt.classList.contains(excludedClass), !order.includes(i + 1), `series ${i + 1} membership`));
}

function expectIdentity(u, expected) {
	const actual = markers(u);
	assert.equal(actual.length, expected.length);
	expected.forEach((pt, i) => assert.equal(actual[i] === pt, true, `point ${i} retains DOM identity`));
}

// Observe membership work only: ordinary positioning can still access u-off.
function spyMembership(pts) {
	const calls = [];
	const restore = [];
	for (const pt of pts) {
		const list = pt.classList;
		for (const name of ['contains', 'add', 'remove', 'toggle', 'replace']) {
			const descriptor = Object.getOwnPropertyDescriptor(list, name);
			const original = list[name];
			Object.defineProperty(list, name, { configurable: true, value(...args) {
				if (args.includes(excludedClass))
					calls.push([name, ...args]);
				return original.apply(this, args);
			} });
			restore.push(() => {
				if (descriptor) Object.defineProperty(list, name, descriptor);
				else delete list[name];
			});
		}
	}
	return { calls, restore: () => restore.forEach(fn => fn()) };
}

describe('legend membership of cursor points', () => {
	let plots;
	beforeEach(() => { plots = []; });
	afterEach(() => { for (const u of plots) u.destroy(); });

	async function plot({ legend = {}, cursor = {}, plotData = data } = {}) {
		const u = new uPlot({
			width: 400, height: 300, pxRatio: 1,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 100] } },
			legend,
			cursor: { focus: { prox: -1 }, dataIdx: (u, si, idx) => idx, ...cursor },
			series: [{ label: 'Time' }, ...['red', 'green', 'blue', 'purple'].map((stroke, i) => ({
				label: `Series ${i + 1}`, stroke, pxAlign: 0, points: { show: false, width: 0 },
			}))],
		}, plotData, (self, init) => {
			plots.push(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 });
			document.body.appendChild(self.root);
			init();
		});
		await frame();
		return u;
	}

	for (const show of [true, false]) {
		it(`uses final filter/sort/limit membership with legend.show=${show}`, async () => {
			const ranks = [0, 2, 99, 0, 1];
			let range = [1, 3];
			const u = await plot({ legend: {
				show,
				filter: (u, si) => si != 2,
				sort: (u, a, b) => ranks[a] - ranks[b],
				limit: () => range,
			} });
			const pts = markers(u);
			expectMembership(u, [4, 1]);
			move(u, 45);
			expectMembership(u, [4, 1]);
			assert.deepEqual(off(pts), [false, false, false, false], 'legend exclusion does not use u-off');
			const positions = pts.map(pt => pt.style.transform);
			range = [0, 1];
			u.setLegend({});
			expectMembership(u, [3]);
			assert.deepEqual(pts.map(pt => pt.style.transform), positions, 'membership does not change point geometry');
			await frame();
			expectIdentity(u, pts);
			if (!show)
				assert.equal(u.root.querySelector('.u-legend'), null, 'membership does not require a built-in legend');
		});

		it(`switches nearest membership on Y-only motion with legend.show=${show}`, async () => {
			const u = await plot({ cursor: { trackDists: true }, legend: {
				show,
				filter: (u, si) => Number.isFinite(u.cursor.dists[si]),
				sort: (u, a, b) => u.cursor.dists[a] - u.cursor.dists[b],
				limit: () => [0, 1],
			} });
			const pts = markers(u);
			move(u, 21);
			expectMembership(u, [1]);
			const idxs = u.cursor.idxs.slice();
			const positions = pts.map(pt => pt.style.transform);
			for (const [y, si] of [[59, 3], [79, 4], [39, 2], [21, 1]]) {
				move(u, y);
				expectMembership(u, [si]);
				assert.deepEqual(u.cursor.idxs, idxs, 'Y-only motion preserves data indices');
				assert.deepEqual(pts.map(pt => pt.style.transform), positions);
				assert.deepEqual(off(pts), [false, false, false, false]);
			}
			expectIdentity(u, pts);
		});
	}

	it('refreshes points for explicit setLegend({}, false) without firing the hook', async () => {
		let selected = 1;
		const u = await plot({ legend: { filter: (u, si) => si == selected } });
		move(u, 20);
		let notifications = 0;
		u.hooks.setLegend = [() => notifications++];
		selected = 3;
		u.setLegend({}, false);
		expectMembership(u, [3]);
		assert.equal(notifications, 0);
		await frame();
		expectMembership(u, [3]);
		assert.equal(notifications, 0, 'deferred rendering also respects hook suppression');
		selected = 2;
		u.setLegend({});
		expectMembership(u, [2]);
		assert.equal(notifications, 1, 'normal refresh still fires the hook');
	});

	it('keeps missing, hidden, outside, and exited points off independently of membership', async () => {
		let include = false;
		const u = await plot({
			plotData: [data[0], data[1], [null, null, null], [150, 150, 150], data[4]],
			legend: { filter: () => include },
		});
		u.setSeries(4, { show: false });
		await frame();
		move(u, 20);
		const pts = markers(u);
		expectMembership(u, []);
		assert.deepEqual(off(pts), [false, true, true, true]);
		for (const value of [true, false, true]) {
			include = value;
			u.setLegend({});
			expectMembership(u, value ? [1, 2, 3, 4] : []);
			assert.deepEqual(off(pts), [false, true, true, true], 'membership cannot reveal an invalid point');
		}
		u.setData(data);
		u.setSeries(4, { show: true });
		await frame();
		move(u, 20);
		assert.deepEqual(off(pts), [false, false, false, false]);
		for (const exit of [
			() => u.setCursor({ left: -10, top: -10 }),
			() => u.over.dispatchEvent(new MouseEvent('mouseleave')),
		]) {
			exit();
			assert.deepEqual(off(pts), [true, true, true, true]);
			include = false;
			u.setLegend({});
			include = true;
			u.setLegend({});
			expectMembership(u, [1, 2, 3, 4]);
			assert.deepEqual(off(pts), [true, true, true, true], 'selection refresh does not reactivate an exited cursor');
			move(u, 20);
			assert.deepEqual(off(pts), [false, false, false, false]);
		}
		expectIdentity(u, pts);
	});

	it('cleans up removed restrictions once and supports applying them again', async () => {
		const filter = (u, si) => si != 2;
		const limit = () => [0, 1];
		const u = await plot({ legend: { filter, limit } });
		move(u, 20);
		const pts = markers(u);
		expectMembership(u, [1]);
		for (let cycle = 0; cycle < 2; cycle++) {
			u.legend.filter = null;
			u.legend.limit = null;
			u.setLegend({});
			expectMembership(u, [1, 2, 3, 4]);
			const spy = spyMembership(pts);
			try {
				for (const y of [35, 65, 25]) {
					u.setLegend({});
					move(u, y);
				}
				await frame();
				assert.deepEqual(spy.calls, [], 'unrestricted updates do not repeat membership cleanup');
			}
			finally { spy.restore(); }
			u.legend.filter = filter;
			u.legend.limit = limit;
			u.setLegend({});
			expectMembership(u, [1]);
			expectIdentity(u, pts);
			assert.deepEqual(off(pts), [false, false, false, false]);
		}
	});

	for (const kind of ['default', 'sort-only', 'retain-all']) {
		it(`avoids membership class reads and writes for ${kind} selection`, async () => {
			let descending = true;
			const sort = (u, a, b) => descending ? b - a : a - b;
			const legend = kind == 'default' ? {} : kind == 'sort-only' ? { sort } : {
				filter: () => true, sort, limit: (u, indices) => [0, indices.length],
			};
			const u = await plot({ legend });
			move(u, 20);
			const pts = markers(u);
			const spy = spyMembership(pts);
			try {
				for (const x of [0, 2, 0]) {
					descending = !descending;
					u.setLegend({});
					move(u, 55, x);
					await frame();
				}
				assert.deepEqual(spy.calls, [], 'retaining every Y series needs no membership DOM work');
			}
			finally { spy.restore(); }
			expectMembership(u, kind == 'default' || !descending ? [1, 2, 3, 4] : [4, 3, 2, 1]);
			expectIdentity(u, pts);
		});
	}

	it('refreshes membership after insertion and deletion even when selected numeric indices do not change', async () => {
		const u = await plot({ legend: { filter: (u, si) => si == 2 } });
		move(u, 40);
		const original = markers(u);
		expectMembership(u, [2]);
		u.addSeries({ label: 'Added', stroke: 'orange', points: { show: false } }, 1);
		u.setData([data[0], [10, 10, 10], ...data.slice(1)]);
		await frame();
		expectMembership(u, [2]);
		const inserted = markers(u)[0];
		expectIdentity(u, [inserted, ...original]);
		assert.equal(original[0].classList.contains(excludedClass), false, 'old series 1 is now selected index 2');
		assert.equal(original[1].classList.contains(excludedClass), true, 'old series 2 is now excluded index 3');
		u.delSeries(1);
		u.setData(data);
		await frame();
		expectMembership(u, [2]);
		expectIdentity(u, original);
		assert.equal(inserted.parentNode, null);
		assert.equal(original[0].classList.contains(excludedClass), true);
		assert.equal(original[1].classList.contains(excludedClass), false);
	});

	for (const show of [true, false]) {
		for (const change of ['insert', 'delete']) {
			it(`keeps one:true ownership across ${change} before the winner during selection-only refresh with legend.show=${show}`, async () => {
				const u = await plot({
					cursor: { focus: { prox: Infinity }, points: { one: true } },
					legend: { show, filter: (u, si) => u.series[si].label == 'Series 2' },
				});
				const added = { label: 'Added', stroke: 'orange', points: { show: false } };
				const aligned = [data[0], [10, 10, 10], ...data.slice(1)];
				if (change == 'delete') {
					u.addSeries(added, 1);
					u.setData(aligned);
					await frame();
				}
				move(u, 40);
				await frame();
				const before = change == 'insert' ? 2 : 3;
				const winner = u.series[before];
				assert.equal(winner.label, 'Series 2');
				assert.equal(winner._focus, true);
				assert.deepEqual(u.legend.order, [before]);
				const pts = markers(u);
				assert.equal(pts.length, 1);
				const pt = pts[0];
				assert.equal(pt.classList.contains(excludedClass), false);
				assert.equal(pt.classList.contains('u-off'), false);
				const geometry = [pt.style.transform, pt.style.width, pt.style.height, pt.style.marginLeft, pt.style.marginTop];

				// Do not move the cursor or await a commit: selection alone must retain ownership.
				if (change == 'insert') {
					u.addSeries(added, 1);
					u.setData(aligned, false);
				}
				else {
					u.delSeries(1);
					u.setData(data, false);
				}
				u.setLegend({});
				const after = change == 'insert' ? 3 : 2;
				assert.equal(u.series[after] === winner, true);
				assert.deepEqual(u.legend.order, [after]);
				expectIdentity(u, pts);
				assert.equal(pt.classList.contains(excludedClass), false, 'the retained owner is still selected at its new index');
				assert.equal(pt.classList.contains('u-off'), false);
				assert.deepEqual([pt.style.transform, pt.style.width, pt.style.height, pt.style.marginLeft, pt.style.marginTop], geometry, 'selection-only refresh preserves shared marker geometry');
			});
		}

		it(`excludes an ownerless one:true marker when deletion moves another selected series into its index with legend.show=${show}`, async () => {
			const u = await plot({
				cursor: { focus: { prox: Infinity }, points: { one: true } },
				legend: { show, filter: (u, si) => ['Series 2', 'Series 3'].includes(u.series[si].label) },
			});
			move(u, 40);
			await frame();
			assert.equal(u.series[2]._focus, true);
			assert.deepEqual(u.legend.order, [2, 3]);
			const pts = markers(u);
			assert.equal(pts.length, 1);
			assert.equal(pts[0].classList.contains(excludedClass), false);
			assert.equal(pts[0].classList.contains('u-off'), false);
			const successor = u.series[3];

			u.delSeries(2);
			u.setData([data[0], data[1], data[3], data[4]], false);
			u.setLegend({});
			assert.equal(u.series[2] === successor, true);
			assert.equal(successor.label, 'Series 3');
			assert.deepEqual(u.legend.order, [2]);
			expectIdentity(u, pts);
			assert.equal(pts[0].classList.contains(excludedClass), true, 'a selected successor at the old index does not own the stale marker');
						assert.equal(pts[0].classList.contains('u-off'), true, 'removing the owner hides the shared marker');
						u.legend.filter = null;
						u.setLegend({});
						assert.equal(pts[0].classList.contains(excludedClass), false);
						assert.equal(pts[0].classList.contains('u-off'), true, 'removing restrictions cannot reveal an ownerless marker');
		});
	}

	it('keeps one:true globally closest and updates its exclusion when closest changes with the same legend order', async () => {
		const u = await plot({
			cursor: { focus: { prox: Infinity }, points: { one: true } },
			legend: { filter: (u, si) => si == 1 || si == 3 },
		});
		const pts = markers(u);
		assert.equal(pts.length, 1);
		const pt = pts[0];
		for (const si of [1, 2, 3, 4, 1]) {
			move(u, data[si][0]);
			assert.deepEqual(u.legend.order, [1, 3]);
			assert.equal(u.cursor.idx, 0);
			assert.equal(u.series[si]._focus, true, 'legend exclusion does not change the global focus winner');
			assert.equal(pt.classList.contains(excludedClass), si == 2 || si == 4);
			assert.equal(pt.classList.contains('u-off'), false, 'excluded closest still has valid point geometry');
			const position = pt.style.transform.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
			const expected = [u.valToPos(0, 'x'), u.valToPos(data[si][0], 'y')];
			expected.forEach((value, axis) => assert.ok(Math.abs(position[axis] - value) < 1e-8, 'shared marker stays at the global winner, not the nearest included series'));
			expectIdentity(u, pts);
		}
		move(u, 40);
		u.legend.filter = null;
		u.setLegend({}, false);
		assert.equal(pt.classList.contains(excludedClass), false, 'removing restrictions reveals the existing closest point');
		u.legend.filter = (u, si) => si == 1;
		u.setLegend({}, false);
		assert.equal(pt.classList.contains(excludedClass), true, 'explicit refresh updates the shared marker without cursor motion');
	});
});
