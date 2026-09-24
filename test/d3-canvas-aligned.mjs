import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import { createDemo } from '../demos/axis-range-aligned.js';
import { createD3CanvasAligned } from '../demos/lib/d3CanvasAligned.js';
import { rangeY, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits, numAxisVals } from '../src/opts.js';

const html = await readFile(new URL('../demos/axis-range-aligned.html', import.meta.url), 'utf8');

// Wiring spy only: nice() is a no-op and ticks() returns domain endpoints.
// tickFormat() returns distinct labels, not D3's numeric formatting.
// These tests do not implement or validate D3's numeric tick/nice algorithms.
// Custom mode checks shared uPlot helpers and parity with the unzoomed demo,
// including canvas label positions, not browser rendering or zoom synchronization.
function createD3Spy() {
	const scales = [], extents = [], lines = [];
	return {
		scales, extents, lines,
		extent(values) {
			extents.push(values);
			const finite = values.filter(Number.isFinite);
			return [Math.min(...finite), Math.max(...finite)];
		},
		scaleLinear() {
			const calls = { id: scales.length, domain: null, range: null, nice: [], ticks: [], tickFormat: [], formatted: [] };
			scales.push(calls);
			const scale = value => {
				const [min, max] = calls.domain;
				const [start, end] = calls.range;
				return start + (max === min ? .5 : (value - min) / (max - min)) * (end - start);
			};
			scale.domain = values => {
				if (values === undefined)
					return calls.domain.slice();
				calls.domain = values.slice();
				return scale;
			};
			scale.range = values => { calls.range = values.slice(); return scale; };
			scale.nice = count => { calls.nice.push(count); return scale; };
			scale.ticks = count => { calls.ticks.push(count); return calls.domain.slice(); };
			scale.tickFormat = count => {
				calls.tickFormat.push(count);
				return value => {
					calls.formatted.push(value);
					return `scale${calls.id}:${count}:${value}`;
				};
			};
			return scale;
		},
		line() {
			let defined, x, y, context;
			const line = values => {
				const points = values.flatMap((value, i) => defined(value, i) ? [[x(value, i), y(value, i)]] : []);
				lines.push({ values, defined, context, points });
			};
			line.defined = value => { defined = value; return line; };
			line.x = value => { x = value; return line; };
			line.y = value => { y = value; return line; };
			line.context = value => { context = value; return line; };
			return line;
		},
	};
}

function assertDraw(d3, data, width, height, { ramp = 1, exact = false, useUplot = false } = {}, canvas, stats) {
	const [x, left, right] = d3.scales.slice(-3);
	const count = useUplot ? rangeYCount(height - 50, ramp) : Math.max(1, Math.floor((height - 50) / 50));
	const axes = [];
	assert.deepEqual(x.domain, [data[0][0], data[0].at(-1)]);
	assert.deepEqual(x.range, [100, width - 100]);
	assert.deepEqual(x.nice, []);
	assert.deepEqual(x.ticks, [10], 'X tick hint does not follow the Y ramp');
	assert.deepEqual(x.tickFormat, [10], 'X formatting hint does not follow the Y ramp');
	assert.deepEqual(x.formatted, x.domain);
	for (const [i, scale] of [left, right].entries()) {
		const finite = data[i + 1].filter(Number.isFinite);
		const extent = [Math.min(...finite), Math.max(...finite)];
		let domain = extent, ticks = extent;
		let labels = ticks.map(value => `scale${scale.id}:${count}:${value}`);
		if (useUplot) {
			const result = rangeY(...extent, height - 50, undefined, ramp, exact);
			assert.ok(result);
			domain = [result.min, result.max];
			ticks = result.count === 1 ? domain : numAxisSplits(null, i + 1, ...domain, result.incr, undefined, true);
			labels = numAxisVals(null, ticks, i + 1, undefined, result.incr);
		}
		axes.push({ domain, ticks, labels });
		assert.deepEqual(scale.domain, domain);
		assert.deepEqual(scale.range, [height - 40, 10]);
		assert.deepEqual(scale.nice, useUplot ? [] : [count], 'custom Y ranging must not call native nice');
		assert.deepEqual(scale.ticks, useUplot ? [] : [count], 'custom Y ranging must not call native ticks');
		assert.deepEqual(scale.tickFormat, useUplot ? [] : [count], 'custom Y ranging must not call native tickFormat');
		assert.deepEqual(scale.formatted, useUplot ? [] : scale.domain);
		assert.equal(d3.extents.at(-2 + i), data[i + 1]);
		const line = d3.lines.at(-2 + i);
		assert.equal(line.values, data[i + 1]);
		assert.equal(line.defined, Number.isFinite);
		assert.equal(line.context, canvas.getContext('2d'));
		assert.equal(line.points.length, finite.length);
		assert.ok(line.points.flat().every(Number.isFinite));
	}
	const log = canvas.getContext('2d').log;
	const labels = log.slice(log.findLastIndex(call => call[0] === 'scale'))
		.filter(call => call[0] === 'fillText')
		.flatMap(call => call.slice(1));
	const expectedLabels = axes.flatMap(axis => axis.labels).concat(x.domain.map(value => `scale${x.id}:10:${value}`));
	assert.deepEqual(labels.map(args => args[0]), expectedLabels, 'canvas receives every formatted tick label');
	let offset = 0;
	for (const [i, axis] of axes.entries()) {
		const [min, max] = axis.domain;
		const positions = axis.ticks.map(value => [i === 0 ? 92 : width - 92,
			height - 40 + (max === min ? .5 : (value - min) / (max - min)) * (50 - height)]);
		assert.deepEqual(labels.slice(offset, offset + axis.ticks.length).map(args => args.slice(1)), positions,
			'canvas positions correspond to the expected tick values');
		offset += axis.ticks.length;
	}
	assert.equal(canvas.width, Math.round(width * devicePixelRatio));
	assert.equal(canvas.height, Math.round(height * devicePixelRatio));
	assert.equal(canvas.style.width, `${width}px`);
	assert.equal(canvas.style.height, `${height}px`);
	assert.equal(stats.textContent.split('\n')[0], `Plot height: ${height - 50}px | ${useUplot ? 'uPlot ranging' : 'D3 nice()'} | tick count hint: ${count}`);
	for (const [i, key] of ['left', 'right'].entries())
		assert.match(stats.textContent, new RegExp(`${key}: ${axes[i].ticks.length} ticks`));
	return axes;
}

describe('D3 aligned canvas wiring (API spy, not D3 numeric algorithms)', () => {
	let root, chart, d3, d3Descriptor, contextDescriptor;
	const input = id => root.querySelector(`#${id}`);
	const canvas = () => input('d3-plot').querySelector('canvas');
	const assertCurrentDraw = (data, width, height, settings = {}) => {
		const axes = assertDraw(d3, data, width, height, settings, canvas(), input('d3-stats'));
		if (settings.useUplot && chart.axes) {
			assert.equal(chart.bbox.height / chart.pxRatio, height - 50);
			for (const [i, key] of ['left', 'right'].entries()) {
				assert.deepEqual(axes[i].domain, [chart.scales[key].min, chart.scales[key].max], `${key} bounds match uPlot`);
				assert.deepEqual(axes[i].ticks, chart.axes[i + 1]._splits, `${key} ticks match uPlot`);
				assert.deepEqual(axes[i].labels, chart.axes[i + 1]._values, `${key} labels match uPlot`);
			}
		}
	};

	beforeEach(() => {
		d3Descriptor = Object.getOwnPropertyDescriptor(globalThis, 'd3');
		d3 = createD3Spy();
		globalThis.d3 = d3;
		contextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
		// The shared canvas mock lacks these two APIs used by the D3 helper.
		HTMLCanvasElement.prototype.getContext = function(...args) {
			const ctx = contextDescriptor.value.apply(this, args);
			ctx.scale ??= (...values) => ctx.log.push(['scale', values]);
			ctx.rect ??= (...values) => ctx.log.push(['rect', values]);
			return ctx;
		};
		root = document.createElement('div');
		root.innerHTML = html.match(/<main\b[^]*?<\/main>/)[0];
		document.body.appendChild(root);
	});

	afterEach(() => {
		try {
			chart?.destroy();
			chart = null;
			root.remove();
		}
		finally {
			Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', contextDescriptor);
			if (d3Descriptor)
				Object.defineProperty(globalThis, 'd3', d3Descriptor);
			else
				delete globalThis.d3;
		}
	});

	it('defaults to native Y nice/ticks/tickFormat with a height-only hint and draws finite samples', () => {
		const data = [[0, 1, 2], [10, NaN, 30], [1000, 2000, 3000]];
		chart = createD3CanvasAligned(d3, input('d3-plot'), input('d3-stats'), data, { width: 900, height: 480 });
		assert.equal(d3.scales.length, 3);
		assert.equal(d3.extents.length, 2);
		assert.equal(input('d3-plot').children.length, 1);
		assertCurrentDraw(data, 900, 480);
		assert.ok(canvas().getContext('2d').log.some(call => call[0] === 'rect' && JSON.stringify(call[1]) === '[100,10,700,430]'));
	});

	it('defaults omitted exact to approximate custom ranging', () => {
		const data = [[0, 1, 2], [10, NaN, 30], [1000, 2000, 3000]];
		chart = createD3CanvasAligned(d3, input('d3-plot'), input('d3-stats'), data, { width: 900, height: 480 }, { useUplot: true });
		assertCurrentDraw(data, 900, 480, { useUplot: true });
		assert.deepEqual(d3.scales.slice(-2).map(scale => scale.domain), [[7.5, 32.5], [750, 3250]]);
		const before = d3.scales.length;
		chart.setRanging({ ramp: 1, exact: false, useUplot: true });
		assert.equal(d3.scales.length, before, 'explicit false matches the omitted default');
		chart.setRanging({ ramp: 1, exact: true, useUplot: true });
		assert.equal(d3.scales.length, before + 3);
		assertCurrentDraw(data, 900, 480, { exact: true, useUplot: true });
		assert.deepEqual(d3.scales.slice(-2).map(scale => scale.domain), [[0, 45], [0, 4500]]);
		assert.equal(d3.extents.length, 2, 'opting into exact mode reuses raw extents');
	});

	it('accepts custom ranging at creation and handles endpoint-only ranges and cached resizes', () => {
		const data = [[0, 1, 2], [-3, NaN, 7], [.0001, .0001, .0001]];
		const settings = { ramp: 0, exact: false, useUplot: true };
		chart = createD3CanvasAligned(d3, input('d3-plot'), input('d3-stats'), data, { width: 900, height: 480 }, settings);
		assertCurrentDraw(data, 900, 480, settings);
		for (const height of [60, 100, 463, 1050]) {
			chart.setSize({ width: 720, height });
			assertCurrentDraw(data, 720, height, settings);
			assert.equal(d3.extents.length, 2, 'custom resizes reuse raw extents');
		}
		const next = [[0, 1], [-20, -5], [0, 0]];
		chart.setData(next);
		assertCurrentDraw(next, 720, 1050, settings);
		assert.equal(d3.extents.length, 4);
	});

	it('stores inactive settings, toggles both ways, and refreshes extents only on setData', () => {
		const data = [[0, 1], [10, 20], [1000, 2000]];
		chart = createD3CanvasAligned(d3, input('d3-plot'), input('d3-stats'), data, { width: 900, height: 480 }, { ramp: 0 });
		assertCurrentDraw(data, 900, 480);
		const stats = input('d3-stats').textContent;
		for (const ramp of [0, .25, 1, 2]) {
			for (const exact of [false, true]) {
				chart.setRanging({ ramp, exact, useUplot: false });
				assert.equal(d3.scales.length, 3, 'inactive settings do not redraw');
				assert.equal(input('d3-stats').textContent, stats);
			}
		}
		chart.setRanging({ ramp: 2, exact: false, useUplot: false });
		chart.setRanging({ ramp: 2, exact: false, useUplot: true });
		assert.equal(d3.scales.length, 6);
		assertCurrentDraw(data, 900, 480, { ramp: 2, exact: false, useUplot: true });
		for (const ramp of [0, .25, 1, 2]) {
			for (const exact of [false, true]) {
				const settings = { ramp, exact, useUplot: true };
				const before = d3.scales.length;
				chart.setRanging(settings);
				assert.equal(d3.scales.length, before + 3);
				assertCurrentDraw(data, 900, 480, settings);
				chart.setRanging(settings);
				assert.equal(d3.scales.length, before + 3, 'unchanged settings do not redraw');
				assert.equal(d3.extents.length, 2, 'ranging reuses raw extents');
			}
		}
		chart.setRanging({ ramp: 2, exact: true, useUplot: false });
		assertCurrentDraw(data, 900, 480, { ramp: 2 });
		const before = d3.scales.length;
		chart.setRanging({ ramp: 2, exact: true, useUplot: false });
		assert.equal(d3.scales.length, before, 'unchanged mode does not redraw');
		for (const height of [60, 100, 463, 1050]) {
			const before = d3.scales.length;
			chart.setSize({ width: 720, height });
			assert.equal(d3.scales.length, before + 3);
			assertCurrentDraw(data, 720, height, { ramp: 2 });
			assert.equal(d3.extents.length, 2, 'resizes reuse raw extents');
		}
		const next = [[5, 6, 7], [-30, -20, -10], [2, 4, 6]];
		chart.setData(next);
		assert.equal(d3.extents.length, 4, 'new data refreshes both extents');
		assertCurrentDraw(next, 720, 1050, { ramp: 2 });
		next[1][0] = -100;
		next[2][2] = 10;
		chart.setData(next);
		assert.equal(d3.extents.length, 6, 'setData also refreshes in-place changes');
		assertCurrentDraw(next, 720, 1050, { ramp: 2 });
		chart.setRanging({ ramp: 2, exact: true, useUplot: true });
		assertCurrentDraw(next, 720, 1050, { ramp: 2, exact: true, useUplot: true });
		assert.equal(d3.extents.length, 6, 'toggling uses the refreshed cache');
		const node = canvas();
		chart.destroy();
		chart = null;
		assert.equal(node.parentNode, null);
		assert.equal(input('d3-plot').children.length, 0);
	});

	it('toggles only D3, retains inactive settings, and matches unzoomed uPlot across ramps and exact modes', async () => {
		assert.equal(input('d3-ranging').checked, false, 'native D3 is the DOM default');
		assert.equal(input('exact-count').checked, false, 'approximate ranging is the DOM default');
		await withSeededRandom(() => { chart = createDemo(root); });
		await Promise.resolve();
		const data = chart.data;
		assertCurrentDraw(data, chart.width, chart.height);
		let scans = 0, draws = 0, redraws = 0;
		chart.hooks.draw.push(() => draws++);
		const redraw = chart.redraw;
		chart.redraw = (...args) => { redraws++; return redraw(...args); };
		for (const key of ['x', 'left', 'right']) {
			const scan = chart.scales[key].scan;
			chart.scales[key].scan = (...args) => { scans++; return scan(...args); };
		}
		for (const useUplot of [false, true, false, true]) {
			if (input('d3-ranging').checked !== useUplot) {
				const before = d3.scales.length;
				const previous = [draws, redraws];
				const stats = input('stats').textContent;
				input('d3-ranging').checked = useUplot;
				input('d3-ranging').dispatchEvent(new Event('change'));
				await Promise.resolve();
				assert.equal(d3.scales.length, before + 3);
				assert.deepEqual([draws, redraws], previous, 'the D3 toggle must not redraw uPlot');
				assert.equal(input('stats').textContent, stats);
				assertCurrentDraw(data, chart.width, chart.height, {
					ramp: input('ramp').valueAsNumber, exact: input('exact-count').checked, useUplot,
				});
			}
			for (const ramp of [0, .25, 1, 2]) {
				const before = d3.scales.length;
				const changed = input('ramp').valueAsNumber !== ramp;
				input('ramp').value = ramp;
				input('ramp').dispatchEvent(new Event('input'));
				await Promise.resolve();
				assert.equal(d3.scales.length, before + (useUplot && changed ? 3 : 0));
				assert.equal(input('ramp-value').value, String(ramp));
				assertCurrentDraw(data, chart.width, chart.height, { ramp, exact: input('exact-count').checked, useUplot });
				for (const exact of [false, true]) {
					const before = d3.scales.length;
					const changed = input('exact-count').checked !== exact;
					const stats = input('d3-stats').textContent;
					input('exact-count').checked = exact;
					input('exact-count').dispatchEvent(new Event('change'));
					await Promise.resolve();
					assert.ok(chart.axes.slice(1).every(axis => axis.ramp === ramp && axis.exact === exact));
					assert.equal(d3.scales.length, before + (useUplot && changed ? 3 : 0));
					if (!useUplot || !changed)
						assert.equal(input('d3-stats').textContent, stats);
					assertCurrentDraw(data, chart.width, chart.height, { ramp, exact, useUplot });
				}
			}
			assert.equal(chart.data, data);
			assert.equal(scans, 0, 'uPlot reuses cached extrema');
			assert.equal(d3.extents.length, 2, 'D3 reuses cached extrema');
		}
	});

	for (const useUplot of [false, true]) {
		it(`shares initial controls, sizes, and regenerated walks (useUplot=${useUplot})`, async () => {
			const settings = { ramp: .25, exact: false, useUplot };
			input('d3-ranging').checked = useUplot;
			input('ramp').value = .25;
			input('height').value = 600;
			input('exact-count').checked = false;
			await withSeededRandom(() => { chart = createDemo(root); });
			await Promise.resolve();
			const data = chart.data;
			assertCurrentDraw(data, chart.width, 600, settings);
			assert.ok(chart.axes.slice(1).every(axis => axis.ramp === .25 && axis.exact === false));
			input('height').value = 463;
			input('height').dispatchEvent(new Event('input'));
			await Promise.resolve();
			assert.equal(chart.height, 463);
			assert.equal(chart.data, data);
			assertCurrentDraw(data, chart.width, 463, settings);
			Object.defineProperty(input('plot'), 'clientWidth', { configurable: true, value: 720 });
			window.dispatchEvent(new Event('resize'));
			await Promise.resolve();
			assert.equal(chart.width, 720);
			assertCurrentDraw(data, 720, 463, settings);
			assert.equal(d3.extents.length, 2);

			for (const action of [
				() => input('walk-controls').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
				() => input('randomize').click(),
			]) {
				const previous = chart.data;
				const before = d3.scales.length;
				const scans = d3.extents.length;
				await withSeededRandom(action);
				await Promise.resolve();
				assert.notEqual(chart.data, previous);
				assert.equal(d3.scales.length, before + 3);
				assert.equal(d3.extents.length, scans + 2);
				assertCurrentDraw(chart.data, 720, 463, settings);
			}
			const before = d3.scales.length;
			const previous = chart.data;
			input('left-spread').value = -1;
			input('walk-controls').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			await Promise.resolve();
			assert.equal(chart.data, previous);
			assert.equal(d3.scales.length, before, 'invalid settings do not reach D3');
		});

		it(`preserves the D3 mode through the decimal precision preset (useUplot=${useUplot})`, async () => {
			input('d3-ranging').checked = useUplot;
			input('exact-count').checked = false;
			input('ramp').value = 2;
			input('height').value = 600;
			await withSeededRandom(() => { chart = createDemo(root); });
			await Promise.resolve();
			input('decimal-precision').click();
			await Promise.resolve();
			assert.equal(chart.height, 450);
			assert.deepEqual(chart.data.slice(1).map(values => [...new Set(values)]), [[1], [.0001]]);
			assert.equal(input('d3-ranging').checked, useUplot);
			assert.equal(input('ramp').valueAsNumber, 1);
			assert.equal(input('exact-count').checked, true);
			assertCurrentDraw(chart.data, chart.width, 450, { ramp: 1, exact: true, useUplot });
			assert.equal(d3.extents.length, 4, 'only regenerated data refreshes extents');
		});
	}

	it('destroys the D3 canvas and disconnects all demo controls', async () => {
		await withSeededRandom(() => { chart = createDemo(root); });
		await Promise.resolve();
		const node = canvas();
		const before = d3.scales.length;
		const calls = [];
		for (const method of ['setSize', 'redraw', 'setData', 'setScale'])
			chart[method] = () => calls.push(method);
		chart.destroy();
		chart = null;
		assert.equal(node.parentNode, null);
		assert.equal(input('plot').children.length, 0);
		assert.equal(input('d3-plot').children.length, 0);
		input('height').value = 700;
		input('d3-ranging').checked = true;
		input('ramp').value = 2;
		input('exact-count').checked = true;
		window.dispatchEvent(new Event('resize'));
		input('height').dispatchEvent(new Event('input'));
		input('d3-ranging').dispatchEvent(new Event('change'));
		input('ramp').dispatchEvent(new Event('input'));
		input('exact-count').dispatchEvent(new Event('change'));
		input('walk-controls').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		input('randomize').click();
		input('decimal-precision').click();
		input('reset-zoom').click();
		await Promise.resolve();
		assert.equal(d3.scales.length, before);
		assert.deepEqual(calls, []);
	});
});
