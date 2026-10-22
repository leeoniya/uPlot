import assert from 'node:assert/strict';

import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const ops = log => log.flatMap(([name, ...entries]) => entries.map(args => ({name, args})));
const counts = (path, op) => ops(path.log).filter(e => e.name == op).length;
const tick = () => Promise.resolve();
const pathList = value => value == null ? [] : Array.isArray(value) ? value : [value];
const paintOps = events => events.filter(e => e.name == 'fill' || e.name == 'stroke');

function appendPath(map, color, path) {
	if (!map.has(color))
		map.set(color, path);
	else
		map.set(color, [...pathList(map.get(color)), path]);
}

function batches(events) {
	const styles = {};
	const result = {fill: new Map(), stroke: new Map()};
	const painted = {fill: new Set(), stroke: new Set()};
	for (const {name, args} of events) {
		if (name == 'fillStyle' || name == 'strokeStyle')
			styles[name] = args;
		else if (name == 'fill' || name == 'stroke') {
			const color = styles[`${name}Style`];
			assert.ok(color != null, 'paint uses a non-null color');
			assert.ok(args[0]?.log != null, 'batched paint receives a Path2D');
			assert.ok(!painted[name].has(args[0]), `paint each group only once per ${name}`);
			assert.ok(counts(args[0], 'arc') > 0, 'do not paint unused colors');
			painted[name].add(args[0]);
			appendPath(result[name], color, args[0]);
		}
	}
	assert.deepEqual(paintOps(events).map(e => e.name), [
		...Array(painted.fill.size).fill('fill'), ...Array(painted.stroke.size).fill('stroke'),
	], 'paint every fill before any stroke');
	return result;
}

function capturePaths(draw) {
	const OriginalPath2D = globalThis.Path2D;
	const paths = new Set();
	// The mock has own, non-writable methods. Capture all unique construction logs,
	// including unpainted paths, instead of counting geometry once per paint.
	globalThis.Path2D = function(source) {
		const path = new OriginalPath2D(source);
		paths.add(path);
		return path;
	};
	try { return {result: draw(), paths: [...paths]}; }
	finally { globalThis.Path2D = OriginalPath2D; }
}

function plot(kind, builder, data = [[0, 1, 2, 3, 4], [2, 3, 4, 3, 2]], extra = {}) {
	const style = kind == 'bars'
		? {paths: builder, width: 2, stroke: 'black', fill: 'gray', points: {show: false}}
		: {paths: () => null, pxAlign: 0, points: {show: true, paths: builder, size: 10, width: 2, fill: 'gray', stroke: 'black'}};
	return new uPlot({
		width: 400, height: 250, pxRatio: 1,
		axes: [], cursor: {show: false}, legend: {show: false},
		scales: {x: {time: false, range: [-1, 5]}, y: {range: [-1, 6]}},
		series: [{}, style],
		...extra,
	}, data, document.body);
}

describe('bar display geometry units', () => {
	const fractions = [.1, .35, .6, .85];
	const fractionWidth = .08;
	const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

	async function checkGeometry(ori, dir, pxRatio, xUnit, sizeUnit, scale = {range: [0, 10]}) {
		const screenDir = dir * (ori == 0 ? 1 : -1);
		const positions = xUnit == 2 ? fractions.slice() : fractions.map(p => 10 * (screenDir == 1 ? p : 1 - p));
		Object.defineProperty(positions, 'map', {value: () => assert.fail('do not allocate a mapped position array')});
		Object.freeze(positions);
		const bounds = [];
		const builder = uPlot.paths.bars({disp: {
			x0: {unit: xUnit, values: () => positions},
			// Scale-value widths are signed deltas in the scale's physical direction.
			size: {kind: 1, unit: sizeUnit, values: () => sizeUnit == 2 ? fractionWidth : 10 * fractionWidth * screenDir},
		}, each: (u, si, di, ...box) => bounds.push([di, ...box])});
		const u = plot('bars', builder, [[1, 2, 3, 4], [2, 3, 4, 3]], {
			pxRatio, padding: [10, 20, 30, 40],
			scales: {x: {time: false, ori, dir, ...scale}, y: {ori: 1 - ori, range: [-1, 6]}},
			series: [{}, {paths: builder, pxAlign: 0, width: 2, stroke: 'black', fill: 'gray', points: {show: false}}],
		});
		try {
			await tick();
			const posToVal = u.posToVal;
			const valToPct = u.scales.x.valToPct;
			for (const resize of [false, true]) {
				if (resize) {
					u.setSize({width: 550, height: 330});
					await tick();
				}
				bounds.length = 0;
				try {
					u.posToVal = () => assert.fail('bar layout must not inverse-project positions');
					if (xUnit == 2 && sizeUnit == 2)
						u.scales.x.valToPct = () => assert.fail('fractional geometry must not use the X transform');
					builder(u, 1, 0, 3);
				}
				finally {
					u.posToVal = posToVal;
					u.scales.x.valToPct = valToPct;
				}
				assert.equal(bounds.length, 4);
				const off = ori == 0 ? u.bbox.left : u.bbox.top;
				const dim = ori == 0 ? u.bbox.width : u.bbox.height;
				for (const [di, left, top, width, height] of bounds) {
					const start = fractions[di] - (screenDir == 1 ? 0 : fractionWidth);
					close(ori == 0 ? left : top, off + start * dim);
					close(ori == 0 ? width : height, fractionWidth * dim);
				}
			}
		}
		finally { u.destroy(); }
	}

	for (const ori of [0, 1]) {
		for (const dir of [1, -1]) {
			for (const pxRatio of [1, 1.5, 2]) {
				it(`keeps position and width units independent (ori ${ori}, dir ${dir}, DPR ${pxRatio})`, async () => {
					for (const xUnit of [1, 2]) {
						for (const sizeUnit of [1, 2])
							await checkGeometry(ori, dir, pxRatio, xUnit, sizeUnit);
					}
				});
			}
			for (const [name, scale] of [
				['log', {distr: 3, range: [1, 100]}],
				['custom', {distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [1, 100]}],
			]) {
				it(`projects fractional geometry directly on a ${name} scale (ori ${ori}, dir ${dir})`, async () => {
					await checkGeometry(ori, dir, 1.5, 2, 2, scale);
				});
			}
		}
	}
});

describe('display kind semantics', () => {
	function encode(kind, values) {
		if (kind == 1)
			return values[0];
		if (kind == 2) {
			const enums = Object.freeze([...new Set(values)]);
			return Object.freeze([enums, new Uint8Array(values.map(v => enums.indexOf(v)))]);
		}
		return Object.freeze(values);
	}

	for (const builderKind of ['bars', 'points']) {
		for (const color of ['rgba(255,0,0,.3)', null, undefined]) {
			it(`${builderKind}: broadcasts unary colors without a per-point index array (${color})`, async () => {
				let calls = 0;
				const fill = {kind: 1, values: () => { calls++; return color; }};
				const builder = uPlot.paths[builderKind]({disp: {fill, stroke: fill}});
				const u = plot(builderKind, builder);
				try {
					await tick();
					const cached = u.series[1]._disp.get(fill).value;
					assert.deepEqual(cached, [[color], 0]);
					u.setSize({width: 500, height: 300});
					await tick();
					const start = u.ctx.log.length;
					const paths = builder(u, 1, 1, 3);
					assert.equal(calls, 1);
					assert.equal(u.series[1]._disp.get(fill).value, cached);
					if (builderKind == 'bars') {
						assert.deepEqual([...paths.fill.keys()], color == null ? [] : [color]);
						if (color != null) {
							assert.equal(counts(paths.fill.get(color), 'rect'), 3);
							assert.equal(counts(paths.stroke.get(color), 'rect'), 3);
						}
					}
					else {
						const paint = ops(u.ctx.log.slice(start)).filter(e => e.name == 'fill' || e.name == 'stroke');
						assert.deepEqual(paint.map(e => e.name), color == null ? [] : ['fill', 'stroke', 'fill', 'stroke', 'fill', 'stroke']);
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const kind of [1, 2, 3, undefined]) {
		for (const scaled of [false, true]) {
			for (const ori of [0, 1]) {
				it(`reads point sizes by kind ${kind} (scaled ${scaled}, ori ${ori})`, async () => {
					const raw = kind == 1 ? Array(5).fill(25) : [0, 25, 100, 25, 100];
					const encoded = encode(kind, raw);
					let calls = 0;
					const size = {kind, values: () => { calls++; return encoded; }};
					if (scaled)
						Object.assign(size, {scale: 'size', range: [2, 62]});
					const bounds = [];
					const builder = uPlot.paths.points({disp: {size}, each: (u, si, di, x, y, w) => bounds.push([di, w / u.pxRatio])});
					const u = plot('points', builder, undefined, {
						pxRatio: 2,
						scales: {x: {time: false, ori, range: [-1, 5]}, y: {ori: 1 - ori, range: [-1, 6]},
							size: {distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [0, 100]}},
					});
					try {
						await tick();
						const expected = max => raw.map((v, i) => [i, scaled ? 2 + Math.sqrt(v / max) * 60 : v]).filter(([, v]) => v > 2);
						assert.deepEqual(bounds, expected(100));
						assert.equal(u.series[1]._disp.get(size).value, encoded);
						bounds.length = 0;
						u.setSize({width: 500, height: 300});
						await tick();
						assert.deepEqual(bounds, expected(100));
						bounds.length = 0;
						builder(u, 1, 0, 4, [4, 1, 3]);
						assert.deepEqual(bounds, [4, 1, 3].map(i => expected(100).find(e => e[0] == i)));
						if (scaled) {
							bounds.length = 0;
							u.setScale('size', {min: 0, max: 400});
							await tick();
							assert.deepEqual(bounds, expected(400));
						}
						assert.equal(calls, 1);
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	for (const ori of [0, 1]) {
		for (const dir of [-1, 1]) {
			for (const channel of ['x0', 'y0', 'y1']) {
				for (const kind of [1, 2, 3, undefined]) {
					it(`reads bar ${channel} by kind ${kind} (ori ${ori}, dir ${dir})`, async () => {
						const values = {x0: [.1, .25, .4, .55, .7], y0: [null, -1, 0, 2, -1], y1: [3, 4, null, 5, 4]};
						if (kind == 1)
							values[channel] = Array(5).fill(values[channel][0]);
						const bounds = [], reference = [];
						const disp = Object.fromEntries(Object.entries(values).map(([key, v]) => [key, {unit: key == 'x0' ? 2 : 1, values: () => v}]));
						disp.size = {kind: 1, unit: 2, values: () => .08};
						const baseline = uPlot.paths.bars({disp, each: (u, si, di, ...box) => reference.push([di, ...box])});
						const builder = uPlot.paths.bars({disp: {...disp, [channel]: {...disp[channel], kind, values: () => encode(kind, values[channel])}},
							each: (u, si, di, ...box) => bounds.push([di, ...box])});
						const u = plot('bars', builder, undefined, {
							pxRatio: 1.5,
							scales: {x: {time: false, ori, dir, range: [-1, 5]}, y: {ori: 1 - ori, range: [-1, 6]}},
						});
						try {
							await tick();
							baseline(u, 1, 0, 4);
							assert.ok(reference.length > 0);
							assert.deepEqual(bounds, reference);
							bounds.length = reference.length = 0;
							builder(u, 1, 1, 3);
							baseline(u, 1, 1, 3);
							assert.deepEqual(bounds, reference);
						}
						finally { u.destroy(); }
					});
				}
			}
		}
	}
});

describe('cached path display values', () => {
	for (const kind of ['bars', 'points']) {
		for (const typed of [false, true]) {
			it(`${kind}: retains discrete tuples and original indices without copying (typed ${typed})`, async () => {
				const colors = Object.freeze(['red', 'blue']);
				const idxs = typed ? new Uint8Array([1, 0, 1, 0, 1]) : Object.freeze([1, 0, 1, 0, 1]);
				const tuple = Object.freeze([colors, idxs]);
				let calls = 0;
				const fill = {kind: 2, values: () => { calls++; return tuple; }};
				const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
				const u = plot(kind, builder);
				try {
					await tick();
					assert.equal(u.series[1]._disp.get(fill).value, tuple);
					u.setSize({width: 500, height: 300});
					await tick();
					const start = u.ctx.log.length;
					const paths = builder(u, 1, 1, 2);
					assert.equal(calls, 1);
					assert.equal(u.series[1]._disp.get(fill).value, tuple);
					if (kind == 'bars') {
						assert.equal(counts(paths.fill.get('red'), 'rect'), 1);
						assert.equal(counts(paths.fill.get('blue'), 'rect'), 1);
					}
					else {
						const events = ops(u.ctx.log.slice(start));
						assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args), ['red', 'blue']);
						assert.deepEqual(events.filter(e => e.name == 'strokeStyle').map(e => e.args), ['red', 'blue']);
					}
				}
				finally { u.destroy(); }
			});
		}

		it(`${kind}: treats kind 3 as per-datapoint colors, including two-element arrays`, async () => {
			const colors = Object.freeze(['red', 'blue']);
			const fill = {kind: 3, values: () => colors};
			const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
			const u = plot(kind, builder, [[0, 1], [2, 3]]);
			try {
				await tick();
				const [palette, idxs] = u.series[1]._disp.get(fill).value;
				assert.deepEqual(Array.from(idxs, idx => palette[idx]), colors);
			}
			finally { u.destroy(); }
		});
		it(`${kind}: reuses data colors without rereading callbacks and refreshes on data replacement`, async () => {
			const calls = [];
			let colors = ['red', 'blue', 'red', null, 'blue'];
			let reads = 0;
			const values = (u, si, i0, i1) => {
				calls.push([u, si, i0, i1]);
				return colors;
			};
			const fill = Object.freeze({get values() { reads++; return values; }});
			const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
			const u = plot(kind, builder);
			try {
				await tick();
				assert.deepEqual(calls.map(c => c.slice(1)), [[1, 0, 4]], 'shared fill/stroke descriptor evaluates once');
				const cache = u.series[1]._disp;
				for (const change of [
					() => u.setSize({width: 500, height: 280}),
					() => u.setScale('x', {min: 1, max: 3}),
					() => u.setScale('y', {min: -2, max: 8}),
					() => u.redraw(true),
					() => { u.clearCache({paths: true}); u.redraw(false); },
					() => { u.setData(u.data, false); u.redraw(true); },
					() => u.setSeries(1, {show: false}),
					() => u.setSeries(1, {show: true}),
				]) {
					change();
					await tick();
					assert.equal(calls.length, 1);
					assert.equal(reads, 1, 'cache hits do not check callback identity');
					assert.equal(u.series[1]._disp, cache);
				}

				colors = Array(5).fill('orange');
				u.redraw(true);
				await tick();
				assert.equal(calls.length, 1, 'closure changes alone do not invalidate cached colors');
				assert.equal(reads, 1);

				u.setData(u.data.map(column => column.slice()), false);
				assert.equal(u.series[1]._disp, null, 'core invalidates before the next builder call');
				u.redraw(true);
				await tick();
				assert.equal(calls.length, 2);
				assert.notEqual(u.series[1]._disp, cache);
				assert.equal(reads, 2);
				const [palette, idxs] = u.series[1]._disp.get(fill).value;
				assert.deepEqual(Array.from(idxs, idx => palette[idx]), colors);
				assert.deepEqual(calls.at(-1).slice(1), [1, 0, 4], 'zoom does not restrict cached callback coverage');
			}
			finally { u.destroy(); }
		});

		it(`${kind}: isolates a shared builder by plot/series and releases caches on data disposal`, async () => {
			let calls = 0;
			const fill = {values: u => { calls++; return Array(5).fill(u.series.length == 2 ? 'red' : 'blue'); }};
			const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
			const a = plot(kind, builder);
			const b = plot(kind, builder, a.data);
			try {
				await tick();
				assert.equal(calls, 2);
				assert.notEqual(a.series[1]._disp, b.series[1]._disp);
				const raw = a.data;
				a.clearCache({data: true});
				assert.equal(a.series[1]._disp, null);
				assert.ok(b.series[1]._disp);
				a.setData(raw, false);
				a.redraw(true);
				await tick();
				assert.equal(calls, 3);
				a.destroy();
				assert.equal(a.series[1]._disp, null);
			}
			finally { b.destroy(); }
		});

		for (const mode of [1, 2]) {
			it(`${kind}: refreshes callbacks after series index changes without replacing data (mode ${mode})`, async () => {
				const calls = [];
				const fill = {values: (u, si, i0, i1) => {
					calls.push(si);
					return Array(i1 + 1).fill(si == 1 ? 'red' : 'blue');
				}};
				const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
				const data = mode == 1 ? [[0, 1], [2, 3], [4, 5]] : [null, [[0, 1], [2, 3]], [[0, 1], [4, 5]]];
				const u = plot(kind, builder, data, {mode});
				try {
					await tick();
					const series = u.series[1];
					const original = series._disp;
					assert.deepEqual(calls, [1]);
					u.addSeries({show: false}, 1);
					assert.equal(u.series[2], series);
					assert.equal(series._disp, null);
					builder(u, 2, 0, 1);
					const shifted = series._disp;
					assert.notEqual(shifted, original);
					assert.deepEqual(calls, [1, 2]);
					u.delSeries(1);
					assert.equal(u.series[1], series);
					assert.equal(series._disp, null);
					builder(u, 1, 0, 1);
					assert.notEqual(series._disp, shifted);
					assert.deepEqual(calls, [1, 2, 1]);
					assert.equal(u.data, data, 'series changes alone invalidate the cache');
				}
				finally { u.destroy(); }
			});
		}

		it(`${kind}: uses faceted series lengths and keeps series caches separate`, async () => {
			const calls = [];
			const fill = {kind: 2, values: (u, si, i0, i1) => {
				calls.push([si, i0, i1]);
				return [[si == 1 ? 'red' : 'blue'], new Uint8Array(i1 + 1)];
			}};
			const builder = uPlot.paths[kind]({disp: {fill, stroke: fill}});
			const style = kind == 'bars'
				? {paths: builder, width: 2, points: {show: false}}
				: {paths: () => null, points: {show: true, paths: builder, width: 2, size: 10}};
			const u = plot(kind, builder, [null, [[0, 1], [2, 3]], [[0, 1, 2], [3, 4, 5]]], {
				mode: 2,
				series: [null, {...style}, {...style}],
			});
			try {
				await tick();
				assert.deepEqual(calls, [[1, 0, 1], [2, 0, 2]]);
				if (kind == 'points') {
					const painted = ops(u.ctx.log).filter(e => e.name == 'fill' && e.args.length == 0);
					assert.equal(painted.length, 5, 'faceted points receive their own full draw range');
				}
				u.setSize({width: 500, height: 300});
				await tick();
				assert.equal(calls.length, 2);
			}
			finally { u.destroy(); }
		});
	}

	for (const ori of [0, 1]) {
		it(`maps cached raw point sizes through a custom scale independently of position (ori ${ori})`, async () => {
			let calls = 0;
			let sizes = [0, 25, 100, 400, 0];
			const size = {
				unit: 1, scale: 'size', range: [2, 62],
				values: (u, si, i0, i1) => {
					calls++;
					assert.deepEqual([si, i0, i1], [1, 0, 4]);
					return sizes;
				},
			};
			const bounds = [];
			const builder = uPlot.paths.points({disp: {size}, each: (u, si, di, x, y, w) => bounds.push([di, w / u.pxRatio])});
			const u = plot('points', builder, undefined, {
				pxRatio: 2,
				scales: {
					x: {time: false, ori, range: [-1, 5]},
					y: {ori: 1 - ori, range: [-1, 6]},
					size: {auto: false, distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [0, 100]},
				},
			});
			try {
				await tick();
				assert.deepEqual(bounds, [[1, 32], [2, 62], [3, 62]]);
				for (const change of [
					() => u.setSize({width: 500, height: 300}),
					() => u.setScale('x', {min: -2, max: 6}),
					() => u.setScale('y', {min: -2, max: 8}),
				]) {
					bounds.length = 0;
					change();
					await tick();
					assert.deepEqual(bounds, [[1, 32], [2, 62], [3, 62]]);
					assert.equal(calls, 1);
				}
				bounds.length = 0;
				u.setScale('size', {min: 0, max: 400});
				await tick();
				assert.deepEqual(bounds, [[1, 17], [2, 32], [3, 62]]);
				assert.equal(calls, 1, 'scale updates do not rerun values');

				sizes = [0, 0, 0, 0, 25];
				bounds.length = 0;
				u.setData(u.data.slice(), false);
				u.redraw(true);
				await tick();
				assert.deepEqual(bounds, [[4, 17]], 'skip zero-radius circles');
				assert.equal(calls, 2);

				size.range = [2, 82];
				bounds.length = 0;
				u.redraw(true);
				await tick();
				assert.deepEqual(bounds, [[4, 22]], 'output range updates reuse cached values');
				assert.equal(calls, 2);
			}
			finally { u.destroy(); }
		});
	}

	it('bar palettes share duplicate colors and skip null/out-of-range entries', async () => {
		const builder = uPlot.paths.bars({disp: {
			fill: {kind: 2, values: () => [['red', 'blue', null, 'red'], new Uint8Array([0, 1, 2, 3, 9])]},
			stroke: {values: () => ['black', null, 'black', 'black', 'black']},
		}});
		const u = plot('bars', builder);
		try {
			await tick();
			const paths = u.series[1]._paths;
			assert.deepEqual([...paths.fill.keys()], ['red', 'blue']);
			assert.equal(counts(paths.fill.get('red'), 'rect'), 2);
			assert.equal(counts(paths.fill.get('blue'), 'rect'), 1);
			const strokes = paths.stroke.get('black');
			assert.ok(Array.isArray(strokes), 'a repeated counterpart color retains separate group paths');
			assert.equal(strokes.length, 2);
			assert.equal(strokes[0], paths.fill.get('red'));
			assert.deepEqual(strokes.map(path => counts(path, 'rect')), [2, 2]);
			assert.notEqual(strokes[0], strokes[1]);
			const rebuilt = builder(u, 1, 1, 3);
			assert.notEqual(rebuilt.fill.get('red'), paths.fill.get('red'), 'only color data, not pixel paths, survives a rebuild');
			assert.equal(counts(rebuilt.fill.get('red'), 'rect'), 1);
		}
		finally { u.destroy(); }
	});

	it('bar geometry callbacks remain uncached', async () => {
		let colors = 0, layouts = 0;
		const fill = {values: () => { colors++; return ['red', 'red', 'red', 'red', 'red']; }};
		const builder = uPlot.paths.bars({disp: {
			fill, stroke: fill,
			x0: {unit: 2, values: () => { layouts++; return [0.05, 0.25, 0.45, 0.65, 0.85]; }},
			size: {kind: 1, unit: 2, values: () => 0.1},
		}});
		const u = plot('bars', builder);
		try {
			await tick();
			const before = layouts;
			u.setSize({width: 500, height: 300});
			await tick();
			assert.equal(colors, 1);
			assert.ok(layouts > before);
		}
		finally { u.destroy(); }
	});

	it('drops cached data for hidden series and for structural series changes', async () => {
		const fill = {values: () => Array(5).fill('red')};
		const builder = uPlot.paths.bars({disp: {fill, stroke: fill}});
		const u = plot('bars', builder);
		try {
			await tick();
			u.setSeries(1, {show: false});
			await tick();
			u.setData(u.data.map(column => column.slice()), false);
			assert.equal(u.series[1]._disp, null);
			u.setSeries(1, {show: true});
			await tick();
			assert.ok(u.series[1]._disp);
			u.addSeries({show: false}, 1);
			assert.equal(u.series[2]._disp, null);
			u.delSeries(1);
			assert.equal(u.series[1]._disp, null);
		}
		finally { u.destroy(); }
	});
});

describe('shared primary-color groups', () => {
	for (const primary of ['fill', 'stroke']) {
		it(`bars: redraw paints repeated fallback colors separately (${primary} descriptor)`, async () => {
			const builder = uPlot.paths.bars({disp: {
				[primary]: {kind: 2, values: () => [['blue', 'unused', 'red'], [2, 0, 2]]},
			}});
			const u = plot('bars', builder, [[0, 1, 2], [2, 3, 4]], {
				axes: [{show: false}, {show: false}],
			});
			try {
				await tick();
				const paths = u.series[1]._paths;
				assert.ok(paths.fill instanceof Map);
				assert.ok(paths.stroke instanceof Map);
				const groups = ['blue', 'red'].map(color => paths[primary].get(color));
				const fallback = paths[primary == 'fill' ? 'stroke' : 'fill'].get(primary == 'fill' ? 'black' : 'gray');
				assert.ok(Array.isArray(fallback));
				assert.equal(fallback.length, 2);
				for (let i = 0; i < groups.length; i++)
					assert.equal(fallback[i], groups[i]);
				for (const rebuild of [false, true]) {
					const start = u.ctx.log.length;
					u.redraw(rebuild);
					await tick();
					const current = u.series[1]._paths;
					const events = paintOps(ops(u.ctx.log.slice(start)));
					for (const channel of ['fill', 'stroke']) {
						const paints = events.filter(e => e.name == channel);
						assert.equal(paints.length, 2, 'paint each group even when its fallback color repeats');
						for (let i = 0; i < paints.length; i++)
							assert.equal(paints[i].args[0], current[primary].get(['blue', 'red'][i]),
								'pass the shared Path2D, not its containing array, to canvas');
					}
				}
			}
			finally { u.destroy(); }
		});
	}

	for (const builderKind of ['bars', 'points']) {
		const op = builderKind == 'bars' ? 'rect' : 'arc';

		for (const kind of [1, 2, 3]) {
			for (const mode of ['both', 'fill-only', 'stroke-only']) {
				for (const width of [0, 2]) {
					it(`${builderKind}: shares geometry by primary color (kind ${kind}, ${mode}, width ${width})`, async () => {
						const primary = mode == 'stroke-only' ? 'stroke' : 'fill';
						const counterpart = primary == 'fill' ? 'stroke' : 'fill';
						const disp = {[primary]: {kind, values: () => kind == 1 ? 'red' : kind == 2
							? [['blue', 'unused', 'red'], new Uint8Array([2, 0, 2])]
							: ['red', 'blue', 'red']}};
						if (mode == 'both')
							disp.stroke = {kind, values: () => kind == 1 ? 'black' : kind == 2
								? [['black'], new Uint8Array(3)] : Array(3).fill('black')};
						const drawn = [];
						const builder = uPlot.paths[builderKind]({batch: true, disp, each: (u, si, di) => drawn.push(di)});
						const style = builderKind == 'bars'
							? {paths: builder, width, fill: 'gray', stroke: 'black', points: {show: false}}
							: {paths: () => null, points: {show: true, paths: builder, size: 10, width, fill: 'gray', stroke: 'black'}};
						const u = plot(builderKind, builder, [[0, 1, 2], [2, 3, 4]], {series: [{}, style]});
						try {
							await tick();
							drawn.length = 0;
							const start = u.ctx.log.length;
							const captured = capturePaths(() => builder(u, 1, 0, 2));
							const events = ops(u.ctx.log.slice(start));
							const paths = builderKind == 'bars' ? captured.result : batches(events);
							if (builderKind == 'points')
								assert.equal(captured.result, null, 'batches paint directly');
							const colors = kind == 1 ? ['red'] : kind == 2 ? ['blue', 'red'] : ['red', 'blue'];
							assert.equal(captured.paths.reduce((sum, path) => sum + counts(path, op), 0), 3,
								'construct each visible shape once, including geometry on unpainted paths');
							const groups = captured.paths.filter(path => counts(path, op) > 0);
							assert.equal(groups.length, colors.length, 'one geometry path per primary-color group');
							assert.deepEqual(drawn, [0, 1, 2]);
							assert.ok(paths.fill instanceof Map);
							assert.deepEqual([...(paths.stroke?.keys() ?? [])], width == 0 ? [] : primary == 'stroke' ? colors : ['black']);
							const fallback = pathList(paths[counterpart]?.get(primary == 'fill' ? 'black' : 'gray'));
							if (counterpart == 'fill' || width > 0) {
								assert.equal(fallback.length, colors.length, 'do not merge groups with the same counterpart color');
								assert.equal(Array.isArray(paths[counterpart].get(primary == 'fill' ? 'black' : 'gray')), colors.length > 1,
									'use arrays only for repeated paint colors');
							}
							assert.deepEqual([...paths.fill.keys()], primary == 'fill' ? colors : ['gray']);
							for (let i = 0; i < colors.length; i++) {
								const path = primary == 'stroke' && width == 0 ? fallback[i] : paths[primary].get(colors[i]);
								assert.ok(!Array.isArray(path), 'unique primary paint colors have a single path');
								assert.ok(groups.includes(path));
								assert.equal(counts(path, op), kind == 1 ? 3 : colors[i] == 'red' ? 2 : 1);
								if (width > 0)
									assert.equal(path, fallback[i], 'fill and stroke share the exact same Path2D');
							}
							assert.equal(new Set(fallback).size, fallback.length, 'repeated colors paint distinct paths');
							if (builderKind == 'points') {
								const paints = paintOps(events);
								assert.deepEqual(paints.filter(e => e.name == 'fill').map(e => e.args[0]),
									primary == 'fill' ? colors.map(color => paths.fill.get(color)) : fallback);
								if (width > 0)
									assert.deepEqual(paints.filter(e => e.name == 'stroke').map(e => e.args[0]),
									primary == 'stroke' ? colors.map(color => paths.stroke.get(color)) : fallback);
							}
						}
						finally { u.destroy(); }
					});
				}
			}
		}

		it(`${builderKind}: does not evaluate the stroke counterpart when stroke is disabled`, async () => {
			const builder = uPlot.paths[builderKind]({batch: true, disp: {
				fill: {kind: 3, values: () => ['red', 'blue', 'red']},
				stroke: {kind: 3, values: () => assert.fail('disabled stroke must not evaluate its descriptor')},
			}});
			const style = builderKind == 'bars'
				? {paths: builder, width: 0, fill: 'gray', points: {show: false}}
				: {paths: () => null, points: {show: true, paths: builder, size: 10, width: 0, fill: 'gray'}};
			const u = plot(builderKind, builder, [[0, 1, 2], [2, 3, 4]], {series: [{}, style]});
			try {
				await tick();
				const start = u.ctx.log.length;
				const captured = capturePaths(() => builder(u, 1, 0, 2));
				const paths = builderKind == 'bars' ? captured.result : batches(ops(u.ctx.log.slice(start)));
				assert.deepEqual([...paths.fill.keys()], ['red', 'blue']);
				assert.deepEqual([...(paths.stroke?.keys() ?? [])], []);
				assert.equal(captured.paths.reduce((sum, path) => sum + counts(path, op), 0), 3);
			}
			finally { u.destroy(); }
		});

		for (const [kind, unary] of [[1, null], [1, undefined], [2], [3]]) {
			it(`${builderKind}: combines null/undefined primary colors while painting their counterpart (kind ${kind}, ${unary})`, async () => {
				const fill = {kind, values: () => kind == 1 ? unary : kind == 2
					? [['red', undefined, null, 'unused'], [2, 1, 2, 0, 1, 0]]
					: [null, undefined, null, 'red', undefined, 'red']};
				const stroke = {kind: 3, values: () => kind == 1 ? Array(6).fill('black')
					: ['black', 'black', 'black', 'green', 'black', 'green']};
				const builder = uPlot.paths[builderKind]({batch: true, disp: {fill, stroke}});
				const u = plot(builderKind, builder, [[0, .5, 1, 1.5, 2, 2.5], Array(6).fill(2)]);
				try {
					await tick();
					const start = u.ctx.log.length;
					const captured = capturePaths(() => builder(u, 1, 0, 5));
					const paths = builderKind == 'bars' ? captured.result : batches(ops(u.ctx.log.slice(start)));
					assert.deepEqual([...paths.fill.keys()], kind == 1 ? [] : ['red']);
					assert.deepEqual([...paths.stroke.keys()], kind == 1 ? ['black'] : kind == 2 ? ['green', 'black'] : ['black', 'green']);
					assert.ok(!Array.isArray(paths.stroke.get('black')), 'all suppressed primary colors share one group');
					assert.equal(counts(paths.stroke.get('black'), op), kind == 1 ? 6 : 4);
					if (kind != 1) {
						assert.equal(paths.fill.get('red'), paths.stroke.get('green'));
						assert.equal(counts(paths.fill.get('red'), op), 2);
					}
					assert.equal(captured.paths.reduce((sum, path) => sum + counts(path, op), 0), 6);
					assert.equal(captured.paths.filter(path => counts(path, op) > 0).length, kind == 1 ? 1 : 2);
				}
				finally { u.destroy(); }
			});
		}

		for (const kind of [1, 2, 3]) {
			it(`${builderKind}: reads counterpart kind ${kind} only at the first drawn member of each group`, async () => {
				const drawn = [];
				const fill = {kind: 2, values: () => [['unused', 'red', 'blue'], [1, 2, 1, 1, 2, 1, 0, 1, 2]]};
				const stroke = {kind, values: () => kind == 1 ? 'black' : kind == 2
					? [['black', 'green', 'unused'], [0, 1, 0, 0, 1, 0, 2, 0, 1]]
					: ['black', 'green', 'black', 'black', 'green', 'black', 'unused', 'black', 'green']};
				const disp = {fill, stroke, ...(builderKind == 'points' ? {size: {values: () => [10, 10, 0, 10, 10, 10, 10, 10, 10]}} : {})};
				const builder = uPlot.paths[builderKind]({batch: true, disp, each: (u, si, di) => drawn.push(di)});
				const u = plot(builderKind, builder, [[0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4], [null, 2, 0, 2, 3, 4, 2, 20, 2]]);
				try {
					await tick();
					const entry = u.series[1]._disp.get(stroke);
					const original = entry.value;
					const paletteReads = [], indexReads = [];
					const observe = (values, reads) => new Proxy(values, {get(target, key) {
						if (typeof key == 'string' && /^\d+$/.test(key))
							reads.push(Number(key));
						return Reflect.get(target, key);
					}});
					// Observe cached lookups, not the full-data normalization pass.
					entry.value = [observe(original[0], paletteReads), kind == 1 ? original[1] : observe(original[1], indexReads)];
					drawn.length = 0;
					const start = u.ctx.log.length;
					let captured;
					try {
						captured = capturePaths(() => builderKind == 'bars' ? builder(u, 1, 0, 5)
							: builder(u, 1, 0, 8, [0, 2, 7, 5, 4, 3, 1]));
					}
					finally { entry.value = original; }
					assert.deepEqual(drawn, builderKind == 'bars' ? [1, 3, 4, 5] : [5, 4, 3, 1]);
					assert.deepEqual(indexReads, kind == 1 ? [] : builderKind == 'bars' ? [1, 3] : [5, 4],
						'skipped, filtered and later group members do not read counterpart indices');
					assert.equal(paletteReads.length, 2, 'resolve counterpart color once per initialized group');
					const paths = builderKind == 'bars' ? captured.result : batches(ops(u.ctx.log.slice(start)));
					assert.deepEqual([...paths.fill.keys()], ['red', 'blue'], 'omit unused groups and keep palette order');
					assert.equal(captured.paths.reduce((sum, path) => sum + counts(path, op), 0), 4);
					if (kind == 1) {
						assert.equal(paths.stroke.get('black')[0], paths.fill.get('red'));
						assert.equal(paths.stroke.get('black')[1], paths.fill.get('blue'));
					}
					else {
						assert.equal(paths.stroke.get('black'), paths.fill.get('red'));
						assert.equal(paths.stroke.get('green'), paths.fill.get('blue'));
					}
				}
				finally { u.destroy(); }
			});
		}
	}
});

describe('point batching', () => {
	const geometry = events => events.filter(e => e.name == 'moveTo' || e.name == 'arc');

	for (const batch of [undefined, null, false, true]) {
		for (const disp of [undefined, null, {}]) {
			it(`selects the default drawing mode (batch ${batch}, disp ${disp == null ? disp : '{}'})`, async () => {
				const drawn = [];
				const builder = uPlot.paths.points({batch, disp, each: (u, si, di) => drawn.push(di)});
				const u = plot('points', builder);
				try {
					await tick();
					drawn.length = 0;
					const start = u.ctx.log.length;
					const result = builder(u, 1, 0, 4);
					const events = ops(u.ctx.log.slice(start));
					const batched = batch ?? (disp == null);
					assert.deepEqual(drawn, [0, 1, 2, 3, 4]);
					if (disp == null && batched) {
						assert.ok(result.fill?.log != null);
						assert.equal(result.stroke, result.fill);
						assert.equal(counts(result.fill, 'arc'), 5);
						assert.equal(paintOps(events).length, 0, 'single-path mode defers painting');
					}
					else {
						assert.equal(result, null);
						assert.equal(u.series[1].points._paths, null);
						assert.equal(events.filter(e => e.name == 'save').length, 1);
						assert.equal(events.filter(e => e.name == 'restore').length, 1);
						assert.equal(events.filter(e => e.name == 'clip').length, 1);
						if (batched) {
							const paths = batches(events);
							assert.deepEqual([...paths.fill.keys()], ['gray']);
							assert.deepEqual([...paths.stroke.keys()], ['black']);
							assert.equal(counts(paths.fill.get('gray'), 'arc'), 5);
							assert.equal(counts(paths.stroke.get('black'), 'arc'), 5);
							assert.equal(paths.fill.get('gray'), paths.stroke.get('black'), 'uniform fallback paints share one group path');
						}
						else {
							assert.deepEqual(paintOps(events).map(e => e.name), Array(5).fill(['fill', 'stroke']).flat());
							assert.ok(paintOps(events).every(e => e.args.length == 0));
							assert.equal(events.filter(e => e.name == 'beginPath').length, 5);
							assert.equal(events.filter(e => e.name == 'arc').length, 5);
						}
					}
					assert.equal(u.series[1]._disp, null, 'no display descriptors need caching');
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const batch of [false, true]) {
		it(`preserves each series alpha during redraw (${batch ? 'batched disp' : 'immediate no disp'})`, async () => {
			const fill = 'rgba(255,0,0,.3)';
			const builder = uPlot.paths.points({batch, ...(batch ? {disp: {fill: {kind: 1, values: () => fill}}} : {})});
			const alphas = [.25, .75];
			const u = plot('points', builder, [[0, 1], [2, 2], [3, 3]], {
				axes: [{show: false}, {show: false}],
				series: [{}, ...alphas.map(alpha => ({
					alpha, paths: () => null,
					points: {show: true, paths: builder, size: 10, width: 2, fill, stroke: 'black'},
				}))],
			});
			try {
				await tick();
				for (const rebuild of [true, false]) {
					let alpha = u.ctx.globalAlpha;
					assert.equal(alpha, 1);
					const start = u.ctx.log.length;
					u.redraw(rebuild);
					await tick();
					const events = ops(u.ctx.log.slice(start));
					const stack = [], painted = [];
					// The recorder logs save/restore but does not restore state itself.
					for (const {name, args} of events) {
						if (name == 'globalAlpha')
							alpha = args;
						else if (name == 'save')
							stack.push(alpha);
						else if (name == 'restore') {
							assert.ok(stack.length > 0);
							alpha = stack.pop();
						}
						else if (name == 'fill' || name == 'stroke') {
							painted.push([name, alpha]);
							assert.ok(batch ? args[0]?.log != null : args.length == 0);
						}
					}
					assert.deepEqual(painted, alphas.flatMap(alpha =>
						Array.from({length: batch ? 1 : 2}, () => [['fill', alpha], ['stroke', alpha]]).flat()),
						'both channels use their own series alpha, independently of CSS color alpha');
					assert.deepEqual(stack, []);
					assert.equal(alpha, 1, 'redraw restores alpha after the last series');
					assert.ok(u.series.slice(1).every(s => s.points._paths == null));
				}
			}
			finally { u.destroy(); }
		});
	}

	it('groups overlapping points by fill with matched strokes, not by adjacent runs', async () => {
		const alpha = 'rgba(255,0,0,.3)';
		const drawn = [];
		const builder = uPlot.paths.points({batch: true, disp: {
			fill: {kind: 3, values: () => [alpha, 'blue', alpha, 'blue', alpha]},
			stroke: {kind: 3, values: () => ['black', 'green', 'black', 'green', 'black']},
		}, each: (u, si, di) => drawn.push(di)});
		const u = plot('points', builder, [Array(5).fill(1), Array(5).fill(2)]);
		try {
			await tick();
			drawn.length = 0;
			const start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 4), null);
			const events = ops(u.ctx.log.slice(start));
			const paths = batches(events);
			assert.deepEqual(drawn, [0, 1, 2, 3, 4]);
			assert.equal(paths.fill.size, 2);
			assert.equal(paths.stroke.size, 2);
			for (const [channel, color, count] of [['fill', alpha, 3], ['fill', 'blue', 2], ['stroke', 'black', 3], ['stroke', 'green', 2]])
				assert.equal(counts(paths[channel].get(color), 'arc'), count);
			assert.equal(paths.fill.get(alpha), paths.stroke.get('black'));
			assert.equal(paths.fill.get('blue'), paths.stroke.get('green'));
			assert.equal(geometry(events).length, 0, 'batched geometry belongs to paths, not the current canvas path');
		}
		finally { u.destroy(); }
	});

	for (const kind of [1, 2, 3, undefined]) {
		it(`reuses normalized colors across batching modes, resize and zoom; refreshes on new data (kind ${kind})`, async () => {
			const calls = [];
			let reads = 0;
			let colors = Object.freeze(['red', 'blue', 'red', 'blue', 'red']);
			let encoded;
			const values = (u, si, i0, i1) => {
				calls.push([si, i0, i1]);
				encoded = kind == 1 ? colors[0] : kind == 2
					? Object.freeze([Object.freeze([...new Set(colors)]), new Uint8Array([0, 1, 0, 1, 0])])
					: colors;
				return encoded;
			};
			const color = Object.freeze({kind, get values() { reads++; return values; }});
			const disp = {fill: color, stroke: color};
			const direct = uPlot.paths.points({batch: false, disp});
			const builder = uPlot.paths.points({batch: true, disp});
			const u = plot('points', direct);
			try {
				await tick();
				const cached = u.series[1]._disp.get(color).value;
				if (kind == 1)
					assert.deepEqual(cached, [['red'], 0]);
				else if (kind == 2)
					assert.equal(cached, encoded, 'retain the original palette and typed indices');
				else
					assert.deepEqual(Array.from(cached[1], i => cached[0][i]), colors);
				for (const change of [
					() => {},
					() => u.setSize({width: 520, height: 300}),
					() => u.setScale('x', {min: 1, max: 3}),
				]) {
					change();
					await tick();
					const start = u.ctx.log.length;
					assert.equal(builder(u, 1, 1, 3), null);
					const paths = batches(ops(u.ctx.log.slice(start)));
					for (const channel of ['fill', 'stroke']) {
						assert.equal(paths[channel].size, kind == 1 ? 1 : 2);
						assert.equal(counts(paths[channel].get('red'), 'arc'), kind == 1 ? 3 : 1);
						if (kind != 1)
							assert.equal(counts(paths[channel].get('blue'), 'arc'), 2);
					}
					assert.equal(u.series[1]._disp.get(color).value, cached);
					assert.deepEqual(calls, [[1, 0, 4]], 'shared fill/stroke normalize once over the full data range');
					assert.equal(reads, 1);
				}
				colors = Object.freeze(['orange', 'purple', 'orange', 'purple', 'orange']);
				u.setData(u.data.map(column => column.slice()), false);
				const start = u.ctx.log.length;
				builder(u, 1, 1, 3);
				const paths = batches(ops(u.ctx.log.slice(start)));
				assert.deepEqual([...paths.fill.keys()].sort(), kind == 1 ? ['orange'] : ['orange', 'purple']);
				assert.notEqual(u.series[1]._disp.get(color).value, cached);
				assert.deepEqual(calls, [[1, 0, 4], [1, 0, 4]]);
				assert.equal(reads, 2);
			}
			finally { u.destroy(); }
		});
	}

	it('merges duplicate palette entries and skips suppressed, invalid and unused colors in filter order', async () => {
		const drawn = [];
		const tuple = Object.freeze([
			Object.freeze(['red', 'red', null, undefined, 'unused', 'blue']),
			Object.freeze([0, 1, 2, 3, 99, -1, 4, 5, 5]),
		]);
		const builder = uPlot.paths.points({batch: true, disp: {
			fill: {kind: 2, values: () => tuple},
			stroke: {kind: 3, values: () => ['black', 'black', null, undefined, null, null, 'unused', 'green', 'green']},
		}, each: (u, si, di) => drawn.push(di)});
		const u = plot('points', builder, [Array.from({length: 9}, (_, i) => i / 2), Array(9).fill(2)]);
		try {
			await tick();
			drawn.length = 0;
			const start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 8, [8, 1, 5, 4, 3, 2, 0]), null);
			const paths = batches(ops(u.ctx.log.slice(start)));
			assert.deepEqual(drawn, [8, 1, 0], 'each runs once for a point with at least one painted channel');
			assert.deepEqual([...paths.fill.keys()], ['red', 'blue'], 'paint in palette order, not filter order');
			assert.deepEqual([...paths.stroke.keys()], ['black', 'green']);
			assert.equal(paths.fill.get('red'), paths.stroke.get('black'));
			assert.equal(paths.fill.get('blue'), paths.stroke.get('green'));
			assert.equal(counts(paths.fill.get('red'), 'arc'), 2);
			assert.equal(counts(paths.fill.get('blue'), 'arc'), 1);
			assert.equal(counts(paths.stroke.get('black'), 'arc'), 2);
			assert.equal(counts(paths.stroke.get('green'), 'arc'), 1);
			for (const [channel, color, indices] of [
				['fill', 'blue', [8]], ['fill', 'red', [1, 0]],
				['stroke', 'black', [1, 0]], ['stroke', 'green', [8]],
			]) {
				assert.deepEqual(ops(paths[channel].get(color).log).filter(e => e.name == 'arc').map(e => e.args),
					indices.map(i => [u.valToPos(u.data[0][i], 'x', true), u.valToPos(2, 'y', true), 4, 0, Math.PI * 2]),
					`${channel} ${color} contains only its filtered points`);
			}
			for (const filter of [[], [2, 3, 5]]) {
				drawn.length = 0;
				const start = u.ctx.log.length;
				assert.equal(builder(u, 1, 0, 8, filter), null);
				assert.deepEqual(drawn, []);
				assert.deepEqual(paintOps(ops(u.ctx.log.slice(start))), [], 'do not paint empty palette paths');
			}
		}
		finally { u.destroy(); }
	});

	for (const channel of ['fill', 'stroke']) {
		for (const width of [0, 2]) {
			it(`uses fallback styles only for omitted channels (${channel} displayed, width ${width})`, async () => {
				const drawn = [];
				const builder = uPlot.paths.points({batch: true, disp: {
					[channel]: {kind: 3, values: () => [null, undefined, 'red']},
				}, each: (u, si, di) => drawn.push(di)});
				const u = plot('points', builder, [[0, 1, 2], [2, 3, 4]], {
					series: [{}, {paths: () => null, points: {show: true, paths: builder, size: 10, width, fill: 'gray', stroke: 'black'}}],
				});
				try {
					await tick();
					drawn.length = 0;
					const start = u.ctx.log.length;
					assert.equal(builder(u, 1, 0, 2), null);
					const paths = batches(ops(u.ctx.log.slice(start)));
					assert.deepEqual(drawn, channel == 'fill' && width == 0 ? [2] : [0, 1, 2]);
					assert.deepEqual([...paths.fill.keys()], [channel == 'fill' ? 'red' : 'gray']);
					assert.deepEqual(pathList(paths.fill.values().next().value).map(path => counts(path, 'arc')), channel == 'fill' ? [1] : [2, 1]);
					assert.deepEqual([...paths.stroke.keys()], width == 0 ? [] : [channel == 'stroke' ? 'red' : 'black']);
					if (width > 0) {
						assert.deepEqual(pathList(paths.stroke.values().next().value).map(path => counts(path, 'arc')), channel == 'stroke' ? [1] : [2, 1]);
						const fallback = pathList(paths[channel == 'fill' ? 'stroke' : 'fill'].values().next().value);
						assert.equal(fallback[1], paths[channel].get('red'));
						assert.notEqual(fallback[0], fallback[1]);
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const width of [0, 2]) {
		it(`resolves the default fill when an omitted channel has no explicit fill (width ${width})`, async () => {
			const builder = uPlot.paths.points({batch: true, disp: {}});
			const u = plot('points', builder, [[0, 1], [2, 3]], {
				series: [{}, {paths: () => null, points: {show: true, paths: builder, size: 10, width, fill: null, stroke: 'black'}}],
			});
			try {
				await tick();
				const start = u.ctx.log.length;
				assert.equal(builder(u, 1, 0, 1), null);
				const paths = batches(ops(u.ctx.log.slice(start)));
				const fill = width == 0 ? 'black' : '#fff';
				assert.deepEqual([...paths.fill.keys()], [fill]);
				assert.equal(counts(paths.fill.get(fill), 'arc'), 2);
				assert.deepEqual([...paths.stroke.keys()], width == 0 ? [] : ['black']);
			}
			finally { u.destroy(); }
		});
	}

	it('draws no-display points immediately with the same filtered geometry and callbacks as empty disp', async () => {
		const bounds = [];
		const each = (u, si, di, ...box) => bounds.push([si, di, ...box]);
		const direct = uPlot.paths.points({disp: {}, each});
		const builder = uPlot.paths.points({batch: false, each});
		const u = plot('points', direct, [[-2, 0, 1, 2, 3], [2, 3, null, 4, 2]], {pxRatio: 2});
		try {
			await tick();
			bounds.length = 0;
			const filter = [4, 2, 0, 1];
			let start = u.ctx.log.length;
			direct(u, 1, 0, 4, filter);
			const reference = ops(u.ctx.log.slice(start));
			const expected = bounds.slice();
			assert.deepEqual(expected.map(b => b[1]), [4, 1]);
			bounds.length = 0;
			start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 4, filter), null);
			const events = ops(u.ctx.log.slice(start));
			assert.deepEqual(bounds, expected);
			assert.deepEqual(geometry(events), geometry(reference));
			assert.deepEqual(paintOps(events), paintOps(reference));
			assert.equal(u.series[1]._disp, null);
		}
		finally { u.destroy(); }
	});

	it('aligns the expanded no-display immediate clip and boundary points with pxAlign', async () => {
		const bounds = [];
		const builder = uPlot.paths.points({batch: false, each: (u, si, di, ...box) => bounds.push([di, ...box])});
		const data = [null, [[0, 1, .5, .5, -.001, 1.001], [.5, .5, 0, 1, .5, .5]]];
		const u = plot('points', builder, data, {
			mode: 2, pxRatio: 1.5,
			scales: {x: {time: false, range: [0, 1]}, y: {range: [0, 1]}},
			series: [null, {paths: () => null, pxAlign: 1, points: {show: true, paths: builder, size: 10, width: 2, fill: 'gray', stroke: 'black'}}],
		});
		try {
			await tick();
			bounds.length = 0;
			const start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 5), null);
			const events = ops(u.ctx.log.slice(start));
			const translateIdx = events.findIndex(e => e.name == 'translate');
			const clipIdx = events.findIndex(e => e.name == 'clip');
			assert.deepEqual(events.filter(e => e.name == 'translate'), [{name: 'translate', args: [.5, .5]}]);
			assert.equal(events[0].name, 'save');
			assert.ok(translateIdx < clipIdx && clipIdx < events.findIndex(e => e.name == 'beginPath'),
				'align the expanded clip before drawing any boundary point');
			assert.equal(events.filter(e => e.name == 'clip').length, 1);
			// No disp retains twice the arc radius as padding: (10 - 2) * 1.5 = 12, not 7.5.
			assert.deepEqual(ops(events[clipIdx].args[0].log), [{name: 'rect', args: [
				u.bbox.left - 12, u.bbox.top - 12, u.bbox.width + 24, u.bbox.height + 24,
			]}]);
			assert.deepEqual(events.filter(e => e.name == 'lineWidth').map(e => e.args), [3]);
			assert.deepEqual(bounds.map(b => b[0]), [0, 1, 2, 3], 'expanded clipping does not include out-of-domain centers');
			const centers = [0, 1, 2, 3].map(i => [
				Math.round(u.valToPos(data[1][0][i], 'x', true)),
				Math.round(u.valToPos(data[1][1][i], 'y', true)),
			]);
			assert.deepEqual(geometry(events), centers.flatMap(([x, y]) => [
				{name: 'moveTo', args: [x + 6, y]},
				{name: 'arc', args: [x, y, 6, 0, Math.PI * 2]},
			]));
			assert.deepEqual(bounds, centers.map(([x, y], i) => [i, x + .5 - 7.5, y + .5 - 7.5, 15, 15]),
				'each reports aligned full bounds, not bounds truncated at the plot edge');
			assert.deepEqual(paintOps(events).map(e => e.name), Array(4).fill(['fill', 'stroke']).flat());
			assert.ok(paintOps(events).every(e => e.args.length == 0));
			assert.equal(events.at(-1).name, 'restore');
			assert.equal(events.filter(e => e.name == 'save').length, 1);
			assert.equal(events.filter(e => e.name == 'restore').length, 1);
		}
		finally { u.destroy(); }
	});

	for (const ori of [0, 1]) {
		for (const scaled of [false, true]) {
			it(`preserves variable-size geometry, filter order, clipping and alignment (ori ${ori}, scaled ${scaled})`, async () => {
				const bounds = [];
				const disp = {
					fill: {kind: 1, values: () => 'red'},
					size: {values: () => [6, 10, 14, 0, 1, 6, 6, 6, 6], ...(scaled ? {scale: 'size', range: [0, 14]} : {})},
				};
				const each = (u, si, di, ...box) => bounds.push([si, di, ...box]);
				const direct = uPlot.paths.points({batch: false, disp, each});
				const builder = uPlot.paths.points({batch: true, disp, each});
				const u = plot('points', direct, [null, [[0, .5, 1, .5, .5, null, .5, -2, -.001], [.5, .5, .5, .5, .5, .5, null, .5, .5]]], {
					mode: 2, pxRatio: 1.5,
					scales: {x: {time: false, ori, range: [0, 1]}, y: {ori: 1 - ori, range: [0, 1]}, size: {range: [0, 14]}},
					series: [null, {paths: () => null, pxAlign: 1, points: {show: true, paths: direct, size: 10, width: 1, fill: 'gray', stroke: 'black'}}],
				});
				try {
					await tick();
					const filter = [8, 2, 7, 0, 6, 4, 5, 3, 1];
					bounds.length = 0;
					let start = u.ctx.log.length;
					assert.equal(direct(u, 1, 0, 8, filter), null);
					const reference = ops(u.ctx.log.slice(start));
					const expected = bounds.slice();
					assert.deepEqual(expected.map(b => b[1]), scaled ? [8, 2, 0, 1] : [2, 0, 1]);
					bounds.length = 0;
					start = u.ctx.log.length;
					assert.equal(builder(u, 1, 0, 8, filter), null);
					const events = ops(u.ctx.log.slice(start));
					const paths = batches(events);
					assert.deepEqual(bounds, expected, 'batching must not reorder or duplicate each callbacks');
					for (const path of [paths.fill.get('red'), paths.stroke.get('black')]) {
						assert.deepEqual(geometry(ops(path.log)), geometry(reference));
						assert.equal(counts(path, 'arc'), expected.length);
					}
					const clipIdx = events.findIndex(e => e.name == 'clip');
					assert.ok(clipIdx >= 0 && clipIdx < events.findIndex(e => e.name == 'translate'));
					assert.deepEqual(ops(events[clipIdx].args[0].log), [{name: 'rect', args: [u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height]}]);
					for (const name of ['translate', 'lineWidth', 'lineCap', 'lineJoin', 'setLineDash'])
						assert.deepEqual(events.filter(e => e.name == name), reference.filter(e => e.name == name));
				}
				finally { u.destroy(); }
			});
		}
	}

	it('retains expanded direct clipping for color-only batches', async () => {
		const builder = uPlot.paths.points({batch: true, disp: {fill: {kind: 1, values: () => 'red'}}});
		const u = plot('points', builder, [[-1], [2]]);
		try {
			await tick();
			const start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 0), null);
			const events = ops(u.ctx.log.slice(start));
			const clipIdx = events.findIndex(e => e.name == 'clip');
			assert.ok(clipIdx > events.findIndex(e => e.name == 'translate'));
			assert.deepEqual(ops(events[clipIdx].args[0].log), [{name: 'rect', args: [u.bbox.left - 5, u.bbox.top - 5, u.bbox.width + 10, u.bbox.height + 10]}]);
			const paths = batches(events);
			assert.equal(counts(paths.fill.get('red'), 'arc'), 1);
			assert.equal(counts(paths.stroke.get('black'), 'arc'), 1);
		}
		finally { u.destroy(); }
	});
});

describe('point shapes', () => {
	for (const [mode, batch, display] of [
		['default shared path', undefined, false],
		['display shared groups', true, true],
		['ordered without display', false, false],
		['ordered with display', false, true],
	]) {
		for (const ori of [0, 1]) {
			for (const pxRatio of [1, 2]) {
				for (const shape of [undefined, 1, 2]) {
					it(`${mode}: shape ${shape ?? 'default'}, ori ${ori}, DPR ${pxRatio}`, async () => {
						const bounds = [];
						const sizes = [10, 12, 14, 16, 18, 10, 10, 10, 10, 0, 2];
						const data = [[0, 1, 2, 3, 4, -2, 2, null, 2, 2, 2], [2, 3, 4, 3, 2, 2, 7, 2, null, 2, 2]];
						const disp = display ? {
							fill: {kind: 2, values: () => [['red', 'blue', 'unused'], [0, 2, 1, 2, 0, 2, 2, 2, 2, 2, 2]]},
							size: {values: () => sizes},
						} : undefined;
						const builder = uPlot.paths.points({batch, disp, each: (u, si, di, ...box) => bounds.push([si, di, ...box])});
						const u = plot('points', () => null, data, {
							pxRatio,
							scales: {x: {time: false, ori, range: [-1, 5]}, y: {ori: 1 - ori, range: [-1, 6]}},
							series: [{}, {paths: () => null, pxAlign: 0, points: {
								show: true, paths: () => null, size: 10, width: 2, fill: 'gray', stroke: 'black',
								...(shape == null ? {} : {shape}),
							}}],
						});
						try {
							await tick();

							const filter = [4, 5, 2, 6, 7, 8, 0, ...(display ? [9, 10] : [])];
							const drawn = [4, 2, 0];
							const expectedBounds = [];
							const expected = drawn.map(di => {
								const x = u.valToPos(data[0][di], 'x', true);
								const y = u.valToPos(data[1][di], 'y', true);
								const [cx, cy] = ori == 0 ? [x, y] : [y, x];
								const size = (display ? sizes[di] : 10) * pxRatio;
								const side = size - 2 * pxRatio;
								const rad = side / 2;
								expectedBounds.push([1, di, cx - size / 2, cy - size / 2, size, size]);
								return shape == 2
									? [{name: 'rect', args: [cx - rad, cy - rad, side, side]}]
									: [{name: 'moveTo', args: [cx + rad, cy]}, {name: 'arc', args: [cx, cy, rad, 0, Math.PI * 2]}];
							});
							const start = u.ctx.log.length;
							const captured = capturePaths(() => builder(u, 1, 0, 10, filter));
							const events = ops(u.ctx.log.slice(start));
							const paints = paintOps(events);
							const single = batch == null;
							const clip = single ? captured.result.clip : events.find(e => e.name == 'clip').args[0];
							const paths = captured.paths.filter(path => path !== clip);
							assert.deepEqual(bounds, expectedBounds, 'each preserves filter order and reports outer bounds including stroke');

							if (single) {
								assert.equal(captured.result.fill, captured.result.stroke, 'fill and stroke share geometry');
								assert.deepEqual(paths, [captured.result.fill], 'construct geometry only once');
								assert.deepEqual(ops(paths[0].log), expected.flat());
								assert.equal(paints.length, 0, 'single-path mode defers painting');
							}
							else if (batch) {
								assert.equal(captured.result, null);
								assert.equal(paths.length, 2, 'allocate only the two drawn color groups');
								assert.deepEqual(paints.map(e => e.name), ['fill', 'fill', 'stroke', 'stroke']);
								const [red, blue] = paints.slice(0, 2).map(e => e.args[0]);
								assert.equal(new Set([red, blue]).size, 2);
								assert.deepEqual(new Set(paths), new Set([red, blue]), 'no duplicate or unpainted geometry');
								assert.equal(paints[2].args[0], red, 'red fill/stroke share one path');
								assert.equal(paints[3].args[0], blue, 'blue fill/stroke share one path');
								assert.deepEqual(ops(red.log), [...expected[0], ...expected[2]]);
								assert.deepEqual(ops(blue.log), expected[1]);
								assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args), ['red', 'blue']);
							}
							else {
								assert.equal(captured.result, null);
								assert.equal(paths.length, 0, 'ordered mode draws directly to the context');
								assert.deepEqual(events.filter(e => ['beginPath', 'rect', 'moveTo', 'arc', 'fill', 'stroke'].includes(e.name)),
									expected.flatMap(geometry => [
										{name: 'beginPath', args: []}, ...geometry,
										{name: 'fill', args: []}, {name: 'stroke', args: []},
									]), 'draw one shape per point, then fill and stroke in filter order');
								assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args), display ? ['red', 'blue', 'red'] : ['gray', 'gray', 'gray']);
							}
						}
						finally { u.destroy(); }
					});
				}
			}
		}
	}
});

describe('ordered point display painting', () => {
	for (const ori of [0, 1]) {
		for (const pxRatio of [1, 2]) {
			it(`culls centers before size lookup and mapping (ori ${ori}, DPR ${pxRatio})`, async () => {
				const reads = [], mapped = [], bounds = [];
				let calls = 0;
				const sizes = {length: 6};
				for (const [i, value] of [25, 36, 49, 64, 81, 100].entries())
					Object.defineProperty(sizes, i, {get() { reads.push(i); return value; }});
				const builder = uPlot.paths.points({disp: {size: {
					scale: 'size', range: [2, 22], values: () => { calls++; return sizes; },
				}}, each: (u, si, di, x, y, w) => bounds.push([di, w / pxRatio])});
				const u = plot('points', builder, [null, [[.5, -1, .5, -.01, 0, 1.01], [.5, .5, 3, .5, .5, .5]]], {
					mode: 2, pxRatio,
					scales: {
						x: {time: false, ori, range: [0, 1]}, y: {ori: 1 - ori, range: [0, 1]},
						size: {distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [0, 100]},
					},
				});
				try {
					await tick();
					const valToPct = u.scales.size.valToPct;
					u.scales.size.valToPct = value => { mapped.push(value); return valToPct(value); };
					reads.length = bounds.length = 0;
					builder(u, 1, 0, 5);
					assert.deepEqual(reads, [0, 3, 4, 5]);
					assert.deepEqual(mapped, [25, 64, 81, 100]);
					assert.deepEqual(bounds, [[0, 12], [3, 18], [4, 20], [5, 22]]);
					assert.equal(calls, 1, 'culling does not reevaluate the cached values callback');
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const ori of [0, 1]) {
		for (const display of [false, true]) {
			for (const pxRatio of [1, 2]) {
				it(`starts each circle at its arc origin (ori ${ori}, disp ${display}, DPR ${pxRatio})`, async () => {
					const builder = uPlot.paths.points(display ? {disp: {size: {values: () => [10, 20]}}} : undefined);
					const u = plot('points', builder, [[0, 1], [2, 3]], {
						pxRatio,
						scales: {x: {time: false, ori, range: [-1, 5]}, y: {ori: 1 - ori, range: [-1, 6]}},
					});
					try {
						await tick();
						const start = u.ctx.log.length;
						const result = builder(u, 1, 0, 1);
						const geometry = ops(display ? u.ctx.log.slice(start) : result.fill.log)
							.filter(e => e.name == 'moveTo' || e.name == 'arc');
						assert.equal(geometry.length, 4);
						for (let i = 0; i < geometry.length; i += 2) {
							assert.equal(geometry[i].name, 'moveTo');
							assert.equal(geometry[i + 1].name, 'arc');
							const [x, y, radius, angle0, angle1] = geometry[i + 1].args;
							assert.equal(angle0, 0);
							assert.equal(angle1, 2 * Math.PI);
							assert.deepEqual(geometry[i].args, [x + radius, y], 'start at the arc origin without a connecting chord');
						}
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	it('paints overlapping points separately, fill then stroke, in input order', async () => {
		const alpha = 'rgba(255,0,0,0.3)';
		const builder = uPlot.paths.points({disp: {
			fill: {kind: 2, values: () => [[alpha, 'blue'], new Uint8Array([0, 1, 0])]},
			stroke: {values: () => ['black', 'green', 'black']},
		}});
		const u = plot('points', builder, [[1, 1, 1], [2, 2, 2]]);
		try {
			await tick();
			assert.equal(u.series[1].points._paths, null);
			const start = u.ctx.log.length;
			assert.equal(builder(u, 1, 0, 2), null);
			const events = ops(u.ctx.log.slice(start));
			const paint = events.filter(e => ['fill', 'stroke'].includes(e.name));
			assert.deepEqual(paint.map(e => e.name), ['fill', 'stroke', 'fill', 'stroke', 'fill', 'stroke']);
			assert.ok(paint.every(e => e.args.length == 0), 'paints the current circle, not a color-batched Path2D');
			assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args), [alpha, 'blue', alpha]);
			assert.equal(events.filter(e => e.name == 'beginPath').length, 3);
			assert.equal(events.filter(e => e.name == 'arc').length, 3);
			assert.equal(events.filter(e => e.name == 'save').length, 1);
			assert.equal(events.filter(e => e.name == 'restore').length, 1);
		}
		finally { u.destroy(); }
	});

	for (const horizontal of [false, true]) {
		it(`uses CSS diameters and reports actual bounds at DPR 2, rotated: ${horizontal}`, async () => {
			const bounds = [];
			let sizeCalls = 0;
			const builder = uPlot.paths.points({disp: {
				size: {values: () => { sizeCalls++; return new Float32Array([10, 20, 30]); }},
				fill: {values: () => ['red', 'blue', 'green']},
			}, each: (u, si, di, ...box) => bounds.push([di, ...box])});
			const u = plot('points', builder, [[0, 1, 2], [2, 3, 4]], {
				pxRatio: 2,
				scales: {x: {time: false, ori: horizontal ? 1 : 0, range: [-1, 5]}, y: {ori: horizontal ? 0 : 1, range: [-1, 6]}},
			});
			try {
				await tick();
				bounds.length = 0;
				builder(u, 1, 0, 2, [2, 0]);
				assert.equal(sizeCalls, 1);
				assert.deepEqual(bounds.map(b => b[0]), [2, 0]);
				for (const [di, left, top, width, height] of bounds) {
					const diameter = (di + 1) * 20;
					const x = u.valToPos(u.data[0][di], 'x', true);
					const y = u.valToPos(u.data[1][di], 'y', true);
					assert.equal(width, diameter);
					assert.equal(height, diameter);
					assert.ok(Math.abs(left + width / 2 - (horizontal ? y : x)) < 1);
					assert.ok(Math.abs(top + height / 2 - (horizontal ? x : y)) < 1);
				}
				u.redraw(true);
				await tick();
				assert.equal(sizeCalls, 1);
			}
			finally { u.destroy(); }
		});
	}

	it('skips zero-radius circles and null coordinates; suppressed fill retains the default stroke', async () => {
		const bounds = [];
		const builder = uPlot.paths.points({disp: {
			fill: {values: () => [null, 'red', 'red', 'red', 'red', 'red']},
			size: {values: () => [10, 0, 1, 2, 10, 10]},
		}, each: (u, si, di) => bounds.push(di)});
		const u = plot('points', builder, [[0, 1, 2, 3, null, 4], [2, 3, 4, 3, 3, null]]);
		try {
			await tick();
			bounds.length = 0;
			const start = u.ctx.log.length;
			builder(u, 1, 0, 5);
			assert.deepEqual(bounds, [0]);
			const events = ops(u.ctx.log.slice(start));
			assert.equal(events.filter(e => e.name == 'fill').length, 0);
			assert.equal(events.filter(e => e.name == 'stroke').length, 1);
			assert.equal(events.find(e => e.name == 'strokeStyle').args, 'black');
		}
		finally { u.destroy(); }
	});

	for (const pxRatio of [1, 1.5, 2]) {
		for (const ori of [0, 1]) {
			for (const scaled of [false, true]) {
				it(`strictly clips disp.size before pixel alignment and reports full bounds (DPR ${pxRatio}, ori ${ori}, scaled ${scaled})`, async () => {
					const bounds = [];
					const values = Array(6).fill(scaled ? 36 : 6);
					const size = {values: () => values, ...(scaled ? {scale: 'size', range: [0, 6]} : {})};
					const builder = uPlot.paths.points({disp: {size}, each: (u, si, di, ...box) => bounds.push([di, ...box])});
					const u = plot('points', builder, [[0, 1, .5, .5, -.005, -2], [.5, .5, 0, 1, .5, .5]], {
						pxRatio,
						scales: {
							x: {time: false, ori, range: [0, 1]},
							y: {ori: 1 - ori, range: [0, 1]},
							size: {distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [0, 36]},
						},
						series: [{}, {paths: () => null, pxAlign: 1, points: {show: true, paths: builder, width: 1, fill: 'red', stroke: 'black'}}],
					});
					try {
						await tick();
						bounds.length = 0;
						const start = u.ctx.log.length;
						builder(u, 1, 0, 5);
						const events = ops(u.ctx.log.slice(start));
						const clipIdx = events.findIndex(e => e.name == 'clip');
						const translateIdx = events.findIndex(e => e.name == 'translate');
						assert.ok(clipIdx < translateIdx, 'stroke alignment must not shift the plot clip');
						const clip = events[clipIdx].args[0];
						const rect = ops(clip.log).find(e => e.name == 'rect').args;
						assert.deepEqual(rect, [u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height]);
						const expected = scaled ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
						assert.deepEqual(bounds.map(b => b[0]), expected, 'only scale-backed sizes expand center inclusion');
						assert.ok(bounds.every(b => b[3] === 6 * pxRatio && b[4] === 6 * pxRatio), 'each reports full diameter, including stroke');
						assert.ok(bounds.slice(0, 4).every(([, x, y, w, h]) =>
							x < u.bbox.left || y < u.bbox.top || x + w > u.bbox.left + u.bbox.width || y + h > u.bbox.top + u.bbox.height),
							'edge bounds remain unclipped');
						assert.equal(events.filter(e => e.name == 'fill').length, expected.length);
						assert.equal(events.filter(e => e.name == 'stroke').length, expected.length);
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	for (const [name, scale, value] of [
		['linear', {range: [0, 1]}, p => p],
		['log', {distr: 3, range: [1, 100]}, p => 100 ** p],
		['custom', {distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [1, 121]}, p => (1 + 10 * p) ** 2],
	]) {
		for (const ori of [0, 1]) {
			for (const dir of [1, -1]) {
				for (const pxRatio of [1, 1.5, 2]) {
					it(`includes a maximum-radius window at all edges (${name}, ori ${ori}, dir ${dir}, DPR ${pxRatio})`, async () => {
						const drawn = [];

						const pairs = [[-.005, .5], [1.005, .5], [.5, -.005], [.5, 1.005],
							[-.09, .5], [1.5, .5], [.5, -.09], [.5, 1.5], [0, .5], [1, .5]];
						const data = [null, [0, 1].map(i => pairs.map(p => value(p[i])))];
						const builder = uPlot.paths.points({disp: {size: {
							scale: 'size', range: [0, 6],
							values: () => pairs.map(() => 36),
						}}, each: (u, si, di) => drawn.push(di)});
						const u = plot('points', builder, data, {
							mode: 2, pxRatio,
							scales: {
								x: {time: false, ...scale, ori, dir},
								y: {...scale, ori: 1 - ori, dir: -dir},
								size: {range: [0, 36]},
							},
						});
						try {
							await tick();
							assert.deepEqual(drawn, [0, 1, 2, 3, 8, 9]);
							for (const key of ['x', 'y'])
								assert.deepEqual([u.scales[key].min, u.scales[key].max], scale.range, 'displayed domains do not expand');
						}
						finally { u.destroy(); }
					});
				}
			}
		}
	}

	it('updates the inclusion window on resize and zoom without reevaluating size values', async () => {
		const drawn = [];
		let calls = 0;
		const builder = uPlot.paths.points({disp: {size: {
			scale: 'size', range: [2, 60], values: () => { calls++; return [1]; },
		}}, each: (u, si, di) => drawn.push(di)});
		const u = plot('points', builder, [null, [[-.05], [.5]]], {
			mode: 2,
			scales: {x: {time: false, range: [0, 1]}, y: {range: [0, 1]}, size: {range: [0, 1]}},
		});
		try {
			await tick();
			assert.deepEqual(drawn, [0]);
			for (const [change, expected] of [
				[() => u.setSize({width: 1000, height: 250}), []],
				[() => u.setScale('x', {min: -.1, max: 1}), [0]],
				[() => u.setScale('x', {min: 0, max: .2}), []],
				[() => u.setScale('x', {min: 0, max: 2}), [0]],
			]) {
				drawn.length = 0;
				change();
				await tick();
				assert.deepEqual(drawn, expected);
				assert.equal(calls, 1);
			}
		}
		finally { u.destroy(); }
	});

	it('keeps boundary points when a custom inverse cannot extrapolate beyond zero', async () => {
		const drawn = [];
		const builder = uPlot.paths.points({disp: {size: {
			scale: 'size', range: [0, 6], values: () => [1, 1],
		}}, each: (u, si, di) => drawn.push(di)});
		const u = plot('points', builder, [null, [[0, .000001], [.5, .5]]], {
			mode: 2,
			scales: {
				x: {time: false, distr: 100, fwd: Math.sqrt, bwd: v => v * v, range: [0, 1]},
				y: {range: [0, 1]}, size: {range: [0, 1]},
			},
		});
		try {
			await tick();
			assert.deepEqual(drawn, [0, 1], 'include zero and nearby valid centers');
		}
		finally { u.destroy(); }
	});

	for (const colorOnly of [false, true]) {
		it(`retains expanded marker clipping without disp.size (color-only disp: ${colorOnly})`, async () => {
			const builder = uPlot.paths.points(colorOnly ? {disp: {fill: {values: () => ['red']}}} : undefined);
			const u = plot('points', builder, [[-1], [2]]);
			try {
				await tick();
				const start = u.ctx.log.length;
				const result = builder(u, 1, 0, 0);
				const clip = colorOnly ? ops(u.ctx.log.slice(start)).find(e => e.name == 'clip').args[0] : result.clip;
				const rect = ops(clip.log).find(e => e.name == 'rect').args;
				const pad = colorOnly ? 5 : 8;
				assert.deepEqual(rect, [u.bbox.left - pad, u.bbox.top - pad, u.bbox.width + pad * 2, u.bbox.height + pad * 2]);
			}
			finally { u.destroy(); }
		});
	}

	for (const kind of ['uniform', 'color', 'size']) {
		it(`culls by center rather than circle bounds for ${kind} points`, async () => {
			const disp = kind == 'uniform' ? undefined : kind == 'color'
				? {fill: {values: () => Array(4).fill('red')}}
				: {size: {values: () => Array(4).fill(10)}};
			const drawn = [];
			const builder = uPlot.paths.points({disp, each: (u, si, di) => drawn.push(di)});
			const u = plot('points', builder, [[-1.001, -1, 5, 5.001], [2, 2, 2, 2]]);
			try {
				await tick();
				assert.deepEqual(drawn, [1, 2], 'include boundary centers, exclude just-outside centers');
			}
			finally { u.destroy(); }
		});
	}

	it('retains the existing single-path builder when disp is omitted', async () => {
		const builder = uPlot.paths.points();
		const u = plot('points', builder);
		try {
			await tick();
			const result = builder(u, 1, 0, 4);
			assert.ok(result.fill != null && !(result.fill instanceof Map));
			assert.equal(result.stroke, result.fill);
			assert.equal(counts(result.fill, 'arc'), 5);
			assert.equal(u.series[1]._disp, null);
		}
		finally { u.destroy(); }
	});

});
