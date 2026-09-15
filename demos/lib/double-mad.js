// Standalone classic script. No imports or runtime dependencies.
var harrellDavisMedian, prepareDoubleMad, doubleMad;

(function() {
	'use strict';

	const normalScale = 0.6744897501960817;
	const lanczos = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
		-176.6150291621406, 12.507343278686905, -0.13857109526572012,
		9.984369578019572e-6, 1.5056327351493116e-7];

	// All callers have z >= 1; no reflection formula is needed.
	function logGamma(z) {
		z--;
		let sum = 0.99999999999980993;
		for (let i = 0; i < lanczos.length; i++)
			sum += lanczos[i] / (z + i + 1);
		const t = z + 7.5;
		return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(sum);
	}

	function guard(value) {
		const tiny = 1e-300;
		return Math.abs(value) < tiny ? (value < 0 ? -tiny : tiny) : value;
	}

	// Modified Lentz continued fraction for I_x(a,a), evaluated only at x <= 1/2.
	function betaLower(x, a, logBeta) {
		if (x === 0) return 0;
		if (x === 0.5) return 0.5;

		let c = 1;
		let d = 1 / guard(1 - 2 * a * x / (a + 1));
		let h = d;
		for (let m = 1; m <= 10000; m++) {
			let aa = m * (a - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
			d = 1 / guard(1 + aa * d);
			c = guard(1 + aa / c);
			h *= d * c;
			aa = -(a + m) * (2 * a + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
			d = 1 / guard(1 + aa * d);
			c = guard(1 + aa / c);
			const delta = d * c;
			h *= delta;
			if (Math.abs(delta - 1) <= 4 * Number.EPSILON)
				return Math.exp(a * (Math.log(x) + Math.log1p(-x)) - logBeta + Math.log(h / a));
		}
		throw new Error('Harrell-Davis beta continued fraction did not converge');
	}

	// HD weights are beta((n+1)/2, (n+1)/2) probability masses in bins of width 1/n.
	// Only the lower half and optional middle weight need storage. Mirroring preserves
	// tiny upper tails; IEEE-754 weights can still underflow to zero.
	function fillWeights(n, weights) {
		const a = (n + 1) / 2;
		const logBeta = 2 * logGamma(a) - logGamma(2 * a);
		const pairs = Math.floor(n / 2);
		let previous = 0;
		for (let i = 0; i < pairs; i++) {
			const cumulative = betaLower((i + 1) / n, a, logBeta);
			weights[i] = Math.max(0, cumulative - previous);
			previous = cumulative;
		}
		if (n % 2 !== 0)
			weights[pairs] = 1 - 2 * previous;
	}

	// side = 0: values; -1: left deviations in reverse order; +1: right deviations.
	// One temporary workspace serves all three medians, reusing weights for equal sizes.
	function medianRange(sorted, start, n, center, side, workspace) {
		if (n === 0) return null;
		const end = start + n - 1;
		const first = side < 0 ? center - sorted[end] : side > 0 ? sorted[start] - center : sorted[start];
		const last = side < 0 ? center - sorted[start] : side > 0 ? sorted[end] - center : sorted[end];
		if (first === last) return first;

		if (workspace.weights === null)
			workspace.weights = new Float64Array(Math.ceil(sorted.length / 2));
		const weights = workspace.weights;
		if (workspace.count !== n) {
			fillWeights(n, weights);
			workspace.count = n;
		}

		const pairs = Math.floor(n / 2);
		let sum = 0;
		let correction = 0;
		for (let i = 0; i < pairs; i++) {
			const low = sorted[start + i];
			const high = sorted[end - i];
			const near = side < 0 ? center - high : side > 0 ? low - center : low;
			const far = side < 0 ? center - low : side > 0 ? high - center : high;
			// Multiply before adding to avoid overflow in the pair's sum.
			const adjusted = (weights[i] * near + weights[i] * far) - correction;
			const next = sum + adjusted;
			correction = (next - sum) - adjusted;
			sum = next;
		}
		if (n % 2 !== 0) {
			const value = sorted[start + pairs];
			const middle = side < 0 ? center - value : side > 0 ? value - center : value;
			sum += weights[pairs] * middle - correction;
		}
		return Math.max(first, Math.min(last, sum));
	}

	// Input must be sorted, finite numbers. Empty input has no median.
	harrellDavisMedian = function(sorted) {
		return medianRange(sorted, 0, sorted.length, 0, 0, {count: 0, weights: null});
	};

	// Scores are a snapshot: prepare again after changing input values or length.
	// Only finite numeric samples participate. Equal-center samples belong to both sides.
	// detect returns original-order labels: -1 = noise, 0 = inlier, null = missing.
	// Default output is reused. The threshold applies to 0.67448975 * deviation / side MAD.
	prepareDoubleMad = function(data) {
		if (!Array.isArray(data) && !(ArrayBuffer.isView(data) && typeof data.length === 'number' && !(data instanceof DataView)))
			throw new TypeError('data must be an Array or numeric typed array');

		const length = data.length;
		let size = 0;
		let ascending = true;
		let previous = -Infinity;
		for (let i = 0; i < length; i++) {
			const value = data[i];
			if (Number.isFinite(value)) {
				size++;
				if (value < previous) ascending = false;
				previous = value;
			}
		}
		const sorted = new Float64Array(size);
		for (let i = 0, j = 0; i < length; i++) {
			if (Number.isFinite(data[i])) sorted[j++] = data[i];
		}
		if (!ascending) sorted.sort();
		// Half units prevent overflowing deviations for finite values of opposite signs.
		const divisor = sorted.length && !Number.isFinite(sorted[sorted.length - 1] - sorted[0]) ? 2 : 1;
		if (divisor !== 1) {
			for (let i = 0; i < sorted.length; i++) sorted[i] /= divisor;
		}
		const workspace = {count: 0, weights: null};
		const center = medianRange(sorted, 0, size, 0, 0, workspace);
		let leftSize = 0;
		let rightStart = 0;
		while (leftSize < size && sorted[leftSize] <= center) leftSize++;
		while (rightStart < size && sorted[rightStart] < center) rightStart++;
		const leftMad = medianRange(sorted, 0, leftSize, center, -1, workspace);
		const rightMad = medianRange(sorted, rightStart, size - rightStart, center, 1, workspace);

		const scores = new Float64Array(length);
		for (let i = 0; i < length; i++) {
			const value = data[i];
			if (!Number.isFinite(value)) {
				scores[i] = NaN;
				continue;
			}
			const scaled = value / divisor;
			const deviation = Math.abs(scaled - center);
			const mad = scaled <= center ? leftMad : rightMad;
			// Zero MAD: center scores 0; every other value scores Infinity.
			scores[i] = deviation === 0 ? 0 : mad === 0 ? Infinity : normalScale * deviation / mad;
		}
		const internal = new Array(length);

		return {
			median: center === null ? null : center * divisor,
			leftMad: leftMad === null ? null : leftMad * divisor,
			rightMad: rightMad === null ? null : rightMad * divisor,
			detect(threshold = 3.5, labels = internal) {
				if (!Number.isFinite(threshold) || threshold < 0)
					throw new RangeError('threshold must be finite and nonnegative');
				if (!Array.isArray(labels) || labels.length !== length || labels === data)
					throw new TypeError('labels must be an Array of data.length, distinct from data');
				for (let i = 0; i < length; i++) {
					const score = scores[i];
					labels[i] = score !== score ? null : score > threshold ? -1 : 0;
				}
				return labels;
			},
		};
	};

	doubleMad = function(data, threshold = 3.5) {
		return prepareDoubleMad(data).detect(threshold);
	};
})();
