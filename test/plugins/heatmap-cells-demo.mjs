import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { rangeY } from '../../src/rangeY.js';
import { timeAxisVals, timeAxisStamps, _timeAxisStampsS } from '../../src/opts.js';
import { generateHeatmapCells } from '../../demos/lib/heatmapCellsData.js';
import { createDemo } from '../../demos/heatmap-cells.js';

function createDemoRoot() {
	const html = readFileSync(new URL('../../demos/heatmap-cells.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function rectangles(u) {
	return u.ctx.log.slice(u.ctx.log.findLastIndex(entry => entry[0] == 'clearRect'))
		.filter(entry => entry[0] == 'fill').flatMap(entry => entry.slice(1))
		.flatMap(([path]) => path?.log?.filter(entry => entry[0] == 'rect').flatMap(entry => entry.slice(1)) ?? []);
}

// Normalize vertical coverage only; keep column widths, gaps, and overlaps observable.
function coverage(rectangles) {
	const result = [];
	for (const [x, y, w, h] of rectangles.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1])) {
		assert.ok(w > 0 && h > 0, 'drawn rectangles have positive area');
		const previous = result.at(-1);
		if (previous && previous[0] == x && previous[2] == w && previous[1] + previous[3] == y)
			previous[3] += h;
		else
			result.push([x, y, w, h]);
	}
	return result;
}

const colorModes = ['linear', 'sqrt', 'cbrt', 'log'];

// Count snapped transitions directly; do not use the production lookup table.
function approximateLogIndex(count, size, min, max) {
	if (min == max) return 0;
	const n = size - 1, logRange = Math.log(max) - Math.log(min), step = logRange / n;
	const base = 4 * n * n, range = Math.expm1(logRange);
	const minGap = Math.exp(step / 2) * Math.expm1(step) / range;
	const intervals = base * Math.max(1, Math.ceil(1 / minGap / base)) * 4;
	assert.ok(intervals <= 2 ** 24);
	const j = Math.floor((count - min) * (intervals / (max - min)));
	let color = 0;
	for (let i = 0; i < n; i++)
		if (Math.ceil(Math.expm1(step * (i + .5)) / range * intervals) <= j) color++;
	const exact = Math.round(n * (Math.log(count) - Math.log(min)) / logRange);
	assert.ok(Math.abs(color - exact) <= 1, `${size} colors, count ${count}: approximate ${color}, exact ${exact}`);
	return color;
}

const nativeTimeValues = timeAxisVals(
	seconds => uPlot.tzDate(seconds * 1000, 'Etc/UTC'),
	timeAxisStamps(_timeAxisStampsS, uPlot.fmtDate),
);

function assertNativeTimeLabels(u) {
	const axis = u.axes[0];
	const [incr, space] = axis._found;
	assert.ok(axis._splits.length > 1);
	assert.deepEqual(axis._values, nativeTimeValues(u, axis._splits, 0, space, incr));
}

describe('heatmap cells demo', () => {
	for (const initial of [0, .5]) {
		it(`updates cell gaps in place from ${initial}px and retains them on plot recreation`, async () => {
			const root = createDemoRoot();
			const slider = root.querySelector('#cell-gap');
			const output = root.querySelector('#cell-gap-value').firstChild;
			assert.deepEqual([slider.min, slider.max, slider.step, slider.value, slider.disabled], ['0', '1', '0.25', '0', true]);
			slider.value = `${initial}`;
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [[60000, 60000, 120000, 120000], [1, 2, 1, 2], [2, 4, 2, 4], [1, 1, 1, 1]] } }];
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot, data = u.data, snapshot = structuredClone(data);
				const check = (u, gap) => {
					const canvas = u.root.querySelector('canvas');
					const sx = canvas.width / u.width, sy = canvas.height / u.height;
					const { left, top, width, height } = u.bbox;
					const px = v => Math.max(left, Math.min(left + width, Math.round(u.valToPos(v, 'x', true))));
					const py = v => Math.max(top, Math.min(top + height, Math.round(u.valToPos(v, 'y', true))));
					const [xs, lo, hi] = u.data[1];
					const expected = xs.map((x, i) => [px(x - 60) + gap * sx / 2, py(hi[i]) + gap * sy / 2,
						px(x) - px(x - 60) - gap * sx, py(lo[i]) - py(hi[i]) - gap * sy]);
					assert.deepEqual(coverage(rectangles(u)), coverage(expected));
					assert.equal(rectangles(u).length, gap == 0 ? 2 : 4, 'returning to zero restores adjacent-row merging');
				};
				assert.equal(slider.disabled, false);
				assert.equal(output.data, `${initial}px`);
				check(u, initial);
				u.setScale('x', { min: 15, max: 120 });
				await Promise.resolve();
				u.over.dispatchEvent(new MouseEvent('mouseenter'));
				u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(1.5, 'y') });
				const bounds = [u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max];
				const readout = root.querySelector('#hover').firstChild;
				const text = readout.data;
				for (const gap of [.25, .5, .75, 1, 0]) {
					slider.value = `${gap}`;
					slider.dispatchEvent(new Event('input'));
					await Promise.resolve();
					assert.equal(demo.plot, u);
					assert.equal(u.data, data);
					assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], bounds);
					assert.equal(root.querySelector('#cell-gap-value').firstChild, output);
					assert.equal(output.data, `${gap}px`);
					assert.equal(u.cursor.idxs[1], 0);
					assert.equal(root.querySelector('#hover').firstChild, readout);
					assert.equal(readout.data, text);
					check(u, gap);
				}
				assert.deepEqual(data, snapshot);
				slider.value = '.75';
				slider.dispatchEvent(new Event('input'));
				await Promise.resolve();
				const yScale = root.querySelector('#y-scale');
				yScale.value = 'linear';
				yScale.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.notEqual(demo.plot, u);
				check(demo.plot, .75);
				const latest = demo.plot;
				demo.destroy();
				demo = null;
				assert.equal(slider.disabled, true);
				latest.redraw = () => assert.fail('gap listener must be removed on destroy');
				slider.value = '0';
				slider.dispatchEvent(new Event('input'));
				assert.equal(output.data, '0.75px');
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('maps both sides of every cube root threshold for all palette sizes', async () => {
		for (let size = 11; size <= 32; size++) {
			const root = createDemoRoot();
			root.querySelector('#color-count').value = `${size}`;
			root.querySelector('#color-scale').value = 'cbrt';
			const counts = [1, 64];
			const indices = [0, size - 1];
			for (let i = 0; i < size - 1; i++) {
				const t = ((i + .5) / (size - 1)) ** 3;
				// Stay clear of floating-point ties while testing both adjacent colors.
				counts.push(1 + 63 * (t - 1e-12), 1 + 63 * (t + 1e-12));
				indices.push(i, i + 1);
			}
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [counts.map((_, i) => (i + 1) * 60000), counts.map(() => 1), counts.map(() => 2), counts] } }];
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				const start = u.ctx.log.length;
				u.hooks.draw[0](u);
				const paths = u.ctx.log.slice(start).filter(e => e[0] == 'fill').flatMap(e => e.slice(1)).map(([path]) => path);
				const expected = Array.from({ length: size }, () => []);
				indices.forEach((color, i) => expected[color].push(Math.round(u.valToPos(i * 60, 'x', true))));
				assert.equal(paths.length, size);
				paths.forEach((path, color) => {
					const xs = path.log.filter(e => e[0] == 'rect').flatMap(e => e.slice(1)).map(rect => rect[0]);
					assert.deepEqual(xs, expected[color], `${size} colors, palette index ${color}`);
				});
			}
			finally { demo?.destroy(); root.remove(); }
		}
	});

	it('maps approximate log transitions at their snapped left endpoints for every palette size', async () => {
		for (let size = 11; size <= 32; size++) {
			const min = 1, max = 64, n = size - 1, logRange = Math.log(max), step = logRange / n;
			const base = 4 * n * n, range = Math.expm1(logRange);
			const minGap = Math.exp(step / 2) * Math.expm1(step) / range;
			const intervals = base * Math.max(1, Math.ceil(1 / minGap / base)) * 4;
			const counts = [min, max];
			for (let i = 0; i < n; i++) {
				const threshold = Math.expm1(step * (i + .5)) / range;
				const snapped = Math.ceil(threshold * intervals);
				// Include the delayed transition and a point between the exact and snapped edges.
				counts.push(...[
					threshold * intervals - 1e-7, threshold * intervals + 1e-7,
					snapped - 1e-7, snapped, snapped + 1e-7, (threshold * intervals + snapped) / 2,
				].map(j => min + (max - min) * j / intervals));
			}
			const indices = counts.map(count => approximateLogIndex(count, size, min, max));
			const root = createDemoRoot();
			root.querySelector('#color-count').value = `${size}`;
			root.querySelector('#color-scale').value = 'log';
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [counts.map((_, i) => (i + 1) * 60000), counts.map(() => 1), counts.map(() => 2), counts] } }];
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot, start = u.ctx.log.length;
				assert.equal(root.querySelector('#color-scale').value, 'log');
				u.hooks.draw[0](u);
				const paths = u.ctx.log.slice(start).filter(e => e[0] == 'fill').flatMap(e => e.slice(1)).map(([path]) => path);
				const expected = Array.from({ length: size }, () => []);
				indices.forEach((color, i) => expected[color].push(Math.round(u.valToPos(i * 60, 'x', true))));
				assert.equal(paths.length, size);
				paths.forEach((path, color) => {
					const xs = path.log.filter(e => e[0] == 'rect').flatMap(e => e.slice(1)).map(rect => rect[0]);
					assert.deepEqual(xs, expected[color], `${size} colors, approximate palette index ${color}`);
				});
			}
			finally { demo?.destroy(); root.remove(); }
		}
	});

	for (const constant of [false, true]) {
		it(`resizes the palette from 32 to 11 and back with ${constant ? 'constant' : 'varying'} counts`, async () => {
			const root = createDemoRoot();
			const slider = root.querySelector('#color-count');
			const output = root.querySelector('#color-count-value').firstChild;
			assert.deepEqual([slider.min, slider.max, slider.step, slider.value, slider.disabled], ['11', '32', '1', '24', true]);
			if (constant) slider.value = '11';
			const counts = constant ? [3, 3, 3, 3] : [1, 2, 3, 5, 8, 13, 21, 34, 55, 64];
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [counts.map((_, i) => (i + 1) * 60000), counts.map(() => 1), counts.map(() => 2), counts] } }];
			const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142']
				.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot, data = u.data, snapshot = structuredClone(data);
				assert.equal(slider.disabled, false);
				assert.equal(output.data, slider.value);
				u.setScale('x', { min: 15, max: counts.length * 60 - 15 });
				await Promise.resolve();
				const scales = [u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max];
				const paint = (plot = u) => {
					const start = plot.ctx.log.length;
					plot.hooks.draw[0](plot);
					const log = plot.ctx.log.slice(start);
					return {
						colors: log.filter(e => e[0] == 'fillStyle').map(e => e[1]),
						paths: log.filter(e => e[0] == 'fill').flatMap(e => e.slice(1)).map(([path]) => path),
					};
				};
				for (const size of [...Array.from({ length: 22 }, (_, i) => 32 - i), 20, 32]) {
					slider.value = `${size}`;
					slider.dispatchEvent(new Event('input'));
					await Promise.resolve();
					assert.equal(root.querySelector('#color-count-value').firstChild, output);
					assert.equal(output.data, `${size}`);
					const expectedPalette = Array.from({ length: size }, (_, i) => {
						const t = i / (size - 1) * 10, lo = Math.min(Math.floor(t), 9);
						return `rgb(${stops[lo].map((v, c) => Math.round(v + (stops[lo + 1][c] - v) * (t - lo))).join(',')})`;
					});
					for (const mode of colorModes) {
						const select = root.querySelector('#color-scale');
						select.value = mode;
						select.dispatchEvent(new Event('change'));
						await Promise.resolve();
						const { colors, paths } = paint();
						assert.deepEqual(colors, expectedPalette);
						assert.equal(paths.length, size, 'no stale paths after shrinking or growing');
						const expectedCounts = new Array(size).fill(0);
						for (const count of counts) {
							const t = constant ? 0 : (count - 1) / 63;
							const index = (mode == 'sqrt' ? Math.sqrt(t) : mode == 'cbrt' ? Math.cbrt(t) : t) * (size - 1);
							expectedCounts[mode == 'log' ? approximateLogIndex(count, size, constant ? 3 : 1, constant ? 3 : 64) : Math.round(index)]++;
						}
						assert.deepEqual(paths.map(path => path.log.filter(e => e[0] == 'rect').reduce((n, e) => n + e.length - 1, 0)), expectedCounts);
						const ramp = root.querySelector('#color-ramp').style.background;
						assert.equal(Array.from(ramp.matchAll(/rgb\(/g)).length, constant ? 1 : size);
						if (!constant) {
							const legendStops = Array.from(ramp.matchAll(/(rgb\([^)]+\))\s+([\d.e+-]+)%/g));
							assert.deepEqual(legendStops.map(stop => stop[1].replace(/\s/g, '')), expectedPalette);
							const positions = legendStops.map(stop => Number(stop[2]) / 100);
							assert.equal(positions[0], 0);
							assert.equal(positions.at(-1), 1);
							positions.forEach((pos, i) => {
								const t = i / (size - 1);
								const expected = mode == 'sqrt' ? t ** 2 : mode == 'cbrt' ? t ** 3 : mode == 'log' ? (64 ** t - 1) / 63 : t;
								assert.ok(Math.abs(pos - expected) < 1e-12, `${mode}, ${size} colors, legend stop ${i}`);
								if (i > 0) assert.ok(pos > positions[i - 1]);
							});
						}
						assert.equal(demo.plot, u);
						assert.equal(u.data, data);
						assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], scales);
						u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(1.5, 'y') });
						assert.equal(u.cursor.idxs[1], 0);
					}
				}
				assert.deepEqual(data, snapshot);
				slider.value = '11';
				slider.dispatchEvent(new Event('input'));
				await Promise.resolve();
				assert.deepEqual(paint().colors, stops.map(rgb => `rgb(${rgb.join(',')})`), '11 colors reproduce the original stops exactly');
				const signed = root.querySelector('#signed-data');
				signed.checked = true;
				signed.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.equal(slider.value, '11');
				assert.deepEqual(paint(demo.plot).colors, stops.map(rgb => `rgb(${rgb.join(',')})`));
				const latest = demo.plot;
				demo.destroy();
				demo = null;
				assert.equal(slider.disabled, true);
				latest.redraw = () => assert.fail('palette listener must be removed');
				slider.value = '32';
				slider.dispatchEvent(new Event('input'));
				assert.equal(output.data, '11');
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('selects the heatmap frame and resolves reordered fields by name', async () => {
		const frames = [
			{ schema: { meta: { type: 'other' } } },
			{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'count' }, { name: 'yMax' }, { name: 'xMax', config: { interval: 60000 } },
				{ name: 'yLayout' }, { name: 'yMin' },
			] }, data: { values: [[1, 2, 3, 4], [2, 4, 2, 8], [60000, 60000, 120000, 120000], [0, 0, 0, 0], [1, 2, 1, 4]] } },
		];
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			assert.deepEqual(demo.plot.data, [null, [[60, 60, 120, 120], [1, 2, 1, 4], [2, 4, 2, 8], [1, 2, 3, 4]]]);
			assert.equal(demo.plot.data[1][3], frames[1].data.values[0]);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const [seconds, label] of [[60, 'one-minute'], [1200, '20-minute'], [30, '30-second'], [90, '90-second'], [.5, '0.5-second']]) {
		it(`labels ${seconds}-second intervals accurately`, async () => {
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: seconds * 1000 } },
				{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [[seconds * 1000, seconds * 2000], [1, 1], [2, 2], [3, 4]] } }];
			const root = createDemoRoot();
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				assert.equal(root.querySelector('#status').textContent,
					`2 cells · 2 ${label} intervals · log₂ Y · uniform-grid hover · no densification or exemplars`);
				if (seconds == 60) {
					const u = demo.plot;
					assertNativeTimeLabels(u);
					assert.deepEqual(u.axes[0].values(u, [0, 60], 0, 50, 60), ['12:00am\n1/1/70', '12:01am']);
					u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(1.5, 'y') });
					assert.equal(root.querySelector('#hover').textContent, '12:00am 1/1/70–12:01am UTC · Y: 1 s–2 s · Count: 3');
				}
				const u = demo.plot;
				u.setCursor({ left: u.valToPos(seconds / 2, 'x'), top: u.valToPos(1.5, 'y') });
				const timeRange = nativeTimeValues(u, [0, seconds], 0, 0, seconds).join('–').replace(/\n/g, ' ');
				assert.equal(root.querySelector('#hover').textContent, `${timeRange} UTC · Y: 1 s–2 s · Count: 3`);
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('switches log bases without changing cells or colors and snaps log10 bounds to decades', async () => {
		const root = createDemoRoot();
		const select = root.querySelector('#y-scale');
		select.value = 'log10';
		root.querySelector('#color-scale').value = 'sqrt';
		const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'xMax', config: { interval: 60000 } },
			{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
		] }, data: { values: [[60000, 60000], [.125, 8], [.25, 16], [3, 4]] } }];
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const data = demo.plot.data, original = structuredClone(data);
			for (const [mode, base, bounds, label] of [
				['log10', 10, [.1, 100], 'log₁₀'],
				['log', 2, [.125, 16], 'log₂'],
				['log10', 10, [.1, 100], 'log₁₀'],
			]) {
				select.value = mode;
				select.dispatchEvent(new Event('change'));
				await Promise.resolve();
				const u = demo.plot;
				assert.equal(u.scales.y.distr, 3);
				assert.equal(u.scales.y.log, base);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], bounds);
				assert.equal(u.data, data);
				assert.deepEqual(data, original);
				assert.equal(root.querySelector('#color-scale').value, 'sqrt');
				assert.ok(root.querySelector('#status').textContent.includes(`${label} Y`));
				assert.equal(rectangles(u).length, 2);
				u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(.1875, 'y') });
				assert.ok(root.querySelector('#hover').textContent.endsWith('Y: 125 ms–250 ms · Count: 3'));
				u.setSize({ width: 777, height: 640 });
				u.setScale('y', { min: .2, max: 10 });
				await Promise.resolve();
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [.2, 10]);
				root.querySelector('#set-data').click();
				await Promise.resolve();
				assert.deepEqual([u.scales.y.min, u.scales.y.max], bounds);
				assert.deepEqual([u.width, u.height], [777, 640]);
				assert.equal(u.scales.y._axisY, false, 'log scales do not use linear tick-aware ranging');
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const initialMode of colorModes) {
		it(`positions legend colors on a linear count domain, starting with ${initialMode}`, async () => {
			const root = createDemoRoot();
			const select = root.querySelector('#color-scale');
			select.value = initialMode;
			const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
				{ name: 'xMax', config: { interval: 60000 } },
				{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
			] }, data: { values: [[60000, 120000], [1, 1], [2, 2], [1, 100]] } }];
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				const ramp = root.querySelector('#color-ramp');
				let colors;
				for (const mode of [initialMode, ...colorModes, 'linear']) {
					if (colors != null) {
						select.value = mode;
						select.dispatchEvent(new Event('change'));
						await Promise.resolve();
					}
					const stops = Array.from(ramp.style.background.matchAll(/(rgb\([^)]+\))\s+([\d.e+-]+)%/g));
					assert.equal(stops.length, 24);
					const positions = stops.map(stop => Number(stop[2]) / 100);
					assert.equal(positions[0], 0);
					assert.equal(positions.at(-1), 1);
					positions.forEach((pos, i) => {
						const t = mode == 'sqrt' ? Math.sqrt(pos) : mode == 'cbrt' ? Math.cbrt(pos) :
							mode == 'log' ? Math.log(1 + 99 * pos) / Math.log(100) : pos;
						assert.ok(Math.abs(t - i / 23) < 1e-12, `${mode} palette stop ${i}`);
						if (i > 0) assert.ok(pos > positions[i - 1]);
					});
					colors ??= stops.map(stop => stop[1]);
					assert.deepEqual(stops.map(stop => stop[1]), colors);
					assert.equal(root.querySelector('#color-min').textContent, '1');
					assert.equal(root.querySelector('#color-max').textContent, '100');
					assert.equal(demo.plot, u, 'changing the legend does not recreate the plot');
				}
				const background = ramp.style.background;
				const yScale = root.querySelector('#y-scale');
				yScale.value = 'linear';
				yScale.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.equal(ramp.style.background, background, 'Y scale does not affect the count legend');
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('uses a single legend color for a constant count domain in all color scales', async () => {
		const root = createDemoRoot();
		const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'xMax', config: { interval: 60000 } },
			{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
		] }, data: { values: [[60000], [1], [2], [3]] } }];
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			for (const mode of colorModes) {
				const select = root.querySelector('#color-scale');
				select.value = mode;
				select.dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.equal(root.querySelector('#color-ramp').style.background.replace(/\s/g, ''), 'rgb(94,79,162)');
				assert.equal(root.querySelector('#color-min').textContent, '3');
				assert.equal(root.querySelector('#color-max').textContent, '3');
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('formats duration ticks and matches tick strokes to gridlines across Y scales', async () => {
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, generateHeatmapCells({ columns: 2 }));
			await Promise.resolve();
			const splits = [null, -2, -.25, -.001, -1e-6, -0, 0, 1e-9, 1e-6, .000125, .0009765625, .001, .125, 1, 1.23456, 12];
			const expected = [null, '-2 s', '-250 ms', '-1 ms', '-1 µs', '0 s', '0 s', '0.001 µs', '1 µs', '125 µs', '977 µs', '1 ms', '125 ms', '1 s', '1.23 s', '12 s'];
			for (const mode of ['log', 'log10', 'linear', 'asinh']) {
				const select = root.querySelector('#y-scale');
				select.value = mode;
				select.dispatchEvent(new Event('change'));
				await Promise.resolve();
				const u = demo.plot;
				assert.deepEqual(u.axes[1].values(u, splits), expected);
				for (let i = 0; i < u.axes.length; i++) {
					const axis = u.axes[i];
					assert.equal(axis.ticks.width, axis.grid.width);
					assert.equal(axis.ticks.stroke(u, i), axis.grid.stroke(u, i));
					const [incr, space] = axis._found;
					assert.deepEqual(axis.ticks.filter(u, axis._splits, i, space, incr), axis.grid.filter(u, axis._splits, i, space, incr));
				}
			}
			root.querySelector('#signed-data').click();
			await Promise.resolve();
			const labels = demo.plot.axes[1]._values.filter(v => v != null);
			assert.ok(labels.some(v => v.startsWith('-')));
			assert.ok(labels.includes('0 s'));
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('refreshes the active range and formats hover bounds across units and mirrored data', async () => {
		const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'xMax', config: { interval: 60000 } },
			{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
		] }, data: { values: [[60000], [.0005], [.001], [3]] } }];
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const select = root.querySelector('#y-scale');
			const hover = (y, expected) => {
				const u = demo.plot;
				u.setCursor({ left: u.valToPos(30, 'x'), top: u.valToPos(y, 'y') });
				assert.ok(root.querySelector('#hover').textContent.endsWith(` · Y: ${expected} · Count: 3`));
			};
			for (const mode of ['log', 'log10', 'linear', 'asinh', 'log']) {
				select.value = mode;
				select.dispatchEvent(new Event('change'));
				await Promise.resolve();
				const u = demo.plot;
				for (const [lo, hi, label] of [[.0005, .001, '500 µs–1 ms'], [.5, 1, '500 ms–1 s']]) {
					u.setData([null, [[60], [lo], [hi], [3]]]);
					await Promise.resolve();
					const linear = rangeY(0, hi, u.bbox.height / u.pxRatio);
						assert.deepEqual([u.scales.y.min, u.scales.y.max], mode.startsWith('log') ? uPlot.rangeLog(lo, hi, mode == 'log10' ? 10 : 2, true) :
							mode == 'asinh' ? uPlot.rangeAsinh(0, hi, 2, true) : [linear.min, linear.max]);
					assert.equal(rectangles(u).length, 1);
					hover((lo + hi) / 2, label);
				}
			}
			root.querySelector('#signed-data').click();
			await Promise.resolve();
			assert.equal(select.value, 'asinh');
			assert.deepEqual([demo.plot.scales.y.min, demo.plot.scales.y.max], uPlot.rangeAsinh(-.001, .001, 2, true));
			assert.equal(rectangles(demo.plot).length, 2);
			hover(-.00075, '-1 ms–-500 µs');
			hover(.00075, '500 µs–1 ms');
			root.querySelector('#signed-data').click();
			await Promise.resolve();
			select.value = 'log';
			select.dispatchEvent(new Event('change'));
			await Promise.resolve();
			assert.deepEqual([demo.plot.scales.y.min, demo.plot.scales.y.max], uPlot.rangeLog(.0005, .001, 2, true));
			hover(.00075, '500 µs–1 ms');
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('snaps asinh ranges to magnitudes and keeps outer gridlines beyond every cell', async () => {
		const root = createDemoRoot();
		root.querySelector('#y-scale').value = 'asinh';
		const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'xMax', config: { interval: 60000 } },
			{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
		] }, data: { values: [[60000, 60000], [2 ** -17, 2 ** 3.625], [2 ** -16.875, 2 ** 3.75], [1, 2]] } }];
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			for (const signed of [false, true]) {
				if (signed) {
					root.querySelector('#signed-data').click();
					await Promise.resolve();
				}
				const u = demo.plot;
				for (const height of [200, 560, 1200]) {
					u.setSize({ width: 1000, height });
					await Promise.resolve();
					assert.deepEqual([u.scales.y.min, u.scales.y.max], [signed ? -16 : 0, 16]);
					const axis = u.axes[1], [incr, space] = axis._found;
					const ticks = axis.grid.filter(u, axis._splits, 1, space, incr).filter(v => v != null);
					assert.equal(ticks[0], signed ? -16 : 0);
					assert.equal(ticks.at(-1), 16);
					assert.ok(u.data[1][1].every(v => v >= ticks[0]));
					assert.ok(u.data[1][2].every(v => v <= ticks.at(-1)));
				}
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('uses tick-aware linear bounds through resize, signed data, zoom, and reset', async () => {
		const root = createDemoRoot();
		root.querySelector('#y-scale').value = 'linear';
		const frames = [{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'xMax', config: { interval: 60000 } },
			{ name: 'yMin' }, { name: 'yMax' }, { name: 'count' },
		] }, data: { values: [[60000], [8], [16], [3]] } }];
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			for (const signed of [false, true]) {
				if (signed) {
					root.querySelector('#signed-data').click();
					await Promise.resolve();
				}
				const u = demo.plot;
				const check = () => {
					const expected = rangeY(signed ? -16 : 0, 16, u.bbox.height / u.pxRatio);
					assert.deepEqual([u.scales.y.min, u.scales.y.max], [expected.min, expected.max]);
					assert.deepEqual([u.axes[1]._splits[0], u.axes[1]._splits.at(-1)], [expected.min, expected.max]);
					assert.ok(expected.min <= (signed ? -16 : 0) && expected.max >= 16);
					assert.equal(rectangles(u).length, signed ? 2 : 1);
				};
				let scans = 0;
				const scan = u.scales.y.scan;
				u.scales.y.scan = (...args) => { scans++; return scan(...args); };
				for (const height of [200, 560, 1200, 560]) {
					u.setSize({ width: 1000, height });
					await Promise.resolve();
					check();
				}
				assert.equal(scans, 0, 'resize reuses prepared bounds');
				u.setScale('y', { min: 7, max: 10 });
				await Promise.resolve();
				u.setSize({ width: 800, height: 400 });
				await Promise.resolve();
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [7, 10]);
				u.setScale('y', { min: null, max: null });
				await Promise.resolve();
				check();
				root.querySelector('#set-data').click();
				await Promise.resolve();
				check();

				const raw = u.scales.y._rawY.slice();
				const beforeScans = scans;
				u.setData([null, [[60], [32], [64], [3]]], false);
				assert.deepEqual(u.scales.y._rawY, raw, 'deferred preparation must not mutate captured scan bounds');
				u.setSize({ width: 800, height: 600 });
				u.redraw(false, true);
				await Promise.resolve();
				const retained = rangeY(...raw, u.bbox.height / u.pxRatio);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [retained.min, retained.max]);
				assert.equal(scans, beforeScans, 'layout alone does not request replacement bounds');
				u.redraw();
				await Promise.resolve();
				assert.deepEqual(u.scales.y._rawY, [0, 64]);
				const replaced = rangeY(0, 64, u.bbox.height / u.pxRatio);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [replaced.min, replaced.max]);
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const xGapProbability of [.5, 1]) {
		it(`keeps generated column gaps empty through zoom and setData (p=${xGapProbability})`, async function() {
			this.timeout(15000);
			const options = { seed: 1, columns: 16, start: 0, interval: 60000 };
			// Keep adjacent dense buckets and sparse fast buckets without a quadratic full-Y oracle.
			const buckets = new Set([-84, -83, -60, -59, -58, -57].map(exponent => 2 ** (exponent / 8)));
			const selectBuckets = values => values.map(facet => facet.filter((_, i) => buckets.has(values[1][i])));
			const frames = generateHeatmapCells({ ...options, xGapProbability });
			const source = frames[0].data.values = selectBuckets(frames[0].data.values);
			const full = selectBuckets(generateHeatmapCells(options)[0].data.values);
			assert.equal(new Set(full[1]).size, buckets.size);
			assert.ok(full[0].length < options.columns * buckets.size, 'retained buckets include missing Y cells');
			const present = new Set(source[0]);
			const missing = Array.from({ length: options.columns }, (_, col) => col)
				.filter(col => !present.has((col + 1) * options.interval));
			assert.deepEqual(missing, xGapProbability == .5 ? [1, 2, 9, 10, 14] : Array.from({ length: 14 }, (_, i) => i + 1));
			assert.deepEqual(source, full.map(values => values.filter((_, i) => present.has(full[0][i]))));
			const root = createDemoRoot();
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 960]);
				assert.ok(root.querySelector('#status').textContent.startsWith(`${source[0].length.toLocaleString()} cells · 16 one-minute intervals`));

				function check() {
					const { left, top, width, height } = u.bbox;
					const px = v => Math.max(left, Math.min(left + width, Math.round(u.valToPos(v, 'x', true))));
					const py = v => Math.max(top, Math.min(top + height, Math.round(u.valToPos(v, 'y', true))));
					// Project source bounds independently of the plugin's grid and color-grouped paths.
					const boxes = source[0].map((time, id) => {
						const x = px(time / 1000 - 60), y = py(source[2][id]);
						return { id, rect: [x, y, px(time / 1000) - x, py(source[1][id]) - y] };
					}).filter(({ rect: [, , w, h] }) => w > 0 && h > 0);
					const drawn = rectangles(u);
					assert.deepEqual(coverage(drawn), coverage(boxes.map(b => b.rect)));
					const hit = (x, y, expected) => {
						u.setCursor({ left: (x - left) / u.pxRatio, top: (y - top) / u.pxRatio });
						assert.equal(u.cursor.dataIdx(u, 1), expected, `canvas (${x}, ${y})`);
					};
					const matches = (x, y) => boxes.filter(({ rect: [l, t, w, h] }) => x >= l && x <= l + w && y >= t && y <= t + h);
					let shared = 0, fallback = 0;
					for (const { id, rect: [x, y, w, h] } of boxes) {
						hit(x + w / 2, y + h / 2, id);
						// Rounded canvas bounds are inclusive; the last matching source wins.
						for (const delta of [-.25, 0, .25]) {
							for (const [qx, qy] of [[x + delta, y + h / 2], [x + w + delta, y + h / 2],
								[x + w / 2, y + delta], [x + w / 2, y + h + delta]]) {
								if (qx >= left && qx <= left + width && qy >= top && qy <= top + height)
									hit(qx, qy, matches(qx, qy).at(-1)?.id ?? null);
							}
						}
						const edge = matches(x + w, y + h / 2);
						if (edge.some(b => source[0][b.id] > source[0][id])) {
							assert.ok(edge.at(-1).id > id, 'later column wins the shared edge');
							shared++;
						}
						if (missing.includes(source[0][id] / options.interval) && x + w < left + width) {
							hit(x + w, y + h / 2, id);
							hit(x + w + .25, y + h / 2, null);
							fallback++;
						}
					}
					if (xGapProbability == .5) assert.ok(shared > 0, 'probed shared edges of retained columns');
					if (u.scales.x.min == 0 || xGapProbability == .5) assert.ok(fallback > 0, 'earlier cell still hits at an edge bordering a gap');
					let gaps = 0;
					for (const col of missing) {
						if (col * 60 < u.scales.x.min || (col + 1) * 60 > u.scales.x.max) continue;
						const l = px(col * 60), r = px((col + 1) * 60);
						assert.ok(drawn.every(([x, , w]) => x + w <= l || x >= r), `no paint inside column ${col}`);
						// Use occupied ungapped buckets so misses cannot be explained by sparse Y rows.
						full[0].forEach((time, i) => {
							if (time == (col + 1) * options.interval)
								hit((l + r) / 2, (py(full[1][i]) + py(full[2][i])) / 2, null);
						});
						gaps++;
					}
					assert.ok(gaps > 1, 'probed multiple absent columns');
				}

				check();
				u.setScale('x', { min: 7 * 60, max: 16 * 60 });
				await Promise.resolve();
				check();
				root.querySelector('#set-data').click();
				await Promise.resolve();
				check();
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('renders all generated source cells with the existing controls', async function() {
		this.timeout(15000);
		// Keep a month-long date range; the plugin suite covers the 250k-cell smoke test.
		const frames = generateHeatmapCells({ columns: 64, interval: 12 * 60 * 60 * 1000 });
		const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
		const values = name => frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const u = demo.plot, xs = values('xMax');
			assert.equal(new Set(xs).size, 64);
			const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
			const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
			const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
			const minY = values('yMin').reduce((a, b) => Math.min(a, b), Infinity);
			const maxY = values('yMax').reduce((a, b) => Math.max(a, b), -Infinity);
			assert.deepEqual(u.data[1].map(facet => facet.length), [xs.length, xs.length, xs.length, xs.length]);
			assert.equal(u.data[1][1], values('yMin'));
			assert.equal(u.data[1][2], values('yMax'));
			assert.equal(u.data[1][3], values('count'));
			assert.deepEqual(u.data[1][0], xs.map(x => x / 1000));
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [minX / 1000 - interval / 1000, maxX / 1000]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], uPlot.rangeLog(minY, maxY, 2, true));
			assert.ok(root.querySelector('#status').textContent.startsWith(`${xs.length.toLocaleString()} cells · 64 720-minute intervals`));
			const start = u.scales.x.min, end = u.scales.x.max;
			assertNativeTimeLabels(u);
			for (const control of root.querySelectorAll('select, input, button')) assert.equal(control.disabled, false);
			const drawn = rectangles(u);
			assert.ok(drawn.length > 0);
			const [x, y, w, h] = drawn[Math.floor(drawn.length / 2)];
			u.setCursor({ left: (x + w / 2 - u.bbox.left) / u.pxRatio, top: (y + h / 2 - u.bbox.top) / u.pxRatio });
			assert.notEqual(u.cursor.dataIdx(u, 1), null);
			root.querySelector('#set-data').click();
			await Promise.resolve();
			assert.deepEqual(rectangles(u), drawn);
			for (const span of [86400, 86399, 3600, 60, 1]) {
				u.setScale('x', { min: start, max: start + span });
				await Promise.resolve();
				assertNativeTimeLabels(u);
			}
			u.setScale('x', { min: start, max: end });
			await Promise.resolve();
			assertNativeTimeLabels(u);
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
