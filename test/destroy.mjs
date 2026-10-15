import assert from 'node:assert/strict';

import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const frame = () => new Promise(requestAnimationFrame);
const paths = u => u.series.slice(1).map(s => s._paths);

function makeData(mode = 1, typed = false, offset = 0) {
	const column = base => {
		const values = [base, base + 1, base + 2].map(v => v + offset);
		return typed ? Float64Array.from(values) : values;
	};
	return mode == 1
		? [column(10), column(20), column(30)]
		: [null, [column(10), column(20)], [column(10), column(30), column(40)]];
}

function optionsFor(data, mode = 1, distr = 1) {
	return {
		width: 400, height: 240, pxRatio: 1, mode,
		scales: { x: { time: false, distr } },
		series: data.map((entry, i) => i == 0 ? {} : {
			stroke: 'blue',
			points: { show: false },
			...(mode == 2 ? { facets: entry.map((_, fi) => ({ scale: fi == 0 ? 'x' : 'y' })) } : {}),
		}),
	};
}

function assertEmpty(actual, source, mode) {
	const seen = new Set();
	function visit(value, old, depth) {
		if (old == null) {
			assert.equal(value, old, 'preserve nullish mode-2 placeholders');
			return;
		}
		assert.ok(Array.isArray(value), 'empty replacements are ordinary arrays');
		assert.notEqual(value, old, 'replace, never truncate, caller or cached arrays');
		assert.ok(!seen.has(value), 'replacement arrays do not alias one another');
		seen.add(value);
		assert.equal(value.length, depth == 0 ? 0 : old.length, 'preserve series and facet counts');
		if (depth > 0)
			old.forEach((child, i) => visit(value[i], child, depth - 1));
	}
	visit(actual, source, mode == 1 ? 1 : 2);
}

function assertDisposed(u, source, mode = 1) {
	assertEmpty(u.data, source, mode);
	assert.equal(u._data, u.data);
	assert.equal(u._base, null);
	assert.ok(paths(u).every(path => path === null));
	assert.ok(u.series.slice(1).every(s => s.points._paths === null));
	assert.equal(u.root.isConnected, false);
}

function assertInert(u, opts) {
	const data = u.data;
	const optionData = opts?.data;
	const values = u.legend.values;
	const idxs = u.cursor.idxs;
	assert.doesNotThrow(() => u.destroy());
	assert.equal(u.data, data, 'repeated destroy does not even replace the empty data');
	assert.equal(u._data, data);
	assert.equal(opts?.data, optionData);
	assert.equal(u.legend.values, values);
	assert.equal(u.cursor.idxs, idxs);
}

function mixedData(typed) {
	const data = [[10, 20, 30], [2, -2, 2], [3, -3, -3], [-4, 4, 4]];
	return typed ? data.map(row => Float64Array.from(row)) : data;
}

function stackOptions(data, percent) {
	return {
		...optionsFor(data),
		stack: { groups: [{ series: [1, 2, 3], dir: 0 }], percent },
	};
}

describe('destroy cache disposal', () => {
	// Rotate retention policies instead of taking another full Cartesian product.
	for (const [name, mode, distr] of [['linear', 1, 1], ['ordinal', 1, 2], ['faceted', 2, 1]]) {
		for (const typed of [false, true]) {
			for (const [index, source] of ['positional', 'options', 'both'].entries()) {
				const policy = ['default', 'true', 'false'][(index + distr + Number(typed)) % 3];
				it(`${name}, ${typed ? 'typed' : 'ordinary'}, ${source}, cache.data=${policy}`, async () => {
					const input = makeData(mode, typed);
					const optionData = source == 'both' ? makeData(mode, typed, 100) : input;
					// Ignored opts.data has its own shape, independent of positional data.
					if (source == 'both')
						(mode == 1 ? optionData : optionData[1]).push(typed ? new Float64Array([7, 8, 9]) : [7, 8, 9]);
					const inputValues = structuredClone(input);
					const optionValues = structuredClone(optionData);
					let opts, draws = 0, destroys = 0;
					const options = {
						...optionsFor(input, mode, distr),
						...(policy == 'default' ? {} : { cache: { data: policy == 'true' } }),
						...(source == 'positional' ? {} : { data: optionData }),
						hooks: { init: [(u, internalOpts) => { opts = internalOpts; }], draw: [() => draws++] },
					};
					const u = new uPlot(options, source == 'options' ? undefined : input, document.body);
					try {
						await frame();
						assert.equal(draws, 1);
						assert.ok(paths(u).every(path => path != null));
						assert.ok(u.axes.every(axis => axis._splits.length > 0 && axis._values.length > 0));
						if (policy == 'false')
							assertEmpty(u.data, input, mode);
						else {
							assert.deepEqual(u.data, inputValues);
							if (distr == 2)
								assert.deepEqual(u._data[0], [0, 1, 2]);
							u.setCursor({ left: u.valToPos(distr == 2 ? 1 : 11, 'x'), top: 30 });
							u.setLegend({ idx: 1 });
							assert.equal(u.legend.idx, 1);
							assert.ok(u.legend.values.some(value => value != null));
						}
						u.over.dispatchEvent(new MouseEvent('mouseenter'));
						assert.ok(u.cursor.event instanceof MouseEvent);
						const before = {
							data: u.data, internal: u._data,
							dataValues: structuredClone(u.data), internalValues: structuredClone(u._data),
							optionData: opts.data, optionValues: structuredClone(opts.data),
						};
						u.hooks.destroy = [self => {
							destroys++;
							assertDisposed(self, before.data, mode);
							if (source != 'positional')
								assertEmpty(opts.data, before.optionData, mode);
						}];
						u.destroy();
						assertDisposed(u, before.data, mode);
						if (source != 'positional') {
							assert.notEqual(opts, options);
							assertEmpty(opts.data, before.optionData, mode);
							assert.notEqual(opts.data, u.data);
							assert.equal(options.data, optionData);
						}
						assert.deepEqual(before.data, before.dataValues);
						assert.deepEqual(before.internal, before.internalValues);
						assert.deepEqual(before.optionData, before.optionValues);
						assert.deepEqual(input, inputValues);
						assert.deepEqual(optionData, optionValues);
						assertInert(u, opts);
						await frame();
						assert.equal(destroys, 1);
						assert.equal(draws, 1, 'pending work does not draw after destruction');
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	for (const percent of [false, true]) {
		for (const typed of [false, true]) {
			it(`clears mixed-sign stack endpoints and baselines (percent=${percent}, typed=${typed})`, async () => {
				const input = mixedData(typed);
				const original = structuredClone(input);
				const u = new uPlot({ ...stackOptions(input, percent), cache: { data: true, paths: true } }, input, document.body);
				try {
					await frame();
					const normalize = rows => rows.map(row => row.map((value, i) => percent ? value / (value < 0 ? [4, 5, 3][i] : [5, 4, 6][i]) : value));
					const expectedBase = [null, ...normalize([[0, 0, 0], [2, -2, 0], [0, 0, 2]])];
					const expectedData = [input[0], ...normalize([[2, -2, 2], [5, -5, -3], [-4, 4, 6]])];
					assert.deepEqual(u._base, expectedBase);
					assert.deepEqual(u._data, expectedData);
					const base = u._base;
					const internal = u._data;
					let destroys = 0;
					u.hooks.destroy = [self => {
						destroys++;
						assertDisposed(self, input);
					}];
					u.destroy();
					assertDisposed(u, input);
					assert.deepEqual(base, expectedBase, 'do not mutate retained baseline arrays');
					assert.deepEqual(internal, expectedData, 'do not mutate retained cumulative arrays');
					assert.deepEqual(input, original);
					assertInert(u);
					assert.equal(destroys, 1);
				}
				finally { u.destroy(); }
			});
		}
	}

	it('releases point paths from visible and subsequently hidden series', async () => {
		const input = makeData();
		const opts = optionsFor(input);
		opts.series.slice(1).forEach(s => { s.points.show = true; });
		const u = new uPlot(opts, input, document.body);
		try {
			await frame();
			const pointPaths = u.series.slice(1).map(s => s.points._paths);
			assert.ok(pointPaths.every(paths => paths?.fill != null && paths.clip != null));
			u.setSeries(2, { show: false });
			await frame();
			assert.equal(u.series[2].points._paths, pointPaths[1]);
			u.destroy();
			assertDisposed(u, input);
			assert.ok(pointPaths.every(paths => paths.fill != null && paths.clip != null), 'drop references without mutating caller-retained paths');
		}
		finally { u.destroy(); }
	});

	for (const mode of [1, 2]) {
		it(`destroys before the initial commit despite cache.data=false (mode=${mode})`, async () => {
			const input = makeData(mode, true);
			const original = structuredClone(input);
			let opts, draws = 0, ready = 0, destroys = 0;
			const u = new uPlot({
				...optionsFor(input, mode), data: input, cache: { data: false, paths: false },
				hooks: {
					init: [(u, internalOpts) => { opts = internalOpts; }],
					draw: [() => draws++], ready: [() => ready++],
					destroy: [self => { destroys++; assertDisposed(self, input, mode); }],
				},
			}, undefined, document.body);
			const optionData = opts.data;
			try {
				assert.equal(u.status, 0);
				u.destroy();
				assertDisposed(u, input, mode);
				assertEmpty(opts.data, optionData, mode);
				assertInert(u, opts);
				await frame();
				assert.equal(draws, 0);
				assert.equal(ready, 0);
				assert.equal(destroys, 1);
				assert.deepEqual(input, original);
			}
			finally { u.destroy(); }
		});

		for (const clearFirst of [false, true]) {
			it(`accepts undefined data during deferred init (mode=${mode}, clearFirst=${clearFirst})`, async () => {
				const input = makeData(mode);
				const original = structuredClone(input);
				let inits = 0, draws = 0, destroys = 0;
				const u = new uPlot({
					...optionsFor(input, mode), data: input,
					hooks: { init: [() => inits++], draw: [() => draws++], destroy: [() => destroys++] },
				}, input, self => { document.body.appendChild(self.root); });
				try {
					assert.equal(u.data, undefined);
					if (clearFirst) {
						assert.doesNotThrow(() => u.clearCache({ data: true }));
						assert.deepEqual(u.data, []);
						assert.equal(u._data, u.data);
						assert.equal(u._base, null);
					}
					assert.doesNotThrow(() => u.destroy());
					assertDisposed(u, [], mode);
					assertInert(u);
					await frame();
					assert.equal(inits, 0);
					assert.equal(draws, 0);
					assert.equal(destroys, 1);
					assert.deepEqual(input, original);
				}
				finally { u.destroy(); }
			});
		}
	}

	it('cleans up before hooks, propagates the hook error, and makes recursive/repeated destroy inert', async () => {
		const input = mixedData(false);
		let opts, calls = 0;
		const error = new Error('destroy hook failed');
		const u = new uPlot({
			...stackOptions(input, true), data: input, cache: { data: true, paths: true },
			hooks: { init: [(u, internalOpts) => { opts = internalOpts; }] },
		}, input, document.body);
		try {
			await frame();
			const optionData = opts.data;
			u.hooks.destroy = [self => {
				calls++;
				self.destroy();
				assert.equal(calls, 1);
				assertDisposed(self, input);
				assertEmpty(opts.data, optionData, 1);
				throw error;
			}];
			assert.throws(() => u.destroy(), caught => caught === error);
			assertDisposed(u, input);
			assertEmpty(opts.data, optionData, 1);
			assertInert(u, opts);
			assert.equal(calls, 1);
		}
		finally { u.destroy(); }
	});

	it('removes document mouse listeners during an active drag', async () => {
		const calls = [];
		const bound = [];
		let destroyed = false;
		const input = makeData();
		const events = ['mousedown', 'mousemove', 'mouseenter', 'mouseleave', 'mouseup', 'dblclick'];
		const u = new uPlot({
			...optionsFor(input),
			cursor: { drag: { x: true }, bind: Object.fromEntries(events.map(type => [type, (self, target, callback) => {
				bound.push([target, type]);
				return event => {
					calls.push([target, type]);
					if (!destroyed)
						callback(event);
				};
			}])) },
			hooks: { destroy: [() => { destroyed = true; }] },
		}, input, document.body);
		try {
			await frame();
			u.over.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
			u.syncRect();
			u.over.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: 40, clientY: 40 }));
			assert.ok(calls.some(([target, type]) => target === u.over && type == 'mousedown'));
			for (const type of ['mousemove', 'mouseup'])
				assert.ok(bound.some(([target, event]) => target === document && event == type), `drag binds document ${type}`);
			u.destroy();
			calls.length = 0;
			for (const [target, type] of bound) {
				if (target === document)
					target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 80, clientY: 40 }));
			}
			await frame();
			assert.deepEqual(calls, [], 'the live document no longer calls into the destroyed chart');
			assertDisposed(u, input);
			assertInert(u);
		}
		finally { u.destroy(); }
	});



	for (const typed of [false, true]) {
		it(`releases raw, cumulative, baseline, and options data with the chart retained (typed=${typed})`, async function() {
			if (!globalThis.gc)
				this.skip();
			const { u, refs } = await gcFixture(typed);
			for (let i = 0; i < 5; i++) {
				await new Promise(setImmediate);
				globalThis.gc();
			}
			for (const [name, ref] of refs)
				assert.equal(ref.deref(), undefined, `${name} must not be retained by the destroyed chart`);
			assert.deepEqual(u.data, [[], [], [], []]);
			assert.equal(u._base, null);
			assertInert(u);
		});
	}
});

async function gcFixture(typed) {
	const refs = [];
	const watch = (name, data) => {
		refs.push([name, new WeakRef(data)]);
		data.forEach((column, i) => {
			if (column != null) {
				refs.push([`${name}[${i}]`, new WeakRef(column)]);
				if (ArrayBuffer.isView(column))
					refs.push([`${name}[${i}].buffer`, new WeakRef(column.buffer)]);
			}
		});
	};
	const input = mixedData(typed);
	const u = new uPlot({
		...stackOptions(input, true), data: makeData(1, typed, 100), cache: { data: true },
		hooks: { init: [(u, opts) => watch('opts.data', opts.data)] },
	}, input, document.body);
	try {
		await frame();
		assert.notEqual(u._data, u.data);
		assert.ok(u._base != null);
		watch('raw', u.data);
		watch('_data', u._data);
		watch('_base', u._base);
	}
	finally { u.destroy(); }
	// No data snapshots or hooks closing over raw arrays escape this fixture.
	return { u, refs };
}
