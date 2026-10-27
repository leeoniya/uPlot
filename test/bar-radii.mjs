import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rectH, rectV } from '../src/paths/utils.js';

function checkCorners(u, path, baseline, value, radii) {
	const rects = path.log.filter(([name]) => name == 'roundRect').flatMap(entry => entry.slice(1));
	assert.equal(rects.length, 1, 'each rounded bar uses one native rounded rectangle');
	const [x, y, w, h, corners] = rects[0];
	const points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
	assert.equal(corners.length, 4);

	const axis = u.scales.y.ori == 0 ? 0 : 1;
	assert.equal(Math.sign(w * h), axis == 0 ? -1 : 1, 'preserves path winding');
	const along = points.map(point => point[axis]);
	const across = points.map(point => point[1 - axis]);
	const length = Math.max(...along) - Math.min(...along);
	const thickness = Math.max(...across) - Math.min(...across);
	const valuePos = u.valToPos(value, 'y', true);
	const basePos = u.valToPos(baseline, 'y', true);

	let valueCorners = 0;
	for (let i = 0; i < points.length; i++) {
		const atValue = Math.abs(points[i][axis] - valuePos) < Math.abs(points[i][axis] - basePos);
		valueCorners += atValue;
		const expected = Math.min(radii[atValue ? 0 : 1] * thickness, thickness / 2, length / 2);
		assert.ok(Math.abs(corners[i] - expected) < 1e-9,
			`${atValue ? 'value' : 'baseline'} corner: expected radius ${expected}, got ${corners[i]}`);
	}
	assert.equal(valueCorners, 2);
}

const variants = [
	{name: 'scalar', radius: 0.3, radii: [0.3, 0], width: 0},
	{name: 'clamped asymmetric pair', radius: [2, 0.1], radii: [2, 0.1], width: 0},
	{name: 'pair with stroke', radius: [0.3, 0.1], radii: [0.3, 0.1], width: 2},
	{name: 'callback with colors', radius: () => [0.3, 0.1], radii: [0.3, 0.1], width: 2, colors: true},
];

const sources = ['zero', 'positive fillTo', 'negative fillTo', 'disp', 'band', 'stack'];

describe('bar value and baseline radii', () => {
	it('clamps each radius independently for short and zero-height bars', () => {
		for (const height of [0, 4, 100]) {
			const end = Math.min(30, 10, height / 2);
			const base = Math.min(1, height / 2);
			const horizontal = new Path2D();
			const vertical = new Path2D();
			rectH(horizontal, 10, 20, 20, height, 30, 1);
			rectV(vertical, 10, 20, 20, height, 30, 1);
			assert.deepEqual(horizontal.log, [['roundRect', [10, 20, 20, height, [end, end, base, base]]]]);
			assert.deepEqual(vertical.log, [['roundRect', [20, 30, height, -20, [end, base, base, end]]]]);
		}
	});

	it('keeps the plain rectangle fast path when both radii are zero', () => {
		const horizontal = new Path2D();
		const vertical = new Path2D();
		rectH(horizontal, 10, 20, 30, 40);
		rectV(vertical, 10, 20, 30, 40);
		assert.deepEqual(horizontal.log, [['rect', [10, 20, 30, 40]]]);
		assert.deepEqual(vertical.log, [['rect', [20, 10, 40, 30]]]);
	});
	for (const horizontal of [false, true]) {
		for (const dir of [1, -1]) {
			for (const source of sources) {
				it(`${source}, horizontal: ${horizontal}, Y direction: ${dir}`, async () => {
					for (const xDir of [1, -1]) {
						for (const variant of variants) {
							const values = [8, 2, -2, -8];
							let baselines = [0, 0, 0, 0];
							let endpoints = values;
							let data = [[0, 1, 2, 3], values];
							let si = 1;
							let extra = {};
							let fillTo = () => 0;
							const disp = {};
							const fills = ['red', 'blue', 'red', 'blue'];
							const strokes = ['green', 'orange', 'green', 'orange'];

							if (source.endsWith('fillTo')) {
								const base = source == 'positive fillTo' ? 5 : -5;
								baselines = Array(4).fill(base);
								fillTo = () => base;
							}
							else if (source == 'disp' || source == 'band') {
								baselines = [3, 6, -6, -3];
								if (source == 'disp') {
									disp.y0 = {values: () => baselines};
									disp.y1 = {values: () => values};
									data = [data[0], [1, 1, 1, 1]];
								}
								else {
									data = [data[0], baselines, values];
									si = 2;
									extra.bands = [{series: [2, 1]}];
								}
							}
							else if (source == 'stack') {
								data = [data[0], [3, -3, 3, -3], [4, -4, -5, 5]];
								baselines = [3, -3, 0, 0];
								endpoints = [7, -7, -5, 5];
								si = 2;
								extra.stack = {groups: [{series: [1, 2], dir: 0}]};
							}

							if (variant.colors) {
								disp.fill = {values: () => fills};
								disp.stroke = {values: () => strokes};
							}

							const paths = uPlot.paths.bars({radius: variant.radius, size: [0.6, 40], disp});
							const u = new uPlot({
								width: 400, height: 300, pxRatio: 1,
								axes: [], cursor: {show: false}, legend: {show: false},
								scales: {
									x: {time: false, ori: horizontal ? 1 : 0, dir: xDir, range: [-0.5, 3.5]},
									y: {ori: horizontal ? 0 : 1, dir, range: [-10, 10]},
								},
								series: [{}, ...data.slice(1).map(() => ({
									paths, width: variant.width, fill: 'red', stroke: 'blue', fillTo, points: {show: false},
								}))],
								...extra,
							}, data, document.body);

							try {
								await Promise.resolve();
								for (let i = 0; i < values.length; i++) {
									const built = paths(u, si, i, i);
									for (const [kind, colors] of [['fill', fills], ['stroke', strokes]]) {
										if (built[kind] != null) {
											const path = variant.colors ? built[kind].get(colors[i]) : built[kind];
											checkCorners(u, path, baselines[i], endpoints[i], variant.radii);
										}
									}
								}
							}
							finally {
								u.destroy();
							}
						}
					}
				});
			}
		}
	}
});
