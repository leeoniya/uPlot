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
	return {
		intervals, directory, blocks,
		lookup: count => {
			const i = Math.floor((count - minCount) * countScale);
			return blocks[(directory[i >>> 6] << 6) | (i & 63)];
		},
	};
}
