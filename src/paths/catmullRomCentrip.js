import { pow, sqrt } from '../utils';
import { splineInterp } from "./spline";

export function catmullRomCentrip(opts) {
	return splineInterp(catmullRomFitting, opts);
}

// adapted from https://gist.github.com/nicholaswmin/c2661eb11cad5671d816 (MIT)
/**
 * Interpolates a Catmull-Rom Spline through a series of x/y points
 * Converts the CR Spline to Cubic Beziers for use with SVG items
 *
 * If 'alpha' is 0.5 then the 'Centripetal' variant is used
 * If 'alpha' is 1 then the 'Chordal' variant is used
 *
 */
function catmullRomFitting(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound) {
	const alpha = 0.5;

	const path = new Path2D();

	const dataLen = xCoords.length;

	let p0x,
		p0y,
		p1x,
		p1y,
		p2x,
		p2y,
		p3x,
		p3y,
		bp1x,
		bp1y,
		bp2x,
		bp2y,
		d1,
		d2,
		d3,
		A,
		B,
		N,
		M,
		d3powA,
		d2powA,
		d3pow2A,
		d2pow2A,
		d1pow2A,
		d1powA;

	moveTo(path, pxRound(xCoords[0]), pxRound(yCoords[0]));

	for (let i = 0; i < dataLen - 1; i++) {
		let p0i = i == 0 ? 0 : i - 1;

		p0x = xCoords[p0i];
		p0y = yCoords[p0i];

		p1x = xCoords[i];
		p1y = yCoords[i];

		p2x = xCoords[i + 1];
		p2y = yCoords[i + 1];

		if (i + 2 < dataLen) {
			p3x = xCoords[i + 2];
			p3y = yCoords[i + 2];
		} else {
			p3x = p2x;
			p3y = p2y;
		}

		d1 = sqrt(pow(p0x - p1x, 2) + pow(p0y - p1y, 2));
		d2 = sqrt(pow(p1x - p2x, 2) + pow(p1y - p2y, 2));
		d3 = sqrt(pow(p2x - p3x, 2) + pow(p2y - p3y, 2));

		// Catmull-Rom to Cubic Bezier conversion matrix

		// A = 2d1^2a + 3d1^a * d2^a + d3^2a
		// B = 2d3^2a + 3d3^a * d2^a + d2^2a

		// [   0			 1			0		  0		  ]
		// [   -d2^2a /N	 A/N		  d1^2a /N   0		  ]
		// [   0			 d3^2a /M	 B/M		-d2^2a /M  ]
		// [   0			 0			1		  0		  ]

		d3powA  = pow(d3, alpha);
		d3pow2A = pow(d3, alpha * 2);
		d2powA  = pow(d2, alpha);
		d2pow2A = pow(d2, alpha * 2);
		d1powA  = pow(d1, alpha);
		d1pow2A = pow(d1, alpha * 2);

		A = 2 * d1pow2A + 3 * d1powA * d2powA + d2pow2A;
		B = 2 * d3pow2A + 3 * d3powA * d2powA + d2pow2A;
		N = 3 * d1powA * (d1powA + d2powA);

		if (N > 0)
			N = 1 / N;

		M = 3 * d3powA * (d3powA + d2powA);

		if (M > 0)
			M = 1 / M;

		bp1x = (-d2pow2A * p0x + A * p1x + d1pow2A * p2x) * N;
		bp1y = (-d2pow2A * p0y + A * p1y + d1pow2A * p2y) * N;

		bp2x = (d3pow2A * p1x + B * p2x - d2pow2A * p3x) * M;
		bp2y = (d3pow2A * p1y + B * p2y - d2pow2A * p3y) * M;

		if (bp1x == 0 && bp1y == 0) {
			bp1x = p1x;
			bp1y = p1y;
		}

		if (bp2x == 0 && bp2y == 0) {
			bp2x = p2x;
			bp2y = p2y;
		}

		bezierCurveTo(path, bp1x, bp1y, bp2x, bp2y, p2x, p2y);
	}

	return path;
}