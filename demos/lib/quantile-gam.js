// Standalone classic script. No imports or runtime dependencies.
var quantileGAM, createQuantileGAM;

(function() {
	'use strict';

	const abs = Math.abs;
	const sqrt = Math.sqrt;
	const max = Math.max;
	const min = Math.min;
	const absoluteTolerance = 1e-6;
	const relativeTolerance = 1e-5;
	const initialRho = 100;
	const defaultQuantiles = Object.freeze([0.1, 0.5, 0.9]);
	const defaultOptions = Object.freeze({});
	const difference = Object.freeze([1, -2, 1]);

	// Lower triangle, stored as [diagonal, subdiagonal 1, 2, 3] per row.
	function factor(gram, penalty, weight, lower, size) {
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

	function solve(lower, rhs, beta, size) {
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

	// Single-smooth quantile GAM: minimize sum pinball_q(y - B beta)
	// + lambda / 2 * ||D2 beta||^2, separately for each requested quantile.
	// y is centered at the finite midrange and divided by the largest deviation.
	// lambda uses this normalized scale and a SUM, not a mean, of sample losses.
	// knots is the number of cubic basis coefficients (a safe integer >= 4).
	// Uniform knots extend beyond [0, 1]; affine coefficients have zero penalty.
	// x optionally supplies finite, strictly increasing coordinates at EVERY position.
	// Normalize from the first to last finite response's x (or original index if omitted).
	// Missing endpoint padding does not set the domain; internal gaps retain their spacing.
	// Inputs are never sorted.
	// lambda must be finite and positive; quantiles must be a nonempty Array in (0, 1).
	// Only finite numeric samples participate. Missing positions remain null.
	// Curves follow quantile order and may cross; no rearrangement is applied.
	// Empty/constant fits take zero iterations. maxIterations is a positive safe integer
	// (default 10000) limiting each quantile's steps; convergence counts depend on data.
	// converged requires feasibility AND stationarity (absolute 1e-6, relative 1e-5).
	// A false flag returns the last iterate, not a certified optimum.
	// Output rescaling saturates at +/-Number.MAX_VALUE on overflow. Convergence
	// describes the normalized spline before this output-only clamp.
	// For n positions, k knots, q quantiles and at most I steps per quantile:
	// preparation O(n + k), histogram warm starts O(q * 256), fitting O(q * I * (n + k));
	// workspace O(n + k), plus O(q * n) returned curves (and their initialization).
	// createQuantileGAM() retains private high-water capacities and returns a fitter
	// with the same options as quantileGAM(). Each call overwrites its previous result,
	// retaining the result, metadata arrays, and pooled curve identities. Copy results
	// if they must outlive the next call. Inputs are reread, not cached; only storage
	// is reused. Fits within warmed capacities allocate no helper buffers or results.
	// Sample/knot capacities grow geometrically: max(required, previous capacity * 2).
	// Retained workspace memory follows these capacities, not the latest fit.
	// data, x, and quantiles must not be this fitter's output arrays (including
	// metadata, the curves array, or inactive pooled curves). Copy them first;
	// an alias throws TypeError before any workspace or output mutation.
	createQuantileGAM = function() {
		const curves = [];
		const iterations = [];
		const converged = [];
		const result = {curves, iterations, converged};
		const curvePool = [];
		const owned = new WeakSet();
		owned.add(curves);
		owned.add(iterations);
		owned.add(converged);
		const histogram = new Uint32Array(256);
		let capacity = 0;
		let knotCapacity = 0;
		let xs, ys, starts, basis, residual, dual, fitted;
		let gram, penalty, initialFactor, lower, beta, rhs, dualReference;

		return function(data, {x, quantiles = defaultQuantiles, knots = 30, lambda = 1, maxIterations = 10000} = defaultOptions) {
			if (owned.has(data) || owned.has(x) || owned.has(quantiles))
				throw new TypeError('data, x, and quantiles must not alias this fitter\'s output arrays; copy them first');
			if (!Array.isArray(data) && !(ArrayBuffer.isView(data) && typeof data.length === 'number' && (data.length === 0 || typeof data[0] === 'number')))
				throw new TypeError('data must be an Array or numeric typed array');
			if (x !== undefined) {
				const type = Object.prototype.toString.call(x);
				if (!Array.isArray(x) && !(ArrayBuffer.isView(x) && typeof x.length === 'number' && type !== '[object BigInt64Array]' && type !== '[object BigUint64Array]'))
					throw new TypeError('x must be an Array or numeric typed array');
				if (x.length !== data.length)
					throw new RangeError('x length must match data length');
				for (let i = 0; i < x.length; i++) {
					if (!Number.isFinite(x[i]) || (i > 0 && x[i] <= x[i - 1]))
						throw new RangeError('x must be finite and strictly increasing at every position');
				}
			}
			if (!Array.isArray(quantiles) || quantiles.length === 0)
				throw new RangeError('quantiles must be a nonempty Array of finite numbers in (0, 1)');
			for (let i = 0; i < quantiles.length; i++) {
				if (!Number.isFinite(quantiles[i]) || quantiles[i] <= 0 || quantiles[i] >= 1)
					throw new RangeError('quantiles must be a nonempty Array of finite numbers in (0, 1)');
			}
			if (!Number.isSafeInteger(knots) || knots < 4)
				throw new RangeError('knots must be a safe integer >= 4');
			if (!Number.isFinite(lambda) || lambda <= 0)
				throw new RangeError('lambda must be finite and positive');
			if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0)
				throw new RangeError('maxIterations must be a positive safe integer');

			curves.length = iterations.length = converged.length = quantiles.length;
			for (let i = 0; i < quantiles.length; i++) {
				let curve = curvePool[i];
				if (curve === undefined) {
					curve = curvePool[i] = new Array(data.length);
					owned.add(curve);
				}
				curve.length = data.length;
				curve.fill(null);
				curves[i] = curve;
				iterations[i] = 0;
				converged[i] = true;
			}
			if (data.length > capacity) {
				const nextCapacity = max(data.length, capacity * 2);
				xs = new Uint32Array(nextCapacity);
				ys = new Float64Array(nextCapacity);
				starts = new Uint32Array(nextCapacity);
				basis = new Float64Array(4 * nextCapacity);
				residual = new Float64Array(nextCapacity);
				dual = new Float64Array(nextCapacity);
				fitted = new Float64Array(nextCapacity);
				capacity = nextCapacity;
			}
			let size = 0;
			let low = Infinity;
			let high = -Infinity;
			for (let i = 0; i < data.length; i++) {
				if (Number.isFinite(data[i])) {
					xs[size] = i;
					ys[size++] = data[i];
					low = min(low, data[i]);
					high = max(high, data[i]);
				}
			}
			if (size === 0 || low === high) {
				for (let q = 0; q < curves.length; q++) {
					for (let i = 0; i < size; i++) curves[q][xs[i]] = ys[i];
				}
				return result;
			}

			// Halving before adding avoids overflow, while centering retains small
			// variations on a large offset. All normalized observations lie in [-1, 1].
			const center = low / 2 + high / 2;
			const scale = max(high - center, center - low);
			// The fixed histogram approximates only the initial quantile, without sorting.
			// ADMM still uses the exact observations and objective, not binned responses.
			histogram.fill(0);
			let yNorm = 0;
			for (let i = 0; i < size; i++) {
				ys[i] = (ys[i] - center) / scale;
				yNorm += ys[i] * ys[i];
				histogram[min(255, Math.floor((ys[i] + 1) * 128))]++;
			}
			yNorm = sqrt(yNorm);

			// Anchor the domain to observed pairs: missing padding must not collapse
			// their occupied range and make the unpenalized affine directions singular.
			// Subtract before dividing to retain small epoch differences. Only halve
			// coordinates when the observed span overflows.
			const xFirst = x === undefined ? xs[0] : x[xs[0]];
			const xLast = x === undefined ? xs[size - 1] : x[xs[size - 1]];
			const xDivisor = Number.isFinite(xLast - xFirst) ? 1 : 2;
			const xOrigin = xFirst / xDivisor;
			const xRange = xLast / xDivisor - xOrigin;
			if (knots > knotCapacity) {
				const nextCapacity = max(knots, knotCapacity * 2);
				gram = new Float64Array(4 * nextCapacity);
				penalty = new Float64Array(4 * nextCapacity);
				initialFactor = new Float64Array(4 * nextCapacity);
				lower = new Float64Array(4 * nextCapacity);
				beta = new Float64Array(nextCapacity);
				rhs = new Float64Array(nextCapacity);
				dualReference = new Float64Array(nextCapacity);
				knotCapacity = nextCapacity;
			}
			gram.fill(0, 0, 4 * knots);
			penalty.fill(0, 0, 4 * knots);
			for (let i = 0; i < size; i++) {
				const position = ((x === undefined ? xs[i] : x[xs[i]]) / xDivisor - xOrigin) / xRange;
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

			factor(gram, penalty, lambda / initialRho, initialFactor, knots);
			for (let q = 0; q < quantiles.length; q++) {
				const tau = quantiles[q];
				const rank = min(size - 1, Math.floor(tau * size));
				let count = 0;
				let initial = 0;
				for (let bin = 0; bin < histogram.length; bin++) {
					count += histogram[bin];
					if (count > rank) {
						initial = (bin + 0.5) / 128 - 1;
						break;
					}
				}
				for (let i = 0; i < size; i++) residual[i] = ys[i] - initial;
				dual.fill(0, 0, size);
				let rho = initialRho;
				// Never overwrite the initial factor when adapting rho. Each quantile
				// starts here, independent of the previous quantile's final rho.
				let currentFactor = initialFactor;
				converged[q] = false;

				for (let iteration = 1; iteration <= maxIterations; iteration++) {
					rhs.fill(0, 0, knots);
					for (let i = 0; i < size; i++) {
						const value = ys[i] - residual[i] - dual[i];
						const start = starts[i];
						const row = 4 * i;
						for (let a = 0; a < 4; a++) rhs[start + a] += basis[row + a] * value;
					}
					solve(currentFactor, rhs, beta, knots);

					dualReference.fill(0, 0, knots);
					let primalNorm = 0;
					let fitNorm = 0;
					let residualNorm = 0;
					for (let i = 0; i < size; i++) {
						const start = starts[i];
						const row = 4 * i;
						let fit = 0;
						for (let a = 0; a < 4; a++) fit += basis[row + a] * beta[start + a];
						fitted[i] = fit;
						const previous = residual[i];
						// Over-relaxation accelerates ADMM; stopping uses the actual fit.
						const relaxed = 1.6 * fit - 0.6 * (ys[i] - previous);
						const value = ys[i] - relaxed - dual[i];
						// Proximal operator of the asymmetric pinball loss, not squared loss.
						const next = max(0, value - tau / rho) + min(0, value + (1 - tau) / rho);
						residual[i] = next;
						const primal = fit + next - ys[i];
						dual[i] += relaxed + next - ys[i];
						primalNorm += primal * primal;
						fitNorm += fit * fit;
						residualNorm += next * next;
						for (let a = 0; a < 4; a++) dualReference[start + a] += basis[row + a] * dual[i];
					}
					let dualNorm = 0;
					let referenceNorm = 0;
					for (let i = 0; i < knots; i++) {
						let gradient = 0;
						for (let j = max(0, i - 2); j < min(knots, i + 3); j++)
							gradient += penalty[4 * max(i, j) + abs(i - j)] * beta[j];
						// Direct stationarity includes the effect of over-relaxation.
						const stationarity = lambda * gradient + rho * dualReference[i];
						dualNorm += stationarity * stationarity;
						referenceNorm += dualReference[i] * dualReference[i];
					}
					primalNorm = sqrt(primalNorm);
					dualNorm = sqrt(dualNorm);
					const primalTolerance = sqrt(size) * absoluteTolerance + relativeTolerance * max(sqrt(fitNorm), sqrt(residualNorm), yNorm);
					const dualTolerance = sqrt(knots) * absoluteTolerance + relativeTolerance * rho * sqrt(referenceNorm);
					iterations[q] = iteration;
					if (primalNorm <= primalTolerance && dualNorm <= dualTolerance) {
						converged[q] = true;
						break;
					}

					// Residual balancing changes the ADMM step size, not the fitted objective.
					// Rescale the scaled dual when rho changes; reuse the banded factor otherwise.
					if (iteration % 25 === 0 && iteration < maxIterations) {
						const balance = (primalNorm / primalTolerance) / (dualNorm / dualTolerance);
						const nextRho = balance > 10 ? min(1e4, rho * 2) : balance < 0.1 ? max(1e-4, rho / 2) : rho;
						if (nextRho !== rho) {
							for (let i = 0; i < size; i++) dual[i] *= rho / nextRho;
							rho = nextRho;
							factor(gram, penalty, lambda / rho, lower, knots);
							currentFactor = lower;
						}
					}
				}

				for (let i = 0; i < size; i++) curves[q][xs[i]] = max(-Number.MAX_VALUE, min(Number.MAX_VALUE, center + scale * fitted[i]));
			}
			return result;
		};
	};

	// The one-shot API owns a fresh workspace and result on every call.
	quantileGAM = function(data, options) {
		return createQuantileGAM()(data, options);
	};
})();
