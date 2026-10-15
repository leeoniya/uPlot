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

export function colorPaths(u, seriesIdx, facet) {
	const [palette, indices] = cacheColors(u, seriesIdx, facet);
	const paths = new Map();
	const lookup = Array(palette.length);

	for (let i = 0; i < palette.length; i++) {
		const color = palette[i];
		if (color != null) {
			let path = paths.get(color);
			if (path == null)
				paths.set(color, path = new Path2D());
			lookup[i] = path;
		}
	}

	return {paths, lookup, indices, index: dispReader(facet.kind == 1 ? 1 : 3)};
}
