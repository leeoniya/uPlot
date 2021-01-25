import { round, pow, sqrt, nonNullIdx } from '../utils';
import { orient, addGap, clipGaps, moveToH, moveToV, lineToH, lineToV, bezierCurveToH, bezierCurveToV, clipBandLine } from './utils';

export function spline(opts) {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let moveTo, bezierCurveTo, lineTo;

			if (scaleX.ori == 0) {
				moveTo = moveToH;
				lineTo = lineToH;
				bezierCurveTo = bezierCurveToH;
			}
			else {
				moveTo = moveToV;
				lineTo = lineToV;
				bezierCurveTo = bezierCurveToV;
			}

			const _dir = 1 * scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			idx0 = nonNullIdx(dataY, idx0, idx1,  1);
			idx1 = nonNullIdx(dataY, idx0, idx1, -1);

			let gaps = [];
			let inGap = false;
			let firstXPos = round(valToPosX(dataX[_dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
			let prevXPos = firstXPos;

			let xCoords = [];
			let yCoords = [];

			for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
				let yVal = dataY[i];
				let xVal = dataX[i];
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);

				if (yVal == null) {
					if (yVal === null) {
						addGap(gaps, prevXPos, xPos);
						inGap = true;
					}
					continue;
				}
				else {
					if (inGap) {
						addGap(gaps, prevXPos, xPos);
						inGap = false;
					}

					xCoords.push((prevXPos = xPos));
					yCoords.push(valToPosY(dataY[i], scaleY, yDim, yOff));
				}
			}

			const _paths = {stroke: catmullRomFitting(xCoords, yCoords, 0.5, moveTo, bezierCurveTo), fill: null, clip: null, band: null};
			const stroke = _paths.stroke;

			if (series.fill != null) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = series.fillTo(u, seriesIdx, series.min, series.max);
				let minY = round(valToPosY(fillTo, scaleY, yDim, yOff));

				lineTo(fill, prevXPos, minY);
				lineTo(fill, firstXPos, minY);
			}

			if (!series.spanGaps)
				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);

			if (u.bands.length > 0) {
				// ADDL OPT: only create band clips for series that are band lower edges
				// if (b.series[1] == i && _paths.band == null)
				_paths.band = clipBandLine(u, seriesIdx, idx0, idx1, stroke);
			}

			return _paths;

			//  if FEAT_PATHS: false in rollup.config.js
			//	u.ctx.save();
			//	u.ctx.beginPath();
			//	u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
			//	u.ctx.clip();
			//	u.ctx.strokeStyle = u.series[sidx].stroke;
			//	u.ctx.stroke(stroke);
			//	u.ctx.fillStyle = u.series[sidx].fill;
			//	u.ctx.fill(fill);
			//	u.ctx.restore();
			//	return null;
		});
	};
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
function catmullRomFitting(xCoords, yCoords, alpha, moveTo, bezierCurveTo) {
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

	moveTo(path, round(xCoords[0]), round(yCoords[0]));

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