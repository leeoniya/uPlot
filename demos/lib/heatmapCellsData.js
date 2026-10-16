// Synthetic request-latency rates on a uniform time / exponential-bucket grid.
// Empty cells are omitted. Output is ordered by xMax, then by yMin.
export function generateHeatmapCells({
	seed = 1,
	columns = 2569,
	interval = 20 * 60 * 1000,
	start = Date.UTC(2026, 7, 20, 10, 20),
	xGapProbability = 0,
} = {}) {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
		throw new RangeError('seed must be a 32-bit unsigned integer');
	if (!Number.isSafeInteger(columns) || columns < 1)
		throw new RangeError('columns must be a positive safe integer');
	if (!Number.isSafeInteger(interval) || interval < 1)
		throw new RangeError('interval must be a positive integer in milliseconds');
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(start + columns * interval))
		throw new RangeError('start and the final timestamp must be safe integers in milliseconds');

	if (!Number.isFinite(xGapProbability) || xGapProbability < 0 || xGapProbability > 1)
		throw new RangeError('xGapProbability must be a number between 0 and 1');

	// Independent Mulberry32 streams keep gaps from changing the surviving cells.
	const rng = state => () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ state >>> 15, state | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
	const random = rng(seed);
	const gapRandom = rng(seed ^ 0x9e3779b9);
	const binsPerOctave = 8;
	const firstExponent = -139;
	const rows = 169;
	const edges = Array.from({length: rows + 1}, (_, i) => 2 ** ((firstExponent + i) / binsPerOctave));
	const rates = new Float64Array(rows);
	const xMax = [], yMin = [], yMax = [], count = [], yLayout = [];
	const values = [xMax, yMin, yMax, count, yLayout];
	const rateWindow = 285;

	// Mass is the total expected rate of a band; width is its log2 standard deviation.
	function band(seconds, width, mass) {
		const center = Math.log2(seconds);
		const lo = Math.max(0, Math.floor((center - 4 * width) * binsPerOctave - firstExponent));
		const hi = Math.min(rows - 1, Math.ceil((center + 4 * width) * binsPerOctave - firstExponent));
		const height = mass / (width * Math.sqrt(2 * Math.PI) * binsPerOctave);
		for (let row = lo; row <= hi; row++) {
			const distance = ((firstExponent + row + 0.5) / binsPerOctave - center) / width;
			rates[row] += height * Math.exp(-0.5 * distance * distance);
		}
	}

	// Poisson sampling gives low-count speckle, empty buckets, and a 1/285 rate quantum.
	function events(mean) {
		const limit = Math.exp(-mean);
		let product = 1;
		let n = 0;
		do {
			product *= random();
			n++;
		} while (product > limit);
		return n - 1;
	}

	let drift = 0;
	for (let col = 0; col < columns; col++) {
		// Retain endpoint columns so every demo infers the same full time range.
		const omit = col > 0 && col < columns - 1 && gapRandom() < xGapProbability;
		const t = col / Math.max(1, columns - 1);
		const day = t * 35.7;
		const wave = Math.sin(2 * Math.PI * day);
		// A short daily count pulse follows a slower rise and rapid fall in the tail.
		const distance = (day + 1.5 - 25 / 36) % 1 - 0.5;
		const pulse = Math.exp(-0.5 * (distance / 0.045) ** 2);
		const tailDistance = (day + 1.5 - 0.65) % 1 - 0.5;
		const hump = Math.exp(-0.5 * (tailDistance / (tailDistance < 0 ? 0.16 : 0.025)) ** 2);
		const secondary = Math.exp(-0.5 * (((day + 1.5 - 0.15) % 1 - 0.5) / 0.08) ** 2);
		const heat = t >= 0.796 && t < 0.924 ? 1 : 0;
		drift = drift * 0.92 + (random() - 0.5) * 0.08;
		const wobble = 2 ** (0.035 * wave + drift);
		const load = 1 + 0.035 * Math.sin(t * Math.PI * 26);
		const outage = t > 0.263 && t < 0.268;
		rates.fill(0);

		band(15e-6 * wobble, 0.23, outage ? 0.15 : 0.285);
		band(23e-6 * wobble, 0.55, outage ? 0 : 0.025);
		const main = (0.0056 + 0.0017 * Math.min(1, t / 0.18)) * wobble;
		band(main, 0.14, outage ? 0.2 : 0.53);
		band(main * 1.15, 0.4, outage ? 0 : 0.14);

		if (!outage) {
			band(0.0027 * wobble, 0.14, 0.04);
			band(0.019 * wobble, 0.85, 0.16 * (1 + 0.9 * heat));
			band(0.101 * wobble, 0.2, 0.33);
			band(0.11 * wobble, 0.48, 0.09);
			band(0.304 * wobble, 0.38, 0.2);
			band(0.4 * wobble, 0.14, 0.09);
			band(0.65 * wobble, 0.5, 0.16);
			band(1.45 * wobble, 0.13, 0.2);
			band(1.5 * wobble, 0.4, 0.06);
			band((2.1 + 2.4 * hump + 0.6 * secondary) * 2 ** (drift * 3), 0.36, 0.06);
			// Weak background connects the broad millisecond-to-second population.
			band(0.07, 2.3, 0.12 * (1 + 0.6 * heat));
			band(0.0018 * wobble, 0.6, 0.18 * heat);
			band(0.0008 * wobble, 0.18, t > 0.42 && t < 0.46 || t > 0.51 && t < 0.56 ? 0 : 0.01);

			// New fast traffic arrives late, then moves between two distinct latency bands.
			if (t >= 0.796) {
				const missingFast = t >= 0.924 && t < 0.971;
				const fast = missingFast ? 0 : t < 0.84 ? 1.4 : t < 0.924 ? 1.15 : 0.5;
				band(0.00075 * wobble, 0.16, fast);
				band(0.0018 * wobble, 0.13, 2.1 - fast);
			}
		}

		const time = start + (col + 1) * interval;
		for (let row = 0; row < rows; row++) {
			// Rare isolated events keep the quiet region sparse rather than filling a matrix.
			const background = !outage && edges[row] < 0.0004 ? 0.00001 : 0;
			// The microsecond band stays steady; daily pulses brighten faster populations
			// while the 1–4s population recedes around the upper-tail peak.
			const latency = Math.sqrt(edges[row] * edges[row + 1]);
			const strength = latency < 0.0001 ? 0 : latency < 0.001 ? 0.1 : latency < 0.01 ? 0.5 : latency < 0.1 ? 0.7 : latency < 1 ? 0.5 : latency < 4 ? -0.3 : 0.4;
			const elevated = latency >= 0.1 && latency < 4 ? 1 + 0.12 * heat : 1;
			const mean = (rates[row] + background) * rateWindow * load * (1 + strength * pulse) * elevated * (0.75 + 0.5 * random());
			if (mean == 0)
				continue;
			const n = events(mean);
			// Still sample omitted columns to preserve the latency/count random stream.
			if (n == 0 || omit)
				continue;
			xMax.push(time);
			yMin.push(edges[row]);
			yMax.push(edges[row + 1]);
			count.push(n / rateWindow);
			yLayout.push(0);
		}
	}

	return [{
		schema: {
			refId: 'A',
			meta: {
				type: 'heatmap-cells', typeVersion: [0, 0],
				custom: {synthetic: true, seed, xGapProbability, calculatedMinStep: interval},
			},
			fields: [
				{name: 'xMax', type: 'time', config: {interval}},
				{name: 'yMin', type: 'number', config: {unit: 's'}},
				{name: 'yMax', type: 'number', config: {unit: 's'}},
				{name: 'count', type: 'number', config: {}},
				{name: 'yLayout', type: 'number', config: {}},
			],
		},
		data: {values},
	}];
}
