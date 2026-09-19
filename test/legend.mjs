import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 50, 100], [10, 20, 30], [40, null, 60], [70, 80, 90]];
const range = (self, min, max) => [min, max];
const frame = async () => { await new Promise(requestAnimationFrame); };

async function plot(table, { isolate = false, prox = -1, lock = false } = {}) {
	const legends = [];
	const seriesEvents = [];
	const scales = [];
	const draws = [];
	const u = new uPlot({
		width: 600,
		height: 400,
		pxRatio: 1,
		padding: [0, 0, 0, 0],
		legend: { isolate },
		cursor: { lock, focus: { prox }, dataIdx: (self, si, idx) => idx },
		focus: { alpha: 0.25 },
		series: [
			{ label: 'Time', value: (self, value) => value == null ? null : `x=${value}` },
			...['Alpha', 'Beta', 'Gamma'].map((label, i) => ({
				label,
				stroke: ['red', 'green', 'blue'][i],
				points: { show: false },
				value: (self, value) => value == null ? null : `v=${value}`,
				...(table && {
					values(self, si, idx) {
						if (idx == null)
							return null;
						// The first call establishes column names before chart data is available.
						const value = self.data?.[si]?.[idx];
						return { Value: value == null ? '--' : `v=${value}`, Double: value == null ? '--' : `d=${2 * value}` };
					},
				}),
			})),
		],
		scales: { x: { time: false, range }, y: { range } },
		axes: [{ size: 30 }, { size: 60 }],
		hooks: {
			setLegend: [self => legends.push({ idx: self.legend.idx, idxs: self.legend.idxs.slice() })],
			setSeries: [(self, i, opts) => seriesEvents.push({ i, ...opts })],
			setScale: [(self, key) => scales.push(key)],
			draw: [() => draws.push(true)],
		},
	}, data, (self, init) => {
		self.ctx.measureText = text => ({ width: String(text).length * 8 });
		document.body.appendChild(self.root);
		init();
	});

	// Happy DOM supplies events, but not CSS layout or hit testing.
	u.over.getBoundingClientRect = () => {
		const style = u.over.style;
		return new DOMRect(101 + parseFloat(style.left), 203 + parseFloat(style.top),
			parseFloat(style.width), parseFloat(style.height));
	};

	await frame();

	const legend = u.root.querySelector('.u-legend');
	const rows = [...legend.querySelectorAll('tbody tr')];
	const row = i => rows[table ? i - 1 : i];
	function mouse(type, target, opts = {}) {
		const event = new MouseEvent(type, {
			bubbles: !['mouseenter', 'mouseleave'].includes(type),
			cancelable: true, button: 0, ...opts,
		});
		target.dispatchEvent(event);
		return event;
	}
	function move(idx) {
		const rect = u.over.getBoundingClientRect();
		return mouse('mousemove', u.over, { clientX: rect.left + rect.width * idx / 2, clientY: rect.top + rect.height - 5 });
	}
	async function assertValues(expected) {
		const cells = expected.map((value, i) => table
			? [value == null ? '--' : `v=${value}`, value == null ? '--' : `d=${2 * value}`]
			: [value == null ? '--' : `${i == 0 ? 'x' : 'v'}=${value}`]);
		for (let i = table ? 1 : 0; i < expected.length; i++)
			assert.deepEqual(Object.values(u.legend.values[i]), cells[i], `series ${i} public values`);
		await frame();
		for (let i = table ? 1 : 0; i < expected.length; i++)
			assert.deepEqual([...row(i).querySelectorAll('td')].map(cell => cell.textContent), cells[i], `series ${i} DOM values`);
	}
	async function assertVisible(expected) {
		assert.deepEqual(u.series.slice(1).map(s => s.show), expected);
		await frame();
		expected.forEach((show, i) => assert.equal(row(i + 1).classList.contains('u-off'), !show));
	}
	async function assertFocus(index) {
		for (let i = 1; i < u.series.length; i++) {
			const focused = index == null || i == index;
			assert.equal(u.series[i]._focus, index == null ? null : focused);
			assert.equal(u.series[i].alpha, focused ? 1 : 0.25);
		}
		await frame();
		const points = [...u.over.querySelectorAll('.u-cursor-pt')];
		assert.equal(points.length, 3);
		for (let i = 1; i < u.series.length; i++) {
			const focused = index == null || i == index;
			assert.equal(row(i).style.opacity, focused ? '' : '0.25');
			assert.equal(Number(points[i - 1].style.opacity), focused ? 1 : 0.25);
		}
	}
	function clear() {
		legends.length = seriesEvents.length = scales.length = draws.length = 0;
	}

	clear();
	return { u, legend, rows, row, mouse, move, assertValues, assertVisible, assertFocus, clear,
		legends, seriesEvents, scales, draws, destroy() { u.destroy(); } };
}

describe('legend value record ownership', () => {
	it('reuses distinct scalar records through values and placeholders before hooks', async () => {
		const f = await plot(false);
		const { u } = f;
		try {
			const values = u.legend.values;
			const records = values.slice();
			assert.equal(new Set(records).size, records.length);
			assert.deepEqual(records.map(record => record._), ['--', '--', '--', '--']);
			let formatted;
			let formats = 0;
			const observed = [];
			u.series[1].value = () => (formats++, formatted);
			u.hooks.setLegend = [self => {
				assert.equal(self.legend.values === values, true);
				assert.equal(self.legend.values.every((record, i) => record === records[i]), true);
				observed.push(records[1]._);
			}];
			for (const value of [0, '', null, undefined, 'next']) {
				formatted = value;
				u.setLegend({ idxs: [null, 1, null, null] });
				assert.equal(records[1]._, value ?? '--');
				assert.deepEqual([records[0]._, records[2]._, records[3]._], ['--', '--', '--']);
				await frame();
				assert.equal(f.row(1).querySelector('td').textContent, String(value ?? '--'));
			}
			assert.equal(formats, 5);
			assert.deepEqual(observed, [0, '', '--', '--', 'next']);
		}
		finally { f.destroy(); }
	});

	it('retains scalar records across cursor updates, data replacement, insertion, and deletion', async () => {
		const f = await plot(false);
		const { u } = f;
		try {
			const values = u.legend.values;
			const records = values.slice();
			for (const idx of [0, 1, 2]) {
				f.move(idx);
				assert.equal(values.every((record, i) => record === records[i]), true);
			}
			u.addSeries({ label: 'Added', stroke: 'blue', value: (self, value) => value }, 2);
			assert.equal(values[2], null, 'new entries stay unformatted until a refresh');
			u.setData([data[0], data[1], [7, 8, 9], data[2], data[3]], false);
			u.setLegend({ idx: 1 });
			const added = values[2];
			assert.equal(records.includes(added), false);
			assert.equal(added._, 8);
			assert.equal(values[3] === records[2], true);
			u.setLegend({ idx: null });
			assert.equal(values[2] === added, true);
			assert.equal(added._, '--');
			u.delSeries(2);
			u.setData(data, false);
			u.setLegend({ idx: 0 });
			assert.equal(u.legend.values === values, true);
			assert.equal(values.every((record, i) => record === records[i]), true);
			assert.deepEqual(records.map(record => record._), ['x=0', 'v=10', 'v=40', 'v=70']);
			assert.equal(added._, '--', 'a removed record receives no later updates');
		}
		finally { f.destroy(); }
	});

	it('keeps multi-value records caller-owned without copying or mutation', async () => {
		const f = await plot(true);
		const { u } = f;
		try {
			const placeholder = u.legend.values[1];
			const reusable = { Value: 'v=10', Double: 'd=20' };
			let result;
			u.series[1].values = () => result;
			for (const value of [Object.freeze({ Value: 'v=0', Double: 'd=0' }), null, undefined, reusable]) {
				result = value;
				u.setLegend({ idx: 0 });
				assert.equal(u.legend.values[1] === (value ?? placeholder), true);
			}
			reusable.Value = 'v=20';
			reusable.Double = 'd=40';
			u.setLegend({ idx: 1 });
			assert.equal(u.legend.values[1] === reusable, true);
			assert.deepEqual(placeholder, { Value: '--', Double: '--' });
			await frame();
			assert.deepEqual([...f.row(1).querySelectorAll('td')].map(cell => cell.textContent), ['v=20', 'd=40']);
		}
		finally { f.destroy(); }
	});
});

for (const table of [false, true]) {
	describe(`${table ? 'table' : 'inline'} legend`, () => {
		it('updates formatted values from mouse movement and clears them on leave', async () => {
			const f = await plot(table);
			const { u, legend } = f;
			try {
				assert.equal(legend.classList.contains('u-inline'), !table);
				assert.equal(legend.classList.contains('u-live'), !table);
				assert.deepEqual([...legend.querySelectorAll('thead th')].map(cell => cell.textContent), table ? ['', 'Value', 'Double'] : []);
				assert.deepEqual(f.rows.map(row => row.querySelector('.u-label').textContent), table ? ['Alpha', 'Beta', 'Gamma'] : ['Time', 'Alpha', 'Beta', 'Gamma']);
				await f.assertValues([null, null, null, null]);
				for (const idx of [0, 1, 2]) {
					f.move(idx);
					assert.equal(u.cursor.idx, idx);
					assert.equal(u.legend.idx, idx);
					assert.deepEqual(u.legend.idxs, [idx, idx, idx, idx]);
					assert.equal(f.legends.length, idx + 1);
					await f.assertValues(data.map(values => values[idx]));
					f.move(idx);
					assert.equal(f.legends.length, idx + 1, 'unchanged indices do not trigger redundant legend updates');
				}
				f.mouse('mouseleave', u.over);
				assert.equal(u.cursor.idx, null);
				assert.equal(u.legend.idx, null);
				assert.deepEqual(u.legend.idxs, [null, null, null, null]);
				assert.equal(f.legends.length, 4);
				await f.assertValues([null, null, null, null]);
			}
			finally { f.destroy(); }
		});

		it('supports explicit shared and per-series indices and suppressed hooks', async () => {
			const f = await plot(table);
			const { u } = f;
			try {
				u.setLegend({ idx: 1 });
				assert.deepEqual(f.legends, [{ idx: 1, idxs: [1, 1, 1, 1] }]);
				await f.assertValues([50, 20, null, 80]);
				u.setLegend({ idxs: [2, 0, null, 1] });
				assert.deepEqual(f.legends[1], { idx: 2, idxs: [2, 0, null, 1] });
				await f.assertValues([100, 10, null, 80]);
				u.setLegend({ idx: 0 }, false);
				assert.equal(f.legends.length, 2);
				await f.assertValues([0, 10, 40, 70]);
				u.setLegend({ idx: null });
				assert.deepEqual(f.legends[2], { idx: null, idxs: [null, null, null, null] });
				await f.assertValues([null, null, null, null]);
			}
			finally { f.destroy(); }
		});

		it('refreshes values at a stationary cursor after data replacement, empty data, and recovery', async () => {
			const f = await plot(table);
			const { u } = f;
			try {
				f.move(1);
				f.clear();
				const replacement = [[0, 50, 100], [11, 22, 33], [44, 55, 66], [77, 88, 99]];
				u.setData(replacement);
				await frame();
				assert.equal(u.legend.idx, 1);
				await f.assertValues([50, 22, 55, 88]);
				assert.equal(f.legends.length, 1);
				u.setData([]);
				await frame();
				assert.equal(u.legend.idx, null);
				await f.assertValues([null, null, null, null]);
				assert.equal(f.legends.length, 2);
				u.setData(data);
				await frame();
				assert.equal(u.legend.idx, 1);
				await f.assertValues([50, 20, null, 80]);
				assert.equal(f.legends.length, 3);
			}
			finally { f.destroy(); }
		});

		it('toggles series through label and marker clicks and collapses the inactive axis', async () => {
			const f = await plot(table);
			const { u } = f;
			try {
				const initial = { ...u.bbox };
				await f.assertVisible([true, true, true]);
				for (const i of [1, 2, 3]) {
					const target = f.row(i).querySelector(i == 2 ? '.u-marker' : '.u-label');
					const event = f.mouse('click', target);
					assert.equal(u.cursor.event, event);
					await f.assertVisible([1, 2, 3].map(si => si > i));
					assert.equal(u.axes[1]._show, i != 3);
					assert.equal(u.scales.y.min == null, i == 3);
				}
				assert.deepEqual(f.seriesEvents, [1, 2, 3].map(i => ({ i, show: false })));
				assert.equal(u.bbox.width, initial.width + 60);
				assert.equal(u.bbox.left, 0);
				f.mouse('click', f.row(2).querySelector('.u-marker'));
				await f.assertVisible([false, true, false]);
				assert.equal(u.axes[1]._show, true);
				assert.deepEqual(u.bbox, initial);
				assert.deepEqual(f.seriesEvents[3], { i: 2, show: true });
			}
			finally { f.destroy(); }
		});

		for (const isolate of [false, true]) {
			it(`supports isolation, restore-all, and modifier inversion with isolate=${isolate}`, async () => {
				const f = await plot(table, { isolate });
				try {
					for (const modifier of ['ctrlKey', 'metaKey']) {
						const isolateOpts = isolate ? {} : { [modifier]: true };
						f.mouse('click', f.row(2).querySelector('.u-label'), isolateOpts);
						await f.assertVisible([false, true, false]);
						f.mouse('click', f.row(2).querySelector('.u-marker'), isolateOpts);
						await f.assertVisible([true, true, true]);
						const toggleOpts = isolate ? { [modifier]: true } : {};
						f.mouse('click', f.row(1).querySelector('.u-label'), toggleOpts);
						await f.assertVisible([false, true, true]);
						f.mouse('click', f.row(1).querySelector('.u-label'), toggleOpts);
						await f.assertVisible([true, true, true]);
					}
				}
				finally { f.destroy(); }
			});
		}

		it('ignores non-primary clicks and clicks on value cells or headings', async () => {
			const f = await plot(table);
			try {
				for (const button of [1, 2])
					f.mouse('click', f.row(1).querySelector('.u-label'), { button });
				f.mouse('click', f.row(1).querySelector('td'));
				f.mouse('click', table ? f.legend.querySelector('thead th') : f.row(0).querySelector('.u-label'));
				await f.assertVisible([true, true, true]);
				assert.deepEqual(f.seriesEvents, []);
				assert.deepEqual(f.draws, []);
			}
			finally { f.destroy(); }
		});

		it('focuses hovered series and restores opacity when the mouse leaves the legend', async () => {
			const f = await plot(table, { prox: 1 });
			const { u } = f;
			try {
				const initial = { ...u.bbox };
				const paths = u.series.slice(1).map(s => s._paths);
				for (const i of [1, 3]) {
					const event = f.mouse('mouseenter', f.row(i).querySelector('th'));
					assert.equal(u.cursor.event, event);
					await f.assertFocus(i);
					await f.assertVisible([true, true, true]);
				}
				f.mouse('mouseleave', f.legend);
				await f.assertFocus(null);
				assert.deepEqual(f.seriesEvents, [{ i: 1, focus: true }, { i: 3, focus: true }, { i: null, focus: true }]);
				assert.equal(f.draws.length, 3);
				assert.deepEqual(f.scales, []);
				assert.deepEqual(f.legends, []);
				assert.deepEqual(u.bbox, initial);
				paths.forEach((path, i) => assert.equal(u.series[i + 1]._paths, path, 'focus redraw reuses series paths'));
			}
			finally { f.destroy(); }
		});

		it('does not focus series on legend hover when focus is disabled', async () => {
			const f = await plot(table);
			try {
				f.mouse('mouseenter', f.row(1).querySelector('th'));
				f.mouse('mouseleave', f.legend);
				await frame();
				assert.deepEqual(f.u.series.slice(1).map(s => s._focus), [null, null, null]);
				assert.deepEqual(f.u.series.slice(1).map(s => s.alpha), [1, 1, 1]);
				assert.deepEqual(f.seriesEvents, []);
				assert.deepEqual(f.draws, []);
			}
			finally { f.destroy(); }
		});

		it('ignores legend clicks and hover while the cursor is locked, then resumes after unlock', async () => {
			const f = await plot(table, { prox: 1, lock: true });
			const { u } = f;
			try {
				const rect = u.over.getBoundingClientRect();
				const coords = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height - 5 };
				function clickPlot() {
					f.mouse('mousedown', u.over, coords);
					f.mouse('mouseup', document, coords);
				}
				clickPlot();
				await frame();
				assert.equal(u.cursor._lock, true);
				f.clear();
				f.mouse('click', f.row(1).querySelector('.u-label'));
				f.mouse('click', f.row(2).querySelector('.u-marker'), { ctrlKey: true });
				f.mouse('mouseenter', f.row(3).querySelector('th'));
				f.mouse('mouseleave', f.legend);
				await f.assertVisible([true, true, true]);
				assert.deepEqual(u.series.slice(1).map(s => s._focus), [null, null, null]);
				assert.deepEqual(f.seriesEvents, []);
				assert.deepEqual(f.draws, []);
				clickPlot();
				await frame();
				assert.equal(u.cursor._lock, false);
				f.mouse('click', f.row(1).querySelector('.u-label'));
				await f.assertVisible([false, true, true]);
				f.mouse('mouseenter', f.row(3).querySelector('th'));
				await f.assertFocus(3);
			}
			finally { f.destroy(); }
		});
	});
}
