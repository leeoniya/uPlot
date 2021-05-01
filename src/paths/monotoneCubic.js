import { splineInterp } from "./spline";

export function monotoneCubic(opts) {
	return splineInterp(_monotoneCubic, opts);
}

// Monotone Cubic Spline interpolation, adapted from the Chartist.js implementation:
// https://github.com/gionkunz/chartist-js/blob/e7e78201bffe9609915e5e53cfafa29a5d6c49f9/src/scripts/interpolation.js#L240-L369
function _monotoneCubic(xs, ys, moveTo, lineTo, bezierCurveTo, pxRound) {
	const n = xs.length;

	if (n < 2)
		return null;

	const path = new Path2D();

	moveTo(path, xs[0], ys[0]);

	if (n == 2)
		lineTo(path, xs[1], ys[1]);
	else {
		let ms  = Array(n),
			ds  = Array(n - 1),
			dys = Array(n - 1),
			dxs = Array(n - 1);

		// calc deltas and derivative
		for (let i = 0; i < n - 1; i++) {
			dys[i] = ys[i + 1] - ys[i];
			dxs[i] = xs[i + 1] - xs[i];
			ds[i]  = dys[i] / dxs[i];
		}

		// determine desired slope (m) at each point using Fritsch-Carlson method
		// http://math.stackexchange.com/questions/45218/implementation-of-monotone-cubic-interpolation
		ms[0] = ds[0];

		for (let i = 1; i < n - 1; i++) {
			if (ds[i] === 0 || ds[i - 1] === 0 || (ds[i - 1] > 0) !== (ds[i] > 0))
				ms[i] = 0;
			else {
				ms[i] = 3 * (dxs[i - 1] + dxs[i]) / (
					(2 * dxs[i] + dxs[i - 1]) / ds[i - 1] +
					(dxs[i] + 2 * dxs[i - 1]) / ds[i]
				);

				if (!isFinite(ms[i]))
					ms[i] = 0;
			}
		}

		ms[n - 1] = ds[n - 2];

		for (let i = 0; i < n - 1; i++) {
			bezierCurveTo(
				path,
				xs[i] + dxs[i] / 3,
				ys[i] + ms[i] * dxs[i] / 3,
				xs[i + 1] - dxs[i] / 3,
				ys[i + 1] - ms[i + 1] * dxs[i] / 3,
				xs[i + 1],
				ys[i + 1],
			);
		}
	}

	return path;
}