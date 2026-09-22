import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { BAND_CLIP_FILL, BAND_CLIP_STROKE } from '../src/paths/utils.js';

// Observe private state in one in-memory module only; production APIs stay unchanged.
async function probeBandCaches() {
	const url = new URL('../src/uPlot.js', import.meta.url);
	let source = readFileSync(url, 'utf8');
	for (const [anchor, addition] of [
		['let bandGroupsDirty = true;', '\n caches.set(self, { bandEnds, firstBand, nextBand, bandHasData, groupBuilds: 0, drawPath, strokeFill, drawOrthoLines });'],
		['if (bandGroupsDirty) {', '\n caches.get(self).groupBuilds++;'],
	]) {
		assert.equal(source.split(anchor).length, 2, 'private cache probe has one insertion point: ' + anchor);
		source = source.replace(anchor, anchor + addition);
	}
	source = 'export const caches = new WeakMap();\n' + source;
	source = source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
		(_, quote, path) => 'from ' + JSON.stringify(new URL(path, url).href));
	return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

const { default: ProbedPlot, caches } = await probeBandCaches();

function makeProbedPlot(options) {
	const f = makePlot({ ...options, Plot: ProbedPlot });
	return { ...f, get groupBuilds() { return caches.get(f.u).groupBuilds; } };
}

function geometryLogs(paths) {
	const logs = path => path instanceof Map ? [...path].map(([style, part]) => [style, logs(part)])
		: Array.isArray(path) ? path.map(logs) : path?.log ?? null;
	return structuredClone(['fill', 'stroke', 'clip', 'band'].map(kind => logs(paths?.[kind])));
}

// Observe the existing mock per instance, including consecutive calls batched into
// one log entry. Keep path identity and canvas state; no raster/snapshot comparison.
function recordCanvas(ctx, labels, events, operations = []) {
	const defaults = () => ({ alpha: 1, fill: '#000', stroke: '#000', clips: [], offset: [0, 0] });
	let state = defaults();
	const stack = [];
	Object.defineProperty(ctx, 'globalAlpha', {
		configurable: true,
		get: () => state.alpha,
		set: value => ctx.record('globalAlpha', value),
	});
	function operation(name, value) {
		operations.push([name, value]);
		if (name == 'canvas.width' || name == 'canvas.height') {
			state = defaults();
			stack.length = 0;
		}
		else if (name == 'translate')
			state.offset = state.offset.map((v, i) => v + value[i]);
		else if (name == 'fillStyle' || name == 'strokeStyle')
			state[name == 'fillStyle' ? 'fill' : 'stroke'] = value;
		else if (name == 'globalAlpha')
			state.alpha = value;
		else if (name == 'save')
			stack.push({ ...state, clips: state.clips.slice(), offset: state.offset.slice() });
		else if (name == 'restore') {
			assert.ok(stack.length > 0, 'balanced canvas restore');
			state = stack.pop();
		}
		else if (name == 'clip')
			state.clips.push(value[0]);
		else if (name == 'fill' || name == 'stroke') {
			const label = labels.get(value[0]);
			assert.ok(label, 'every painted path belongs to a series or its points');
			events.push({ ...label, kind: name, path: value[0], alpha: state.alpha, style: state[name], clips: state.clips.slice(), offset: state.offset.slice() });
		}
	}
	ctx.log.push = function(entry) {
		operation(entry[0], entry[1]);
		Object.defineProperty(entry, 'push', {
			value(...values) {
				values.forEach(value => operation(entry[0], value));
				return Array.prototype.push.apply(this, values);
			}
		});
		return Array.prototype.push.call(this, entry);
	};

	return () => {
		assert.equal(stack.length, 0, 'canvas saves are balanced');
		assert.deepEqual(state.clips, [], 'clips do not leak between series');
		assert.equal(state.alpha, 1, 'series alpha is restored');
		assert.deepEqual(state.offset, [0, 0], 'canvas translation returns to identity');
	};
}

function makePlot({ count = 5, bands = [], hidden = [], stack, series = () => ({}), paths = uPlot.paths.linear(), points = true, data, xRange = [0, 2], pxRatio = 1, Plot = uPlot } = {}) {
	const events = [];
	const operations = [];
	const labels = new WeakMap();
	const builds = Array(count + 1).fill(0);
	const pointBuilds = Array(count + 1).fill(0);
	const geometry = [];
	const pointPaths = uPlot.paths.points();
	let checkState;

	function labelPaths(built, si, points) {
		for (const kind of ['fill', 'stroke']) {
			const path = built?.[kind];
			if (path instanceof Map) {
				let segment = 0;
				for (const part of path.values())
					labels.set(part, { si, points, segment: segment++ });
			}
			else if (path != null)
				labels.set(path, { si, points });
		}
		return built;
	}
	const u = new Plot({
		width: 400, height: 240, pxRatio,
		axes: [{ show: false }, { show: false }],
		cursor: { show: false }, legend: { show: false },
		scales: { x: { time: false, range: xRange }, y: { range: [0, count + 2] } },
		bands, stack,
		series: [{}, ...Array.from({ length: count }, (_, idx) => ({
			show: !hidden.includes(idx + 1),
			fill: 'silver', stroke: 'black', width: 2,
			...series(idx + 1),
			paths(u, si, ...args) {
				builds[si] = (builds[si] || 0) + 1;
				const built = paths(u, si, ...args);
				geometry[si] = geometryLogs(built);
				return labelPaths(built, si, false);
			},
			points: {
				show: points, fill: 'white', stroke: 'black', width: 1,
				paths(u, si, ...args) {
					pointBuilds[si] = (pointBuilds[si] || 0) + 1;
					return labelPaths(pointPaths(u, si, ...args), si, true);
				},
			},
		}))],
		hooks: {
			init: [u => { checkState = recordCanvas(u.ctx, labels, events, operations); }],
			drawSeries: [(u, si) => events.push({ kind: 'hook', si, alpha: u.ctx.globalAlpha })],
		},
	}, data ?? [[0, 1, 2], ...Array.from({ length: count }, (_, i) => [i + 1, i + 1.5, i + 1])], document.body);
	return { u, events, operations, builds, pointBuilds, geometry, checkState: () => checkState() };
}

const pointsAndHook = si => [`fillP${si}`, `strokeP${si}`, `hook${si}`];
const ordinary = si => [`fill${si}`, `stroke${si}`, ...pointsAndHook(si)];
function group(indices, fills = indices, segments = 1) {
	const paint = kind => (kind == 'fill' ? fills : indices).flatMap(si =>
		segments == 1 ? [`${kind}${si}`] : Array.from({ length: segments }, (_, j) => `${kind}${si}:${j}`));
	return [...paint('fill'), ...paint('stroke'), ...indices.flatMap(pointsAndHook)];
}
function assertOrder(f, expected, offset = e => e.points ? 0.5 : 0) {
	assert.deepEqual(f.events.map(e => `${e.kind}${e.points ? 'P' : ''}${e.si}${e.segment == null ? '' : ':' + e.segment}`), expected);
	for (const e of f.events.filter(e => e.kind != 'hook'))
		assert.deepEqual(e.offset, [offset(e), offset(e)], 'each paint uses its own pixel-alignment offset');
	f.checkState();
}
const band = (a, b) => ({ series: [a, b], fill: 'orange' });

function customPaths(flags, maps) {
	const rect = () => {
		const path = new Path2D();
		path.rect(10, 10, 20, 20);
		return path;
	};
	return () => ({
		fill: maps ? new Map([['red', rect()], ['orange', rect()]]) : rect(),
		stroke: maps ? new Map([['blue', rect()], ['green', rect()]]) : rect(),
		clip: rect(), band: [rect(), rect()], flags,
	});
}

describe('band-local drawing', () => {
	it('observes saved translations and bitmap resets, including consecutive operations', () => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		const path = new Path2D();
		const events = [];
		const checkState = recordCanvas(ctx, new WeakMap([[path, { si: 1 }]]), events);
		ctx.translate(0.5, 0.5);
		ctx.save();
		ctx.translate(2, 3);
		ctx.translate(4, 5);
		ctx.fill(path);
		ctx.restore();
		ctx.fill(path);
		ctx.translate(-0.5, -0.5);
		checkState();
		assert.deepEqual(events.map(e => e.offset), [[6.5, 8.5], [0.5, 0.5]]);

		for (const dimension of ['width', 'height']) {
			ctx.save();
			ctx.translate(7, 9);
			ctx.clip(path);
			ctx.globalAlpha = 0.25;
			ctx.fillStyle = 'red';
			ctx.strokeStyle = 'blue';
			// Even assigning the same bitmap size resets all state and saved frames.
			canvas[dimension] = canvas[dimension];
			canvas[dimension] = canvas[dimension];
			checkState();
			assert.equal(ctx.globalAlpha, 1);
			ctx.fill(path);
			ctx.stroke(path);
			for (const e of events.slice(-2)) {
				assert.equal(e.style, '#000');
				assert.equal(e.alpha, 1);
				assert.deepEqual(e.clips, []);
				assert.deepEqual(e.offset, [0, 0]);
			}
		}
	});

	for (const [width, pxAlign, pxRatio, mainOffset, pointOffset] of [
		[1, 1, 1, 0.5, 0.5],
		[3, 1, 1, 0.5, 0.5],
		[3, 0, 1, 0, 0],
		[3, 2, 1, 0, 0],
		[1, 1, 1.5, 0.75, 0.75],
		[1, 1, 2, 0, 0],
	]) {
		it(`aligns every grouped and ordinary paint, width=${width}, pxAlign=${pxAlign}, pxRatio=${pxRatio}`, async () => {
			const f = makePlot({
				count: 3, bands: [band(1, 2)], pxRatio,
				paths: customPaths(BAND_CLIP_FILL | BAND_CLIP_STROKE, false),
				series: () => ({ width, pxAlign }),
			});
			try {
				await Promise.resolve();
				for (const change of [null, () => f.u.redraw(false), () => f.u.setSize({ width: 420, height: 260 })]) {
					if (change) {
						f.events.length = 0;
						change();
						await Promise.resolve();
					}
					assertOrder(f, [...group([1, 2]), ...ordinary(3)], e => e.points ? pointOffset : mainOffset);
				}
			}
			finally { f.u.destroy(); }
		});
	}

	for (const grouped of [false, true]) {
		for (const [name, series, paths] of [
			['zero-width scalar strokes', { width: 0, fill: null }, customPaths(0, false)],
			['zero-width Map strokes', { width: 0, fill: null }, () => ({ ...customPaths(0, true)(), fill: null })],
			['empty Maps', { width: 3 }, () => ({ ...customPaths(0, false)(), fill: new Map(), stroke: new Map() })],
			['null scalar styles', { width: 3, fill: null, stroke: null }, customPaths(0, false)],
			['no main path', { width: 3 }, () => null],
		]) {
			it(`skips ${name} without suppressing points/hooks, ${grouped ? 'grouped' : 'ordinary'}`, async () => {
				for (const points of [false, true]) {
					const f = makePlot({ count: 2, bands: grouped ? [band(1, 2)] : [], points, series: () => series, paths });
					try {
						await Promise.resolve();
						for (let frame = 0; frame < 2; frame++) {
							assertOrder(f, [1, 2].flatMap(si => points ? pointsAndHook(si) : ['hook' + si]));
							const ops = f.operations.filter(([name]) => !['canvas.width', 'canvas.height', 'clearRect'].includes(name));
							if (!points)
								assert.deepEqual(ops, [], 'unpaintable main paths do not configure styles, translate, save, or clip');
							else {
								for (const [name, count] of [['save', 2], ['restore', 2], ['clip', 2], ['translate', 4]])
									assert.equal(ops.filter(op => op[0] == name).length, count, name + ': only points change canvas state');
								for (const [name, value] of ops) {
									if (name == 'fillStyle')
										assert.equal(value, 'white');
									if (name == 'strokeStyle')
										assert.equal(value, 'black');
									if (name == 'lineWidth')
										assert.equal(value, 1);
								}
							}
							assert.deepEqual(f.pointBuilds, [0, points ? frame + 1 : 0, points ? frame + 1 : 0]);
							if (frame == 0) {
								f.events.length = f.operations.length = 0;
								f.u.redraw(false);
								await Promise.resolve();
							}
						}
					}
					finally { f.u.destroy(); }
				}
			});
		}
	}

	for (const maps of [false, true]) {
		it(`paints ${maps ? 'Map' : 'scalar'} fills without configuring zero-width strokes`, async () => {
			const f = makePlot({ count: 2, bands: [band(1, 2)], points: false, paths: customPaths(0, maps), series: () => ({ width: 0 }) });
			try {
				await Promise.resolve();
				for (let frame = 0; frame < 2; frame++) {
					assertOrder(f, [...[1, 2].flatMap(si => maps ? [`fill${si}:0`, `fill${si}:1`] : ['fill' + si]), 'hook1', 'hook2']);
					assert.deepEqual(f.operations.filter(([name]) => ['stroke', 'strokeStyle', 'lineWidth', 'lineJoin', 'lineCap', 'setLineDash', 'translate'].includes(name)), []);
					if (frame == 0) {
						f.events.length = f.operations.length = 0;
						f.u.redraw(false);
						await Promise.resolve();
					}
				}
			}
			finally { f.u.destroy(); }
		});
	}

	it('keeps paintable series aligned after an unpaintable series and rechecks styles on cached redraw', async () => {
		let paintable = false;
		const f = makePlot({
			count: 3, bands: [band(1, 2)], paths: customPaths(0, false),
			series: si => ({ width: si == 1 ? 1 : 3, fill: () => si == 1 && !paintable ? null : 'red', stroke: () => si == 1 && !paintable ? null : 'blue' }),
		});
		try {
			await Promise.resolve();
			for (const active of [false, true, false]) {
				if (active != paintable) {
					paintable = active;
					f.events.length = f.operations.length = 0;
					f.u.redraw(false);
					await Promise.resolve();
				}
				assertOrder(f, [...(active ? ['fill1', 'fill2', 'stroke1', 'stroke2'] : ['fill2', 'stroke2']), ...pointsAndHook(1), ...pointsAndHook(2), ...ordinary(3)], () => 0.5);
				assert.deepEqual(f.builds, [0, 1, 1, 1], 'style eligibility changes without rebuilding geometry');
				const paints = f.events.filter(e => e.kind != 'hook');
				assert.equal(f.operations.filter(([name]) => name == 'save').length, active ? 8 : 6, 'inactive series adds no main-path save/clip work');
				for (const e of paints)
					assert.equal(e.style, e.points ? e.kind == 'fill' ? 'white' : 'black' : e.kind == 'fill' ? 'red' : 'blue');
			}
		}
		finally { f.u.destroy(); }
	});

	it('paints min/median/max fill below every line, then points/hooks; redraw(false) reuses paths', async () => {
		let fills = 0;
		const f = makePlot({
			count: 3,
			bands: [{ series: [3, 1], fill: () => { fills++; return 'orange'; } }],
			series: si => ({ label: ['min', 'median', 'max'][si - 1], fill: null }),
		});
		try {
			await Promise.resolve();
			const cached = f.u.series.slice(1).map(s => s._paths);
			const cachedParts = cached.map(p => [p.fill, p.stroke, p.clip, p.band]);
			for (let frame = 1; frame <= 3; frame++) {
				assertOrder(f, group([1, 2, 3], [3]));
				assert.equal(fills, frame, 'band fill callback runs only in the fill pass');
				assert.deepEqual(f.builds, [0, 1, 1, 1]);
				assert.deepEqual(f.pointBuilds, [0, frame, frame, frame]);
				f.u.series.slice(1).forEach((s, i) => {
					assert.equal(s._paths, cached[i]);
					[s._paths.fill, s._paths.stroke, s._paths.clip, s._paths.band].forEach((p, j) =>
						assert.equal(p, cachedParts[i][j], 'split passes preserve cached path identities'));
					assert.deepEqual(geometryLogs(s._paths), f.geometry[i + 1], 'split passes do not mutate cached geometry, including the first draw');
				});
				if (frame < 3) {
					f.events.length = 0;
					f.u.redraw(false);
					await Promise.resolve();
				}
			}
		}
		finally { f.u.destroy(); }
	});

	for (const [name, bands] of [
		['shared-edge chain', [band(3, 5), band(1, 3)]],
		['overlapping intervals without a shared endpoint', [band(2, 5), band(1, 4)]],
	]) {
		it(`merges ${name}, including intervening series, and paints each part once`, async () => {
			const f = makePlot({ bands });
			try {
				await Promise.resolve();
				assertOrder(f, group([1, 2, 3, 4, 5]));
				assert.deepEqual(f.builds, [0, 1, 1, 1, 1, 1]);
				assert.deepEqual(f.pointBuilds, [0, 1, 1, 1, 1, 1]);
			}
			finally { f.u.destroy(); }
		});
	}

	for (const flags of [0, BAND_CLIP_FILL | BAND_CLIP_STROKE]) {
		it(`visits interleaved owners in original band-index order without changing paint multiplicity, flags=${flags}`, async () => {
			const calls = [];
			const edges = [[3, 1], [5, 4], [3, 2], [5, 6], [3, 4]];
			const colors = ['red', 'green', 'blue', 'orange', 'purple'];
			const f = makePlot({
				count: 7,
				bands: edges.map((series, idx) => ({
					series,
					fill: (u, bi) => {
						assert.equal(bi, idx, 'callback receives the original index, not an owner-local index');
						calls.push(bi);
						return colors[bi];
					}
				})),
				paths: customPaths(flags, false),
			});
			try {
				await Promise.resolve();
				for (let frame = 0; frame < 2; frame++) {
					const painted = flags == 0 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 3, 3, 4, 5, 5, 6];
					assertOrder(f, [...painted.map(si => 'fill' + si), ...painted.map(si => 'stroke' + si),
						...[1, 2, 3, 4, 5, 6].flatMap(pointsAndHook), ...ordinary(7)]);
					assert.deepEqual(calls, flags == 0 ? [] : [0, 2, 4, 1, 3]);
					for (const si of [1, 2, 3, 4, 5, 6, 7]) {
						const owned = flags == 0 ? [] : edges.flatMap(([owner], bi) => owner == si ? [bi] : []);
						for (const kind of ['fill', 'stroke']) {
							const paints = f.events.filter(e => e.si == si && !e.points && e.kind == kind);
							assert.equal(paints.length, owned.length || 1, 'missing owner/zero flags paint once');
							paints.forEach((e, i) => {
								assert.equal(e.style, kind == 'stroke' ? 'black' : owned.length ? colors[owned[i]] : 'silver');
								const clips = edges.map(([, lower]) => f.u.series[lower]._paths.band[1]);
								assert.deepEqual(e.clips.filter(clip => clips.includes(clip)), owned.length ? [clips[owned[i]]] : []);
							});
						}
					}
					if (frame == 0) {
						calls.length = f.events.length = 0;
						f.u.redraw(false);
						await Promise.resolve();
					}
				}
			}
			finally { f.u.destroy(); }
		});
	}

	it('reads band owners only when grouping or building paths, not while painting cached owners', async () => {
		let buildingPaths = false;
		const linear = uPlot.paths.linear();
		const f = makeProbedPlot({
			bands: [band(3, 1), band(5, 4), band(3, 2)],
			paths: (...args) => {
				buildingPaths = true;
				try { return linear(...args); }
				finally { buildingPaths = false; }
			},
		});
		try {
			await Promise.resolve();
			const pathReads = [0, 0, 0];
			const otherReads = [0, 0, 0];
			f.u.bands.forEach((b, bi) => {
				const owner = b.series[0];
				Object.defineProperty(b.series, 0, {
					get() {
						(buildingPaths ? pathReads : otherReads)[bi]++;
						return owner;
					}
				});
			});
			for (const [name, change, builds, groupBuilds] of [
				['cached redraw', () => f.u.redraw(false), 0, 0],
				['resize', () => f.u.setSize({ width: 480, height: 280 }), 5, 0],
				['dirty redraw', () => { f.u.setBand(0, { fill: () => 'purple' }); f.u.redraw(false); }, 0, 1],
				['rebuilt redraw', () => f.u.redraw(false), 0, 0],
			]) {
				pathReads.fill(0);
				otherReads.fill(0);
				const before = f.groupBuilds;
				change();
				await Promise.resolve();
				assert.deepEqual(pathReads, [builds, builds, builds], name + ': bandFillClipDirs scans only during path builds');
				assert.deepEqual(otherReads, [groupBuilds, groupBuilds, groupBuilds], name + ': no per-series scan during paint');
				assert.equal(f.groupBuilds, before + groupBuilds);
				f.checkState();
			}
		}
		finally { f.u.destroy(); }
	});

	it('keeps separate groups local and ordinary series in their original overdraw order', async () => {
		const f = makePlot({ count: 7, bands: [band(6, 5), band(2, 3)] });
		try {
			await Promise.resolve();
			assertOrder(f, [...ordinary(1), ...group([2, 3]), ...ordinary(4), ...group([5, 6]), ...ordinary(7)]);
			f.u.setBand(0, { series: [4, 5] });
			f.events.length = 0;
			f.u.redraw();
			await Promise.resolve();
			assertOrder(f, [...ordinary(1), ...group([2, 3]), ...group([4, 5]), ...ordinary(6), ...ordinary(7)]);
		}
		finally { f.u.destroy(); }
	});

	it('retains intervals through hidden upper/lower endpoints and a hidden shared boundary', async () => {
		const f = makeProbedPlot({ bands: [band(1, 3), band(3, 5)], hidden: [3] });
		try {
			await Promise.resolve();
			assertOrder(f, group([1, 2, 4, 5], [2, 4, 5]));
			assert.equal(f.builds[3], 0, 'hidden shared endpoint needs no paths');
			const { bandEnds, firstBand, nextBand } = caches.get(f.u);
			const structure = structuredClone([bandEnds, firstBand, nextBand]);
			for (const [si, show, visible, fills] of [
				[3, true, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]],
				[1, false, [2, 3, 4, 5], [2, 3, 4, 5]],
				[5, false, [2, 3, 4], [2, 4]],
				[3, false, [2, 4], [2, 4]],
				[1, true, [1, 2, 4], [2, 4]],
			]) {
				f.events.length = 0;
				f.u.setSeries(si, { show });
				assert.deepEqual([bandEnds, firstBand, nextBand], structure, 'ordinary visibility preserves owner links immediately');
				await Promise.resolve();
				assert.equal(f.groupBuilds, 1, 'ordinary visibility does not rebuild structural groups');
				assert.deepEqual([bandEnds, firstBand, nextBand], structure);
				assertOrder(f, group(visible, fills));
				f.events.length = 0;
				f.u.redraw(false);
				await Promise.resolve();
				assert.equal(f.groupBuilds, 1);
				assertOrder(f, group(visible, fills));
			}
		}
		finally { f.u.destroy(); }
	});

	it('recomputes grouping after addBand, setBand, delBand(index), and delBand()', async () => {
		const f = makePlot();
		try {
			await Promise.resolve();
			assertOrder(f, [1, 2, 3, 4, 5].flatMap(ordinary));
			for (const [change, expected] of [
				[() => f.u.addBand(band(1, 3)), [...group([1, 2, 3]), ...ordinary(4), ...ordinary(5)]],
				[() => f.u.setBand(0, { series: [5, 3] }), [...ordinary(1), ...ordinary(2), ...group([3, 4, 5])]],
				[() => f.u.addBand(band(1, 3), 0), group([1, 2, 3, 4, 5])],
				[() => f.u.delBand(0), [...ordinary(1), ...ordinary(2), ...group([3, 4, 5])]],
				[() => f.u.delBand(), [1, 2, 3, 4, 5].flatMap(ordinary)],
			]) {
				f.events.length = 0;
				change();
				// Band APIs do not schedule drawing or rebuild endpoint geometry.
				f.u.redraw();
				await Promise.resolve();

				assertOrder(f, expected);
				f.events.length = 0;
				f.u.redraw(false);
				await Promise.resolve();

				assertOrder(f, expected);
			}
		}
		finally { f.u.destroy(); }
	});

	it('invalidates groups lazily for band APIs (private probe)', async () => {
		const f = makeProbedPlot();
		try {
			await Promise.resolve();
			assert.equal(f.groupBuilds, 1, 'initial draw builds even an empty grouping');
			for (const change of [
				() => f.u.addBand(band(1, 3)),
				() => f.u.setBand(0, { series: [3, 5] }),
				() => f.u.addBand(band(1, 3), 0),
				() => f.u.delBand(0),
				() => f.u.delBand(),
			]) {
				const before = f.groupBuilds;
				change();
				assert.equal(f.groupBuilds, before, 'APIs invalidate without rebuilding eagerly');
				const { firstBand, nextBand } = caches.get(f.u);
				assert.deepEqual([firstBand, nextBand], [[], []], 'band APIs clear ownership links immediately');
				f.u.redraw();
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 1, 'each change rebuilds once');
				f.u.redraw(false);
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 1, 'the rebuilt groups are cached');
				f.checkState();
			}
		}
		finally { f.u.destroy(); }
	});

	it('reuses groups across redraws, resize, focus, and unchanged visibility', async () => {
		const f = makeProbedPlot({ bands: [band(1, 3), band(4, 5)] });
		const expected = [...group([1, 2, 3]), ...group([4, 5])];
		try {
			await Promise.resolve();
			assert.equal(f.groupBuilds, 1, 'initial draw builds groups');
			assertOrder(f, expected);
			for (const [name, change] of [
				['redraw(false)', () => f.u.redraw(false)],
				['redraw()', () => f.u.redraw()],
				['resize', () => f.u.setSize({ width: 480, height: 280 })],
				['focus', () => f.u.setSeries(2, { focus: true })],
				['unfocus', () => f.u.setSeries(null, { focus: true })],
				['unchanged visibility', () => f.u.setSeries(3, { show: true })],
			]) {
				f.events.length = 0;
				change();
				await Promise.resolve();
				assert.equal(f.groupBuilds, 1, name + ' does not regroup');
				assertOrder(f, expected);
				if (name == 'focus')
					for (const e of f.events.filter(e => e.kind != 'hook'))
						assert.equal(e.alpha, e.si == 2 ? 1 : f.u.focus.alpha);
			}
		}
		finally { f.u.destroy(); }
	});

	it('regroups after adding and deleting a series without changing the bands', async () => {
		const f = makeProbedPlot({ bands: [band(1, 3)] });
		try {
			await Promise.resolve();
			assert.equal(f.groupBuilds, 1);
			assertOrder(f, [...group([1, 2, 3]), ...ordinary(4), ...ordinary(5)]);
			const data = f.u.data.slice();
			data.splice(2, 0, [2, 3, 2]);
			f.events.length = 0;
			// Reuse the labeled path factories; they receive the current series index.
			f.u.addSeries({ ...f.u.series[1], points: { ...f.u.series[1].points } }, 2);
			const { firstBand, nextBand } = caches.get(f.u);
			assert.deepEqual([firstBand, nextBand], [[], []], 'addSeries clears ownership links');
			f.u.setData(data);
			await Promise.resolve();
			assert.equal(f.groupBuilds, 2, 'addSeries invalidates groups');
			assertOrder(f, [...group([1, 2, 3]), ...ordinary(4), ...ordinary(5), ...ordinary(6)]);
			f.events.length = 0;
			f.u.delSeries(2);
			assert.deepEqual([firstBand, nextBand], [[], []], 'delSeries clears ownership links');
			data.splice(2, 1);
			f.u.setData(data);
			await Promise.resolve();
			assert.equal(f.groupBuilds, 3, 'delSeries invalidates groups');
			assertOrder(f, [...group([1, 2, 3]), ...ordinary(4), ...ordinary(5)]);
		}
		finally { f.u.destroy(); }
	});

	it('reuses stacked topology across new data and rebuilds when previous ordered edges or count differ', async () => {
		const f = makeProbedPlot({ stack: { groups: [{ series: [1, 2, 3], dir: 1 }, { series: [4, 5], dir: 1 }] } });
		const expected = [...group([1, 2, 3]), ...group([4, 5])];
		const edges = [[2, 1], [3, 2], [5, 4]];
		try {
			await Promise.resolve();
			assert.equal(f.groupBuilds, 1);
			assertOrder(f, expected);
			for (let frame = 1; frame <= 3; frame++) {
				const previous = f.u.bands.slice();
				f.events.length = 0;
				f.u.setData(f.u.data.map((col, si) => si == 0 ? col.slice() : col.map(v => v + 0.1)));
				await Promise.resolve();
				assert.deepEqual(f.u.bands.map(b => b.series), edges);
				f.u.bands.forEach((b, i) => assert.notEqual(b, previous[i], 'stackData replaced the band objects'));
				assert.equal(f.groupBuilds, 1, 'new band objects with unchanged edges do not regroup');
				assertOrder(f, expected);
			}
			// Draw edited bands first so the next setData must detect the topology
			// difference itself, not inherit dirty state from a band/visibility API.
			for (const [change, editedOrder] of [
				[() => { f.u.setBand(0, { series: [5, 4] }); f.u.setBand(2, { series: [2, 1] }); }, expected],
				[() => f.u.setBand(0, { series: [2, 4] }), [...ordinary(1), ...group([2, 3, 4, 5])]],
				[() => f.u.addBand(band(4, 3)), group([1, 2, 3, 4, 5])],
				[() => f.u.delBand(2), [...group([1, 2, 3]), ...ordinary(4), ...ordinary(5)]],
			]) {
				const before = f.groupBuilds;
				f.events.length = 0;
				change();
				f.u.redraw();
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 1);
				assertOrder(f, editedOrder);
				f.events.length = 0;
				f.u.setData(f.u.data);
				await Promise.resolve();
				assert.deepEqual(f.u.bands.map(b => b.series), edges);
				assert.equal(f.groupBuilds, before + 2, 'stackData detects changed ordered edges/count');
				assertOrder(f, expected);
				f.events.length = 0;
				f.u.setData(f.u.data);
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 2, 'restored topology is cached again');
				assertOrder(f, expected);
			}
			for (const [show, topology, order] of [
				[false, [[3, 1], [5, 4]], [...group([1, 3]), ...group([4, 5])]],
				[true, edges, expected],
			]) {
				const before = f.groupBuilds;
				f.events.length = 0;
				const { firstBand, nextBand } = caches.get(f.u);
				const owners = structuredClone([firstBand, nextBand]);
				f.u.setSeries(2, { show });
				assert.deepEqual([firstBand, nextBand], owners, 'visibility alone does not clear stack owners eagerly');
				assert.equal(f.groupBuilds, before);
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 1, 'changed generated endpoints rebuild once');
				assert.deepEqual(f.u.bands.map(b => b.series), topology);
				assertOrder(f, order);
				f.events.length = 0;
				f.u.setData(f.u.data);
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + 1, 'new visibility topology is cached');
				assertOrder(f, order);
			}
		}
		finally { f.u.destroy(); }
	});

	for (const [name, paths, flags] of [
		['linear', uPlot.paths.linear(), BAND_CLIP_FILL],
		['fill clipping', customPaths(BAND_CLIP_FILL, false), BAND_CLIP_FILL],
		['stroke clipping', customPaths(BAND_CLIP_STROKE, false), BAND_CLIP_STROKE],
		['fill and stroke clipping', customPaths(BAND_CLIP_FILL | BAND_CLIP_STROKE, false), BAND_CLIP_FILL | BAND_CLIP_STROKE],
	]) {
		it(`refreshes lower-edge eligibility on viewport-only populated/null/populated changes: ${name}`, async () => {
			// Exercise the unmodified public constructor as well as the counter probe.
			for (const Plot of [uPlot, ProbedPlot]) {
				let fills = 0;
				const data = [Array.from({ length: 9 }, (_, i) => i), Array(9).fill(3), [1, 1, 1, null, null, null, 1, 1, 1]];
				const f = makePlot({
					Plot, count: 2, data, points: false, paths,
					xRange: (u, min, max) => [min, max],
					bands: [{ series: [1, 2], fill: () => { fills++; return 'orange'; } }],
				});
				try {
					await Promise.resolve();
					const probe = caches.get(f.u);
					const structure = probe && structuredClone([probe.bandEnds, probe.firstBand, probe.nextBand]);
					const bands = f.u.bands.slice();
					for (const [min, max, eligible] of [[0, 2, true], [3, 5, false], [6, 8, true]]) {
						f.events.length = 0;
						const before = fills;
						f.u.setScale('x', { min, max });
						await Promise.resolve();
						assert.deepEqual([f.u.scales.x.min, f.u.scales.x.max], [min, max]);
						const rebuilt = f.events.slice();
						const builds = f.builds.slice();
						for (let frame = 0; frame < 2; frame++) {
							const owner = f.events.filter(e => e.si == 1 && e.kind != 'hook');
							assert.deepEqual(owner.map(e => e.kind), eligible ? ['fill', 'stroke'] : ['stroke']);
							assert.equal(fills, before + (frame + 1) * Number(eligible), 'only an eligible fill pass evaluates band fill');
							const lower = f.u.series[2]._paths;
							const bandClip = Array.isArray(lower?.band) ? lower.band[1] : lower?.band;
							if (name != 'linear')
								assert.ok(bandClip, 'synthetic lower geometry exists even when viewport data is all null');
							for (const e of owner) {
								const clipped = eligible && !!(flags & (e.kind == 'fill' ? BAND_CLIP_FILL : BAND_CLIP_STROKE));
								assert.equal(e.clips.includes(bandClip), clipped, 'viewport data, not topology or geometry presence alone, controls band clipping');
								if (lower?.clip != null)
									assert.equal(e.clips.includes(lower.clip), clipped && (e.kind == 'fill' || flags == (BAND_CLIP_FILL | BAND_CLIP_STROKE)));
								assert.equal(e.style, e.kind == 'fill' ? 'orange' : 'black');
								assert.deepEqual(e.offset, [0, 0]);
							}
							assert.deepEqual(f.events.filter(e => e.kind == 'hook').map(e => e.si), [1, 2]);
							assert.equal(f.u.data, data, 'viewport changes never replace data');
							assert.deepEqual(f.u.bands, bands, 'viewport changes never change topology');
							if (probe) {
								assert.equal(probe.groupBuilds, 1, 'lower-data refresh does not regroup');
								assert.deepEqual([probe.bandEnds, probe.firstBand, probe.nextBand], structure);
								assert.deepEqual(probe.bandHasData, [eligible]);
							}
							f.checkState();
							if (frame == 0) {
								f.events.length = 0;
								f.u.redraw(false);
								await Promise.resolve();
								assert.deepEqual(f.builds, builds, 'cached redraw does not rebuild paths');
								assert.deepEqual(f.events, rebuilt, 'cached redraw preserves paint order, styles, clipping, and offsets');
							}
						}
					}
				}
				finally { f.u.destroy(); }
			}
		});
	}

	it('keeps private caches numeric/boolean and clears them on cache release and destroy', async () => {
		const f = makeProbedPlot({ bands: [band(1, 3), band(4, 5)], paths: customPaths(BAND_CLIP_FILL | BAND_CLIP_STROKE, false) });
		const { bandEnds, firstBand, nextBand, bandHasData } = caches.get(f.u);
		const assertCleared = () => {
			assert.deepEqual(bandEnds, []);
			assert.deepEqual(firstBand, []);
			assert.deepEqual(nextBand, []);
			assert.deepEqual(bandHasData, []);
		};
		const assertTypes = () => {
			assert.equal(bandEnds.length, f.u.bands.length ? f.u.series.length : 0);
			assert.equal(firstBand.length, bandEnds.length);
			assert.equal(nextBand.length, f.u.bands.length);
			assert.equal(bandHasData.length, f.u.bands.length);
			for (const indices of [bandEnds, firstBand, nextBand])
				for (const index of indices)
					assert.ok(Number.isInteger(index), 'group/owner caches contain only numeric indices, no paths/series/data');
			for (const hasData of bandHasData)
				assert.equal(typeof hasData, 'boolean', 'lower-data cache contains only booleans');
		};
		try {
			await Promise.resolve();
			assertTypes();
			assert.deepEqual(bandHasData, [true, true]);
			assert.deepEqual(firstBand, [-1, 0, -1, -1, 1, -1]);
			assert.deepEqual(nextBand, [-1, -1]);
			assertOrder(f, [...group([1, 2, 3]), ...group([4, 5])]);
			const data = f.u.data.slice();
			data[5] = [null, null, null];
			f.events.length = 0;
			f.u.setData(data);
			await Promise.resolve();
			assert.equal(f.groupBuilds, 1, 'data changes refresh lower-data flags without regrouping');
			assertTypes();
			assert.deepEqual(bandHasData, [true, false]);
			const expected = [...group([1, 2, 3]), ...group([4, 5], [5])];
			assertOrder(f, expected);
			for (const targets of [{}, { paths: false, data: false }, { paths: true }, { data: true }, undefined]) {
				const before = f.groupBuilds;
				const clears = targets == null || targets.paths === true || targets.data === true;
				f.events.length = 0;
				f.u.clearCache(targets);
				if (clears)
					assertCleared();
				else
					assertTypes();
				assert.equal(f.groupBuilds, before, 'cache release does not eagerly regroup');
				if (targets == null || targets.data === true) {
					f.u.redraw(false);
					await Promise.resolve();
					assert.equal(f.groupBuilds, before, 'empty data defers rebuilding');
					assertOrder(f, []);
					f.u.setData(data);
				}
				else
					f.u.redraw(false);
				await Promise.resolve();
				assert.equal(f.groupBuilds, before + Number(clears));
				assertTypes();
				assert.deepEqual(bandHasData, [true, false]);
				assertOrder(f, expected);
			}
			f.u.delBand(1);
			assertCleared();
			f.u.delSeries(5);
			f.u.setData(data.slice(0, 5));
			await Promise.resolve();
			assertTypes();
			assert.deepEqual(firstBand, [-1, 0, -1, -1, -1], 'shrinking series removes the old tail');
			assert.deepEqual(nextBand, [-1], 'shrinking bands removes the old tail');
			f.u.delBand();
			assertCleared();
			f.events.length = 0;
			f.u.redraw(false);
			await Promise.resolve();
			assertTypes();
			assertCleared();
			assertOrder(f, [1, 2, 3, 4].flatMap(ordinary));
			// Repopulate before destroy so release is not tested only on empty arrays.
			f.u.addBand(band(1, 3));
			f.u.redraw(false);
			await Promise.resolve();
			assertTypes();
		}
		finally { f.u.destroy(); }
		assertCleared();
	});

	for (const [mode, fill, stroke] of [['fill-only', true, false], ['stroke-only', false, true], ['combined', true, true]]) {
		it(`configures only active paint styles for ${mode} drawing (private operation probe)`, async () => {
			// Hidden series leave style caches cold; no points or axes can mask writes.
			const u = new ProbedPlot({
				width: 400, height: 240, pxRatio: 1,
				axes: [{ show: false }, { show: false }],
				cursor: { show: false }, legend: { show: false },
				scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 2] } },
				series: [{}, { show: false }],
			}, [[0, 1, 2], [1, 2, 1]], document.body);
			try {
				await Promise.resolve();
				const { strokeFill, drawOrthoLines } = caches.get(u);
				const paths = customPaths(0, false)();
				const strokeOps = ['strokeStyle', 'lineWidth', 'lineJoin', 'lineCap', 'setLineDash'];
				const paintOps = [...strokeOps, 'fillStyle', 'fill', 'stroke'];
				const operations = start => u.ctx.log.slice(start).filter(([name]) => paintOps.includes(name));
				const start = u.ctx.log.length;
				strokeFill('blue', 4, [3, 2], 'square', 'red', stroke ? paths.stroke : null, fill ? paths.fill : null, 0);
				const ops = operations(start);
				assert.deepEqual(ops.map(([name]) => name).sort(), [
					...(stroke ? [...strokeOps, 'stroke'] : []),
					...(fill ? ['fillStyle', 'fill'] : []),
				].sort(), 'inactive paint must not write properties, set dashes, or draw');
				if (stroke) {
					for (const [name, value] of [['strokeStyle', 'blue'], ['lineWidth', 4], ['lineJoin', 'round'], ['lineCap', 'square'], ['setLineDash', [[3, 2]]]])
						assert.deepEqual(ops.find(op => op[0] == name), [name, value]);
				}
				if (fill)
					assert.deepEqual(ops.find(op => op[0] == 'fillStyle'), ['fillStyle', 'red']);
				assert.deepEqual(ops.filter(([name]) => name == 'fill' || name == 'stroke'), [
					...(fill ? [['fill', [paths.fill]]] : []),
					...(stroke ? [['stroke', [paths.stroke]]] : []),
				], 'combined drawing still fills before stroking');

				if (mode == 'stroke-only') {
					const start = u.ctx.log.length;
					drawOrthoLines([10, 20], [true, true], 0, 2, 0, 30, 6, 'green', [5, 1], 'round');
					assert.deepEqual(operations(start), [
						['strokeStyle', 'green'], ['lineWidth', 6], ['lineCap', 'round'],
						['setLineDash', [[5, 1]]], ['stroke', []],
					], 'orthogonal lines configure strokes without writing fillStyle');
				}
			}
			finally { u.destroy(); }
		});
	}

	for (const flags of [0, BAND_CLIP_FILL, BAND_CLIP_STROKE, BAND_CLIP_FILL | BAND_CLIP_STROKE]) {
		it(`restores styles between Map and scalar paths with matching final colors, flags=${flags}`, async () => {
			const mapPaths = customPaths(flags, true);
			const scalarPaths = customPaths(flags, false);
			const f = makePlot({
				count: 3, bands: [{ series: [1, 3], fill: 'purple' }],
				paths: (u, si) => (si == 1 ? mapPaths : scalarPaths)(),
				series: si => ({ fill: si == 1 ? null : 'orange', stroke: si == 1 ? null : 'green' }),
			});
			try {
				await Promise.resolve();
				for (let frame = 0; frame < 2; frame++) {
					assertOrder(f, ['fill1:0', 'fill1:1', 'fill2', 'fill3', 'stroke1:0', 'stroke1:1', 'stroke2', 'stroke3', ...[1, 2, 3].flatMap(pointsAndHook)]);
					for (const e of f.events.filter(e => e.kind != 'hook' && !e.points)) {
						const colors = e.kind == 'fill' ? ['red', 'orange'] : ['blue', 'green'];
						assert.equal(e.style, colors[e.segment ?? 1], 'scalar paint must not reuse a stale Map style cache after restore');
						const clipped = e.si == 1 && !!(flags & (e.kind == 'fill' ? BAND_CLIP_FILL : BAND_CLIP_STROKE));
						assert.equal(e.clips.includes(f.u.series[3]._paths.band[1]), clipped);
					}
					f.u.series.slice(1).forEach((s, i) =>
						assert.deepEqual(geometryLogs(s._paths), f.geometry[i + 1], 'Map entries and scalar geometry remain unchanged'));
					if (frame == 0) {
						f.events.length = 0;
						f.u.redraw(false);
						await Promise.resolve();
					}
				}
				assert.deepEqual(f.builds, [0, 1, 1, 1]);
			}
			finally { f.u.destroy(); }
		});
	}

	it('restores Map styles across nested fill clipping and outer clipping (private combined-pass probe)', async () => {
		const mapPaths = customPaths(BAND_CLIP_FILL, true);
		const scalarPaths = customPaths(BAND_CLIP_FILL, false);
		const f = makeProbedPlot({
			count: 2, bands: [{ series: [1, 2], fill: 'purple' }],
			paths: (u, si) => (si == 1 ? mapPaths : scalarPaths)(),
			series: si => ({ width: 3, fill: si == 1 ? null : 'orange', stroke: si == 1 ? null : 'green' }),
		});
		try {
			await Promise.resolve();
			f.events.length = 0;
			// Grouped series use split passes. Invoke the combined path privately to
			// exercise the nested fill-only clip followed by an unclipped stroke.
			const { drawPath } = caches.get(f.u);
			drawPath(1, false);
			drawPath(2, false);
			assertOrder(f, ['fill1:0', 'fill1:1', 'stroke1:0', 'stroke1:1', 'fill2', 'stroke2'], () => 0.5);
			const lower = f.u.series[2]._paths;
			for (const e of f.events) {
				const colors = e.kind == 'fill' ? ['red', 'orange'] : ['blue', 'green'];
				assert.equal(e.style, colors[e.segment ?? 1]);
				assert.equal(e.clips.includes(lower.band[1]), e.si == 1 && e.kind == 'fill', 'nested band clip is restored before stroking');
				assert.equal(e.clips.includes(lower.clip), e.si == 2 || e.kind == 'fill', 'nested lower gaps do not leak to the upper stroke');
			}
		}
		finally { f.u.destroy(); }
	});

	for (const maps of [false, true]) {
		for (const flags of [0, BAND_CLIP_FILL, BAND_CLIP_STROKE, BAND_CLIP_FILL | BAND_CLIP_STROKE]) {
			it(`${maps ? 'Map' : 'scalar'} styles: preserves alpha and clipping with flags=${flags}`, async () => {
				let fills = 0;
				const f = makePlot({
					count: 4,
					bands: [{ series: [1, 3], fill: () => { fills++; return 'purple'; } }],
					paths: customPaths(flags, maps),
					series: si => ({ alpha: si / 4, width: si % 2 ? 3 : 2, pxAlign: si == 4 ? 0 : 1, fill: maps ? null : 'silver', stroke: maps ? null : 'black' }),
				});
				try {
					await Promise.resolve();
					for (const dir of [-1, 1]) {
						if (dir == 1) {
							f.events.length = 0;
							f.u.setBand(0, { dir });
							f.u.redraw(false);
							await Promise.resolve();
						}
						const segments = maps ? 2 : 1;
						assertOrder(f, [...group([1, 2, 3], [1, 2, 3], segments), ...group([4], [4], segments)], e => e.si == 4 ? 0 : e.points || e.si % 2 ? 0.5 : 0);
						const lower = f.u.series[3]._paths;
						const bandClip = lower.band[dir == 1 ? 0 : 1];
						for (const e of f.events) {
							assert.equal(e.alpha, e.kind == 'hook' ? 1 : e.si / 4, 'alpha is per series in every pass');
							if (e.kind == 'hook' || e.points)
								continue;
							const clipped = e.si == 1 && !!(flags & (e.kind == 'fill' ? BAND_CLIP_FILL : BAND_CLIP_STROKE));
							assert.equal(e.clips.includes(bandClip), clipped, 'only the requested paint is band-clipped');
							assert.equal(e.clips.includes(lower.band[dir == 1 ? 1 : 0]), false, 'uses the correct directional clip');
							const lowerGap = clipped && (e.kind == 'fill' || flags == (BAND_CLIP_FILL | BAND_CLIP_STROKE));
							assert.equal(e.clips.includes(lower.clip), e.si == 3 || lowerGap, 'lower-edge gaps follow clip flags');
							assert.ok(e.clips.includes(f.u.series[e.si]._paths.clip), 'own gaps clip is retained');
							assert.equal(e.clips.length, 2 + Number(clipped) + Number(lowerGap), 'bounds, own gaps, and optional band/lower gaps only');
							const style = maps ? (e.kind == 'fill' ? ['red', 'orange'] : ['blue', 'green'])[e.segment]
								: e.kind == 'stroke' ? 'black' : e.si == 1 && flags != 0 ? 'purple' : 'silver';
							assert.equal(e.style, style, 'Map-owned styles survive null series styles and split passes');
						}
						assert.deepEqual(f.builds, [0, 1, 1, 1, 1], 'cached paths are not regenerated');
						assert.equal(fills, flags == 0 ? 0 : dir == -1 ? 1 : 2, 'band fill callback never runs in the stroke pass');
					}
				}
				finally { f.u.destroy(); }
			});
		}
	}
});
