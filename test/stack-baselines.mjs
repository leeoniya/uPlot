import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const frame = () => new Promise(requestAnimationFrame);

function makePlot(data, opts = {}, barOpts = {}) {
	const rects = new Map();
	const paths = uPlot.paths.bars({
		...barOpts,
		each: (u, si, i, left, top, width, height) => rects.set(i, {left, top, width, height}),
	});
	const u = new uPlot({
		width: 400,
		height: 300,
		pxRatio: 1,
		axes: [],
		cursor: {show: false},
		scales: {
			x: {time: false, range: [-0.5, data[0].length - 0.5]},
			y: {range: [-10, 10]},
		},
		series: [{}, ...data.slice(1).map(() => ({paths, width: 0, fill: 'red'}))],
		...opts,
	}, data, document.body);

	return {u, paths, rects};
}

function build({u, paths, rects}, si) {
	rects.clear();
	const descriptor = Object.getOwnPropertyDescriptor(u.bands, 'find');
	if (u._base?.[si] != null) {
		Object.defineProperty(u.bands, 'find', {
			configurable: true,
			value: () => assert.fail(`integrated bar series ${si} must not look up bands`),
		});
	}

	try {
		paths(u, si, 0, u.data[0].length - 1);
	}
	finally {
		if (descriptor == null)
			delete u.bands.find;
		else
			Object.defineProperty(u.bands, 'find', descriptor);
	}
}

function checkRect({u, rects}, i, baseline, value) {
	const y0 = Math.round(u.valToPos(baseline, 'y', true));
	const y1 = Math.round(u.valToPos(value, 'y', true));
	const rect = rects.get(i);
	assert.ok(rect, `point ${i} must draw`);
	const horizontal = u.scales.y.ori == 0;
	assert.deepEqual(
		horizontal ? [rect.left, rect.width] : [rect.top, rect.height],
		[Math.min(y0, y1), Math.abs(y1 - y0)],
		`point ${i}`,
	);
	assert.ok((horizontal ? rect.height : rect.width) > 0, `point ${i} must have positive thickness`);
}

function checkMixed(plot, baselines, endpoints) {
	const {u, rects} = plot;
	assert.deepEqual(u._base, baselines, 'series-indexed baselines');
	assert.deepEqual(u._data, [u.data[0], ...endpoints], 'render endpoints');

	baselines.forEach((base, si) => {
		if (base == null)
			return;

		build(plot, si);
		const indices = u.data[si].flatMap((value, i) => value == null || value == 0 ? [] : [i]);
		assert.deepEqual([...rects.keys()].sort((a, b) => a - b), indices, `series ${si}: skip holes and zeros`);
		indices.forEach(i => checkRect(plot, i, base[i], endpoints[si - 1][i]));
	});
}

describe('bar stack baselines', () => {
	for (const percent of [false, true]) {
		for (const sign of [1, -1]) {
			it(`uses dir0 baselines for same-sign inputs (percent: ${percent}, sign: ${sign})`, async () => {
				const signed = rows => rows.map(row => row.map(value => value == null || value == 0 ? value : sign * value));
				const data = [
					[0, 1, 2, 3, 4, 5],
					...signed([
						[1, 1, 1, 0, null, undefined],
						[null, 2, null, 0, null, undefined],
						[undefined, 2, 0, 0, null, undefined],
						[3, 3, 3, 0, null, undefined],
					]),
				];
				const totals = [4, 8, 4, 0, 0, 0];
				const render = rows => signed(rows).map(row => row.map((value, i) =>
					percent && value != null && value != 0 ? value / totals[i] : value));
				const zeroBase = sign == 1 ? 1 : 0;
				const baselines = [null, ...render([
					[0, 0, 0, 0, null, undefined],
					[null, 1, null, 0, null, undefined],
					[undefined, 3, zeroBase, 0, null, undefined],
					[1, 5, 1, 0, null, undefined],
				])];
				const endpoints = render([
					[1, 1, 1, 0, null, undefined],
					[null, 3, null, 0, null, undefined],
					[undefined, 5, zeroBase, 0, null, undefined],
					[4, 8, 4, 0, null, undefined],
				]);
				const original = structuredClone(data);
				const plot = makePlot(data, {stack: {groups: [{series: [1, 2, 3, 4], dir: 0}], percent}});

				try {
					await frame();
					checkMixed(plot, baselines, endpoints);
					assert.deepEqual(plot.u.bands, [], 'same-sign bar groups do not generate bands');
					assert.deepEqual(plot.u.data, original);
				}
				finally {
					plot.u.destroy();
				}
			});
		}
	}

	for (const distr of [1, 2]) {
		it(`does not traverse explicit bands (x distribution: ${distr})`, async () => {
			const data = [[10, 20, 30, 40], [2, 2, 2, 2], [null, undefined, 0, 2], [5, 5, 5, 5]];
			const plot = makePlot(data, {
				bands: [{series: [3, 2], dir: -1}, {series: [2, 1], dir: -1}],
				scales: {x: {time: false, distr}, y: {range: [0, 10]}},
			}, {
				disp: {
					y0: {values: (u, si) => {
						assert.notEqual(si, 3, 'bands take precedence over disp.y0');
						return data[si];
					}},
					y1: {values: (u, si) => {
						assert.notEqual(si, 3, 'bands take precedence over disp.y1');
						return data[si];
					}},
				},
			});

			try {
				await frame();
				build(plot, 3);
				[0, 0, 0, 2].forEach((baseline, i) => checkRect(plot, i, baseline, 5));
			}
			finally {
				plot.u.destroy();
			}
		});
	}

	it('keeps disp.y0/y1 null fallback and zero baselines unchanged', async () => {
		const data = [[0, 1, 2, 3, 4, 5], [9, 9, 9, 9, 9, 9]];
		const plot = makePlot(data, {}, {
			disp: {
				y0: {values: () => [null, undefined, 0, -2, 2, 2]},
				y1: {values: () => [5, -5, 5, -5, 2, null]},
			},
		});

		try {
			await frame();
			build(plot, 1);
			assert.equal(plot.rects.size, 4);
			checkRect(plot, 0, 0, 5);
			checkRect(plot, 1, 0, -5);
			checkRect(plot, 2, 0, 5);
			checkRect(plot, 3, -2, -5);
		}
		finally {
			plot.u.destroy();
		}
	});
});

describe('mixed-sign bar stack baselines', () => {
	for (const percent of [false, true]) {
		for (const horizontal of [false, true]) {
			for (const dir of [1, -1]) {
				it(`draws signed segments, holes, and zeros (percent: ${percent}, horizontal: ${horizontal}, scale dir: ${dir})`, async () => {
					const data = [
						Array.from({length: 10}, (_, i) => i),
						[2, -2, 2, -2, null, undefined, 0, null, 2, -2],
						[3, -3, -4, 4, undefined, null, 0, undefined, null, undefined],
						[-4, 4, 0, 0, 3, -3, 0, null, 3, -3],
					];
					const original = structuredClone(data);
					const baselines = percent ? [
						null,
						[0, 0, 0, 0, null, undefined, 0, null, 0, 0],
						[2/5, -2/5, 0, 0, undefined, null, 0, undefined, null, undefined],
						[0, 0, 1, 1, 0, 0, 0, null, 2/5, -2/5],
					] : [
						null,
						[0, 0, 0, 0, null, undefined, 0, null, 0, 0],
						[2, -2, 0, 0, undefined, null, 0, undefined, null, undefined],
						[0, 0, 2, 4, 0, 0, 0, null, 2, -2],
					];
					const endpoints = percent ? [
						[2/5, -2/5, 1, -1, null, undefined, 0, null, 2/5, -2/5],
						[1, -1, -1, 1, undefined, null, 0, undefined, null, undefined],
						[-1, 1, 1, 1, 1, -1, 0, null, 1, -1],
					] : [
						data[1],
						[5, -5, -4, 4, undefined, null, 0, undefined, null, undefined],
						[-4, 4, 2, 4, 3, -3, 0, null, 5, -5],
					];
					const plot = makePlot(data, {
						stack: {groups: [{series: [1, 2, 3], dir: 0}], percent},
						scales: {
							x: {time: false, ori: horizontal ? 1 : 0, dir, range: [-0.5, 9.5]},
							y: {ori: horizontal ? 0 : 1, dir, range: percent ? [-1, 1] : [-10, 10]},
						},
						hooks: {init: [u => u.series.slice(1).forEach(s => {
							s.fillTo = () => assert.fail('mixed bars must bypass fillTo');
						})]},
					}, {
						disp: {
							y0: {values: () => assert.fail('mixed bars must bypass disp.y0')},
							y1: {values: () => assert.fail('mixed bars must bypass disp.y1')},
						},
					});

					try {
						await frame();
						checkMixed(plot, baselines, endpoints);
						assert.deepEqual(plot.u.bands, [], 'mixed groups do not generate bands');
						assert.deepEqual(data, original, 'transforms must not mutate raw data');
					}
					finally {
						plot.u.destroy();
					}
				});
			}
		}

		it(`restacks visibility before draw and setData synchronously (percent: ${percent})`, async () => {
			const data = [[0, 1], [2, -2], [3, -3], [-4, 4]];
			const original = structuredClone(data);
			const events = [];
			const plot = makePlot(data, {
				stack: {groups: [{series: [1, 2, 3], dir: 0}], percent},
				hooks: Object.fromEntries(['drawClear', 'drawSeries', 'draw'].map(name => [name, [u => {
					events.push({name, base: structuredClone(u._base), end: structuredClone(u._data)});
				}]])),
			});
			const {u} = plot;
			const initialBase = [null, [0, 0], percent ? [2/5, -2/5] : [2, -2], [0, 0]];
			const initialEnd = percent ? [[2/5, -2/5], [1, -1], [-1, 1]] : [[2, -2], [5, -5], [-4, 4]];
			async function drawn(base, end) {
				await frame();
				assert.equal(events.filter(e => e.name == 'draw').length, 1, 'one final draw per update');
				assert.ok(events.some(e => e.name == 'drawClear'));
				assert.ok(events.some(e => e.name == 'drawSeries'));
				for (const event of events) {
					assert.deepEqual(event.base, base, `${event.name} sees final baselines`);
					assert.deepEqual(event.end, [u.data[0], ...end], `${event.name} sees final endpoints`);
				}
				events.length = 0;
				checkMixed(plot, base, end);
			}

			try {
				await drawn(initialBase, initialEnd);
				let previous = u._base;
				u.setSeries(1, {show: false});
				assert.equal(u._base, previous, 'visibility transforms are queued');
				await drawn([null, null, [0, 0], [0, 0]], [data[1], percent ? [1, -1] : data[2], percent ? [-1, 1] : data[3]]);
				assert.notEqual(u._base, previous);
				assert.notEqual(u._base[2], previous[2]);

				previous = u._base;
				u.setSeries(1, {show: true});
				await drawn(initialBase, initialEnd);
				assert.notEqual(u._base, previous);

				const longer = [[0, 1, 2], [-1, 2, 0], [3, -4, 5], [-3, 4, 0]];
				const longerOriginal = structuredClone(longer);
				const longerBase = [null, [0, 0, 0], null, percent ? [-1/4, 1/3, 0] : [-1, 2, 0]];
				const longerEnd = [percent ? [-1/4, 1/3, 0] : longer[1], longer[2], percent ? [-1, 1, 0] : [-4, 6, 0]];
				previous = u._base;
				u.setSeries(2, {show: false});
				u.setData(longer);
				assert.notEqual(u._base, previous);
				assert.deepEqual(u._base, longerBase, 'setData includes pending visibility synchronously');
				assert.deepEqual(u._data, [longer[0], ...longerEnd]);
				await drawn(longerBase, longerEnd);

				const shorter = [[0], [4], [-2], [-6]];
				const shorterBase = [null, [0], [0], percent ? [-1/4] : [-2]];
				const shorterEnd = percent ? [[1], [-1/4], [-1]] : [[4], [-2], [-8]];
				previous = u._base;
				u.setSeries(2, {show: true});
				u.setData(shorter, false);
				assert.notEqual(u._base, previous);
				assert.deepEqual(u._base, shorterBase, 'shorter input leaves no stale tail or hidden entry');
				assert.deepEqual(u._data, [shorter[0], ...shorterEnd]);
				u.redraw();
				await drawn(shorterBase, shorterEnd);
				assert.deepEqual(data, original);
				assert.deepEqual(longer, longerOriginal);
				assert.deepEqual(shorter, [[0], [4], [-2], [-6]]);
			}
			finally {
				u.destroy();
			}
		});

		it(`isolates mixed bar groups, sign-consistent lines, and unstacked bars (percent: ${percent})`, async () => {
			const data = [[0, 1], [2, -2], [4, -4], [3, -3], [6, -6], [1, 2], [2, 3], [7, -7]];
			const lines = uPlot.paths.linear();
			const plot = makePlot(data, {
				stack: {
					groups: [{series: [3, 1], dir: 0}, {series: [2, 4], dir: 0}, {series: [5, 6], dir: 1}],
					percent,
				},
				hooks: {init: [u => [5, 6].forEach(si => {
					u.series[si].paths = lines;
					u.series[si].width = 1;
					u.series[si].stroke = () => 'blue';
				})]},
			});
			const base = [null, percent ? [3/5, -3/5] : [3, -3], [0, 0], [0, 0], percent ? [2/5, -2/5] : [4, -4], null, null, null];
			const end = percent ? [[1, -1], [2/5, -2/5], [3/5, -3/5], [1, -1], [1/3, 2/5], [1, 1], data[7]] :
				[[5, -5], data[2], data[3], [10, -10], data[5], [3, 5], data[7]];

			try {
				await frame();
				checkMixed(plot, base, end);
				assert.deepEqual(plot.u.bands.map(b => [b.series, b.dir]), [[[6, 5], -1]]);
				for (const si of [5, 6]) {
					assert.equal(plot.u.series[si].paths, lines);
					assert.ok(plot.u.series[si]._paths.stroke, `line series ${si} must draw`);
				}
				build(plot, 7);
				for (let i = 0; i < 2; i++)
					checkRect(plot, i, 0, data[7][i]);

				plot.u.setSeries(3, {show: false});
				await frame();
				base[1] = [0, 0];
				base[3] = null;
				end[0] = percent ? [1, -1] : data[1];
				end[2] = data[3];
				checkMixed(plot, base, end);
			}
			finally {
				plot.u.destroy();
			}
		});
	}

	it('retains baselines across path disposal and recreates them after data disposal', async () => {
		const data = [[0, 1], [2, -2], [3, -3]];
		const plot = makePlot(data, {stack: {groups: [{series: [1, 2], dir: 0}]}});
		const {u} = plot;
		const base = [null, [0, 0], [2, -2]];
		const end = [[2, -2], [5, -5]];
		try {
			await frame();
			const previousBase = u._base;
			const previousEnd = u._data;
			const previousPath = u.series[2]._paths;
			assert.ok(previousPath);
			u.clearCache({paths: true});
			assert.equal(u.series[2]._paths, null);
			assert.equal(u._base, previousBase);
			assert.equal(u._data, previousEnd);
			u.redraw(false);
			await frame();
			assert.ok(u.series[2]._paths);
			assert.notEqual(u.series[2]._paths, previousPath);
			assert.equal(u._base, previousBase, 'path rebuild does not restack');
			checkMixed(plot, base, end);

			const rebuiltPath = u.series[2]._paths;
			u.clearCache({data: true});
			assert.equal(u._base, null);
			assert.deepEqual(u.data, [[], [], []]);
			assert.equal(u._data, u.data);
			assert.equal(u.series[2]._paths, rebuiltPath, 'data disposal retains cached paths');
			u.setData(data, false);
			assert.notEqual(u._base, previousBase);
			assert.notEqual(u._base[2], previousBase[2]);
			assert.deepEqual(u._base, base);
			u.redraw(false);
			await frame();
			assert.ok(u.series[2]._paths);
			assert.notEqual(u.series[2]._paths, rebuiltPath);
			checkMixed(plot, base, end);
			assert.deepEqual(data, [[0, 1], [2, -2], [3, -3]]);
		}
		finally {
			u.destroy();
		}
	});

	for (const cache of [{paths: false}, {data: false}, {paths: false, data: false}]) {
		it(`disposes mixed caches after draw hooks (${JSON.stringify(cache)})`, async () => {
			const draws = [];
			const data = [[0, 1], [2, -2], [3, -3]];
			const plot = makePlot(data, {
				stack: {groups: [{series: [1, 2], dir: 0}]},
				cache,
				legend: {show: false},
				hooks: {draw: [u => draws.push({base: u._base, end: u._data, paths: u.series.slice(1).map(s => s._paths)})]},
			});
			const {u} = plot;
			try {
				for (let pass = 0; pass < 2; pass++) {
					await frame();
					assert.equal(draws.length, pass + 1);
					const draw = draws[pass];
					assert.deepEqual(draw.base, [null, [0, 0], [2, -2]]);
					assert.deepEqual(draw.end, [[0, 1], [2, -2], [5, -5]]);
					assert.ok(draw.paths.every(path => path != null), 'draw hooks run before path disposal');
					draw.paths.forEach((path, i) => assert.equal(u.series[i + 1]._paths, cache.paths === false ? null : path));
					if (cache.data === false) {
						assert.equal(u._base, null);
						assert.deepEqual(u._data, [[], [], []]);
						assert.equal(u._data, u.data);
					}
					else {
						assert.equal(u._base, draw.base);
						checkMixed(plot, draw.base, draw.end.slice(1));
					}
					if (pass == 0) {
						if (cache.data === false) {
							u.setData(data);
							assert.deepEqual(u._base, draw.base, 'setData restores baselines synchronously');
							assert.notEqual(u._base, draw.base);
						}
						else
							u.redraw(false);
					}
				}
				draws[1].paths.forEach((path, i) => assert.notEqual(path, draws[0].paths[i]));
				if (cache.data !== false)
					assert.equal(draws[1].base, draws[0].base, 'path-only disposal preserves baselines');
				assert.deepEqual(data, [[0, 1], [2, -2], [3, -3]]);
			}
			finally {
				u.destroy();
			}
		});
	}
});
