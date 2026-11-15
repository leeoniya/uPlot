// Standalone classic script. No imports or runtime dependencies.
var meanGAM, createMeanGAM;

(function() {
	'use strict';

	const sqrt = Math.sqrt;
	const max = Math.max;
	const min = Math.min;
	const defaultOptions = Object.freeze({});
	const difference = Object.freeze([1, -2, 1]);

	function isNumericArray(value) {
		if (Array.isArray(value)) return true;
		if (!ArrayBuffer.isView(value) || typeof value.length !== 'number') return false;
		const type = Object.prototype.toString.call(value);
		return type !== '[object BigInt64Array]' && type !== '[object BigUint64Array]';
	}

	// Lower triangle, stored as [diagonal, subdiagonal 1, 2, 3] per row.
	function bandedCholesky(gram, penalty, weight, lower, size) {
		for (let i = 0; i < size; i++) {
			for (let j = max(0, i - 3); j <= i; j++) {
				const index = 4 * i + i - j;
				let value = gram[index] + weight * penalty[index];
				for (let k = max(0, i - 3); k < j; k++)
					value -= lower[4 * i + i - k] * lower[4 * j + j - k];
				if (i === j) {
					if (!(value > 0) || !Number.isFinite(value))
						throw new RangeError('knots and lambda produce a numerically singular spline system');
					lower[index] = sqrt(value);
				}
				else lower[index] = value / lower[4 * j];
			}
		}
	}

	function bandedSolve(lower, rhs, beta, size) {
		for (let i = 0; i < size; i++) {
			let value = rhs[i];
			for (let j = max(0, i - 3); j < i; j++) value -= lower[4 * i + i - j] * beta[j];
			beta[i] = value / lower[4 * i];
		}
		for (let i = size - 1; i >= 0; i--) {
			let value = beta[i];
			for (let j = i + 1; j < min(size, i + 4); j++) value -= lower[4 * j + j - i] * beta[j];
			beta[i] = value / lower[4 * i];
		}
	}

	// Single-smooth mean GAM: minimize .5 * sum((yNormalized - B beta)^2)
	// + lambda / 2 * ||D2 beta||^2. The loss is a SUM, not a mean.
	// y is centered at its finite midrange and divided by the largest deviation.
	// The cubic basis and second-difference penalty are identical to quantileGAM's.
	// Uniform knots extend beyond [0, 1]; affine coefficients have zero penalty.
	// knots is the number of basis coefficients (a safe integer >= 4, default 30).
	// lambda must be finite and positive (default 1).
	// data accepts Arrays and numeric typed arrays. Only finite numbers participate.
	// The returned Array has data.length entries, with null at missing positions.
	// x optionally supplies finite, strictly increasing coordinates at EVERY position.
	// Otherwise, use original indices. The first and last finite responses set the
	// domain: missing endpoint padding is ignored, but internal gaps retain spacing.
	// Inputs are never sorted or modified. Empty, constant, and at most two observed
	// responses are analytic; other fits use one banded Cholesky factor and solve.
	// Output rescaling saturates at +/-Number.MAX_VALUE on overflow.
	// Work and workspace are O(n + k) for n positions and k coefficients.
	// createMeanGAM() returns a callable with the same API. It retains its output
	// Array and typed workspace; each call overwrites the previous output. Copy it
	// if it must outlive the next call. Inputs and options are reread and validated.
	// Sample/knot capacities grow as max(required, previous capacity * 2).
	// Within warmed capacities, calls allocate no helper arrays, views, or results.
	// data and x must not be this fitter's output Array. Copy it first; an alias
	// throws TypeError before any workspace or output mutation.
	createMeanGAM = function() {
		const result = [];
		let capacity = 0;
		let knotCapacity = 0;
		let indices, ys, starts, basis;
		let gram, penalty, lower, rhs, beta;

		return function(data, {x, knots = 30, lambda = 1} = defaultOptions) {
			if (data === result || x === result)
				throw new TypeError('data and x must not alias this fitter\'s output Array; copy it first');
			if (!isNumericArray(data))
				throw new TypeError('data must be an Array or numeric typed array');
			if (x !== undefined) {
				if (!isNumericArray(x))
					throw new TypeError('x must be an Array or numeric typed array');
				if (x.length !== data.length)
					throw new RangeError('x length must match data length');
				let previous = -Infinity;
				for (let i = 0; i < x.length; i++) {
					const value = x[i];
					if (!Number.isFinite(value) || value <= previous)
						throw new RangeError('x must be finite and strictly increasing at every position');
					previous = value;
				}
			}
			if (!Number.isSafeInteger(knots) || knots < 4)
				throw new RangeError('knots must be a safe integer >= 4');
			if (!Number.isFinite(lambda) || lambda <= 0)
				throw new RangeError('lambda must be finite and positive');

			result.length = data.length;
			result.fill(null);
			if (data.length > capacity) {
				const nextCapacity = max(data.length, capacity * 2);
				indices = new Uint32Array(nextCapacity);
				ys = new Float64Array(nextCapacity);
				starts = new Uint32Array(nextCapacity);
				basis = new Float64Array(4 * nextCapacity);
				capacity = nextCapacity;
			}
			let size = 0;
			let low = Infinity;
			let high = -Infinity;
			for (let i = 0; i < data.length; i++) {
				const value = data[i];
				if (Number.isFinite(value)) {
					indices[size] = i;
					ys[size++] = value;
					low = min(low, value);
					high = max(high, value);
				}
			}
			// Two distinct observations admit an exact affine fit with zero penalty.
			if (size <= 2 || low === high) {
				for (let i = 0; i < size; i++) result[indices[i]] = ys[i];
				return result;
			}

			// Centering retains small variations on a large offset; halve before adding
			// to avoid overflow. All normalized observations lie in [-1, 1].
			const center = low / 2 + high / 2;
			const scale = max(high - center, center - low);
			for (let i = 0; i < size; i++) ys[i] = (ys[i] - center) / scale;

			// Subtract before dividing to retain small epoch differences. Halve only
			// when the observed coordinate span overflows.
			const xFirst = x === undefined ? indices[0] : x[indices[0]];
			const xLast = x === undefined ? indices[size - 1] : x[indices[size - 1]];
			const xDivisor = Number.isFinite(xLast - xFirst) ? 1 : 2;
			const xOrigin = xFirst / xDivisor;
			const xRange = xLast / xDivisor - xOrigin;
			if (knots > knotCapacity) {
				const nextCapacity = max(knots, knotCapacity * 2);
				gram = new Float64Array(4 * nextCapacity);
				penalty = new Float64Array(4 * nextCapacity);
				lower = new Float64Array(4 * nextCapacity);
				rhs = new Float64Array(nextCapacity);
				beta = new Float64Array(nextCapacity);
				knotCapacity = nextCapacity;
			}
			gram.fill(0, 0, 4 * knots);
			penalty.fill(0, 0, 4 * knots);
			rhs.fill(0, 0, knots);
			for (let i = 0; i < size; i++) {
				const position = ((x === undefined ? indices[i] : x[indices[i]]) / xDivisor - xOrigin) / xRange;
				const knotX = position * (knots - 3);
				const start = min(knots - 4, Math.floor(knotX));
				const u = knotX - start;
				const v = 1 - u;
				const row = 4 * i;
				starts[i] = start;
				basis[row] = v * v * v / 6;
				basis[row + 1] = (3 * u * u * u - 6 * u * u + 4) / 6;
				basis[row + 2] = (-3 * u * u * u + 3 * u * u + 3 * u + 1) / 6;
				basis[row + 3] = u * u * u / 6;
				for (let a = 0; a < 4; a++) {
					rhs[start + a] += basis[row + a] * ys[i];
					for (let b = 0; b <= a; b++)
						gram[4 * (start + a) + a - b] += basis[row + a] * basis[row + b];
				}
			}
			for (let i = 0; i < knots - 2; i++) {
				for (let a = 0; a < 3; a++) {
					for (let b = 0; b <= a; b++)
						penalty[4 * (i + a) + a - b] += difference[a] * difference[b];
				}
			}

			bandedCholesky(gram, penalty, lambda, lower, knots);
			bandedSolve(lower, rhs, beta, knots);
			for (let i = 0; i < size; i++) {
				const start = starts[i];
				const row = 4 * i;
				let fit = 0;
				for (let a = 0; a < 4; a++) fit += basis[row + a] * beta[start + a];
				const scaled = scale * fit;
				// An overflowing product can still have a finite sum with the center.
				const restored = Number.isFinite(scaled) ? center + scaled : (center / 2 + scale * (fit / 2)) * 2;
				result[indices[i]] = max(-Number.MAX_VALUE, min(Number.MAX_VALUE, restored));
			}
			return result;
		};
	};

	// The one-shot API owns a fresh workspace and output on every call.
	meanGAM = function(data, options) {
		return createMeanGAM()(data, options);
	};
})();
