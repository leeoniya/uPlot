import { retArg0 } from '../utils.js';

function arrayValue(values, i) {
	return values[i];
}

function discreteValue(values, i) {
	return values[0][values[1][i]];
}

// Select once per rebuild, not once per value.
export function dispReader(kind) {
	return kind == 1 ? retArg0 : kind == 2 ? discreteValue : arrayValue;
}

// Display data outlives pixel geometry. Inputs and callback results are immutable.
// Core lifecycle operations clear series._disp when data or series indices change.
export function cacheDisp(u, seriesIdx, facet, prepare) {
	const cache = u.series[seriesIdx]._disp ??= new WeakMap();
	let entry = cache.get(facet);

	if (entry == null) {
		const data = u.mode == 2 ? u.data[seriesIdx] : u.data;
		let value = facet.values(u, seriesIdx, 0, data[0].length - 1);
		if (prepare != null)
			value = prepare(value);
		entry = {value};
		cache.set(facet, entry);
	}

	return entry.value;
}

function unaryColor(color) {
	return [[color], 0];
}

function indexColors(colors) {
	const palette = [null];
	const indices = new Uint32Array(colors.length);
	const unique = new Map();

	for (let i = 0; i < colors.length; i++) {
		const color = colors[i];
		if (color != null) {
			let idx = unique.get(color);
			if (idx == null) {
				idx = palette.length;
				unique.set(color, idx);
				palette.push(color);
			}
			indices[i] = idx;
		}
	}

	return [palette, indices];
}

export function cacheColors(u, seriesIdx, facet) {
	return cacheDisp(u, seriesIdx, facet, facet.kind == 1 ? unaryColor : facet.kind == 2 ? null : indexColors);
}

// The primary color identifies the whole fill/stroke combination. Callers supply matched groups.
export function colorPaths(u, seriesIdx, disp, fillStyle, strokeStyle, stroke = true) {
	const fills = disp.fill == null ? null : cacheColors(u, seriesIdx, disp.fill);
	const strokes = disp.stroke == null || !stroke && fills != null ? null : cacheColors(u, seriesIdx, disp.stroke);
	const fillIndex = dispReader(disp.fill?.kind == 1 ? 1 : 3);
	const strokeIndex = dispReader(disp.stroke?.kind == 1 ? 1 : 3);
	const primary = fills ?? strokes;
	const index = fills == null ? strokeIndex : fillIndex;
	const groups = new Map();

	// Preserve palette order, but allocate geometry only for groups with drawn items.
	primary?.[0].forEach(color => groups.set(color ?? null, null));

	return {
		groups,
		path(i) {
			const color = primary == null ? fillStyle : primary[0][index(primary[1], i)];
			const key = color ?? null;
			let group = groups.get(key);
			if (group == null) {
				const fill = fills == null ? fillStyle : color;
				const strokeColor = !stroke ? null : strokes == null ? strokeStyle : fills == null ? color : strokes[0][strokeIndex(strokes[1], i)];
				group = {fill, stroke: strokeColor, path: fill == null && strokeColor == null ? null : new Path2D()};
				groups.set(key, group);
			}
			return group.path;
		},
	};
}

export function paintPaths(groups, channel) {
	const paths = new Map();
	groups.forEach(group => {
		if (group != null && group.path != null && group[channel] != null) {
			const color = group[channel];
			const prev = paths.get(color);
			if (prev == null)
				paths.set(color, group.path);
			else if (Array.isArray(prev))
				prev.push(group.path);
			else
				paths.set(color, [prev, group.path]);
		}
	});
	return paths;
}
