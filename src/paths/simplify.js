/*
 (c) 2017, Vladimir Agafonkin
 Simplify.js, a high-performance JS polyline simplification library
 mourner.github.io/simplify-js
*/

// square distance between 2 points
function getSqDist(x1, y1, x2, y2) {
	let dx = x1 - x2,
		dy = y1 - y2;

	return dx * dx + dy * dy;
}

// square distance from a point to a segment
function getSqSegDist(x0, y0, x1, y1, x2, y2) {
	let x = x1,
		y = y1,
		dx = x2 - x1,
		dy = y2 - y1;

	if (dx !== 0 || dy !== 0) {
		let t = ((x0 - x) * dx + (y0 - y) * dy) / (dx * dx + dy * dy);

		if (t > 1) {
			x = x2;
			y = y2;

		} else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}

	dx = x0 - x;
	dy = y0 - y;

	return dx * dx + dy * dy;
}
// rest of the code doesn't care about point format

// basic distance-based simplification
function simplifyRadialDist(xs, ys, sqTolerance) {
	let prevPoint = 0,
		newPoints = [prevPoint],
		point = 0;

	for (let i = 1; i < xs.length; i++) {
		point = i;

		let x1 = xs[point],
			y1 = ys[point],
			x2 = xs[prevPoint],
			y2 = ys[prevPoint];

		if (getSqDist(x1, y1, x2, y2) > sqTolerance) {
			newPoints.push(point);
			prevPoint = point;
		}
	}

	if (prevPoint !== point)
		newPoints.push(point);

	return newPoints;
}

function simplifyDPStep(xs, ys, idxs, first, last, sqTolerance, simplified) {
	let maxSqDist = sqTolerance,
		index;

	let x1 = xs[idxs[first]],
		y1 = ys[idxs[first]],
		x2 = xs[idxs[last]],
		y2 = ys[idxs[last]];

	for (let i = first + 1; i < last; i++) {
		let x0 = xs[idxs[i]],
			y0 = ys[idxs[i]];

		let sqDist = getSqSegDist(x0, y0, x1, y1, x2, y2);

		if (sqDist > maxSqDist) {
			index = i;
			maxSqDist = sqDist;
		}
	}

	if (maxSqDist > sqTolerance) {
		if (index - first > 1)
			simplifyDPStep(xs, ys, idxs, first, index, sqTolerance, simplified);

		simplified.push(idxs[index]);

		if (last - index > 1)
			simplifyDPStep(xs, ys, idxs, index, last, sqTolerance, simplified);
	}
}

// simplification using Ramer-Douglas-Peucker algorithm
function simplifyDouglasPeucker(xs, ys, idxs, sqTolerance) {
	let last = idxs.length - 1;

	let simplified = [];

	simplified.push(idxs[0]);
	simplifyDPStep(xs, ys, idxs, 0, last, sqTolerance, simplified);
	simplified.push(idxs[last]);

	return simplified;
}

// both algorithms combined for awesome performance
export function simplify(xs, ys, tolerance = 1, highestQuality = false) {
	if (xs.length <= 2)
		return [...xs.keys()];

	let sqTolerance = tolerance * tolerance;

	let points = simplifyDouglasPeucker(
		xs,
		ys,
		highestQuality ? [...xs.keys()] : simplifyRadialDist(xs, ys, sqTolerance),
		sqTolerance,
	);

	return points;
}

/*
import assert from 'node:assert/strict';
import test from 'node:test';

let points = [
    {x:224.55,y:250.15},{x:226.91,y:244.19},{x:233.31,y:241.45},{x:234.98,y:236.06},
    {x:244.21,y:232.76},{x:262.59,y:215.31},{x:267.76,y:213.81},{x:273.57,y:201.84},
    {x:273.12,y:192.16},{x:277.62,y:189.03},{x:280.36,y:181.41},{x:286.51,y:177.74},
    {x:292.41,y:159.37},{x:296.91,y:155.64},{x:314.95,y:151.37},{x:319.75,y:145.16},
    {x:330.33,y:137.57},{x:341.48,y:139.96},{x:369.98,y:137.89},{x:387.39,y:142.51},
    {x:391.28,y:139.39},{x:409.52,y:141.14},{x:414.82,y:139.75},{x:427.72,y:127.30},
    {x:439.60,y:119.74},{x:474.93,y:107.87},{x:486.51,y:106.75},{x:489.20,y:109.45},
    {x:493.79,y:108.63},{x:504.74,y:119.66},{x:512.96,y:122.35},{x:518.63,y:120.89},
    {x:524.09,y:126.88},{x:529.57,y:127.86},{x:534.21,y:140.93},{x:539.27,y:147.24},
    {x:567.69,y:148.91},{x:575.25,y:157.26},{x:580.62,y:158.15},{x:601.53,y:156.85},
    {x:617.74,y:159.86},{x:622.00,y:167.04},{x:629.55,y:194.60},{x:638.90,y:195.61},
    {x:641.26,y:200.81},{x:651.77,y:204.56},{x:671.55,y:222.55},{x:683.68,y:217.45},
    {x:695.25,y:219.15},{x:700.64,y:217.98},{x:703.12,y:214.36},{x:712.26,y:215.87},
    {x:721.49,y:212.81},{x:727.81,y:213.36},{x:729.98,y:208.73},{x:735.32,y:208.20},
    {x:739.94,y:204.77},{x:769.98,y:208.42},{x:779.60,y:216.87},{x:784.20,y:218.16},
    {x:800.24,y:214.62},{x:810.53,y:219.73},{x:817.19,y:226.82},{x:820.77,y:236.17},
    {x:827.23,y:236.16},{x:829.89,y:239.89},{x:851.00,y:248.94},{x:859.88,y:255.49},
    {x:865.21,y:268.53},{x:857.95,y:280.30},{x:865.48,y:291.45},{x:866.81,y:298.66},
    {x:864.68,y:302.71},{x:867.79,y:306.17},{x:859.87,y:311.37},{x:860.08,y:314.35},
    {x:858.29,y:314.94},{x:858.10,y:327.60},{x:854.54,y:335.40},{x:860.92,y:343.00},
    {x:856.43,y:350.15},{x:851.42,y:352.96},{x:849.84,y:359.59},{x:854.56,y:365.53},
    {x:849.74,y:370.38},{x:844.09,y:371.89},{x:844.75,y:380.44},{x:841.52,y:383.67},
    {x:839.57,y:390.40},{x:845.59,y:399.05},{x:848.40,y:407.55},{x:843.71,y:411.30},
    {x:844.09,y:419.88},{x:839.51,y:432.76},{x:841.33,y:441.04},{x:847.62,y:449.22},
    {x:847.16,y:458.44},{x:851.38,y:462.79},{x:853.97,y:471.15},{x:866.36,y:480.77}
];

let simplified = [
    {x:224.55,y:250.15},{x:267.76,y:213.81},{x:296.91,y:155.64},{x:330.33,y:137.57},
    {x:409.52,y:141.14},{x:439.60,y:119.74},{x:486.51,y:106.75},{x:529.57,y:127.86},
    {x:539.27,y:147.24},{x:617.74,y:159.86},{x:629.55,y:194.60},{x:671.55,y:222.55},
    {x:727.81,y:213.36},{x:739.94,y:204.77},{x:769.98,y:208.42},{x:779.60,y:216.87},
    {x:800.24,y:214.62},{x:820.77,y:236.17},{x:859.88,y:255.49},{x:865.21,y:268.53},
    {x:857.95,y:280.30},{x:867.79,y:306.17},{x:859.87,y:311.37},{x:854.54,y:335.40},
    {x:860.92,y:343.00},{x:849.84,y:359.59},{x:854.56,y:365.53},{x:844.09,y:371.89},
    {x:839.57,y:390.40},{x:848.40,y:407.55},{x:839.51,y:432.76},{x:853.97,y:471.15},
    {x:866.36,y:480.77}
];

let xs = points.map(p => p.x);
let ys = points.map(p => p.y);

test('works', () => {
  assert.deepStrictEqual(simplify(xs, ys, 5).map(idx => ({x: xs[idx], y: ys[idx]})), simplified);
});
*/