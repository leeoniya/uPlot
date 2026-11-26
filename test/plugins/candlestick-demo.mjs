import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { createCharts, createDemo, dataUrl, initialRange, parseCsv } from '../../demos/candlestick.js';

const start = Date.parse('2021-07-14T01:08:00Z') / 1e3;
const fields = {time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5, sma: 6, bolup: 7, boldn: 8};
function fixture(factor = 1) {
	const data = [
		Array.from({length: 6}, (_, i) => start + i * 30),
		[10, 11, 12, 13, 14, 15], [12, 13, 14, 15, 16, 17], [9, 10, 11, 12, 13, 14], [11, 12, 13, 14, 15, 16],
		[1000, 2000, 1500, 3000, 2000, 1000], [10.5, 11.5, 12.5, 13.5, 14.5, 15.5], [13, 14, 15, 16, 17, 18], [8, 9, 10, 11, 12, 13],
	].map((values, si) => si === 0 || si === fields.volume ? values : values.map(value => value * factor));
	return {data, fields};
}
const texts = (root, selector) => [...root.querySelectorAll(selector)].map(el => el.textContent);
const xRange = u => [u.scales.x.min, u.scales.x.max];
const initialBounds = [start - 15, start + 1395];
const band = u => u.under.firstElementChild;
function assertBand(u, interval = 30) {
	const time = u.data[0][u.cursor.idx];
	assert.ok(Number.isFinite(time));
	const left = u.valToPos(time - interval / 2, 'x'), right = u.valToPos(time + interval / 2, 'x');
	assert.equal(band(u).style.display, '');
	assert.equal(band(u).style.transform, `translateX(${Math.round(left)}px)`);
	assert.equal(band(u).style.width, Math.max(1, Math.round(right - left)) + 'px');
}

function mouseFor(u) {
	let previous;
	return (type, left, top = 80, target = u.over) => {
		const event = new MouseEvent(type, {
			bubbles: true, cancelable: true, button: 0,
			buttons: type === 'mouseup' || type === 'dblclick' ? 0 : 1,
			detail: type === 'dblclick' ? 2 : 0,
			clientX: left, clientY: top,
		});
		// mount() supplies a zero-origin overlay; Happy DOM needs explicit movement.
		Object.defineProperties(event, {
			movementX: {value: previous == null ? 0 : left - previous[0]},
			movementY: {value: previous == null ? 0 : top - previous[1]},
		});
		previous = [left, top];
		target.dispatchEvent(event);
		return event;
	};
}

describe('candlestick demo behavior', () => {
	let root, plots;
	beforeEach(() => {
		root = document.body.appendChild(document.createElement('div'));
		plots = [];
	});
	function destroyPlots() {
		for (const u of plots.splice(0)) u.destroy();
	}
	afterEach(() => {
		try { destroyPlots(); }
		finally { root.remove(); }
	});
	function mount(parsed = fixture(), target = root) {
		const created = createCharts(parsed, target);
		plots.push(...created);
		for (const u of created) {
			u.over.getBoundingClientRect = () => ({left: 0, top: 0, width: u.bbox.width / u.pxRatio, height: u.bbox.height / u.pxRatio});
			u.syncRect();
		}
		return created;
	}

	async function load(target = root) {
		const created = await createDemo(target);
		plots.push(...created);
		return created;
	}

	for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
		it(`parses ${name} CSV by semantic column order, with seconds and null blanks`, () => {
			const parsed = parseCsv([
				'time,volume,close,low,high,open,boldn,bolup,sma',
				'2021-07-14T01:08:00Z,100,11,9,12,10,8,13,10.5',
				'2021-07-14T01:08:30Z,,12,10,13,11,,,0',
				'',
			].join(newline));
			assert.deepEqual(parsed.fields, {time: 0, volume: 1, close: 2, low: 3, high: 4, open: 5, boldn: 6, bolup: 7, sma: 8});
			assert.deepEqual(parsed.data, [[start, start + 30], [100, null], [11, 12], [9, 10], [12, 13], [10, 11], [8, null], [13, null], [10.5, 0]]);
		});
	}

	it('loads the local 2101-row CSV through the page module and wires range controls', async () => {
		const page = new URL('../../demos/candlestick.html', import.meta.url);
		const template = document.createElement('template');
		template.innerHTML = (await readFile(page, 'utf8')).match(/<body>([^]*?)<\/body>/)[1];
		const script = template.content.querySelector('script[type="module"]');
		const source = script.textContent.replace(/import\s+\{[^}]+\}\s+from\s+['"]\.\/candlestick\.js['"];?/, '');
		script.remove();
		root.appendChild(template.content);
		assert.equal(dataUrl, 'data/ohlc_dogecoin.csv');
		// Execute the real page body; the shared loader reads the local CSV under Node/Bun.
		const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
		await new AsyncFunction('initialRange', 'createDemo', 'document', source)(initialRange, load, root);
		await Promise.resolve();
		assert.equal(plots.length, 4);
		const data = plots[0].data;
		assert.deepEqual(data.map(column => column.length), Array(9).fill(2101));
		assert.deepEqual(data.map(column => column[0]), [1626195600, .19986, .20009, .19983, .20004, 286630.4, .1999668, .2002845, .1996492]);
		assert.ok(data[0].slice(1).every((time, i) => time - data[0][i] === 30));
		assert.equal(root.querySelector('#status').textContent, `${(2101).toLocaleString()} samples, 30 seconds apart.`);
		assert.deepEqual(initialRange, [start - 1.58, start + 1394.094], 'exported timestamps stay unsnapped');
		for (const u of plots) assert.deepEqual(xRange(u), initialBounds);
		const requests = plots.map(u => {
			const calls = [], setRange = u.setRange;
			u.setRange = (...args) => { calls.push(args); return setRange(...args); };
			return calls;
		});
		for (const [id, range] of [['all', [data[0][0] - 15, data[0].at(-1) + 15]], ['reset', initialBounds]]) {
			const button = root.querySelector('#' + id);
			assert.equal(button.disabled, false);
			button.click();
			await Promise.resolve();
			for (const [i, u] of plots.entries()) {
				assert.deepEqual(xRange(u), range);
				assert.deepEqual(requests[i].at(-1), ['x', ...(id === 'all' ? [null, null] : range)]);
			}
		}
	});

	it('snaps X callbacks outward without clamping, drifting or changing explicit ranges', async () => {
		mount();
		await Promise.resolve();
		for (const u of plots) {
			assert.deepEqual(xRange(u), initialBounds, 'the short fixture retains the broad initial range');
			for (const [request, expected] of [
				[[-5, 65], [-15, 75]], [[29, 31], [15, 45]], [[15, 75], [15, 75]],
				[[-46, 196], [-75, 225]], [[210, 240], [195, 255]], [[-90, -60], [-105, -45]],
				[[30, 30], [15, 45]], [[null, 60], [null, null]], [[0, null], [null, null]], [[null, null], [null, null]],
			]) {
				const bounds = request.map(value => value == null ? null : start + value);
				const snapped = expected.map(value => value == null ? null : start + value);
				assert.deepEqual(u.scales.x.range(u, ...bounds), snapped);
				assert.deepEqual(u.cursor.drag.setRange(u, 'x', ...bounds), snapped);
				assert.deepEqual(u.scales.x.range(u, ...snapped), snapped, 'snapping is idempotent');
			}
			for (const key of ['y', 'volume'])
				assert.deepEqual(u.cursor.drag.setRange(u, key, 10.125, 14.875), [10.125, 14.875]);

			u.setScale('x', {min: start - 4.25, max: start + 136.75});
			await Promise.resolve();
			assert.deepEqual(xRange(u), [start - 4.25, start + 136.75]);
			u.setRange('x', start + 7.25, start + 122.75);
			await Promise.resolve();
			assert.deepEqual(xRange(u), [start + 7.25, start + 122.75]);
			for (let i = 0; i < 2; i++) {
				u.setRange('x', ...u.scales.x.range(u, start + 29, start + 31));
				await Promise.resolve();
				assert.deepEqual(xRange(u), [start + 15, start + 45]);
			}
		}
	});

	it('infers the full-array minimum gap and handles irregular edges, duplicates, single and empty data', async () => {
		mount();
		await Promise.resolve();
		for (const [offsets, interval, expected, all] of [
			[[0, 60, 150], 60, [-30, 90], [-30, 180]],
			[[7, 37, 67], 30, [22, 52], [-8, 82]],
			[[0, 60, 120, 180, 185], 5, [22.5, 37.5], [-2.5, 187.5]],
			[[0, 60, 67, 127], 7, [24.5, 35.5], [-3.5, 130.5]],
			[[0, 0, 60, 65], 5, [22.5, 37.5], [-2.5, 67.5]],
			[[7, 7, 7], 1, [25.5, 34.5], [6.5, 7.5]],
			[[7], 1, [25.5, 34.5], [6.5, 7.5]],
			[[], 1, [null, null], [null, null]],
		]) {
			const data = fixture().data.map((column, si) => si === 0 ? offsets.map(value => start + value) : column.slice(0, offsets.length));
			const snapped = expected.map(value => value == null ? null : start + value);
			const full = all.map(value => value == null ? null : start + value);
			for (const u of plots) {
				u.setData(data, false);
				assert.deepEqual(u.scales.x.range(u, start + 26, start + 34), snapped);
				assert.deepEqual(u.cursor.drag.setRange(u, 'x', start + 26, start + 34), snapped);
				assert.deepEqual(u.scales.x.range(u, data[0][0] ?? null, data[0].at(-1) ?? null), full);
				u.setRange('x', null, null);
			}
			await Promise.resolve();
			for (const u of plots) {
				assert.deepEqual(xRange(u), full);
				if (offsets.length > 0) {
					for (const time of data[0])
						assert.deepEqual(u.scales.x.range(u, time, time), [time - interval / 2, time + interval / 2]);
					u.setCursor({left: u.valToPos(data[0].at(-1), 'x'), top: 80});
					assertBand(u, interval);
				}
				else
					assert.equal(band(u).style.display, 'none');
				assert.doesNotMatch(band(u).style.cssText, /NaN|Infinity/);
			}
		}
	});

	for (const [interval, bounds] of [[60, [-30, 1410]], [5, [-2.5, 1397.5]]]) {
		it(`infers an initial ${interval}-unit interval for bounds and highlight without hover repaint`, async () => {
			const parsed = fixture();
			parsed.data[0] = parsed.data[0].map((_, i) => start + i * interval);
			mount(parsed);
			await Promise.resolve();
			for (const u of plots) {
				assert.deepEqual(xRange(u), bounds.map(value => start + value));
				const painted = structuredClone(u.ctx.log);
				for (const idx of [1, 3, 4]) {
					u.setCursor({left: u.valToPos(parsed.data[0][idx], 'x'), top: 80});
					assert.equal(u.cursor.idx, idx);
					assertBand(u, interval);
				}
				assert.deepEqual(u.ctx.log, painted, 'hover does not paint');
			}
		});
	}

	for (const resetScales of [false, true]) {
		it(`refreshes 30→60→5 intervals after replacement and in-place setData, resetScales=${resetScales}`, async () => {
			mount();
			await Promise.resolve();
			let data = plots[0].data;
			for (const interval of [30, 60, 5]) {
				for (const u of plots) u.setCursor({left: 0, top: 80});
				const previous = plots.map(u => ({range: xRange(u), width: band(u).style.width}));
				const full = [start - interval / 2, start + 5.5 * interval];
				if (interval !== 30) {
					if (interval === 60) data = fixture().data;
					for (let i = 0; i < data[0].length; i++) data[0][i] = start + i * interval;
					for (const u of plots) {
						assert.equal(u.data === data, interval === 5, '5-unit update reuses both data and timestamp arrays');
						u.setData(data, resetScales);
					}
					await Promise.resolve();
					for (const [i, u] of plots.entries()) {
						assert.deepEqual(xRange(u), resetScales ? full : previous[i].range);
						assert.equal(u.cursor.idx, 0, 'stationary cursor keeps the same index');
						assertBand(u, interval);
						if (!resetScales) assert.notEqual(band(u).style.width, previous[i].width);
					}
				}
				for (const u of plots) u.setRange('x', null, null);
				await Promise.resolve();
				for (const u of plots) assert.deepEqual(xRange(u), full);

				const source = plots[0], mouse = mouseFor(source);
				const left = source.valToPos(start + .9 * interval, 'x'), right = source.valToPos(start + 1.1 * interval, 'x');
				mouse('mousedown', left);
				mouse('mousemove', right);
				mouse('mouseup', right, 80, document);
				await Promise.resolve();
				for (const u of plots) assert.deepEqual(xRange(u), [start + .5 * interval, start + 1.5 * interval]);
				mouse('dblclick', source.bbox.width / source.pxRatio / 2);
				await Promise.resolve();
				for (const u of plots) assert.deepEqual(xRange(u), full);
			}
		});
	}

	for (const ratio of [1, 1.5, 2, 3, 4]) {
		it(`synchronizes snapped mouse drags and native double-click reset at DPR ${ratio}`, async () => {
			mount();
			for (const u of plots) u.setPxRatio(ratio);
			for (const width of [450, 900]) {
				for (const u of plots) {
					u.setSize({width, height: 420});
					u.setRange('x', null, null);
				}
				await Promise.resolve();
				for (const u of plots) u.syncRect();
				for (const [i, [from, to, expected]] of [
					[4, 94, [-15, 105]], [94, 4, [-15, 105]],
					[29, 31, [15, 45]], [31, 29, [15, 45]],
				].entries()) {
					const source = plots[i], mouse = mouseFor(source);
					const left = source.valToPos(start + from, 'x'), right = source.valToPos(start + to, 'x');
					mouse('mousedown', left);
					mouse('mousemove', right);
					assert.ok(source.select.width > 0, 'even a tiny within-column drag creates a selection');
					mouse('mouseup', right, 80, document);
					await Promise.resolve();
					for (const u of plots)
						assert.deepEqual(xRange(u), expected.map(value => start + value), `width ${width}, source ${i}`);
					for (let repeat = 0; repeat < 2; repeat++) {
						mouse('dblclick', source.bbox.width / source.pxRatio / 2);
						await Promise.resolve();
						for (const u of plots) assert.deepEqual(xRange(u), [start - 15, start + 165]);
					}
				}
			}
		});
	}

	it('parses fresh chart data from cached CSV text on each render', async () => {
		const first = await load();
		const original = structuredClone(first[0].data);
		first[0].data[1][0] = -1;
		first[0].data[2].pop();
		const second = await load();
		assert.deepEqual(second[0].data, original);
		for (let i = 0; i < original.length; i++)
			assert.notEqual(second[0].data[i], first[0].data[i]);
	});

	it('creates four variants with an overlay-only static legend and native formatted tooltips', async () => {
		mount();
		await Promise.resolve();
		assert.deepEqual(plots.map(u => u.root.querySelector('.u-title').textContent), [
			'Price & Volume', 'Price Only, Hollow Candles', 'Price Only, OHLC Bars', 'Volume Only, Alt Colors, 100% Opacity',
		]);
		const labels = ['Open', 'High', 'Low', 'Close', 'Volume', 'SMA', 'Bollinger upper', 'Bollinger lower'];
		const values = ['$11.000', '$13.000', '$10.000', '$12.000', '2,000', '$11.500', '$14.000', '$9.000'];
		for (const [i, u] of plots.entries()) {
			const selected = i === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : i === 3 ? [4] : [0, 1, 2, 3];
			assert.deepEqual(u.series.slice(1).filter(s => s.show).map(s => s.label), selected.map(si => labels[si]));
			assert.deepEqual(u.bands.map(b => b.series), i === 0 ? [[fields.bolup, fields.boldn]] : []);
			for (const [si, stroke, width, dash, cap] of [
				[fields.sma, '#ff780a', 5, [0, 20], 'round'],
				[fields.bolup, '#3274d9', 1, [10, 10], 'butt'],
				[fields.boldn, '#e0b400', 1, [10, 10], 'butt'],
			]) {
				const s = u.series[si];
				assert.deepEqual([s.stroke(u, si), s.width, s.dash, s.cap ?? 'butt'], [stroke, width, dash, cap]);
			}
			if (i === 0) {
				assert.ok(u.ctx.log.some(([op, ...calls]) => op === 'setLineDash' && calls.some(args => args[0]?.join() === '10,10')));
				assert.ok(u.ctx.log.some(([op, ...values]) => op === 'fillStyle' && values.includes('rgba(50,116,217,0.08)')));
			}
			const legend = u.root.querySelector('.u-legend');
			if (i === 0) assert.deepEqual(texts(legend, '.u-label'), labels.slice(5));
			else assert.equal(legend, null);
			const legendText = legend?.textContent;
			u.setCursor({left: u.valToPos(start + 30, 'x'), top: 80});
			const tooltip = u.over.querySelector('.u-tooltip');
			assert.equal(tooltip.querySelector('thead').textContent, '2021-07-14 01:08:30 UTC');
			assert.deepEqual(texts(tooltip, 'tbody .u-label'), selected.map(si => labels[si]));
			assert.deepEqual(texts(tooltip, 'tbody .u-value'), selected.map(si => values[si]));
			assert.equal(tooltip.querySelector('.u-marker'), null);
			assert.equal(legend?.textContent, legendText);
		}
	});

	for (const ratio of [1, 2]) {
		it(`synchronizes column hover and leave without canvas repaint at DPR ${ratio}`, async () => {
			mount();
			for (const u of plots) u.setPxRatio(ratio);
			await Promise.resolve();
			const painted = plots.map(u => structuredClone(u.ctx.log));
			for (const u of plots) {
				assert.equal(band(u).style.display, 'none');
				assert.equal(band(u).style.backgroundColor, 'rgba(128, 128, 128, 0.2)');
				assert.equal(u.root.querySelector('.u-cursor-x, .u-cursor-y, .u-cursor-pt'), null);
			}
			for (const idx of [1, 3, 4]) {
				plots[0].setCursor({left: plots[0].valToPos(start + idx * 30, 'x'), top: 80}, true, true);
				await Promise.resolve();
				for (const u of plots) {
					assert.equal(u.cursor.idx, idx);
					assertBand(u);
				}
			}
			plots[0].setCursor({left: -10, top: -10}, true, true);
			await Promise.resolve();
			for (const [i, u] of plots.entries()) {
				assert.equal(band(u).style.display, 'none');
				assert.deepEqual(u.ctx.log, painted[i], 'hover and leave do not paint');
			}
		});
	}

	it('refreshes a stationary highlight on resize, zoom, replacement and empty data', async () => {
		mount();
		await Promise.resolve();
		for (const u of plots) {
			u.setCursor({left: u.valToPos(start + 90, 'x'), top: 80});
			for (const update of [() => u.setSize({width: 900, height: 420}), () => u.setScale('x', {min: start, max: start + 150})]) {
				const width = band(u).style.width;
				update();
				await Promise.resolve();
				assertBand(u);
				assert.notEqual(band(u).style.width, width);
			}
			const idx = u.cursor.idx, transform = band(u).style.transform;
			const replacement = fixture().data;
			replacement[0] = replacement[0].map(time => time + 5);
			u.setData(replacement, false);
			await Promise.resolve();
			assert.equal(u.cursor.idx, idx, 'same-index data replacement still refreshes the highlight');
			assertBand(u);
			assert.notEqual(band(u).style.transform, transform);
			u.setData(replacement.map(() => []), false);
			await Promise.resolve();
			assert.equal(band(u).style.display, 'none');
		}
	});

	it('uses tick-aware price/volume-only ranges, decimal labels and automatic axis sizing', async () => {
		mount(fixture(.01));
		await Promise.resolve();
		function check() {
			for (const u of plots.slice(0, 3)) {
				const sc = u.scales.y, axis = u.axes[1];
				assert.equal(sc.axis, 1);
				assert.equal(sc._axisY, true);
				assert.deepEqual([axis._splits[0], axis._splits.at(-1)], [sc.min, sc.max]);
				assert.deepEqual(axis._values, axis._splits.map(v => '$' + v.toFixed(uPlot.numDec(axis._splits))));
				assert.equal(new Set(axis._values).size, axis._values.length);
			}
			for (const u of plots) for (const axis of u.axes.slice(1).filter(axis => axis._show)) {
				assert.equal(axis.size, uPlot.autoAxisSize);
				assert.ok(Number.isFinite(axis._size));
				assert.ok(axis._size >= Math.max(...axis._labelWidths) + axis.gap + axis.ticks.size);
			}
			const combined = plots[0], volume = plots[3];
			assert.deepEqual([combined.scales.volume.min, combined.scales.volume.max], [0, combined.series[fields.volume].max * 7]);
			assert.equal(combined.scales.volume._axisY, false);
			assert.equal(volume.scales.volume.axis, 2);
			assert.equal(volume.scales.volume._axisY, true);
			assert.equal(volume.scales.volume.min, 0);
			assert.ok(volume.scales.volume.max >= volume.series[fields.volume].max);
			assert.equal(volume.axes[2]._splits.at(-1), volume.scales.volume.max);
		}
		check();
		const values = plots[0].axes[1].values, initialWidth = plots[0].axes[1]._size;
		assert.deepEqual(values(plots[0], [0, 1, 2, null]), ['$0', '$1', '$2', '']);
		assert.deepEqual(values(plots[0], [0, 1e-8, 2e-8, null]), ['$0.00000000', '$0.00000001', '$0.00000002', '']);
		for (const factor of [1e-8, 1e5]) {
			for (const u of plots) u.setData(fixture(factor).data);
			await Promise.resolve();
			check();
			assert.ok(plots[0].axes[1]._size > initialWidth, 'longer labels expand the axis');
		}
		for (const u of plots) {
			u.setPxRatio(2);
			u.setSize({width: 450, height: 320});
			u.setScale('x', {min: start + 30, max: start + 60});
		}
		await Promise.resolve();
		check();
	});

	it('resizes from each host observer and disconnects it on destroy', async () => {
		const original = globalThis.ResizeObserver, observers = [];
		try {
			globalThis.ResizeObserver = class {
				constructor(callback) { this.callback = callback; this.disconnects = 0; observers.push(this); }
				observe(target) { this.target = target; }
				disconnect() { this.disconnects++; }
			};
			mount();
			await Promise.resolve();
			const hosts = plots.map(u => observers.find(observer => observer.target === u.root.parentElement));
			assert.equal(new Set(hosts).size, 4);
			for (const [i, observer] of hosts.entries()) {
				observer.callback([{contentRect: {width: 731.9}}]);
				await Promise.resolve();
				assert.deepEqual([plots[i].width, plots[i].height], [731, 420]);
				observer.callback([{contentRect: {width: 0}}]);
				assert.equal(plots[i].width, 731);
			}
			destroyPlots();
			for (const observer of hosts) assert.equal(observer.disconnects, 1);
		}
		finally {
			try { destroyPlots(); }
			finally { globalThis.ResizeObserver = original; }
		}
	});
});
