// Callers supply a distribution from the sampler table below, a nonnegative safe integer count,
// and an unsigned 32-bit seed. The default seed keeps benchmark inputs repeatable.
export function generatePoints(distribution, count = 250_000, seed = 73) {
	let state = seed;
	const random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32);
	const tau = 2 * Math.PI;
	const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(tau * random());
	const samplers = {
		cloud(xs, ys) {
			for (let i = 0; i < count; i++) {
				const x = 0.55 * normal();
				xs[i] = x;
				ys[i] = 0.8 * x + 0.25 * normal();
			}
		},
		annulus(xs, ys) {
			for (let i = 0; i < count; i++) {
				// Sample squared radius uniformly for uniform density per unit area.
				const r = Math.sqrt(0.8 ** 2 + random() * (1.5 ** 2 - 0.8 ** 2)), t = tau * random();
				xs[i] = r * Math.cos(t);
				ys[i] = r * Math.sin(t);
			}
		},
		clusters(xs, ys) {
			const cx = [-1, 0, 1], cy = [-0.6, 1, -0.4];
			for (let i = 0; i < count; i++) {
				const c = Math.floor(3 * random());
				xs[i] = cx[c] + 0.2 * normal();
				ys[i] = cy[c] + 0.2 * normal();
			}
		},
		moons(xs, ys) {
			for (let i = 0; i < count; i++) {
				const t = Math.PI * random(), s = random() < 0.5 ? 1 : -1;
				xs[i] = s * (Math.cos(t) - 0.5) + 0.07 * normal();
				ys[i] = s * (Math.sin(t) - 0.25) + 0.07 * normal();
			}
		},
		spiral(xs, ys) {
			for (let i = 0; i < count; i++) {
				const v = random(), r = 0.12 + 1.45 * v, t = 2 * tau * v;
				xs[i] = r * Math.cos(t) + 0.05 * normal();
				ys[i] = r * Math.sin(t) + 0.05 * normal();
			}
		},
		checkerboard(xs, ys) {
			for (let i = 0; i < count; i++) {
				const col = Math.floor(4 * random()), row = 2 * Math.floor(2 * random()) + col % 2;
				xs[i] = 0.8 * (col + random() - 2);
				ys[i] = 0.8 * (row + random() - 2);
			}
		},
	};

	const xs = new Float64Array(count), ys = new Float64Array(count);
	samplers[distribution](xs, ys);
	return [xs, ys];
}
