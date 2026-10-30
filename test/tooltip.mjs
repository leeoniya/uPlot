import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { createDemo } from '../demos/legend-tooltip.js';

const data = [[0, 1, 2], [10, 20, 30], [40, 50, 60]];
const commit = () => Promise.resolve();
const rows = table => [...table.querySelectorAll('tbody tr')];
const cells = table => rows(table).map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
const labels = table => rows(table).map(row => row.querySelector('.u-label').textContent);
const headers = table => [...table.querySelectorAll('thead th')].map(cell => cell.textContent);
const tooltip = u => u.root.querySelector('.u-tooltip');
const stats = u => u.root.querySelector('.u-legend:not(.u-tooltip)');
const scalar = (u, value, si, idx) => idx == null ? `sum:${u.data[si]?.reduce((a, b) => a + b, 0)}` : `v:${value}`;
const values = (u, si, idx) => idx == null ? { Sum: u.data?.[si]?.reduce((a, b) => a + b, 0) } : { Value: u.data?.[si]?.[idx], Double: 2 * u.data?.[si]?.[idx] };

// Happy DOM has no layout or ResizeObserver delivery. Supply only the geometry
// the implementation is allowed to read: the overlay, viewport, and RO entry.
describe('tooltip', () => {
	let plots, observers, restore, bodyChildren, frames;
	let viewport;

	function replace(object, key, descriptor) {
		const previous = Object.getOwnPropertyDescriptor(object, key);
		Object.defineProperty(object, key, { configurable: true, ...descriptor });
		restore.push(() => previous ? Object.defineProperty(object, key, previous) : delete object[key]);
	}

	beforeEach(() => {
		plots = [];
		observers = [];
		restore = [];
		frames = [];
		bodyChildren = new Set(document.body.children);
		viewport = { width: 500, height: 400 };
		replace(document.documentElement, 'clientWidth', { get: () => viewport.width });
		replace(document.documentElement, 'clientHeight', { get: () => viewport.height });
		replace(globalThis, 'requestAnimationFrame', { value: callback => { frames.push(callback); return frames.length; } });
		replace(globalThis, 'cancelAnimationFrame', { value: () => assert.fail('tooltip must not cancel animation frames') });
		replace(globalThis, 'ResizeObserver', { value: class {
			constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
			observe(target, options) { this.targets.push([target, options]); }
			disconnect() { this.disconnected = true; }
			deliver(width, height) { this.callback([{ target: this.targets[0][0], borderBoxSize: [{ inlineSize: width, blockSize: height }] }]); }
		} });
	});

	afterEach(async () => {
		await commit();
		try {
			for (const u of plots)
				u.destroy();
			assert.ok(observers.every(observer => observer.disconnected), 'all tooltip observers disconnect');
			assert.equal(frames.length, 0, 'tooltip updates never request animation frames');
		}
		finally {
			for (const undo of restore.reverse())
				undo();
			for (const child of [...document.body.children]) {
				if (!bodyChildren.has(child))
					child.remove();
			}
		}
	});

	async function plot(options = {}, source = data) {
		const rect = { left: 20, top: 30, width: 400, height: 300 };
		const u = new uPlot({
			width: 400, height: 300, pxRatio: 1, padding: [0, 0, 0, 0], axes: [],
			series: [{ label: 'Time' }, ...['Alpha', 'Beta'].map(label => ({ label, stroke: 'red', points: { show: false }, value: scalar }))],
			scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 100] } },
			...options,
			tooltip: { show: true, ...options.tooltip },
		}, source.map(column => Array.isArray(column) ? column.slice() : column), (self, init) => {
			plots.push(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 });
			if (self.over)
				self.over.getBoundingClientRect = () => ({ ...rect });
			document.body.appendChild(self.root);
			init();
		});
		await commit();
		return { u, rect };
	}

	function multiSeries(format = values) {
		return [{ label: 'Time' }, ...['Alpha', 'Beta'].map(label => ({ label, stroke: 'red', points: { show: false }, values: format }))];
	}

	function hover(u, idx = 1, si = 1) {
		u.setCursor({ left: u.valToPos(idx, 'x'), top: u.valToPos(data[si][idx], 'y') });
	}

	for (const alpha of [0.25, 1]) {
		for (const multi of [false, true]) {
			it(`updates legend and tooltip focus classes without row opacity, alpha=${alpha}, multi=${multi}`, async () => {
				const { u } = await plot({
					focus: { alpha },
					cursor: { focus: { prox: Infinity } },
					...(multi && { series: multiSeries() }),
					tooltip: { filter: () => true },
				});
				const tables = [stats(u), tooltip(u)];
				const original = tables.map(rows);
				function assertFocus(si) {
					for (const [i, table] of tables.entries()) {
						const current = rows(table);
						assert.equal(current.length, original[i].length);
						current.forEach((row, index) => {
							assert.equal(row === original[i][index], true);
							const coreIndex = u.series.findIndex(s => s.label == row.querySelector('.u-label').textContent);
							assert.ok(coreIndex >= 0);
							assert.equal(row.classList.contains('u-focus'), coreIndex > 0 && coreIndex == si);
							assert.equal(row.classList.contains('u-off'), !u.series[coreIndex].show);
							assert.equal(row.style.opacity, '');
						});
					}
					const opacity = [1, 2].map(i => si == null || i == si ? 1 : alpha);
					assert.deepEqual(u.series.slice(1).map(s => s.alpha), opacity);
					assert.deepEqual([...u.over.querySelectorAll('.u-cursor-pt')].map(point => Number(point.style.opacity || 1)), opacity);
				}
				u.setLegend({ idx: 1 });
				assertFocus(null);
				for (const si of [1, 2, null]) {
					u.setSeries(si, { focus: true });
					// The custom tooltip filter defers selection and rendering to the commit.
					await commit();
					assertFocus(si);
				}
				for (const si of [1, 2, null]) {
					if (si == null)
						u.setCursor({ left: -10, top: -10 });
					else
						hover(u, 1, si);
					assertFocus(si);
				}
				u.setLegend({ idx: 1 });
				u.setSeries(2, { focus: true, show: false });
				await commit();
				assertFocus(2);
				for (const table of tables)
					assert.equal(table.querySelectorAll('tr.u-focus.u-off').length, 1);
				u.setSeries(null, { focus: true });
				await commit();
				assertFocus(null);
			});
		}
	}

	it('runs the public tooltip demo with zoom-dependent stats and legend toggles', async () => {
		const host = document.createElement('div');
		replace(host, 'clientWidth', {get: () => 400});
		document.body.appendChild(host);
		const u = createDemo(host);
		plots.push(u);
		await commit();
		assert.deepEqual(headers(stats(u)), ['', 'Min', 'Max', 'Last']);
				const last = u.data.slice(1).map(column => column.at(-1).toFixed(2));
				assert.deepEqual(cells(stats(u)).map(row => row[2]), last);
		assert.deepEqual(headers(tooltip(u)), []);
		assert.deepEqual(labels(tooltip(u)), ['Sample', 'North', 'South', 'West']);
		const before = cells(stats(u));
		u.setCursor({left: u.valToPos(30, 'x'), top: 100});
		assert.deepEqual(cells(tooltip(u)), [['30'], ...u.data.slice(1).map(column => [column[30].toFixed(2)])]);
		assert.deepEqual(cells(stats(u)), before);
		u.setScale('x', {min: 20, max: 40});
		await commit();
		assert.notDeepEqual(cells(stats(u)), before);
		assert.deepEqual(cells(stats(u)).map(row => row[2]), last, 'Last uses the full series, not the zoomed range');
		stats(u).querySelector('tbody th').dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}));
		await commit();
		assert.equal(u.series[1].show, false);
		assert.equal(u.tooltip.order.includes(1), false);
		assert.equal(rows(stats(u)).length, 3);
	});

	it('runs the inline demo with labels-only toggles, hover focus, and scalar tooltip values', async () => {
		const host = document.createElement('div');
		replace(host, 'clientWidth', {get: () => 400});
		document.body.appendChild(host);
		const u = createDemo(host, {stats: false});
		plots.push(u);
		await commit();
		const legend = stats(u);
		assert.equal(legend.classList.contains('u-inline'), true);
		assert.equal(legend.classList.contains('u-live'), false);
		assert.deepEqual(labels(legend), ['North', 'South', 'West']);
		assert.equal(legend.querySelectorAll('.u-value').length, 0);
		assert.equal(legend.querySelectorAll('.u-marker').length, 3);
		u.setCursor({left: u.valToPos(30, 'x'), top: 100});
		assert.deepEqual(cells(tooltip(u)), [['30'], ...u.data.slice(1).map(column => [column[30].toFixed(2)])]);

		const label = legend.querySelector('tbody th');
		label.dispatchEvent(new MouseEvent('mouseenter'));
		await commit();
		assert.ok(rows(legend).every(row => row.style.opacity == ''));
		assert.deepEqual(rows(legend).map(row => row.classList.contains('u-focus')), [true, false, false]);
		assert.deepEqual(rows(tooltip(u)).map(row => row.classList.contains('u-focus')), [false, true, false, false]);
		legend.dispatchEvent(new MouseEvent('mouseleave'));
		await commit();
		for (const table of [legend, tooltip(u)])
			assert.ok(rows(table).every(row => !row.classList.contains('u-focus') && row.style.opacity == ''));

		for (const show of [false, true]) {
			label.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}));
			await commit();
			assert.equal(u.series[1].show, show);
			assert.equal(u.tooltip.order.includes(1), show);
			assert.deepEqual(labels(legend), ['North', 'South', 'West']);
			assert.equal(legend.querySelectorAll('.u-value').length, 0);
		}
	});

	for (const legendSrc of [undefined, 'value', 'values']) {
		for (const tooltipSrc of [undefined, 'value', 'values']) {
			it(`selects independent formatter sources: legend=${legendSrc}, tooltip=${tooltipSrc}`, async () => {
				const { u } = await plot({
					series: multiSeries().map(s => ({...s, value: scalar})),
					legend: {mode: 'table', valueSrc: legendSrc},
					tooltip: {mode: 'table', valueSrc: tooltipSrc},
				});
				assert.deepEqual(headers(stats(u)), legendSrc == 'value' ? [] : ['', 'Sum']);
				assert.deepEqual(cells(stats(u)), legendSrc == 'value' ? [['sum:60'], ['sum:150']] : [['60'], ['150']]);
				u.setLegend({idx: 1});
				assert.deepEqual(headers(tooltip(u)), tooltipSrc == 'value' ? [] : ['', 'Value', 'Double']);
				assert.deepEqual(labels(tooltip(u)), tooltipSrc == 'value' ? ['Time', 'Alpha', 'Beta'] : ['Alpha', 'Beta']);
				assert.deepEqual(cells(tooltip(u)), tooltipSrc == 'value' ? [['v:1'], ['v:20'], ['v:50']] : [['20', '40'], ['50', '100']]);
				assert.deepEqual(cells(stats(u)), legendSrc == 'value' ? [['sum:60'], ['sum:150']] : [['60'], ['150']]);
			});
		}
	}

	for (const live of [false, true]) {
		for (const valueSrc of [undefined, 'value', 'values']) {
			it(`selects the standalone legend formatter: live=${live}, valueSrc=${valueSrc}`, async () => {
				const { u } = await plot({
					series: multiSeries().map(s => ({...s, value: scalar})),
					legend: {live, valueSrc},
					tooltip: {show: false},
				});
				u.setLegend({idx: 1});
				assert.deepEqual(headers(stats(u)), valueSrc == 'value' ? [] : live ? ['', 'Value', 'Double'] : ['', 'Sum']);
				assert.deepEqual(cells(stats(u)), valueSrc == 'value'
					? live ? [['v:1'], ['v:20'], ['v:50']] : [['sum:60'], ['sum:150']]
					: live ? [['20', '40'], ['50', '100']] : [['60'], ['150']]);
			});
		}
	}

	it('uses default scalar formatters without calling unused values callbacks', async () => {
		const { u } = await plot({
			series: multiSeries(() => assert.fail('unselected values callback')),
			legend: {valueSrc: 'value'},
			tooltip: {valueSrc: 'value'},
		});
		u.setLegend({idx: 1});
		assert.deepEqual(headers(tooltip(u)), []);
		assert.deepEqual(cells(tooltip(u)), [['1'], ['20'], ['50']]);
		assert.deepEqual(cells(stats(u)), [['--'], ['--']]);
	});

	it('retains explicit sources after replacing the first Y series', async () => {
		const { u } = await plot({
			series: multiSeries(),
			legend: {valueSrc: 'values'},
			tooltip: {valueSrc: 'value'},
		});
		u.batch(() => {
			u.delSeries(1);
			u.addSeries({label: 'Replacement', stroke: 'red', value: scalar, values}, 1);
			u.setData(data, false);
		});
		await commit();
		u.setLegend({idx: 1});
		assert.deepEqual(headers(stats(u)), ['', 'Sum']);
		assert.deepEqual(cells(stats(u)), [['60'], ['150']]);
		assert.deepEqual(headers(tooltip(u)), []);
		assert.deepEqual(labels(tooltip(u)), ['Time', 'Replacement', 'Beta']);
		assert.deepEqual(cells(tooltip(u)), [['1'], ['v:20'], ['50']]);
	});

	it('makes tooltip the live selection owner and targets it with setLegend', async () => {
		const selected = [];
		const { u } = await plot({
			legend: { live: true, filter: (self, si) => self.legend.values[si]._ != null },
			tooltip: {
				filter: (self, si) => { assert.equal(self.tooltip.idxs, self.cursor.idxs); return self.series[si].show; },
				sort: (self, a, b) => self.data[b][self.tooltip.idx] - self.data[a][self.tooltip.idx],
				limit: (self, order) => { selected.push(order.slice()); return [0, 1]; },
			},
		});
		assert.equal(u.tooltip.show, true);
		assert.equal(u.tooltip.gap, 5);
		assert.equal(u.tooltip.mode, 'table');
		assert.equal(u.legend.live, false);
		assert.notEqual(u.legend.values, u.tooltip.values);
		assert.notEqual(u.legend.idxs, u.tooltip.idxs);
		const statsBefore = cells(stats(u));
		const snapshots = [];
		u.hooks.setLegend = [self => snapshots.push([self.tooltip.idx, cells(tooltip(self))])];
		u.setLegend({ idx: 1 });
		assert.deepEqual(u.tooltip.idxs, [1, 1, 1]);
		assert.deepEqual(u.tooltip.order, [2]);
		assert.equal(u.tooltip.count, 2);
		assert.deepEqual(u.tooltip.range, [0, 1]);
		assert.deepEqual(selected.at(-1), [2, 1]);
		assert.deepEqual(labels(tooltip(u)), ['Time', 'Beta']);
		assert.deepEqual(cells(tooltip(u)).slice(1), [['v:50']]);
		assert.deepEqual(snapshots.at(-1), [1, cells(tooltip(u))]);
		assert.equal(u.legend.idx, null);
		assert.deepEqual(u.legend.idxs, [null, null, null]);
		assert.deepEqual(u.legend.order, [1, 2]);
		assert.deepEqual(cells(stats(u)), statsBefore);
		u.tooltip.filter = null;
		u.tooltip.sort = null;
		u.tooltip.limit = null;
		u.setLegend({ idx: 2 });
		assert.deepEqual(u.tooltip.order, [1, 2]);
		assert.deepEqual(u.tooltip.range, [0, 2]);
	});

	it('uses only tooltip selection for hover points, including Y-only movement', async () => {
		const { u } = await plot({
			cursor: { trackDists: true },
			legend: { filter: (self, si) => si == 2 },
			tooltip: {
				filter: (self, si) => self.series[si].show,
				sort: (self, a, b) => self.cursor.dists[a] - self.cursor.dists[b],
				limit: () => [0, 1],
			},
		});
		const pts = [...u.over.querySelectorAll('.u-cursor-pt')];
		assert.equal(pts.length, 2);
		for (const [y, selected] of [[20, 1], [50, 2], [20, 1]]) {
			u.setCursor({left: u.valToPos(1, 'x'), top: u.valToPos(y, 'y')});
			assert.deepEqual(u.tooltip.order, [selected]);
			assert.deepEqual(u.legend.order, [2]);
			assert.deepEqual(pts.map(pt => pt.classList.contains('u-excl')), [selected != 1, selected != 2]);
		}
	});

	for (const show of [false, true]) {
		it(`selects stats independently after refresh and on explicit pagination with tooltip.show=${show}`, async () => {
			let formats = 0, selections = 0, offset = 0;
			const source = [...data, [40, 50, 60]];
			const { u } = await plot({
				series: [{}, ...['Alpha', 'Beta', 'Gamma'].map(label => ({label, stroke: 'red', points: {show: false},
					values(self, si, idx) {
						if (idx != null)
							return {Value: self.data?.[si]?.[idx]};
						formats++;
						return {Sum: self.data[si].reduce((a, b) => a + b, 0)};
					},
				}))],
				legend: {
					live: false,
					filter(self, si) {
						selections++;
						assert.ok(self.legend.values.slice(1).every(value => value?.Sum != null), 'all stats precede selection');
						return self.series[si].show && self.legend.values[si].Sum >= 70;
					},
					sort: (self, a, b) => self.legend.values[b].Sum - self.legend.values[a].Sum,
					limit: () => [offset, offset + 1],
				},
				tooltip: {show, filter: (self, si) => si == 1},
			}, source);
			assert.deepEqual(u.legend.order, [2], 'equal stats retain series order');
			assert.equal(u.legend.count, 2);
			assert.deepEqual(u.legend.range, [0, 1]);
			assert.deepEqual(labels(stats(u)), ['Beta']);
			u.setCursor({left: 200, top: 100});
			const selected = selections, formatted = formats;
			u.setCursor({left: 210, top: 130});
			await commit();
			assert.equal(selections, selected, 'cursor does not rerun stats selection');
			assert.equal(formats, formatted, 'cursor does not recalculate stats');
			const points = [...u.over.querySelectorAll('.u-cursor-pt')];
			assert.deepEqual(points.map(pt => pt.classList.contains('u-excl')), show ? [false, true, true] : [false, false, false]);

			offset = 1;
			u.setLegend({});
			assert.equal(formats, formatted, 'pagination uses cached stats');
			assert.deepEqual(u.legend.order, [3]);
			assert.deepEqual(u.legend.range, [1, 2]);
			assert.deepEqual(labels(stats(u)), ['Gamma']);
			u.legend.sort = (self, a, b) => String(self.series[b].label).localeCompare(String(self.series[a].label));
			offset = 0;
			u.setLegend({});
			assert.deepEqual(u.legend.order, [3], 'sorting by name is independent of cursor values');
			u.setSeries(3, {show: false});
			await commit();
			assert.deepEqual(u.legend.order, [2]);
			assert.equal(u.legend.count, 1);
			u.legend.sort = (self, a, b) => self.legend.values[b].Sum - self.legend.values[a].Sum;
			u.setData([data[0], [100, 100, 100], [1, 2, 3], source[3]], false);
			await commit();
			assert.deepEqual(u.legend.order, [1], 'data refresh precedes stats sorting');
			const beforeScale = selections;
			u.setScale('x', {min: 0, max: 1});
			await commit();
			assert.ok(selections > beforeScale);
			u.legend.filter = null;
			u.legend.sort = null;
			u.legend.limit = null;
			u.setLegend({});
			assert.deepEqual(u.legend.order, [1, 2, 3], 'removing callbacks restores all rows');
			assert.deepEqual(u.legend.range, [0, 3]);
		});
	}

	it('limits a 1000-series stats legend without limiting hover points', async () => {
		const count = 1000;
		const { u } = await plot({
			legend: {live: false, sort: (self, a, b) => b - a, limit: () => [0, 10]},
			tooltip: {show: false},
			cursor: {points: {show: false}},
			series: [{}, ...Array.from({length: count}, (_, i) => ({label: `Series ${i}`, stroke: 'red', points: {show: false}, value: () => i}))],
		}, [data[0], ...Array.from({length: count}, () => [1, 2, 3])]);
		assert.equal(u.legend.count, count);
		assert.deepEqual(u.legend.range, [0, 10]);
		assert.deepEqual(u.legend.order, Array.from({length: 10}, (_, i) => count - i));
		assert.equal(rows(stats(u)).length, 10);
	});

	it('mounts two independent instances of the table renderer once, with independent markers', async () => {
		const mounts = { stats: [], live: [] };
		const markerCalls = [];
		const { u } = await plot({
			series: multiSeries(),
			legend: { mode: 'table', markers: { show: false }, mount: (self, table) => mounts.stats.push([self, table]) },
			tooltip: {
				show: true, gap: 5, mode: 'table',
				markers: { show: true, width: 3, dash: 'solid', stroke: 'blue', fill: (self, si) => { markerCalls.push([self, si]); return 'orange'; } },
				mount(self, table) {
					assert.equal(table.parentNode, self.over);
					assert.equal(table.classList.contains('u-tooltip'), true);
					assert.deepEqual(headers(table), ['', 'Value', 'Double']);
					mounts.live.push([self, table]);
				},
			},
		});
		const a = stats(u), b = tooltip(u);
		assert.notEqual(a, b);
		assert.equal(a.tagName, 'TABLE');
		assert.equal(b.tagName, 'TABLE');
		assert.ok(a.querySelector('tbody') && b.querySelector('tbody'));
		assert.equal(a.querySelectorAll('.u-marker').length, 0);
		assert.equal(b.querySelectorAll('.u-marker').length, 2);
		assert.equal(b.classList.contains('u-inline'), false);
		assert.deepEqual(headers(a), ['', 'Sum']);
		for (const marker of b.querySelectorAll('.u-marker')) {
			assert.equal(marker.style.borderWidth, '3px');
			assert.equal(marker.style.borderColor, 'blue');
			assert.equal(marker.style.background, 'orange');
		}
		u.setLegend({ idx: 1 });
		u.setLegend({ idx: 2 });
		u.setSeries(2, { show: false });
		await commit();
		assert.equal(stats(u), a);
		assert.equal(tooltip(u), b);
		assert.deepEqual(mounts, { stats: [[u, a]], live: [[u, b]] });
		assert.deepEqual(markerCalls, [[u, 1], [u, 2]]);
	});

	it('clones HTMLElement labels and registers no tooltip DOM listeners or binding factories', async () => {
		const label = document.createElement('span');
		label.appendChild(document.createElement('b')).textContent = 'Alpha';
		const listeners = [], bindings = [];
		const add = HTMLElement.prototype.addEventListener;
		replace(HTMLElement.prototype, 'addEventListener', { value: function(type, listener, options) {
			listeners.push([this, type]);
			return add.call(this, type, listener, options);
		} });
		const { u } = await plot({
			series: [{}, { label, stroke: 'red', values }],
			cursor: { focus: { prox: 10 }, bind: Object.fromEntries(['click', 'mouseenter', 'mouseleave'].map(type => [type, (self, target, handler) => {
				bindings.push([target, type]);
				return handler;
			}])) },
		}, data.slice(0, 2));
		const a = stats(u), b = tooltip(u);
		const original = a.querySelector('tbody .u-label').firstChild;
		const clone = b.querySelector('tbody .u-label').firstChild;
		assert.equal(original === label, true);
		assert.equal(clone === label, false);
		assert.equal(clone.firstChild === label.firstChild, false);
		assert.equal(clone.outerHTML, label.outerHTML);
		assert.ok(bindings.some(([target]) => a.contains(target)));
		assert.ok(listeners.some(([target]) => a.contains(target)));
		assert.equal(bindings.filter(([target]) => b.contains(target)).length, 0);
		assert.equal(listeners.filter(([target]) => b.contains(target)).length, 0);
		b.querySelector('th').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		b.querySelector('th').dispatchEvent(new MouseEvent('mouseenter'));
		assert.equal(u.series[1].show, true);
		assert.notEqual(u.series[1]._focus, true);
		label.firstChild.textContent = 'edited';
		u.setLegend({ idx: 1 });
		assert.equal(clone.textContent, 'Alpha');
		assert.equal(original.textContent, 'edited');
	});

	it('formats scalar stats with null arguments on initialization and both setData reset modes', async () => {
		const calls = [];
		const { u } = await plot({ series: [{}, ...['Alpha', 'Beta'].map(label => ({ label, stroke: 'red', value(self, value, si, idx) {
			calls.push([si, value, idx]);
			return scalar(self, value, si, idx);
		} }))] });
		assert.deepEqual(cells(stats(u)), [['sum:60'], ['sum:150']]);
		assert.ok(calls.some(call => call[0] == 1 && call[1] === null && call[2] === null));
		hover(u);
		for (const reset of [true, false]) {
			calls.length = 0;
			const next = reset ? [[0, 1, 2], [1, 2, 3], [4, 5, 6]] : [[0, 1, 2], [7, 8, 9], [10, 11, 12]];
			const before = cells(stats(u));
			u.setData(next, reset);
			assert.deepEqual(cells(stats(u)), before, 'stats update at commit, not in setData');
			await commit();
			assert.deepEqual(calls.filter(call => call[2] === null), [[1, null, null], [2, null, null]]);
			assert.deepEqual(cells(stats(u)), next.slice(1).map(column => [`sum:${column.reduce((a, b) => a + b, 0)}`]));
			assert.deepEqual(cells(tooltip(u)).slice(1), next.slice(1).map(column => [`v:${column[1]}`]));
		}
	});

	it('refreshes stats for explicit setSeries, but not cursor-driven focus', async () => {
		const calls = [];
		const { u } = await plot({
			cursor: { focus: { prox: 1 } },
			series: multiSeries((self, si, idx) => { calls.push([si, idx]); return values(self, si, idx); }),
		});
		hover(u);
		await commit();
		calls.length = 0;
		hover(u, 1, 2);
		assert.equal(u.series[2]._focus, true);
		await commit();
		assert.equal(calls.filter(([, idx]) => idx === null).length, 0);
		for (const options of [{ focus: true }, { show: false }]) {
			calls.length = 0;
			u.setSeries(1, options);
			assert.equal(calls.filter(([, idx]) => idx === null).length, 0);
			await commit();
			assert.deepEqual(calls.filter(([, idx]) => idx === null), [[1, null], [2, null]]);
		}
		assert.equal(rows(stats(u))[0].classList.contains('u-off'), true);
		assert.equal(rows(tooltip(u))[0].classList.contains('u-off'), true);
	});

	it('refreshes stats from committed scale bounds, not pending setScale bounds', async () => {
		const calls = [];
		const { u } = await plot({ series: multiSeries((self, si, idx) => {
			if (idx === null) {
				calls.push([si, self.scales.x.min, self.scales.x.max]);
				return { Range: `${self.scales.x.min}:${self.scales.x.max}` };
			}
			return { Value: self.data?.[si]?.[idx] };
		}) });
		hover(u);
		calls.length = 0;
		u.setScale('x', { min: 0.5, max: 1.5 });
		assert.equal(calls.length, 0);
		assert.deepEqual(cells(stats(u)), [['0:2'], ['0:2']]);
		await commit();
		assert.deepEqual(calls, [[1, 0.5, 1.5], [2, 0.5, 1.5]]);
		assert.deepEqual(cells(stats(u)), [['0.5:1.5'], ['0.5:1.5']]);
	});

	it('refreshes stats and reconciles both tables by series identity after add/delete', async () => {
		const { u } = await plot({ series: multiSeries() });
		u.setLegend({ idx: 1 });
		const a = rows(stats(u)), b = rows(tooltip(u));
		u.addSeries({ label: 'Gamma', stroke: 'blue', values: (self, si, idx) => idx == null ? { Sum: 99 } : { Value: 33, Double: 66 } });
		u.setData([...data, [33, 33, 33]], false);
		await commit();
		assert.deepEqual(u.legend.order, [1, 2, 3]);
		assert.deepEqual(u.legend.idxs, [null, null, null, null]);
		assert.deepEqual(cells(stats(u)), [['60'], ['150'], ['99']]);
		assert.equal(rows(stats(u))[0] === a[0], true);
		assert.equal(rows(tooltip(u))[1] === b[1], true);
		u.delSeries(1);
		u.setData([data[0], data[2], [33, 33, 33]], false);
		await commit();
		assert.deepEqual(u.legend.order, [1, 2]);
		assert.deepEqual(u.tooltip.order, [1, 2]);
		assert.deepEqual(labels(stats(u)), ['Beta', 'Gamma']);
		assert.deepEqual(labels(tooltip(u)), ['Beta', 'Gamma']);
		assert.equal(rows(stats(u))[0] === a[1], true);
		assert.equal(rows(tooltip(u))[0] === b[1], true);
		assert.equal(a[0].isConnected, false);
		assert.equal(b[0].isConnected, false);
	});

	it('owns separate snapshots when every values callback reuses one mutable record', async () => {
		const record = {};
		const { u } = await plot({ series: multiSeries((self, si, idx) => {
			for (const key of Object.keys(record)) delete record[key];
			Object.assign(record, idx == null ? { Sum: si * 100 } : { Value: self.data?.[si]?.[idx], Double: si + idx });
			return record;
		}) });
		u.setLegend({ idx: 1 });
		const stat = u.legend.values[1], live = u.tooltip.values[1];
		assert.notEqual(stat, record);
		assert.notEqual(live, record);
		assert.notEqual(stat, live);
		assert.notEqual(u.tooltip.values[1], u.tooltip.values[2]);
		assert.deepEqual(stat, { Sum: 100 });
		assert.deepEqual(live, { Value: 20, Double: 2 });
		u.setSeries(2, { show: false });
		await commit();
		assert.deepEqual(u.tooltip.values[1], { Value: 20, Double: 2 });
		assert.deepEqual(cells(stats(u)), [['100'], ['200']]);
		u.setLegend({ idx: 2 });
		assert.deepEqual(cells(tooltip(u)), [['30', '3'], ['60', '4']]);
		assert.deepEqual(u.legend.values.slice(1), [{ Sum: 100 }, { Sum: 200 }]);
		assert.deepEqual(stat, { Sum: 100 });
		assert.deepEqual(live, { Value: 20, Double: 2 });
	});

	it('changes independent stats and live column schemas without remounting either table', async () => {
		let extended = false;
		const mounts = [];
		const { u } = await plot({
			series: multiSeries((self, si, idx) => idx == null ? (extended ? { Min: si, Max: si + 10 } : { Sum: si }) : { Value: si + idx }),
			legend: { mount: (self, table) => mounts.push(table) },
			tooltip: { mount: (self, table) => mounts.push(table) },
		});
		const a = stats(u), b = tooltip(u);
		u.setLegend({ idx: 1 });
		extended = true;
		u.setData(data, false);
		await commit();
		assert.deepEqual(headers(a), ['', 'Min', 'Max']);
		assert.deepEqual(cells(a), [['1', '11'], ['2', '12']]);
		assert.deepEqual(headers(b), ['', 'Value']);
		const format = (self, si, idx) => idx == null ? { Total: 9 } : { Reading: 8, Unit: 'ms' };
		u.addSeries({ label: 'New first', stroke: 'blue', values: format }, 1);
		u.setData([data[0], [8, 8, 8], data[1], data[2]], false);
		await commit();
		u.setLegend({ idx: 1 });
		assert.deepEqual(headers(a), ['', 'Total']);
		assert.deepEqual(headers(b), ['', 'Reading', 'Unit']);
		assert.deepEqual(cells(b)[0], ['8', 'ms']);
		u.delSeries(1);
		u.setData(data, false);
		await commit();
		u.setLegend({ idx: 2 });
		assert.deepEqual(headers(a), ['', 'Min', 'Max']);
		assert.deepEqual(headers(b), ['', 'Value']);
		assert.deepEqual(cells(b), [['3'], ['4']]);
		assert.equal(stats(u), a);
		assert.equal(tooltip(u), b);
		assert.deepEqual(mounts, [a, b]);
	});

	it('uses mode 2 per-series indices even when cursor.idx is undefined or null', async () => {
		const { u } = await plot({
			mode: 2,
			cursor: { dataIdx: (self, si) => si == 1 ? 0 : 2 },
			series: multiSeries((self, si, idx) => idx == null ? { Sum: si * 100 } : { Value: self.data?.[si]?.[1]?.[idx] }),
		}, [null, [[0, 1, 2], [10, 20, 30]], [[0, 0.5, 2], [40, 50, 60]]]);
		u.setCursor({ left: 100, top: 100 });
		assert.equal(u.cursor.idx == null, true);
		assert.deepEqual(u.tooltip.idxs.slice(1), [0, 2]);
		assert.deepEqual(cells(tooltip(u)), [['10'], ['60']]);
		assert.equal(tooltip(u).style.display, '');
		u.cursor.idx = null;
		u.setLegend({ idxs: [null, 2, 0] });
		assert.equal(u.cursor.idx, null);
		assert.equal(u.tooltip.idx, null);
		assert.deepEqual(cells(tooltip(u)), [['30'], ['40']]);
		assert.equal(tooltip(u).style.display, '');
		assert.deepEqual(cells(stats(u)), [['100'], ['200']]);
		u.setLegend({ idxs: [null, null, null] });
		assert.equal(tooltip(u).style.display, 'none');
	});

	it('preserves scalar live null, false, zero, and empty-string formatting semantics', async () => {
		let result = 0;
		const calls = [];
		const { u } = await plot({ series: [{}, { label: 'Alpha', stroke: 'red', value(self, value, si, idx) {
			calls.push([value, idx]);
			return idx == null ? null : result;
		} }] }, data.slice(0, 2));
		assert.deepEqual(cells(stats(u)), [['--']]);
		for (const [value, text] of [[0, '0'], [false, ''], ['', ''], [null, '--'], [undefined, '--']]) {
			result = value;
			u.setLegend({ idx: 1 });
			assert.deepEqual(cells(tooltip(u)).slice(1), [[text]]);
			assert.deepEqual(calls.at(-1), [20, 1]);
		}
		u.setLegend({ idx: null });
		assert.deepEqual(calls.at(-1), [null, null]);
		assert.equal(u.tooltip.values[1]._, '--');
		assert.equal(u.legend.values[1]._, '--');
	});

	it('calls multi-value formatters with null indices and distinguishes null records from null cells', async () => {
		let result;
		const calls = [];
		const { u } = await plot({ series: multiSeries((self, si, idx) => {
			calls.push([si, idx]);
			return result === undefined ? { A: 0, B: '', C: false, D: null } : result;
		}) });
		u.setLegend({ idx: 1 });
		assert.deepEqual(cells(tooltip(u)), [['0', '', '', ''], ['0', '', '', '']]);
		result = null;
		u.setLegend({ idx: null });
		assert.deepEqual(calls.slice(-2), [[1, null], [2, null]]);
		assert.deepEqual(cells(tooltip(u)), [['--', '--', '--', '--'], ['--', '--', '--', '--']]);
		result = { A: 'outside', B: 0 };
		u.setLegend({ idx: null });
		assert.deepEqual(cells(tooltip(u)), [['outside', '0', '', ''], ['outside', '0', '', '']]);
		assert.equal(tooltip(u).style.display, 'none');
	});

	for (const [name, options] of [['no .u-over', { dom: { over: false } }], ['cursor.show=false', { cursor: { show: false } }]]) {
		it(`disables tooltip with ${name} without forcing stats mode`, async () => {
			let mounts = 0;
			const { u } = await plot({ ...options, tooltip: { mount: () => mounts++ } });
			assert.equal(u.tooltip.show, false);
			assert.equal(u.legend.live, true);
			assert.equal(tooltip(u), null);
			assert.equal(mounts, 0);
			assert.equal(observers.length, 0);
			u.setLegend({ idx: 2 });
			assert.equal(u.legend.idx, 2);
			assert.deepEqual(u.legend.idxs, [2, 2, 2]);
			assert.deepEqual(cells(stats(u)).slice(1), [['v:30'], ['v:60']]);
			assert.deepEqual(u.tooltip.order, []);
		});
	}

	it('commits batched data, scale, and series changes and keeps setLegend on the live owner', async () => {
		const calls = [];
		const { u } = await plot({ series: multiSeries((self, si, idx) => {
			if (idx === null) calls.push(si);
			return values(self, si, idx);
		}) });
		hover(u);
		calls.length = 0;
		const seen = [];
		u.hooks.setLegend = [self => seen.push([self.tooltip.idx, self.legend.idx, cells(tooltip(self))])];
		u.batch(() => {
			u.setData([[0, 1, 2], [1, 2, 3], [4, 5, 6]], false);
			u.setScale('x', { min: 0.5, max: 1.5 });
			u.setSeries(2, { show: false });
		}, true);
		assert.deepEqual(calls, [1, 2]);
		assert.deepEqual(cells(stats(u)), [['6'], ['15']]);
		assert.deepEqual(cells(tooltip(u)), [['2', '4'], ['5', '10']]);
		assert.equal(rows(tooltip(u))[1].classList.contains('u-off'), true);
		u.batch(() => u.setLegend({ idx: 2 }), true);
		await commit();
		assert.deepEqual(seen.at(-1), [2, null, [['3', '6'], ['6', '12']]]);
		assert.deepEqual(cells(stats(u)), [['6'], ['15']]);
		await commit();
		assert.deepEqual(calls, [1, 2], 'no redundant stats pass after the batch');
	});

	it('positions all four flip combinations, returns to default, and retains RO size across hidden zero reports', async () => {
		const { u } = await plot();
		const node = tooltip(u);
		const geometryRead = () => assert.fail('tooltip geometry must come from ResizeObserver');
		for (const key of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight'])
			replace(node, key, { get: geometryRead });
		node.getBoundingClientRect = node.getClientRects = geometryRead;
		assert.equal(observers.length, 1);
		assert.deepEqual(observers[0].targets, [[node, { box: 'border-box' }]]);
		observers[0].deliver(100, 80);
		for (const [left, top, transform] of [
			[40, 50, 'translate(65px, 85px)'],
			[400, 50, 'translate(315px, 85px)'],
			[40, 300, 'translate(65px, 245px)'],
			[400, 300, 'translate(315px, 245px)'],
			[40, 50, 'translate(65px, 85px)'],
		]) {
			u.setCursor({ left, top });
			assert.equal(node.style.display, '');
			assert.equal(node.style.transform, transform);
		}
		u.setCursor({ left: -10, top: -10 });
		assert.equal(node.style.display, 'none');
		observers[0].deliver(0, 0);
		u.setCursor({ left: 400, top: 300 });
		assert.equal(node.style.transform, 'translate(315px, 245px)');
		observers[0].deliver(50, 40);
		assert.equal(node.style.transform, 'translate(425px, 335px)');
	});

	it('repositions on captured scroll and resize with refreshed overlay geometry and viewport', async () => {
		const { u, rect } = await plot();
		const node = tooltip(u);
		observers[0].deliver(100, 80);
		u.setCursor({ left: 100, top: 100 });
		assert.equal(node.style.transform, 'translate(125px, 135px)');
		rect.left = 300;
		rect.top = 200;
		// Non-bubbling descendant scroll still reaches the window capture listener.
		u.over.dispatchEvent(new Event('scroll'));
		assert.equal(node.style.transform, 'translate(295px, 305px)');
		viewport.width = 800;
		viewport.height = 350;
		window.dispatchEvent(new Event('resize'));
		assert.equal(node.style.transform, 'translate(405px, 215px)');
		rect.left = 20;
		rect.top = 30;
		viewport.height = 400;
		window.dispatchEvent(new Event('scroll'));
		assert.equal(node.style.transform, 'translate(125px, 135px)');
	});

	it('hides for empty selection, absent indices, out-of-plot or out-of-viewport anchors, and recovers', async () => {
		const { u, rect } = await plot();
		const node = tooltip(u);
		u.setCursor({ left: 100, top: 100 });
		assert.equal(node.style.display, '');
		u.tooltip.filter = () => false;
		u.setLegend({ idx: 1 });
		assert.equal(node.style.display, 'none');
		u.tooltip.filter = null;
		u.setLegend({ idx: null });
		assert.equal(node.style.display, 'none');
		u.setLegend({ idx: 1 });
		assert.equal(node.style.display, '');
		for (const [left, top] of [[-1, 100], [401, 100], [100, -1], [100, 301]]) {
			u.setCursor({ left, top });
			assert.equal(node.style.display, 'none');
		}
		u.setCursor({ left: 100, top: 100 });
		for (const [left, top] of [[-101, 0], [401, 0], [0, -101], [0, 301]]) {
			rect.left = left;
			rect.top = top;
			u.syncRect();
			assert.equal(node.style.display, 'none');
		}
		rect.left = 20;
		rect.top = 30;
		u.syncRect();
		assert.equal(node.style.display, '');
	});

	it('removes the observer, exact window listeners, and externally mounted tooltip on destroy', async () => {
		const added = [], removed = [];
		for (const [method, records] of [['addEventListener', added], ['removeEventListener', removed]]) {
			const original = window[method];
			replace(window, method, { value: function(type, listener, options) {
				records.push([type, listener, options]);
				return original.call(this, type, listener, options);
			} });
		}
		const host = document.createElement('div');
		document.body.appendChild(host);
		const { u } = await plot({ tooltip: { mount: (self, node) => host.appendChild(node) } });
		const node = host.querySelector('.u-tooltip');
		const registrations = added.filter(([type]) => type == 'scroll' || type == 'resize');
		assert.equal(registrations.length, 2);
		assert.deepEqual(registrations.map(([type, , options]) => [type, options]), [['scroll', true], ['resize', undefined]]);
		u.setCursor({ left: 100, top: 100 });
		const transform = node.style.transform;
		u.destroy();
		plots.splice(plots.indexOf(u), 1);
		assert.equal(node.isConnected, false);
		assert.equal(host.children.length, 0);
		assert.equal(observers[0].disconnected, true);
		for (const registration of registrations)
			assert.ok(removed.some(removal => removal.every((value, index) => value === registration[index])));
		u.syncRect = () => assert.fail('destroyed tooltip must not refresh rect');
		window.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		observers[0].deliver(999, 999);
		assert.equal(node.style.transform, transform);
	});
});
