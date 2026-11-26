// Approximate log colors with at most one index of error inside the count domain.
// See docs/investigations/heatmap-color-luts.md for the grid bound and measurements.
export function logApproxLut(colorCount, minCount, maxCount) {
	if (!Number.isInteger(colorCount) || colorCount < 11 || colorCount > 32 ||
		!Number.isFinite(minCount) || !Number.isFinite(maxCount) || minCount > maxCount)
		return null;

	if (minCount == maxCount)
		return { intervals: 0, directory: new Uint8Array(1), blocks: new Uint8Array(64), lookup: () => 0 };

	if (minCount <= 0) return null;
	const countRange = maxCount - minCount;
	const logRange = Math.log(maxCount) - Math.log(minCount);
	if (!(logRange > 0)) return null;
	const step = logRange / (colorCount - 1);
	const ratioRange = Math.expm1(logRange);
	const minGap = Math.exp(step / 2) * Math.expm1(step) / ratioRange;
	const base = 4 * (colorCount - 1) ** 2;
	// No bin can span two transitions. Four subdivisions reduce error frequency.
	const intervals = 4 * base * Math.max(1, Math.ceil(1 / minGap / base));
	// Bound the directory allocation and keep bitwise lookup indices in range.
	if (!Number.isFinite(intervals) || intervals > 2 ** 24) return null;
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

function countToGrid(min, max, intervals) {
	const range = max - min;
	if (!Number.isFinite(range)) {
		const halfRange = max / 2 - min / 2;
		return count => (count / 2 - min / 2) / halfRange * intervals;
	}
	const factor = intervals / range;
	return Number.isFinite(factor) ? count => (count - min) * factor : count => (count - min) / range * intervals;
}

function scaledLookup(min, max, last, factor, table) {
	if (table == null)
		return count => count <= min ? 0 : count >= max ? last : Math.round((count - min) * factor);
	if (table.colors != null) {
		const { colors } = table;
		return count => count <= min ? 0 : count >= max ? last : colors[Math.floor((count - min) * factor)];
	}
	return sharedLookup(min, max, last, factor, table.directory, table.blocks);
}

function gridLookup(min, max, last, table) {
	const intervals = table?.intervals ?? last;
	const range = max - min;
	const factor = intervals / range;
	if (Number.isFinite(range) && Number.isFinite(factor))
		return scaledLookup(min, max, last, factor, table);

	// Only extreme domains need a separate conversion to grid coordinates.
	const grid = countToGrid(min, max, intervals);
	const lookup = scaledLookup(0, intervals, last, 1, table);
	return count => lookup(grid(count));
}

export function prepareHeatmapColorScale(palette, scale, min, max) {
	if (!Array.isArray(palette) || palette.length == 0) throw new TypeError('Expected a nonempty color array');
	for (const color of palette) {
		if (typeof color != 'string' || !color.trim()) throw new TypeError('Expected a CSS color string');
	}
	if (!['linear', 'sqrt', 'cbrt', 'log'].includes(scale)) throw new RangeError(`Unknown color scale: ${scale}`);
	if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new RangeError('Expected a finite ordered color domain');
	if (scale == 'log' && min != max && min <= 0) throw new RangeError('Nonconstant log domains must be positive');

	const last = palette.length - 1;
	if (min == max || last == 0) return { lookup: () => 0, stops: [[0, palette[0]], [1, palette[0]]] };

	let lookup, offset;
	if (scale == 'linear') {
		lookup = gridLookup(min, max, last);
		offset = t => t;
	}
	else if (scale == 'log') {
		// log1p preserves narrow domains. Test the largest relative count before using it.
		let logRatio;
		if (Number.isFinite((max - min) / min))
			logRatio = count => Math.log1p((count - min) / min);
		else {
			const logMin = Math.log(min);
			logRatio = count => Math.log(count) - logMin;
		}
		const range = logRatio(max);
		lookup = logApproxLut(last + 1, min, max)?.lookup ??
			(count => count <= min ? 0 : count >= max ? last : Math.round(logRatio(count) / range * last));
		const span = Math.expm1(range);
		// For overflowing ratios, divide numerator and denominator by exp(range).
		offset = Number.isFinite(span) ? t => Math.expm1(range * t) / span :
			t => Math.exp(range * (t - 1)) * -Math.expm1(-range * t);
	}
	else {
		offset = scale == 'sqrt' ? t => t * t : t => t * t * t;
		// Keep the flat grid small and shared block IDs representable in one byte.
		if (palette.length <= 32) {
			lookup = gridLookup(min, max, last, rootTable(scale, last));
		}
		else {
			const root = scale == 'sqrt' ? Math.sqrt : Math.cbrt;
			const normalize = countToGrid(min, max, 1);
			lookup = count => count <= min ? 0 : count >= max ? last : Math.round(root(normalize(count)) * last);
		}
	}

	return {
		lookup,
		stops: palette.map((color, i) => [i == 0 ? 0 : i == last ? 1 : offset(i / last), color]),
	};
}
