import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candlestickPlugin } from '../../demos/lib/candlestickPlugin.js';

const fields = { open: 3, high: 6, low: 2, close: 1, volume: 4 };
const colors = ['green', 'red', 'gray'];
const nativePaths = () => 'native overlay';
class RectPath {
	rects = [];
	rect(...args) { this.rects.push(args); }
}

function render(options = {}, { open = 101, close = 103, spacing = 20, idxs = [1, 1], mutate = () => {} } = {}) {
	const fills = [], events = [], states = [];
	let clip = 'existing clip';
	const u = {
		data: [[0, 1], [100, close], [94, 94], [100, open], [2, 4], [7, 8], [106, 106]],
		series: Array.from({ length: 7 }, (_, i) => ({
			scale: i === 0 ? 'x' : i === fields.volume ? 'volume' : 'price', show: true,
			idxs, paths: nativePaths, points: { show: true, size: 7 },
		})),
		bbox: { left: 90, top: 900, width: 200, height: 300 },
		valToPos(value, scale, canvas) {
			assert.equal(canvas, true, 'renderer uses canvas coordinates');
			return scale === 'x' ? 100 + value * spacing : scale === 'volume' ? 1100 - value * 30 : 2000 - value * 10;
		},
		ctx: {
			globalAlpha: .75, fillStyle: 'existing',
			get globalCompositeOperation() { return 'multiply'; },
			set globalCompositeOperation(value) { assert.fail(`unexpected composite write: ${value}`); },
			save() { events.push('save'); states.push([this.globalAlpha, this.fillStyle, clip]); },
			restore() {
				events.push('restore');
				assert.equal(states.length, 1);
				[this.globalAlpha, this.fillStyle, clip] = states.pop();
			},
			clip(path) {
				events.push('clip');
				clip = path.rects;
				const { left, top, width, height } = u.bbox;
				assert.deepEqual(clip, [[left, top, width, height]]);
			},
			fill(path, rule = 'nonzero') {
				events.push('fill');
				assert.equal(rule, 'nonzero');
				assert.notEqual(clip, 'existing clip', 'clip precedes every fill');
				fills.push({ color: this.fillStyle, alpha: this.globalAlpha, rects: path.rects.map(r => r.slice()) });
			},
		},
	};
	mutate(u);
	const plugin = candlestickPlugin({ fields, upColor: colors[0], downColor: colors[1], flatColor: colors[2], ...options });
	plugin.opts(u, { series: u.series });
	// Restore the shared harness's Path2D descriptor before returning, even on failure.
	const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
	try {
		Object.defineProperty(globalThis, 'Path2D', { configurable: true, writable: true, value: RectPath });
		plugin.hooks.drawAxes(u);
	}
	finally {
		if (original) Object.defineProperty(globalThis, 'Path2D', original);
		else delete globalThis.Path2D;
	}
	assert.deepEqual(events, fills.length ? ['save', 'clip', ...fills.map(() => 'fill'), 'restore'] : []);
	assert.deepEqual(states, []);
	assert.deepEqual([u.ctx.globalAlpha, u.ctx.fillStyle, clip, u.ctx.globalCompositeOperation], [.75, 'existing', 'existing clip', 'multiply']);
	for (const { rects } of fills)
		for (const rect of rects) {
			assert.ok(rect.every(Number.isFinite), `finite rectangle: ${rect}`);
			assert.ok(rect[2] >= 0, 'nonnegative width');
		}
	return { fills, u };
}

const occupied = fills => fills.filter(f => f.rects.length);
// Signed winding, not parity: overlapping solid wick/body rectangles must remain filled.
function winding(rects, x, y) {
	return rects.reduce((sum, [left, top, width, height]) => sum + (
		x >= left && x < left + width && y >= Math.min(top, top + height) && y < Math.max(top, top + height)
			? Math.sign(width * height) : 0), 0);
}

test('four direction combinations: solid open-close and hollow close-close share volume colors', () => {
	for (const [open, close, solidColor, hollowColor, rising] of [
		[101, 103, 'green', 'green', true], [105, 103, 'red', 'green', false],
		[95, 97, 'green', 'red', true], [99, 97, 'red', 'red', false],
	]) {
		for (const colorStrategy of ['open-close', 'close-close']) {
			const color = colorStrategy === 'open-close' ? solidColor : hollowColor;
			const hollow = colorStrategy === 'close-close' && rising;
			const [volume, price] = occupied(render({ colorStrategy }, { open, close }).fills);
			assert.deepEqual([volume.color, price.color], [color, color], `${open} → ${close}, ${colorStrategy}`);
			assert.deepEqual(volume.rects, [[114, 980, 12, 120]]);
			assert.deepEqual(price.rects.at(hollow ? -2 : -1), [114, 2000 - 10 * Math.max(open, close), 12, 20]);
			assert.equal(price.rects.length, hollow ? 4 : 2);
			assert.equal(price.rects.some(r => r[3] < 0), hollow);
		}
	}
});

test('OHLC bars put the open tick on the left and the close tick on the right', () => {
	for (const [open, close, openY, closeY, solidColor, closeColor] of [
		[105, 103, 950, 970, 'red', 'green'], [95, 97, 1050, 1030, 'green', 'red'],
	]) {
		for (const colorStrategy of ['open-close', 'close-close']) {
			const [volume, price] = occupied(render({ candleStyle: 'ohlcbars', colorStrategy }, { open, close }).fills);
			assert.deepEqual([volume.color, price.color], Array(2).fill(colorStrategy === 'open-close' ? solidColor : closeColor));
			assert.deepEqual(price.rects, [[120, 940, 1, 120], [114, openY, 6, 1], [120, closeY, 6, 1]]);
		}
	}
});

test('ties honor flatAsUp in both color strategies', () => {
	for (const [colorStrategy, open, close] of [['open-close', 103, 103], ['close-close', 99, 100]]) {
		for (const flatAsUp of [true, false]) {
			const fills = render({ colorStrategy, flatAsUp }, { open, close }).fills;
			assert.deepEqual(occupied(fills).map(f => f.color), Array(2).fill(flatAsUp ? 'green' : 'gray'));
		}
	}
});

test('an absent or nonfinite previous close is neutral, not an up tie', () => {
	for (const previous of [undefined, null, NaN, Infinity, -Infinity]) {
		for (const flatAsUp of [true, false]) {
			const fills = render({ colorStrategy: 'close-close', flatAsUp }, { mutate: u => { u.data[fields.close][0] = previous; } }).fills;
			assert.deepEqual(occupied(fills).map(f => f.color), ['gray', 'gray']);
			assert.ok(fills[5].rects.some(r => r[3] < 0), 'neutral color does not suppress a rising hollow body');
		}
	}
	const first = render({ colorStrategy: 'close-close' }, { idxs: [0, 0], mutate: u => { u.data[fields.open][0] = 99; } });
	assert.deepEqual(occupied(first.fills).map(f => f.color), ['gray', 'gray']);
	assert.deepEqual(occupied(render({}, { mutate: u => { u.data[fields.close][0] = null; } }).fills).map(f => f.color), ['green', 'green']);
});

test('viewport boundaries preserve full-data spacing and previous-close classification', () => {
	for (const [options, previous, close] of [
		[{}, 100, 103], [{ colorStrategy: 'close-close' }, 100, 103],
		[{ colorStrategy: 'close-close', flatAsUp: false }, 100, 100],
		[{ colorStrategy: 'close-close', candleStyle: 'ohlcbars' }, NaN, 103],
	]) {
		const mutate = u => {
			u.data.forEach(column => column.push(column[1]));
			u.data[0][2] = 4; // The narrowest interval is outside the cropped viewport.
			u.data[fields.close][1] = previous;
			u.data[fields.close][2] = close;
		};
		const full = render(options, { idxs: [0, 2], mutate }).fills;
		const cropped = render(options, { idxs: [2, 2], mutate }).fills;
		assert.deepEqual(cropped, full.map(f => ({ ...f, rects: f.rects.filter(r => r[0] >= 174) })));
		assert.equal(occupied(cropped)[0].rects[0][2], 12);
	}
});

test('same-color nonzero paths leave hollow interiors clear, split wicks, and retain solid overlap', () => {
	const { fills } = render({ colorStrategy: 'close-close' }, { idxs: [1, 2], mutate: u => {
		u.data.forEach(column => column.push(column[1]));
		u.data[0][2] = 2;
		u.data[fields.open][2] = 105;
		u.data[fields.close][2] = 104;
	} });
	assert.deepEqual(occupied(fills).map(f => f.color), ['green', 'green']);
	const price = fills[3].rects;
	assert.deepEqual(price, [
		[120, 940, 1, 30], [120, 990, 1, 70], [114, 970, 12, 20], [115, 989, 10, -18],
		[140, 940, 1, 120], [134, 950, 12, 10],
	]);
	for (const [x, y, expected] of [[120.5, 985.5, 0], [116.5, 985.5, 0], [114.5, 985.5, 1], [120.5, 970.5, 1], [120.5, 950.5, 1], [120.5, 1000.5, 1], [140.5, 955.5, 2]])
		assert.equal(winding(price, x, y), expected, `winding at ${x},${y}`);
	assert.equal(winding(fills[0].rects, 120.5, 985.5), 1, 'volume remains beneath the hollow wick center');
});

test('thin candles and dojis keep a body without a degenerate hollow interior', () => {
	for (const [spacing, width, height, hollow] of [
		[.1, 1, 20, false], [10 / 3, 2, 20, false], [5, 3, 20, true],
		[20, 12, 0, false], [20, 12, 2, false], [20, 12, 3, true],
		[24, 14, 4, false], [24, 14, 5, true],
	]) {
		const [price] = occupied(render({ mode: 'candles', colorStrategy: 'close-close' }, { spacing, open: 103 - height / 10 }).fills);
		assert.deepEqual(price.rects.at(hollow ? -2 : -1), [Math.round(100 + spacing) - Math.floor(width / 2), 970, width, Math.max(1, height)]);
		assert.equal(price.rects.length, hollow ? 4 : 2, `width ${width}, height ${height}`);
		assert.equal(price.rects.some(r => r[3] < 0), hollow);
	}
});

test('missing and nonfinite samples skip only the affected layers; zero volume is valid', () => {
	for (const [field, value, volumeRects, priceRects] of [
		[0, NaN, 0, 0], [fields.open, null, 0, 0], [fields.open, '101', 0, 0], [fields.close, Infinity, 0, 0],
		[fields.high, undefined, 1, 0], [fields.low, -Infinity, 1, 0],
		[fields.volume, NaN, 0, 2], [fields.volume, null, 0, 2], [fields.volume, 0, 1, 2],
	]) {
		const { fills } = render({}, { mutate: u => { u.data[field][1] = value; } });
		assert.deepEqual(fills.map(f => f.rects.length), [volumeRects, 0, 0, priceRects, 0, 0], `field ${field}: ${value}`);
	}
	for (const [scale, counts] of [['price', [1, 0, 0, 0, 0, 0]], ['volume', [0, 0, 0, 2, 0, 0]], ['x', []]]) {
		const { fills } = render({}, { mutate: u => {
			const project = u.valToPos;
			u.valToPos = (v, key, canvas) => key === scale ? Infinity : project(v, key, canvas);
		} });
		assert.deepEqual(fills.map(f => f.rects.length), counts, `nonfinite ${scale} projection`);
	}
});

test('remapped semantic fields use their own scales and leave native overlays untouched', () => {
	const expected = render().fills;
	const { fills, u } = render({}, { mutate: u => {
		const project = u.valToPos, factors = { open: 2, high: 3, low: 4, close: 5, volume: 6 };
		for (const [name, idx] of Object.entries(fields)) {
			u.series[idx].scale = name;
			u.data[idx] = u.data[idx].map(v => v * factors[name]);
		}
		u.valToPos = (v, key, canvas) => key === 'x' ? project(v, key, canvas) : project(v / factors[key], key === 'volume' ? 'volume' : 'price', canvas);
	} });
	assert.deepEqual(fills, expected);
	for (const idx of [0, 5]) {
		assert.equal(u.series[idx].paths, nativePaths);
		assert.deepEqual(u.series[idx].points, { show: true, size: 7 });
	}
	assert.deepEqual(u.data[5], [7, 8]);
	for (const [mode, custom] of [['candles+volume', [1, 2, 3, 4, 6]], ['candles', [1, 2, 3, 6]], ['volume', [4]]]) {
		const { u } = render({ mode });
		for (let i = 1; i < u.series.length; i++) {
			assert.equal(u.series[i].paths === nativePaths, !custom.includes(i), `${mode}: field ${i}`);
			assert.deepEqual(u.series[i].points, { show: !custom.includes(i), size: 7 });
			if (custom.includes(i)) assert.equal(u.series[i].paths(), null);
		}
	}
});

test('each active layer gets three clipped fills in volume-first order with restored canvas state', () => {
	for (const [options, hidden, alphas] of [
		[{}, [], [.5, 1]], [{ volumeAlpha: .35 }, [], [.35, 1]],
		[{ mode: 'candles' }, [], [1]], [{ mode: 'volume', volumeAlpha: 1 }, [], [1]],
		[{}, [fields.close], [.5]], [{ volumeAlpha: 0 }, [fields.volume], [1]],
		[{}, [fields.close, fields.volume], []], [{ mode: 'volume', volumeAlpha: 0 }, [], [0]],
	]) {
		const { fills } = render(options, { mutate: u => { hidden.forEach(i => { u.series[i].show = false; }); } });
		assert.deepEqual(fills.map(f => [f.color, f.alpha]), alphas.flatMap(alpha => colors.map(color => [color, alpha])));
	}
});

test('empty bounds or missing required columns cause no canvas activity', () => {
	for (const idxs of [undefined, [null, null], [1, 0]])
		assert.deepEqual(render({}, { mutate: u => { u.series[0].idxs = idxs; } }).fills, []);
	for (const idx of [0, fields.open, fields.close])
		assert.deepEqual(render({}, { mutate: u => { u.data[idx] = undefined; } }).fills, []);
	for (const [idx, counts] of [[fields.high, [1, 0, 0, 0, 0, 0]], [fields.volume, [0, 0, 0, 2, 0, 0]]])
		assert.deepEqual(render({}, { mutate: u => { u.data[idx] = undefined; } }).fills.map(f => f.rects.length), counts);
});
