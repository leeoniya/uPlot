// Standalone classic script. No imports or runtime dependencies.
var loess, createLoess;

(function() {
	'use strict';

	const abs = Math.abs;
	const defaults = Object.freeze({});

	function siftDown(values, start, root, length) {
		const value = values[start + root];
		let child = root * 2 + 1;
		while (child < length) {
			if (child + 1 < length && values[start + child] < values[start + child + 1]) child++;
			if (value >= values[start + child]) break;
			values[start + root] = values[start + child];
			root = child;
			child = root * 2 + 1;
		}
		values[start + root] = value;
	}

	// Sort only the inclusive active range, without views or sort scratch.
	function sortRange(values, left, right) {
		const length = right - left + 1;
		for (let root = (length >> 1) - 1; root >= 0; root--)
			siftDown(values, left, root, length);
		for (let end = length - 1; end > 0; end--) {
			const value = values[left];
			values[left] = values[left + end];
			values[left + end] = value;
			siftDown(values, left, 0, end);
		}
	}

	// In-place three-way introselect, with a linear partition-work budget.
	// The allocation-free heapsort fallback bounds worst-case work at O(n log n), never O(n²).
	function selectMedian(values, length) {
		const middle = length >> 1;
		let left = 0;
		let right = length - 1;
		let budget = 2 * length;
		while (left < right) {
			if ((budget -= right - left + 1) < 0) {
				sortRange(values, left, right);
				break;
			}
			const a = values[left];
			const b = values[(left + right) >> 1];
			const c = values[right];
			const pivot = a < b ? (b < c ? b : Math.max(a, c)) : (a < c ? a : Math.max(b, c));
			let low = left;
			let high = right;
			for (let i = left; i <= high;) {
				const value = values[i];
				if (value < pivot) {
					values[i++] = values[low];
					values[low++] = value;
				}
				else if (value > pivot) {
					values[i] = values[high];
					values[high--] = value;
				}
				else i++;
			}
			if (middle < low) right = low - 1;
			else if (middle > high) left = high + 1;
			else break;
		}
		if (length % 2) return values[middle];
		let lower = values[0];
		for (let i = 1; i < middle; i++) lower = Math.max(lower, values[i]);
		return (lower + values[middle]) / 2;
	}

	function selectAnchors(xs, size, limit, anchors, selected) {
		if (limit === size) {
			for (let i = 0; i < size; i++) anchors[i] = i;
			return size;
		}

		let regular = true;
		const step = xs[1] - xs[0];
		for (let i = 2; i < size; i++) {
			if (xs[i] - xs[i - 1] !== step) {
				regular = false;
				break;
			}
		}
		if (regular || limit < 4) {
			for (let a = 0; a < limit; a++)
				anchors[a] = Math.round(a * (size - 1) / (limit - 1));
			return limit;
		}
		const rankCount = Math.ceil(limit / 2);
		selected.fill(0, 0, size);
		for (let a = 0; a < rankCount; a++)
			selected[Math.round(a * (size - 1) / (rankCount - 1))] = 1;

		// Each interior x-grid point reserves two slots for its surrounding samples.
		// A monotone scan and a marker array merge both grids without sorting samples.
		const gridCount = Math.floor((limit - rankCount) / 2);
		const width = xs[size - 1] - xs[0];
		let right = 1;
		for (let g = 1; g <= gridCount; g++) {
			const fraction = g / (gridCount + 1);
			const target = width === Infinity
				? (1 - fraction) * xs[0] + fraction * xs[size - 1]
				: xs[0] + fraction * width;
			while (right < size - 1 && xs[right] < target)
				right++;
			selected[right - 1] = selected[right] = 1;
		}
		let fitCount = 0;
		for (let i = 0; i < size; i++) {
			if (selected[i]) anchors[fitCount++] = i;
		}
		return fitCount;
	}

	function grow(state, length) {
		if (length <= state.capacity) return;
		const capacity = Math.max(length, state.capacity * 2);
		state.positions = new Uint32Array(capacity);
		state.xs = new Float64Array(capacity);
		state.ys = new Float64Array(capacity);
		state.anchors = new Uint32Array(capacity);
		state.selected = new Uint8Array(capacity);
		state.starts = new Uint32Array(capacity);
		state.radii = new Float64Array(capacity);
		state.weights = new Float64Array(capacity);
		state.fitted = new Float64Array(capacity);
		state.robust = new Float64Array(capacity);
		state.residuals = new Float64Array(capacity);
		state.scratch = new Float64Array(capacity);
		state.capacity = capacity;
	}

	// span is in (0, 1]; robustnessIters is a nonnegative safe integer.
	// Optional x is an Array or numeric typed array with the same length as data.
	// All x values must be finite and strictly increasing, including positions with missing y.
	// Without x, coordinates are the original indices. Neither input is sorted or modified.
	// Only finite y values participate. Missing positions stay null, not interpolated.
	// Neighborhoods contain k = ceil(span * finiteCount) samples, with a minimum of four
	// (or all available samples): tricube gives the farthest samples zero weight.
	// maxFits is a safe integer >= 2 (default 512), an approximation budget.
	// Uniform x uses evenly spaced finite-sample indices, including both endpoints.
	// For irregular x and budgets >= 4, half the slots form an index grid.
	// The remaining slots select sample pairs around evenly spaced interior x-grid points.
	// This preserves both sides of gaps that contain grid points, including isolated samples between large gaps.
	// Duplicates use no extra fits. Anchor selection is O(n), with at most maxFits anchors.
	// A limited budget cannot preserve every gap or feature. Higher maxFits improves coverage.
	// Other finite positions use linear interpolation in x before residual reweighting.
	// For k <= 16, every sample gets an exact fit to preserve narrow-window smoothing.
	// Here n is data.length and m is the number of fits per pass.
	// Local-fit work per pass is O(m*k + n), linear in n at fixed maxFits (or k <= 16).
	// Residual selection is normally O(n), with an O(n log n) worst-case fallback.
	// One-shot storage is O(n); reusable storage is O(largest input length).
	// By default, series with up to 512 finite samples get exact fits.
	// maxFits >= finiteCount requests exact fits and can cost O(n²) per pass.
	function fit(data, {span = 0.05, robustnessIters = 2, x, maxFits = 512} = defaults, state) {
		if (!Array.isArray(data) && !(ArrayBuffer.isView(data) && typeof data.length === 'number'))
			throw new TypeError('data must be an Array or numeric typed array');
		if (!Number.isFinite(span) || span <= 0 || span > 1)
			throw new RangeError('span must be finite and in (0, 1]');
		if (!Number.isSafeInteger(robustnessIters) || robustnessIters < 0)
			throw new RangeError('robustnessIters must be a nonnegative safe integer');
		if (!Number.isSafeInteger(maxFits) || maxFits < 2)
			throw new RangeError('maxFits must be a safe integer >= 2');
		if (x !== undefined) {
			if (!Array.isArray(x) && !(ArrayBuffer.isView(x) && typeof x.length === 'number'))
				throw new TypeError('x must be an Array or numeric typed array');
			if (x.length !== data.length)
				throw new RangeError('x must have the same length as data');
		}

		const length = data.length;
		grow(state, length);
		const {output, positions, xs, ys, anchors, selected, starts, radii, weights, fitted, robust, residuals, scratch} = state;
		let size = 0;
		let minY = Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < length; i++) {
			const coordinate = x === undefined ? i : x[i];
			if (x !== undefined && (!Number.isFinite(coordinate) || i > 0 && coordinate <= x[i - 1]))
				throw new RangeError('x must contain finite, strictly increasing numbers at every position');
			const value = data[i];
			if (Number.isFinite(value)) {
				positions[size] = i;
				xs[size] = coordinate;
				ys[size] = value;
				size++;
				minY = Math.min(minY, value);
				maxY = Math.max(maxY, value);
			}
		}

		// Read inputs first: a caller can also supply the previous output as data or x.
		output.length = length;
		output.fill(null);
		if (size < 3 || minY === maxY) {
			for (let i = 0; i < size; i++) output[positions[i]] = ys[i];
			return output;
		}

		// The finite midrange avoids overflow and ties residual tolerance to variation, not the y offset.
		const center = minY / 2 + maxY / 2;
		let scale = 0;
		for (let i = 0; i < size; i++) {
			ys[i] -= center;
			scale = Math.max(scale, abs(ys[i]));
		}
		for (let i = 0; i < size; i++) {
			ys[i] /= scale;
			fitted[i] = ys[i];
			robust[i] = 1;
		}

		const count = Math.min(size, Math.max(4, Math.ceil(span * size)));
		const fitCount = selectAnchors(xs, size, count <= 16 ? size : Math.min(size, maxFits), anchors, selected);
		let left = 0;
		for (let a = 0; a < fitCount; a++) {
			const i = anchors[a];
			while (left + count < size && xs[i] - xs[left] > xs[left + count] - xs[i])
				left++;
			starts[a] = left;
			radii[a] = Math.max(xs[i] - xs[left], xs[left + count - 1] - xs[i]);
		}

		const tolerance = 32 * Number.EPSILON;
		let previousMedian = Infinity;

		// The monotone window scan runs once. Only the anchors need local regressions.
		for (let iteration = 0; ; iteration++) {
			for (let a = 0; a < fitCount; a++) {
				const i = anchors[a];
				const start = starts[a];
				const end = start + count;
				let radius = radii[a];
				// Opposite finite x extremes can have an infinite difference.
				const wide = radius === Infinity;
				if (wide) radius = Math.max(xs[i] / 2 - xs[start] / 2, xs[end - 1] / 2 - xs[i] / 2);
				let first = -1;
				let last = -1;
				for (let j = 0; j < count; j++) {
					const index = start + j;
					const distance = abs(wide ? xs[index] / 2 - xs[i] / 2 : xs[index] - xs[i]) / radius;
					const tricube = 1 - distance * distance * distance;
					const weight = weights[j] = tricube * tricube * tricube * robust[index];
					if (weight > 0) {
						if (first < 0) first = index;
						last = index;
					}
				}
				// No support retains the last fit. Robust rejection can shrink the support each pass.
				if (first < 0) continue;
				const originX = xs[first];
				let spread = xs[last] - originX;
				const wideSpread = spread === Infinity;
				if (wideSpread) spread = xs[last] / 2 - originX / 2;
				const target = spread > 0 ? (wideSpread ? xs[i] / 2 - originX / 2 : xs[i] - originX) / spread : 0;
				const origin = ys[i];
				let weightSum = 0;
				let meanX = 0;
				let meanY = 0;
				let variance = 0;
				let covariance = 0;

				for (let j = start; j < end; j++) {
					const weight = weights[j - start];
					if (weight <= 0) continue;

					// Scale the contributing spread, not the radius: zero-weight neighbors can be arbitrarily distant.
					const x = spread > 0 ? (wideSpread ? xs[j] / 2 - originX / 2 : xs[j] - originX) / spread : 0;
					// Weighted centered moments avoid subtracting nearly equal normal equations.
					const y = ys[j] - origin;
					const dx = x - meanX;
					const dy = y - meanY;
					weightSum += weight;
					const fraction = weight / weightSum;
					meanX += fraction * dx;
					meanY += fraction * dy;
					variance += weight * dx * (x - meanX);
					covariance += weight * dx * (y - meanY);
				}

				// One surviving point gives a constant fit, even with an extreme target offset.
				fitted[i] = origin + meanY + (variance > 0 && covariance !== 0 ? covariance / variance * (target - meanX) : 0);
			}

			for (let a = 1; a < fitCount; a++) {
				const start = anchors[a - 1];
				const end = anchors[a];
				const width = xs[end] - xs[start];
				for (let i = start + 1; i < end; i++) {
					const fraction = width === Infinity
						? (xs[i] / 2 - xs[start] / 2) / (xs[end] / 2 - xs[start] / 2)
						: (xs[i] - xs[start]) / width;
					fitted[i] = fitted[start] + fraction * (fitted[end] - fitted[start]);
				}
			}

			if (iteration === robustnessIters) break;

			let largest = 0;
			for (let i = 0; i < size; i++) {
				residuals[i] = abs(ys[i] - fitted[i]);
				scratch[i] = residuals[i];
				largest = Math.max(largest, residuals[i]);
			}
			if (largest <= tolerance) break;

			let median = selectMedian(scratch, size);
			if (median <= tolerance) {
				// Exact trends with isolated spikes can have a zero median residual.
				// Use the nonzero residuals so the next pass can still reject those spikes.
				let nonzero = 0;
				for (let i = 0; i < size; i++) {
					if (residuals[i] > tolerance) scratch[nonzero++] = residuals[i];
				}
				median = selectMedian(scratch, nonzero);
				// Once only the rejected spikes have residuals, do not let them raise the scale.
				median = Math.min(median, previousMedian);
			}
			previousMedian = median;
			for (let i = 0; i < size; i++) {
				const ratio = residuals[i] / (6 * median);
				const bisquare = Math.max(0, 1 - ratio * ratio);
				robust[i] = bisquare * bisquare;
			}
		}

		for (let i = 0; i < size; i++) {
			let value = fitted[i] * scale;
			// An overflowing product can still have a finite sum with the center.
			if (!Number.isFinite(value) && Number.isFinite(fitted[i]))
				value = (center / 2 + fitted[i] * (scale / 2)) * 2;
			else value += center;
			// Local linear extrapolation at edges can exceed the finite number range.
			output[positions[i]] = Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
		}
		return output;
	}

	// createLoess() returns a callable with the same (data, options) interface as loess().
	// Each fitter owns its workspace and returns the same output Array on every call.
	// Each call rereads and validates inputs and options, then overwrites all output positions.
	// Copy the output if a snapshot must survive the next call. Do not freeze the output.
	// Typed buffers grow geometrically and never shrink. Options do not change their capacity.
	// Valid refits within capacity create no arrays, typed-array views, or result objects.
	// The engine can still resize the output Array's internal storage when its length changes.
	createLoess = function() {
		const state = {
			capacity: 0,
			output: new Array(),
			positions: null,
			xs: null,
			ys: null,
			anchors: null,
			selected: null,
			starts: null,
			radii: null,
			weights: null,
			fitted: null,
			robust: null,
			residuals: null,
			scratch: null,
		};
		return function(data, options) {
			return fit(data, options, state);
		};
	};

	// One-shot calls retain no workspace and return independent output Arrays.
	loess = function(data, options) {
		return createLoess()(data, options);
	};
})();
