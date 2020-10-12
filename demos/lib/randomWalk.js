// https://stackoverflow.com/a/22080644

const boxMullerRandom = (() => {
    let phase = 0, x1, x2, w, z;

    return () => {
        if (!phase) {
            do {
                x1 = 2.0 * Math.random() - 1.0;
                x2 = 2.0 * Math.random() - 1.0;
                w = x1 * x1 + x2 * x2;
            } while (w >= 1.0);

            w = Math.sqrt((-2.0 * Math.log(w)) / w);
            z = x1 * w;
        }
        else
            z = x2 * w;

        phase ^= 1;

        return z;
    }
})();

function randomWalk(value, steps, min, max) {
    min = min == null ? -Infinity : min;
    max = max == null ? Infinity : max;

    var points = Array(steps), r;

    for (let i = 0; i < steps; i++) {
		do {
			r = boxMullerRandom();
		} while (value + r < min || value + r > max);

        value += r;
        points[i] = value;
    }

    return points;
}