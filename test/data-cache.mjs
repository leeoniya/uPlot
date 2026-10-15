import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const paths = u => u.series.slice(1).map(s => s._paths);
const snapshot = data => structuredClone(data);

function frame(u) {
	return {
		extrema: u.series.map(s => [s.min, s.max, s.facets?.map(f => [f.min, f.max])]),
		scales: Object.fromEntries(Object.entries(u.scales).map(([key, s]) => [key, [s.min, s.max]])),
		bbox: { ...u.bbox },
		bitmap: [u.ctx.width, u.ctx.height],
		canvas: JSON.stringify(u.ctx.log),
	};
}

function capture(u) {
	return { data: u.data, internal: u._data, values: snapshot(u.data), internalValues: snapshot(u._data), paths: paths(u), frame: frame(u) };
}

function makeData(mode, typed, offset = 0, length = 3) {
	const column = base => {
		const values = Array.from({ length }, (_, i) => offset + base + i);
		return typed ? Float64Array.from(values) : values;
	};
	return mode == 1
		? [column(0), column(10), column(30)]
		: [null, ...[2, 3, 4].map((count, si) => Array.from({ length: count }, (_, fi) => column(fi == 0 ? 0 : 10 + si * 30 + fi * 10)))];
}

function assertEmpty(actual, original, mode) {
	const seen = new Set();
	function visit(value, source, depth) {
		if (source == null) {
			assert.equal(value, source, 'preserve the mode-2 placeholder');
			return;
		}
		assert.ok(Array.isArray(value), 'replacement containers and columns are ordinary arrays');
		assert.notEqual(value, source, 'replace rather than mutate existing containers');
		assert.ok(!seen.has(value), 'each replacement array is fresh');
		seen.add(value);
		assert.equal(value.length, depth == 0 ? 0 : source.length, 'preserve column and facet counts');
		if (depth > 0)
			source.forEach((child, i) => visit(value[i], child, depth - 1));
	}
	visit(actual, original, mode == 1 ? 1 : 2);
}

function makePlot(mode, distr, cache, source, input, optionData) {
	const trace = { draws: [], ready: [] };
	const options = {
		width: 400,
		height: 200,
		pxRatio: 1,
		mode,
		cache,
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		select: { show: false },
		scales: { x: { time: false, distr } },
		series: input.map((entry, i) => i == 0 ? {} : {
			stroke: 'blue',
			points: { show: false },
			...(mode == 2 ? { facets: entry.map((_, fi) => ({ scale: fi == 0 ? 'x' : 'y' })) } : {}),
		}),
		hooks: {
			init: [(u, opts) => {
				trace.options = opts;
				trace.optionData = opts.data;
			}],
			draw: [u => trace.draws.push(capture(u))],
			ready: [u => trace.ready.push(capture(u))],
		},
	};
	if (source != 'positional')
		options.data = optionData;
	const u = new uPlot(options, source == 'options' ? undefined : input, document.body);
	return { u, trace, options };
}

describe('data cache disposal', () => {

	for (const [name, mode, distr] of [['linear', 1, 1], ['ordinal', 1, 2], ['faceted', 2, 1]]) {
		for (const typed of [false, true]) {
			for (const source of ['positional', 'options', 'both']) {
				for (const [policy, cache, automatic, retainPaths] of [
					['explicit', undefined, false, true],
					['automatic', { data: false }, true, true],
					['automatic without paths', { data: false, paths: false }, true, false],
				]) {
					it(`${name}, ${typed ? 'typed' : 'ordinary'}, ${source}, ${policy}`, async () => {
						const input = makeData(mode, typed);
						const optionData = source == 'both' ? makeData(mode, typed, 100) : input;
						// Unused opts.data must retain its own shape, not the positional dataset's shape.
						if (source == 'both') {
							if (mode == 1)
								optionData.push(typed ? new Float64Array([5, 6, 7]) : [5, 6, 7]);
							else
								optionData[1].push(typed ? new Float64Array([5, 6, 7]) : [5, 6, 7]);
						}
						const originalInput = snapshot(input);
						const originalOptions = snapshot(optionData);
						const { u, trace, options } = makePlot(mode, distr, cache, source, input, optionData);
						try {
							const copiedOptionData = snapshot(trace.optionData);
							await Promise.resolve();
							assert.equal(trace.ready.length, 1);
							assert.equal(trace.draws.length, 1);
							const ready = trace.ready[0];
							if (automatic) {
								assert.equal(ready.data, ready.internal);
								assertEmpty(ready.data, input, mode);
								ready.paths.forEach((path, i) => assert.equal(path, retainPaths ? trace.draws[0].paths[i] : null));
							}
							else
								assert.deepEqual(ready.values, originalInput);

							let current = input;
							for (let pass = 0; pass < 2; pass++) {
								const draw = trace.draws[pass];
								assert.deepEqual(draw.values, current, 'draw hooks see the complete current dataset');
								assert.ok(draw.paths.every(path => path != null), 'paths exist during drawing');

								if (distr == 2)
									assert.deepEqual(draw.internal[0], Array.from({ length: current[0].length }, (_, i) => i));
								if (!automatic)
									u.clearCache({ data: true });

								assertEmpty(u.data, current, mode);
								assert.equal(u.data, u._data, 'public and internal data share the empty structure');
								assert.deepEqual(draw.data, draw.values, 'do not truncate the old public dataset');
								assert.deepEqual(draw.internal, draw.internalValues, 'do not truncate ordinal indices or old internal data');
								assert.deepEqual(frame(u), draw.frame, 'disposal preserves extrema, scales, layout, and canvas commands');
								paths(u).forEach((path, i) => assert.equal(path, retainPaths ? draw.paths[i] : null));
								if (source != 'positional') {
									assert.notEqual(trace.options, options, 'init receives the internal options copy');
									assertEmpty(trace.options.data, trace.optionData, mode);
									assert.deepEqual(trace.optionData, copiedOptionData, 'replace cloned option data without truncating it');
									assert.equal(options.data, optionData);
								}
								assert.deepEqual(input, originalInput, 'caller input is unchanged');
								assert.deepEqual(optionData, originalOptions, 'caller opts.data is unchanged');
								await Promise.resolve();
								assert.equal(trace.draws.length, pass + 1, 'disposal does not schedule a redraw');
								assert.deepEqual(frame(u), draw.frame);

								if (pass == 0) {
									current = makeData(mode, typed, 20, 4);
									const before = snapshot(current);
									u.setData(current);
									await Promise.resolve();
									assert.equal(trace.draws.length, 2, 'setData renders after completed disposal');
									assert.deepEqual(current, before, 'replacement caller data is unchanged');
									assert.notDeepEqual(trace.draws[1].frame.extrema, draw.frame.extrema, 'new data refreshes extrema');
									trace.draws[1].paths.forEach((path, i) => assert.notEqual(path, draw.paths[i], 'new data rebuilds paths'));
								}
							}
							assert.equal(trace.ready.length, 1);
						}
						finally {
							u.destroy();
						}
					});
				}
			}
		}
	}
});
