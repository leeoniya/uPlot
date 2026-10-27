import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { createDemo, descendingHoverValue } from '../demos/legend-selection.js';
import history from '../demos/data/log-scales.js';
import uPlot from '../src/uPlot.js';

const uPlotValue = value => uPlot.fmtNum(value);
const sideClasses = ['u-top', 'u-rgt', 'u-btm', 'u-lft'];

function assertPosition(u, side) {
	const legend = u.root.querySelector('.u-legend');
	assert.equal(legend.tagName, 'TABLE');
	assert.deepEqual(sideClasses.filter(name => legend.classList.contains(name)), [sideClasses[side]]);
	assert.deepEqual(sideClasses.filter(name => u.root.classList.contains(name)), []);
	assert.equal(u.root.hasAttribute('data-legend-side'), false);
	assert.equal(legend.hasAttribute('data-legend-side'), false);
}

const frame = async () => { await Promise.resolve(); await new Promise(requestAnimationFrame); };

function changeBehavior(root, mode) {
	const behavior = root.querySelector('select[name="behavior"]');
	behavior.value = mode;
	behavior.dispatchEvent(new Event('change'));
}

function expected(u, mode, proximity, limit = 5) {
	const indices = [];
	for (let si = 1; si < u.series.length; si++) {
		if (mode != 'nearby' || u.series[si].show && (u.cursor.idx == null ||
					Number.isFinite(u.cursor.dists[si]) && u.cursor.dists[si] <= proximity))
			indices.push(si);
	}
	if (mode != 'limit')
		indices.sort((a, b) => descendingHoverValue(u, a, b, mode == 'latest') || a - b);
	return { count: indices.length, order: (mode == 'limit' || mode == 'latest') && limit != 0 ? indices.slice(0, limit) : indices };
}

function assertReadback(root, demo) {
	demo.plots.forEach((u, i) => {
		assertPosition(u, Number(root.querySelector('select[name="position"]').value));
		const result = expected(u, root.querySelector('select[name="behavior"]').value,
			Number(root.querySelector('select[name="proximity"]').value),
			Number(root.querySelector('select[name="limit"]').value));
		assert.equal(u.legend.count, result.count);
		assert.deepEqual(u.legend.order, result.order);
		const points = [...u.over.querySelectorAll('.u-cursor-pt')];
		assert.equal(points.length, u.series.length - 1);
		points.forEach((point, i) => {
			assert.equal(point.classList.contains('u-excl'), !result.order.includes(i + 1),
				`series ${i + 1} hover point follows final legend membership`);
		});
		assert.deepEqual(
			points.flatMap((point, i) => point.matches(':not(.u-off):not(.u-excl)') ? [i + 1] : []),
			result.order.filter(si => !points[si - 1].classList.contains('u-off')).sort((a, b) => a - b),
		);
		const rows = [...u.root.querySelectorAll('.u-legend tbody tr')];
		assert.equal(rows.length, result.order.length + 1);
		assert.ok(rows.length <= 13);
		assert.deepEqual(rows.map(row => row.querySelector('.u-label').textContent),
			['Time', ...result.order.map(si => u.series[si].label)]);
		assert.equal(root.querySelectorAll('output')[i].value,
			`count ${u.legend.count} | range [${u.legend.range.join(', ')}) | order [${u.legend.order.join(', ')}]`);
		assert.equal(u.root.querySelectorAll('.u-legend input, .u-legend button, .u-legend select').length, 0);
	});
}

describe('legend selection demo', () => {
	it('starts with a simple limit and switches behaviors on the same chart without stale stages', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			const [u] = demo.plots;
			const chartRoot = u.root;
			assert.equal(u.legend.mode, 'table');
			assert.equal(u.legend.side, 1);
			assertPosition(u, 1);
			assert.equal(u.root.querySelector('.u-legend').classList.contains('u-inline'), false);
			const position = [u.cursor.left, u.cursor.top, u.cursor.idx];
			const behavior = root.querySelector('select[name="behavior"]');
			const proximity = root.querySelector('select[name="proximity"]');
			assert.deepEqual([...behavior.options].map(option => option.value), ['limit', 'latest', 'nearby', 'ranked']);
			assert.equal(behavior.value, 'limit');
			assert.deepEqual(u.legend.order, [1, 2, 3, 4, 5]);
			assert.deepEqual(u.legend.range, [0, 5]);
			assert.equal(u.legend.count, 12);
			assert.equal(u.legend.filter, null);
			assert.equal(u.legend.sort, null);
			assert.ok(u.series.every(series => series.show));
			assertReadback(root, demo);

			for (const mode of ['nearby', 'ranked', 'limit', 'ranked', 'nearby', 'limit']) {
				changeBehavior(root, mode);
				await frame();
				assert.equal(demo.plots.length, 1);
				assert.equal(demo.plots[0], u);
				assert.equal(root.querySelector('.uplot'), chartRoot);
				assert.deepEqual([u.cursor.left, u.cursor.top, u.cursor.idx], position);
				assert.equal(proximity.closest('label').hidden, mode != 'nearby');
				assert.equal(u.legend.filter != null, mode == 'nearby');
				assert.equal(u.legend.sort != null, mode != 'limit');
				assert.equal(u.legend.limit != null, mode == 'limit');
				assertReadback(root, demo);
			}
			changeBehavior(root, 'nearby');
			proximity.value = '15';
			proximity.dispatchEvent(new Event('change'));
			changeBehavior(root, 'limit');
			changeBehavior(root, 'nearby');
			await frame();
			assert.equal(proximity.value, '15', 'proximity persists across behavior changes');
			assertReadback(root, demo);
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});
	it('ranks and displays final samples when idle, then returns to hovered values without overriding cursor indices', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			let u = demo.plots[0];
			const limit = root.querySelector('select[name="limit"]');
			const last = u.data[0].length - 1;
			const finalTime = u.series[0].value(u, u.data[0][last], 0, last);
			u.setCursor({ left: -10, top: -10 });
			changeBehavior(root, 'latest');
			await frame();
			assert.equal(limit.closest('label').hidden, false);
			const finalOrder = Array.from({ length: 12 }, (_, i) => i + 1)
				.sort((a, b) => u.data[b][last] - u.data[a][last] || a - b);

			function assertIdle(count) {
				assert.equal(u.cursor.idx, null);
				assert.equal(u.legend.idx, null);
				assert.ok(u.legend.idxs.every(idx => idx == null));
				assert.ok(u.cursor.dists.every(distance => distance == Infinity));
				assert.deepEqual(u.legend.order, finalOrder.slice(0, count));
				assert.equal(u.legend.values[0]._, finalTime);
				for (let si = 1; si < u.series.length; si++)
					assert.equal(u.legend.values[si]._, uPlotValue(u.data[si][last]));
				const cells = [...u.root.querySelectorAll('.u-legend tbody td')].map(cell => cell.textContent);
				assert.deepEqual(cells, [finalTime, ...u.legend.order.map(si => uPlotValue(u.data[si][last]))]);
				assertReadback(root, demo);
			}

			assertIdle(5);
			limit.value = '0';
			limit.dispatchEvent(new Event('change'));
			await frame();
			assertIdle(12);
			u.setCursor({ left: u.valToPos(u.data[0][0], 'x'), top: u.valToPos(u.data[1][0], 'y') });
			await frame();
			assert.equal(u.cursor.idx, 0);
			assert.notDeepEqual(u.legend.order, finalOrder);
			for (let si = 1; si < u.series.length; si++)
				assert.equal(u.legend.values[si]._, uPlotValue(u.data[si][0]));
			assertReadback(root, demo);
			u.setCursor({ left: -10, top: -10 });
			await frame();
			assertIdle(12);

			const layout = root.querySelector('select[name="mode"]');
			layout.value = 'inline';
			layout.dispatchEvent(new Event('change'));
			await frame();
			u = demo.plots[0];
			assertIdle(12);
			for (const mode of ['limit', 'ranked', 'nearby']) {
				changeBehavior(root, mode);
				await frame();
				assert.ok(u.legend.values.every(value => value._ == '--'), 'other behaviors retain idle placeholders');
				assertReadback(root, demo);
			}
			changeBehavior(root, 'latest');
			await frame();
			assertIdle(12);

			// Missing final samples stay missing; the demo does not search backward.
			u.data[2][last] = null;
			u.data[3][last] = Infinity;
			u.setLegend({});
			await frame();
			assert.deepEqual(u.legend.order.slice(-2), [2, 3]);
			assert.equal(u.legend.values[2]._, '--');
			assert.equal(u.legend.values[3]._, '--');
			assertReadback(root, demo);
			u.setCursor({ left: u.valToPos(u.data[0][last], 'x'), top: u.valToPos(u.data[1][last], 'y') });
			await frame();
			assert.equal(u.cursor.idx, last);
			assert.equal(u.legend.values[2]._, '--', 'missing hovered values do not use an idle fallback');
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('uses the shared server history to distinguish clusters, outliers, and empty space at one cursor time', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			assert.equal(demo.plots.length, 1);
			changeBehavior(root, 'nearby');
			await frame();
			for (const u of demo.plots) {
				assert.equal(u.series.length, 13);
				assert.equal(u.cursor.idx, 720);
				assert.equal(u.scales.y.distr, 3);
				assert.deepEqual(u.data[0], history.timestamps);
				history.servers.forEach((server, i) => {
					assert.equal(u.series[i + 1].label, server.name);
					assert.equal(u.series[i + 1].stroke(u, i + 1), server.color);
					assert.deepEqual(u.data[i + 1], history.graphData[i].map(value => value === 0 ? 1 : value));
				});
				assert.ok(Number.isFinite(u.cursor.top));
				assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 12);
				assert.equal(u.over.querySelectorAll('.u-cursor-pt:not(.u-off):not(.u-excl)').length, u.legend.order.length);
			}
			const nearby = demo.plots[0];
			const cluster = { left: nearby.cursor.left, top: nearby.cursor.top };
			nearby.setCursor({ left: -10, top: -10 });
			await frame();
			assert.deepEqual(nearby.legend.order, Array.from({ length: 12 }, (_, i) => i + 1), 'idle proximity shows all visible servers in series order');
			assert.ok(nearby.legend.values.every(value => value._ == '--'));
			assert.equal(nearby.over.querySelectorAll('.u-cursor-pt:not(.u-off):not(.u-excl)').length, 0, 'hover points hide while idle');
			assertReadback(root, demo);
			nearby.setCursor(cluster);
			await frame();
			const idx = nearby.cursor.idx;
			assert.ok(nearby.legend.count > 1, 'the initial cursor selects a cluster');
			assert.ok(!nearby.legend.order.includes(1), 'the cluster excludes Hypixel');
			assertReadback(root, demo);
			const output = root.querySelector('output');
			const value = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(output), 'value');
			let writes = 0;
			Object.defineProperty(output, 'value', {
				get() { return value.get.call(this); },
				set(text) { writes++; value.set.call(this, text); },
			});
			const outlier = nearby.data[1][idx];
			nearby.setCursor({ left: nearby.cursor.left, top: nearby.valToPos(outlier, 'y') });
			await frame();
			assert.equal(nearby.cursor.idx, idx);
			assert.deepEqual(nearby.legend.order, [1], 'Hypixel is isolated from the cluster');
			assert.equal(nearby.over.querySelectorAll('.u-cursor-pt:not(.u-off)').length, 12, 'legend exclusion does not change normal point visibility');
			assert.equal(nearby.over.querySelectorAll('.u-cursor-pt:not(.u-off):not(.u-excl)').length, 1, 'only the Hypixel hover point remains active');
			assert.equal(writes, 1, 'a selection-only cursor move updates readback once');
			assertReadback(root, demo);
			nearby.setCursor({ left: nearby.cursor.left, top: nearby.cursor.top });
			await frame();
			assert.equal(writes, 1, 'unchanged selection and values do not update readback');
			const gap = Math.sqrt(outlier * nearby.data[12][idx]);
			nearby.setCursor({ left: nearby.cursor.left, top: nearby.valToPos(gap, 'y') });
			await frame();
			assert.deepEqual(nearby.legend.order, [], 'the space between Hypixel and Minehut has no matches');
			assert.equal(nearby.over.querySelectorAll('.u-cursor-pt:not(.u-off):not(.u-excl)').length, 0, 'an empty legend selection has no active hover points');
			assert.equal(writes, 2, 'the next selection-only move also updates readback once');
			assertReadback(root, demo);
			for (const u of demo.plots)
				u.setCursor({ left: -10, top: -10 });
			await frame();
			assert.equal(nearby.legend.count, 12, 'cursor exit restores all visible servers');
			assertReadback(root, demo);
			nearby.setCursor(cluster);
			await frame();
			assert.ok(nearby.legend.count > 1 && nearby.legend.count < 12, 'cursor re-entry applies proximity again');
			assertReadback(root, demo);
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('ranks every server at the current time independently of cursor height', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			changeBehavior(root, 'ranked');
			await frame();
			const [all] = demo.plots;
			const initial = all.legend.order.slice();
			assert.equal(all.legend.order.length, 12);
			all.setCursor({ left: all.valToPos(all.data[0][0], 'x'), top: all.cursor.top });
			await frame();
			assert.equal(all.cursor.idx, 0);
			assert.notDeepEqual(all.legend.order, initial, 'server ranks change during the day');
			assert.equal(all.legend.order.length, 12);

			assertReadback(root, demo);
			const ranking = all.legend.order.slice();
			all.setCursor({ left: all.cursor.left, top: all.valToPos(all.data[1][0], 'y') });
			assert.deepEqual(all.legend.order, ranking, 'ranking does not depend on cursor height');
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('changes proximity at a stationary cursor and excludes unavailable distances at Infinity', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			changeBehavior(root, 'nearby');
			await frame();
			const [nearby] = demo.plots;
			const proximity = root.querySelector('select[name="proximity"]');
			assert.equal(root.querySelectorAll('select').length, 5);
			assert.ok(proximity.closest('label').textContent.includes('Proximity:'));
			assert.deepEqual([...proximity.options].map(option => [option.value, option.textContent]),
				[['5', '5px'], ['10', '10px'], ['15', '15px'], ['20', '20px'], ['Infinity', 'Infinity']]);
			assert.equal(proximity.value, '20');
			const position = [nearby.cursor.left, nearby.cursor.top, nearby.cursor.idx];
			const initial = nearby.legend.order.slice();
			const allOrder = expected(nearby, 'ranked', Infinity).order;
			let previousCount = 0;
			let updates = 0;
			nearby.hooks.setLegend.push(() => updates++);
			for (const distance of ['5', '10', '15', '20', 'Infinity']) {
				proximity.value = distance;
				proximity.dispatchEvent(new Event('change', { bubbles: true }));
				assert.ok(nearby.legend.count >= previousCount);
				previousCount = nearby.legend.count;
				assert.deepEqual([nearby.cursor.left, nearby.cursor.top, nearby.cursor.idx], position);

				await frame();
				assertReadback(root, demo);
			}
			assert.equal(updates, 5, 'each change explicitly refreshes the legend');
			assert.deepEqual(nearby.legend.order, allOrder, 'Infinity includes every available server');
			proximity.value = '20';
			proximity.dispatchEvent(new Event('change'));
			assert.deepEqual(nearby.legend.order, initial);
			await frame();
			assertReadback(root, demo);

			proximity.value = 'Infinity';
			proximity.dispatchEvent(new Event('change'));
			nearby.setSeries(1, { show: false });
			await frame();
			assert.equal(nearby.legend.count, 11);
			assert.ok(!nearby.legend.order.includes(1), 'Infinity does not admit hidden series');
			nearby.cursor.dataIdx = (u, si, idx) => si == 2 ? null : idx;
			nearby.setCursor({ left: nearby.cursor.left, top: nearby.cursor.top });
			await frame();
			assert.equal(nearby.legend.count, 10);
			assert.ok(!nearby.legend.order.includes(2), 'Infinity does not admit missing hover values');
			assertReadback(root, demo);
			nearby.setCursor({ left: -10, top: -10 });
			await frame();
			assert.equal(nearby.legend.count, 11, 'idle proximity includes every visible series without needing a hover value');
			assert.ok(!nearby.legend.order.includes(1), 'hidden series remain excluded while idle');
			assert.ok(nearby.legend.order.includes(2), 'a missing hover value does not exclude an idle row');
			assertReadback(root, demo);
			proximity.value = '5';
			proximity.dispatchEvent(new Event('change'));
			await frame();
			assert.equal(nearby.legend.count, 11, 'idle membership does not depend on the proximity threshold');
			assertReadback(root, demo);
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('changes the limit without recreating the chart and remembers it across behaviors', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			const [u] = demo.plots;
			const limit = root.querySelector('select[name="limit"]');
			assert.equal(limit.value, '5');
			assert.equal(limit.closest('label').hidden, false);
			assert.ok(limit.closest('label').textContent.startsWith('Per page:'));
			assert.equal(limit.options[0].textContent, '0 (All)');
			const counts = Array.from({ length: 11 }, (_, i) => i * 5);
			assert.deepEqual([...limit.options].map(option => Number(option.value)), counts);
			const cursor = [u.cursor.left, u.cursor.top, u.cursor.idx];
			let updates = 0;
			u.hooks.setLegend.push(() => updates++);
			for (const count of [...counts, 10]) {
				limit.value = String(count);
				limit.dispatchEvent(new Event('change'));
				assert.equal(demo.plots[0], u);
				assert.deepEqual(u.legend.range, [0, Math.min(12, count || 12)]);
				assert.equal(u.legend.count, 12);
				assert.deepEqual([u.cursor.left, u.cursor.top, u.cursor.idx], cursor);
				await frame();
				assertReadback(root, demo);
			}
			assert.equal(updates, counts.length + 1);
			for (const mode of ['ranked', 'nearby', 'latest', 'limit']) {
				changeBehavior(root, mode);
				await frame();
				assert.equal(limit.closest('label').hidden, mode != 'limit' && mode != 'latest');
				assert.equal(limit.value, '10');
				assertReadback(root, demo);
			}
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('recreates the chart for mode and side changes while preserving behavior, controls, cursor, scales, and visibility', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		const demo = createDemo(root);
		try {
			await frame();
			const position = root.querySelector('select[name="position"]');
			const layout = root.querySelector('select[name="mode"]');
			assert.deepEqual([...layout.options].map(option => [option.value, option.textContent]),
				[['inline', 'Inline'], ['table', 'Table']]);
			assert.equal(layout.value, 'table');
			const limit = root.querySelector('select[name="limit"]');
			const proximity = root.querySelector('select[name="proximity"]');
			assert.deepEqual([...position.options].map(option => [option.value, option.textContent]),
				[['0', 'Top'], ['1', 'Right'], ['2', 'Bottom'], ['3', 'Left']]);
			assert.equal(position.value, '1');
			limit.value = '10';
			limit.dispatchEvent(new Event('change'));
			proximity.value = '15';
			proximity.dispatchEvent(new Event('change'));
			let u = demo.plots[0];
			u.setSeries(2, { show: false });
			u.setScale('x', { min: u.data[0][200], max: u.data[0][1000] });
			await frame();
			u.setCursor({ left: u.valToPos(u.data[0][600], 'x'), top: u.valToPos(u.data[5][600], 'y') });
			await frame();
			const cursor = [u.cursor.left, u.cursor.top, u.cursor.idx];
			const scales = [u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max];
			for (const mode of ['limit', 'latest', 'nearby', 'ranked']) {
				changeBehavior(root, mode);
				for (const [control, value] of [
					[position, '0'], [layout, 'inline'],
					[position, '3'], [layout, 'table'],
					[position, '2'], [layout, 'inline'],
					[position, '1'], [layout, 'table'],
				]) {
					const old = u;
					control.value = value;
					control.dispatchEvent(new Event('change'));
					await frame();
					u = demo.plots[0];
					assert.notEqual(u, old);
					assert.equal(old.root.isConnected, false);
					assert.equal(root.querySelectorAll('.uplot').length, 1);
					assert.equal(demo.plots.length, 1);
					assert.equal(u.legend.side, Number(position.value));
					assert.equal(u.legend.mode, layout.value);
					assert.equal(u.root.querySelector('.u-legend').classList.contains('u-inline'), layout.value == 'inline');
					assertPosition(u, Number(position.value));
					assert.deepEqual([u.cursor.left, u.cursor.top, u.cursor.idx], cursor);
					assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], scales);
					assert.equal(u.series[2].show, false);
					assert.equal(limit.value, '10');
					assert.equal(proximity.value, '15');
					assertReadback(root, demo);
				}
			}
			window.dispatchEvent(new Event('resize'));
			await frame();
			assertReadback(root, demo);
		}
		finally {
			demo.destroy();
			root.remove();
		}
	});

	it('supports repeated creation and cleanup, including destruction before the first frame', async () => {
		const root = document.createElement('main');
		root.innerHTML = '<section id="charts"></section>';
		document.body.appendChild(root);
		try {
			for (const wait of [false, true, true]) {
				const demo = createDemo(root);
				if (wait)
					await frame();
				const controls = root.querySelectorAll('select');
				demo.destroy();
				controls.forEach(control => control.dispatchEvent(new Event('change')));
				window.dispatchEvent(new Event('resize'));
				await frame();
				assert.equal(root.querySelector('#charts').children.length, 0);
				assert.equal(demo.plots.length, 0);
			}
		}
		finally { root.remove(); }
	});
});
