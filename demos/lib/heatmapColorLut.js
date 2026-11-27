// Approximate log colors with at most one index of error inside the count domain.
// See docs/investigations/heatmap-color-luts.md for the grid bound and measurements.
export function logApproxLut(colorCount, minCount, maxCount) {
	if (colorCount < 11 || colorCount > 32) return null;

	const countRange = maxCount - minCount;
	const logRange = Math.log(maxCount) - Math.log(minCount);
	// Distinct endpoints can have the same rounded log. Use the direct log1p scale then.
	if (logRange == 0) return null;
	const step = logRange / (colorCount - 1);
	const ratioRange = Math.expm1(logRange);
	const minGap = Math.exp(step / 2) * Math.expm1(step) / ratioRange;
	const base = 4 * (colorCount - 1) ** 2;
	// No bin can span two transitions. Four subdivisions reduce error frequency.
	const intervals = 4 * base * Math.max(1, Math.ceil(1 / minGap / base));
	// Bound the directory allocation and keep bitwise lookup indices in range.
	if (intervals > 2 ** 24) return null;
	const countScale = intervals / countRange;
	if (!Number.isFinite(countScale)) return null;
	const transitions = Array.from({ length: colorCount - 1 }, (_, i) =>
		Math.ceil(Math.expm1(step * (i + .5)) / ratioRange * intervals));

	const { directory, blocks } = sharedBlocks(colorCount, intervals, transitions);
	const lookup = sharedLookup(minCount, maxCount, colorCount - 1, countScale, directory, blocks);
	return { intervals, directory, blocks, lookup };
}

function sharedBlocks(colorCount, intervals, transitions) {
	const directory = new Uint8Array(Math.ceil((intervals + 1) / 64));
	// At most one solid block per color and one mixed block per transition.
	const scratch = new Uint8Array((2 * colorCount - 1) * 64);
	const solidBlocks = new Array(colorCount);
	let blockCount = 0;
	for (let block = 0, color = 0; block < directory.length; block++) {
		const start = block * 64;
		while (color < transitions.length && start >= transitions[color]) color++;
		const solid = start + 64 <= (transitions[color] ?? Infinity);
		let id = solid ? solidBlocks[color] : undefined;
		if (id == null) {
			id = blockCount++;
			if (solid) solidBlocks[color] = id;
			for (let i = 0; i < 64; i++) {
				while (color < transitions.length && start + i >= transitions[color]) color++;
				scratch[id * 64 + i] = color;
			}
		}
		directory[block] = id;
	}
	const blocks = scratch.slice(0, blockCount * 64);
	return { directory, blocks };
}

function sharedLookup(min, max, last, factor, directory, blocks) {
	return count => {
		if (count <= min) return 0;
		if (count >= max) return last;
		const i = Math.floor((count - min) * factor);
		return blocks[(directory[i >>> 6] << 6) | (i & 63)];
	};
}

const rootTables = { sqrt: null, cbrt: null };

function rootTable(scale, last) {
	if (rootTables[scale]?.last == last) return rootTables[scale];

	// Half-color boundaries fall on odd squares or cubes in these integer grids.
	const intervals = (2 * last) ** (scale == 'sqrt' ? 2 : 3);
	if (scale == 'sqrt') {
		const colors = new Uint8Array(intervals + 1);
		for (let i = 1; i <= last; i++)
			colors.fill(i, (2 * i - 1) ** 2, (2 * i + 1) ** 2);
		return rootTables.sqrt = { last, intervals, colors };
	}
	const transitions = Array.from({ length: last }, (_, i) => (2 * i + 1) ** 3);
	return rootTables.cbrt = { last, intervals, ...sharedBlocks(last + 1, intervals, transitions) };
}

function gridLookup(min, max, last, table) {
	const factor = (table?.intervals ?? last) / (max - min);
	if (table == null)
		return count => count <= min ? 0 : count >= max ? last : Math.round((count - min) * factor);
	if (table.colors != null) {
		const { colors } = table;
		return count => count <= min ? 0 : count >= max ? last : colors[Math.floor((count - min) * factor)];
	}
	return sharedLookup(min, max, last, factor, table.directory, table.blocks);
}


export function prepareHeatmapColorScale(palette, scale, min, max) {
	const last = palette.length - 1;
	if (min == max || last == 0) return { lookup: () => 0, stops: [[0, palette[0]], [1, palette[0]]] };

	let lookup, offset;
	if (scale == 'linear') {
		lookup = gridLookup(min, max, last);
		offset = t => t;
	}
	else if (scale == 'log') {
		// log1p preserves narrow domains. The relative span and expm1(range) must be finite.
		const logRatio = count => Math.log1p((count - min) / min);
		const range = logRatio(max);
		lookup = logApproxLut(last + 1, min, max)?.lookup ??
			(count => count <= min ? 0 : count >= max ? last : Math.round(logRatio(count) / range * last));
		const span = Math.expm1(range);
		offset = t => Math.expm1(range * t) / span;
	}
	else {
		offset = scale == 'sqrt' ? t => t * t : t => t * t * t;
		// Keep the flat grid small and shared block IDs representable in one byte.
		if (palette.length <= 32) {
			lookup = gridLookup(min, max, last, rootTable(scale, last));
		}
		else {
			const root = scale == 'sqrt' ? Math.sqrt : Math.cbrt;
			const factor = 1 / (max - min);
			lookup = count => count <= min ? 0 : count >= max ? last : Math.round(root((count - min) * factor) * last);
		}
	}

	return {
		lookup,
		stops: palette.map((color, i) => [offset(i / last), color]),
	};
}
