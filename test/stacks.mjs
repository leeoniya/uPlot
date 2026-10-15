import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const frame = () => new Promise(requestAnimationFrame);

const bandState = u => u.bands.map(({series, dir}) => ({series: series.slice(), dir}));

const initialBands = [
	{series: [2, 1], dir: -1},
	{series: [4, 3], dir: 1},
];

function internalData(data) {
	return [
		data[0],
		data[1],
		data[2].map((value, i) => value + data[1][i]),
		data[3],
		data[4].map((value, i) => value + data[3][i]),
	];
}

function makePlot() {
	const data = [
		[0, 1, 2],
		[1, 2, 3],
		[10, 20, 30],
		[-1, -2, -3],
		[-10, -20, -30],
	];
	const original = structuredClone(data);
	const rangeInputs = {};
	const exactRange = key => (u, min, max) => {
		rangeInputs[key] = [min, max];
		return [min, max];
	};
	const value = (u, value) => value;

	const u = new uPlot({
		width: 400,
		height: 300,
		pxRatio: 1,
		axes: [],
		cursor: {show: false},
		stack: {
			groups: [
				{series: [1, 2], dir: 1},
				{series: [3, 4], dir: -1},
			],
		},
		scales: {
			x: {time: false, range: exactRange('x')},
			positive: {range: exactRange('positive')},
			negative: {range: exactRange('negative')},
		},
		series: [
			{},
			{label: 'Positive 1', scale: 'positive', stroke: 'red', value},
			{label: 'Positive 2', scale: 'positive', stroke: 'orange', value},
			{label: 'Negative 1', scale: 'negative', stroke: 'blue', value},
			{label: 'Negative 2', scale: 'negative', stroke: 'green', value},
		],
	}, data, document.body);

	return {u, data, original, rangeInputs};
}

function makeOrdinalPlot(data) {
	const value = (u, value) => value;
	return new uPlot({
		width: 400, height: 300, pxRatio: 1,
		axes: [{incrs: [1]}, {show: false}],
		cursor: {show: false},
		stack: {groups: [{series: [1, 2], dir: 1}]},
		scales: {x: {time: false, distr: 2}},
		series: [{value}, {stroke: 'red', value}, {stroke: 'blue', value}],
	}, data, document.body);
}

describe('integrated stacking', () => {
	it('keeps public data raw, stacks away from zero, and reports only data extrema', async () => {
		const {u, data, original, rangeInputs} = makePlot();

		try {
			await frame();

			assert.equal(u.data, data);
			assert.deepEqual(u.data, original);
			assert.notEqual(u._data, u.data);
			assert.deepEqual(u._data, internalData(data));
			assert.deepEqual(bandState(u), initialBands);
			assert.deepEqual(rangeInputs.positive, [1, 33]);
			assert.deepEqual(rangeInputs.negative, [-33, -1]);
			assert.deepEqual([u.scales.positive.min, u.scales.positive.max], [1, 33]);
			assert.deepEqual([u.scales.negative.min, u.scales.negative.max], [-33, -1]);

			u.setLegend({idx: 1});
			assert.deepEqual(u.legend.values.slice(1).map(record => record._), [2, 20, -2, -20]);

			assert.deepEqual(data, original);
		}
		finally {
			u.destroy();
		}
	});

	it('leaves series unchanged after each unsupported addition and deletion', async () => {
		const {u} = makePlot();

		try {
			await frame();
			const members = u.series.slice();
			const derived = u._data;
			const bands = bandState(u);
			for (const change of [() => u.addSeries({}), () => u.delSeries(1)]) {
				change();
				assert.equal(u.series.length, members.length);
				members.forEach((member, si) => assert.equal(u.series[si], member));
				assert.equal(u._data, derived);
				assert.deepEqual(bandState(u), bands);
			}
		}
		finally {
			u.destroy();
		}
	});

	for (const percent of [false, true]) {
		it(`coalesces visibility restacking in the commit before drawing (percent: ${percent})`, async () => {
			const members = Array.from({length: 16}, (_, i) => i + 1);
			let reads = 0;
			const draws = [];
			const data = [[0, 1], ...members.map(() => new Proxy([1, 1], {
				get(target, key) {
					if (typeof key == 'string' && /^\d+$/.test(key))
						reads++;
					return target[key];
				},
			}))];
			const u = new uPlot({
				width: 400, height: 300, axes: [], cursor: {show: false},
				stack: {groups: [{series: members, dir: 1}], percent},
				scales: {x: {time: false}, y: {range: [0, 20]}},
				series: [{}, ...members.map(() => ({show: false}))],
				hooks: {draw: [u => draws.push({data: u._data, bands: bandState(u), reads})]},
			}, data, document.body);

			function resetCounts() {
				reads = 0;
				draws.length = 0;
			}

			function checkShown(count = members.length) {
				assert.equal(draws.length, 1);
				assert.equal(draws[0].data, u._data);
				assert.equal(draws[0].reads, count * data[0].length);
				assert.equal(reads, count * data[0].length);
				assert.deepEqual(draws[0].data[members.length], Array(2).fill(percent ? 1 : count));
				assert.equal(draws[0].bands.length, count - 1);
			}

			try {
				await frame();
				resetCounts();
				u.setSeries(null, {show: true});
				assert.equal(reads, 0);
				assert.equal(draws.length, 0);
				await frame();
				checkShown();

				const derived = u._data;
				resetCounts();
				u.setSeries(null, {show: true});
				await frame();
				assert.equal(reads, 0);
				assert.equal(u._data, derived);

				resetCounts();
				u.setSeries(null, {show: false});
				await frame();
				assert.equal(reads, 0);
				assert.equal(draws.length, 1);
				assert.deepEqual(draws[0].bands, []);
				members.forEach(si => assert.equal(draws[0].data[si], data[si]));

				resetCounts();
				members.forEach(si => u.setSeries(si, {show: true}));
				assert.equal(reads, 0);
				await frame();
				checkShown();

				for (const deferHooks of [false, true]) {
					resetCounts();
					u.batch(() => {
						u.setSeries(null, {show: false});
						members.forEach(si => u.setSeries(si, {show: true}));
						assert.equal(reads, 0);
					}, deferHooks);
					assert.equal(reads, members.length * data[0].length);
					await frame();
					checkShown();
				}

				for (const resetScales of [true, false]) {
					resetCounts();
					u.setSeries(1, {show: false});
					u.setData(data, resetScales);
					const updated = u._data;
					assert.equal(reads, (members.length - 1) * data[0].length);
					await frame();
					checkShown(members.length - 1);
					assert.equal(u._data, updated, 'setData consumes the pending restack');

					resetCounts();
					u.setSeries(1, {show: true});
					await frame();
					checkShown();
				}
			}
			finally {
				u.destroy();
			}
		});

		for (const dir of [1, -1]) {
			it(`draw hooks see final stack values and label positions (percent: ${percent}, dir: ${dir})`, async () => {
				const draws = [];
				const pathValues = [];
				const linear = uPlot.paths.linear();
				let rangeInput;
				let hideFromDraw = false;
				const u = new uPlot({
					width: 400, height: 300, pxRatio: 1, axes: [], cursor: {show: false},
					stack: {groups: [{series: [1, 2, 3], dir}], percent},
					scales: {
						x: {time: false},
						y: {range: (u, min, max) => {
							rangeInput = [min, max];
							return [-10, 10];
						}},
					},
					series: [{}, ...[1, 2, 3].map(() => ({
						stroke: 'red',
						paths: (u, si, i0, i1) => {
							if (si == 2)
								pathValues.push(u._data[si][1]);
							return linear(u, si, i0, i1);
						},
					}))],
					hooks: {draw: [u => {
						const value = u._data[2][1];
						const y = u.valToPos(value, 'y', true);
						u.ctx.fillText(u.data[2][1], u.valToPos(1, 'x', true), y);
						draws.push({value, y, range: rangeInput, bands: bandState(u)});
						if (hideFromDraw) {
							hideFromDraw = false;
							u.setSeries(1, {show: false});
						}
					}]},
				}, [[0, 1, 2], [dir, dir, dir], [3 * dir, 3 * dir, 3 * dir], [2 * dir, 2 * dir, 2 * dir]], document.body);

				try {
					await frame();
					draws.length = pathValues.length = 0;
					u.setSeries(1, {show: false});
					u.setSeries(3, {show: false});
					await frame();
					const value = dir * (percent ? 1 : 3);
					assert.deepEqual(pathValues, [value]);
					assert.deepEqual(draws, [{value, y: u.valToPos(value, 'y', true), range: [value, value], bands: []}]);

					draws.length = pathValues.length = 0;
					u.batch(() => u.setSeries(null, {show: true}));
					assert.equal(draws.length, 1);
					assert.equal(draws[0].value, dir * (percent ? 4 / 6 : 4));
					assert.deepEqual(draws[0].bands, [
						{series: [2, 1], dir: -dir},
						{series: [3, 2], dir: -dir},
					]);

					draws.length = pathValues.length = 0;
					hideFromDraw = true;
					u.redraw(false);
					await frame();
					assert.equal(draws.length, 2, 'a draw-hook visibility change gets a follow-up commit');
					assert.equal(draws[1].value, dir * (percent ? 3 / 5 : 3));
					assert.equal(draws[1].y, u.valToPos(draws[1].value, 'y', true));
					assert.deepEqual(pathValues, [draws[1].value]);
					assert.deepEqual(draws[1].bands, [{series: [3, 2], dir: -dir}]);
				}
				finally {
					u.destroy();
				}
			});
		}

		it(`refreshes stationary stack cursor markers with fixed bounds (percent: ${percent})`, async () => {
			const limit = percent ? 1 : 10;
			const data = [[0, 1, 2], [1, 1, 1], [3, 3, 3], [2, 2, 2]];
			const u = new uPlot({
				width: 400, height: 300, pxRatio: 1, pxAlign: 0, padding: [0, 0, 0, 0], axes: [],
				stack: {groups: [{series: [1, 2, 3], dir: 1}], percent},
				scales: {x: {time: false, range: [0, 2]}, y: {range: [0, limit]}},
				series: [{}, ...[1, 2, 3].map(() => ({stroke: 'red', points: {width: 0}, value: (u, v) => v}))],
			}, data, document.body);

			function check(value) {
				const pt = u.over.querySelectorAll('.u-cursor-pt')[1];
				const position = pt.style.transform.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
				assert.ok(Math.abs(position[1] - u.valToPos(value, 'y')) < 1e-9);
				assert.equal(pt.classList.contains('u-off'), false);
				assert.equal(u.legend.values[2]._, 3);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [0, limit]);
			}

			try {
				await frame();
				u.setCursor({left: u.valToPos(1, 'x'), top: 150});
				check(percent ? 4 / 6 : 4);
				u.setSeries(1, {show: false});
				await frame();
				check(percent ? 3 / 5 : 3);
				u.setSeries(1, {show: true});
				await frame();
				check(percent ? 4 / 6 : 4);
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const dir of [1, -1]) {
		it(`normalizes cumulative totals exactly to ${dir}`, async () => {
			const members = Array.from({length: 9}, (_, i) => i + 1);
			const data = [[0, 1, 2], ...members.map(() => [dir, 0, null])];
			const u = new uPlot({
				width: 400, height: 300, axes: [], cursor: {show: false},
				stack: {groups: [{series: members, dir}], percent: true},
				scales: {x: {time: false}},
				series: [{}, ...members.map(() => ({}))],
			}, data, document.body);

			try {
				await frame();
				members.forEach(si => assert.deepEqual(u._data[si], [dir * si / 9, 0, null]));
				assert.deepEqual(u._data[9], [dir, 0, null]);
			}
			finally {
				u.destroy();
			}
		});
	}

	it('omits hidden series and rebuilds stack bands', async () => {
		const {u, data, original, rangeInputs} = makePlot();

		try {
			await frame();
			u.setSeries(1, {show: false});
			await frame();

			assert.equal(u.data, data);
			assert.deepEqual(u.data, original);
			assert.deepEqual(u._data, [data[0], data[1], data[2], data[3], [-11, -22, -33]]);
			assert.deepEqual(bandState(u), [{series: [4, 3], dir: 1}]);
			assert.deepEqual(rangeInputs.positive, [10, 30]);
			assert.deepEqual([u.scales.positive.min, u.scales.positive.max], [10, 30]);

			u.setSeries(1, {show: true});
			await frame();

			assert.deepEqual(u._data, internalData(data));
			assert.deepEqual(bandState(u), initialBands);
			assert.deepEqual(rangeInputs.positive, [1, 33]);
			assert.deepEqual(data, original);
		}
		finally {
			u.destroy();
		}
	});

	for (const dir of [1, -1, 0]) {
		it(`invalidates only changed stack scales and preserves unrelated fill extrema (dir: ${dir})`, async () => {
			const values = dir == 0 ? [1, -2, 3] : [dir, 2 * dir, 3 * dir];
			const data = [[0, 1, 2], values, values.map(v => v * 10), values.map(v => v * 2), values.map(v => v * 20), [40, 60, 50]];
			const rangeCalls = {x: [], a: [], b: [], unrelated: []};
			const range = key => (u, min, max) => {
				rangeCalls[key].push([min, max]);
				return [min, max];
			};
			const fillInputs = [];
			const pathCalls = [];
			const paths = dir == 0 ? uPlot.paths.bars() : uPlot.paths.linear();
			const linear = uPlot.paths.linear();
			const u = new uPlot({
				width: 400, height: 300, pxRatio: 1, axes: [], cursor: {show: false},
				stack: {groups: [{series: [1, 2], dir}, {series: [3, 4], dir}]},
				scales: {
					x: {time: false, range: range('x')},
					a: {range: range('a')},
					b: {range: range('b')},
					unrelated: {range: range('unrelated')},
				},
				series: [{}, ...['a', 'a', 'b', 'b', 'unrelated'].map(scale => ({
					scale, stroke: 'red', fill: 'red', points: {show: false},
					paths: (u, si, i0, i1) => {
						pathCalls.push(si);
						return (scale == 'unrelated' ? linear : paths)(u, si, i0, i1);
					},
					...(scale == 'unrelated' ? {fillTo: (u, si, min, max) => {
						fillInputs.push([min, max]);
						return min;
					}} : {}),
				}))],
			}, data, document.body);

			function resetCalls() {
				Object.values(rangeCalls).forEach(calls => calls.length = 0);
				fillInputs.length = pathCalls.length = 0;
			}

			function check(aTotal, bTotal, dirty) {
				const expected = [data[0], data[1], values.map(v => v * aTotal), data[3], values.map(v => v * bTotal), data[5]];
				assert.deepEqual(u._data, expected);
				const visible = u.series.map((s, si) => si).filter(si => si > 0 && u.series[si].show);
				for (const si of visible) {
					assert.deepEqual([u.series[si].min, u.series[si].max], [Math.min(...expected[si]), Math.max(...expected[si])], `series ${si} extrema`);
				}
				for (const key of ['a', 'b', 'unrelated']) {
					const values = visible.filter(si => u.series[si].scale == key).flatMap(si => expected[si]);
					const extrema = [Math.min(...values), Math.max(...values)];
					assert.deepEqual([u.scales[key].min, u.scales[key].max], extrema, `${key} scale extrema`);
					assert.deepEqual(rangeCalls[key], dirty.includes(key) ? [extrema] : [], `${key} range calls`);
				}
				assert.deepEqual(rangeCalls.x, [], 'the x scale is untouched');
				assert.deepEqual(fillInputs, [[40, 60]], 'rebuilt unrelated fill receives cached extrema');
				assert.deepEqual(pathCalls, visible, 'all visible paths are rebuilt');
			}

			try {
				await frame();
				assert.deepEqual(fillInputs, [[40, 60]]);
				resetCalls();
				u.setSeries(1, {show: false});
				await frame();
				check(10, 22, ['a']);

				resetCalls();
				u.batch(() => {
					u.setSeries(1, {show: true});
					u.setSeries(3, {show: false});
				});
				await frame();
				check(11, 20, ['a', 'b']);

				resetCalls();
				u.setSeries(3, {show: true});
				await frame();
				check(11, 22, ['b']);
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const resetScales of [true, false]) {
		it(`invalidates each Y minimum once when setData consumes pending visibility (resetScales: ${resetScales})`, async () => {
			const {u, data} = makePlot();
			const invalidations = [0, 0, 0, 0];

			try {
				await frame();
				u.series.slice(1).forEach((s, i) => {
					let min = s.min;
					Object.defineProperty(s, 'min', {
						configurable: true,
						get: () => min,
						set(value) {
							if (value === null)
								invalidations[i]++;
							min = value;
						},
					});
				});

				u.setSeries(1, {show: false});
				assert.deepEqual(invalidations, [0, 0, 0, 0], 'visibility invalidation remains deferred');
				u.setData(data, resetScales);
				// Later X-scale ranging can invalidate extrema independently of setData.
				const setDataInvalidations = invalidations.slice();
				const derived = u._data;
				await frame();

				assert.equal(u._data, derived, 'the commit does not restack again');
				assert.deepEqual(u._data, [data[0], data[1], data[2], data[3], [-11, -22, -33]]);
				assert.deepEqual(setDataInvalidations, [1, 1, 1, 1], 'the full setData reset also covers the dirty stack scale');
			}
			finally {
				u.destroy();
			}
		});
	}

	it('recomputes derived data without mutating setData input', async () => {
		const {u} = makePlot();
		const data = [
			[3, 4],
			[4, 5],
			[6, 7],
			[-4, -5],
			[-6, -7],
		];
		const original = structuredClone(data);

		try {
			await frame();
			u.setData(data);
			await frame();

			assert.equal(u.data, data);
			assert.deepEqual(u.data, original);
			assert.deepEqual(u._data, [data[0], data[1], [10, 12], data[3], [-10, -12]]);
			u.setLegend({idx: 1});
			assert.deepEqual(u.legend.values.slice(1).map(record => record._), [5, 7, -5, -7]);
			assert.deepEqual(data, original);
		}
		finally {
			u.destroy();
		}
	});

	it('normalizes each visible group for percent stacking', async () => {
		const data = [
			[0, 1, 2],
			[1, 0, null],
			[3, 0, 2],
			[-1, 0, null],
			[-3, 0, -2],
		];
		const original = structuredClone(data);
		const value = (u, value) => value;
		const u = new uPlot({
			width: 400,
			height: 300,
			pxRatio: 1,
			axes: [],
			cursor: {show: false},
			stack: {
				groups: [
					{series: [1, 2], dir: 1},
					{series: [3, 4], dir: -1},
				],
				percent: true,
			},
			scales: {
				x: {time: false},
				positive: {range: [0, 1]},
				negative: {range: [-1, 0]},
			},
			series: [
				{},
				{scale: 'positive', value},
				{scale: 'positive', value},
				{scale: 'negative', value},
				{scale: 'negative', value},
			],
		}, data, document.body);

		try {
			await frame();
			assert.equal(u.data, data);
			assert.deepEqual(u.data, original);
			assert.deepEqual(u._data, [
				data[0],
				[0.25, 0, null],
				[1, 0, 1],
				[-0.25, 0, null],
				[-1, 0, -1],
			]);
			u.setLegend({idx: 0});
			assert.deepEqual(u.legend.values.slice(1).map(record => record._), [1, 3, -1, -3]);

			u.setSeries(1, {show: false});
			await frame();
			assert.equal(u._data[1], data[1]);
			assert.deepEqual(u._data[2], [1, 0, 1]);
			assert.deepEqual(u._data.slice(3), [[-0.25, 0, null], [-1, 0, -1]]);
			assert.deepEqual(data, original);
		}
		finally {
			u.destroy();
		}
	});

	it('reuses the ordinal X ramp across visibility restacks', async () => {
		const data = [[10, 20, 30], [1, 2, 3], [4, 5, 6]];
		const u = makeOrdinalPlot(data);

		try {
			await frame();
			const ramp = u._data[0];
			assert.notEqual(ramp, data[0]);
			assert.deepEqual(ramp, [0, 1, 2]);

			for (const show of [false, true]) {
				u.setSeries(1, {show});
				await frame();
				assert.deepEqual(u._data[2], show ? [5, 7, 9] : [4, 5, 6]);
				assert.equal(u._data[0], ramp, 'visibility does not replace the ordinal ramp');
				assert.deepEqual(ramp, [0, 1, 2]);
			}
		}
		finally {
			u.destroy();
		}
	});

	it('reuses the ordinal X ramp but refreshes raw legend and axis values on same-length setData', async () => {
		const data = [[10, 20, 30], [1, 2, 3], [4, 5, 6]];
		const updated = [[40, 60, 90], [1, 2, 3], [4, 5, 6]];
		const original = structuredClone(updated);
		const u = makeOrdinalPlot(data);

		try {
			await frame();
			const ramp = u._data[0];
			assert.deepEqual(u.axes[0]._values, ['10', '20', '30']);
			u.setLegend({idx: 1});
			assert.deepEqual(u.legend.values.map(record => record._), [20, 2, 5]);

			u.setData(updated);
			await frame();
			u.setLegend({idx: 1});
			assert.equal(u.data, updated);
			assert.deepEqual(u._data, [[0, 1, 2], [1, 2, 3], [5, 7, 9]]);
			assert.deepEqual(u.legend.values.map(record => record._), [60, 2, 5]);
			assert.deepEqual(u.axes[0]._values, ['40', '60', '90']);
			assert.deepEqual(updated, original);
			assert.deepEqual(data[0], [10, 20, 30]);
			assert.equal(u._data[0], ramp, 'new raw categories do not replace a same-length ramp');
		}
		finally {
			u.destroy();
		}
	});

	it('allocates and fills ordinal X ramps for larger, smaller, empty, and restored data', async () => {
		const u = makeOrdinalPlot([[10, 20, 30], [1, 1, 1], [2, 2, 2]]);

		try {
			await frame();
			assert.deepEqual(u._data[0], [0, 1, 2]);
			for (const categories of [[40, 50, 60, 70], [80, 90], [], [100, 110, 120]]) {
				const previous = u._data[0];
				const previousValues = previous.slice();
				const data = [categories, categories.map(() => 1), categories.map(() => 2)];
				const original = structuredClone(data);
				u.setData(data);
				await frame();

				assert.equal(u.data, data);
				assert.notEqual(u._data[0], previous, 'a length change allocates a new ramp');
				assert.notEqual(u._data[0], categories);
				assert.deepEqual(u._data, [categories.map((_, i) => i), data[1], categories.map(() => 3)]);
				assert.deepEqual(previous, previousValues, 'old ramps are not resized or overwritten');
				assert.deepEqual(data, original);
				if (categories.length > 0) {
					assert.deepEqual(u.axes[0]._values, categories.map(String));
					u.setLegend({idx: categories.length - 1});
					assert.equal(u.legend.values[0]._, categories.at(-1));
				}
			}
		}
		finally {
			u.destroy();
		}
	});

	it('restores a filled ordinal X ramp after data-cache disposal', async () => {
		const data = [[10, 20, 30], [1, 2, 3], [4, 5, 6]];
		const original = structuredClone(data);
		const u = makeOrdinalPlot(data);

		try {
			await frame();
			const previous = u._data[0];
			u.clearCache({data: true});
			const disposed = u._data[0];
			assert.deepEqual(u._data, [[], [], []]);
			assert.notEqual(disposed, previous);
			assert.deepEqual(previous, [0, 1, 2]);

			u.setData(data);
			await frame();
			assert.notEqual(u._data[0], disposed, 'restore must not reuse the empty cache replacement');
			assert.notEqual(u._data[0], previous, 'disposal releases the old ramp');
			assert.notEqual(u._data[0], data[0]);
			assert.deepEqual(u._data, [[0, 1, 2], [1, 2, 3], [5, 7, 9]]);
			assert.deepEqual(disposed, []);
			assert.deepEqual(u.axes[0]._values, ['10', '20', '30']);
			u.setLegend({idx: 2});
			assert.deepEqual(u.legend.values.map(record => record._), [30, 3, 6]);
			assert.equal(u.data, data);
			assert.deepEqual(data, original);
		}
		finally {
			u.destroy();
		}
	});

	it('retains raw categories while stacking ordinal data', async () => {
		const data = [[10, 20], [1, 2], [3, 4]];
		const value = (u, value) => value;
		const u = new uPlot({
			width: 400,
			height: 300,
			pxRatio: 1,
			axes: [],
			cursor: {show: false},
			stack: {groups: [{series: [1, 2], dir: 1}]},
			scales: {x: {time: false, distr: 2}},
			series: [{value}, {stroke: 'red', value}, {stroke: 'blue', value}],
		}, data, document.body);

		try {
			await frame();
			assert.equal(u.data, data);
			assert.deepEqual(u._data, [[0, 1], [1, 2], [4, 6]]);
			u.setLegend({idx: 1});
			assert.deepEqual(u.legend.values.map(record => record._), [20, 2, 4]);
		}
		finally {
			u.destroy();
		}
	});

});
