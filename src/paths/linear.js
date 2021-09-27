import { min, max, nonNullIdx, inf } from '../utils';
import { orient, addGap, clipGaps, lineToH, lineToV, clipBandLine, BAND_CLIP_FILL } from './utils';

function _drawAcc(lineTo) {
	return (stroke, accX, minY, maxY, inY, outY) => {
		if (minY != maxY) {
			if (inY != minY && outY != minY)
				lineTo(stroke, accX, minY);
			if (inY != maxY && outY != maxY)
				lineTo(stroke, accX, maxY);

			lineTo(stroke, accX, outY);
		}
	};
}

const drawAccH = _drawAcc(lineToH);
const drawAccV = _drawAcc(lineToV);

export function linear() {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			let lineTo, drawAcc;

			if (scaleX.ori == 0) {
				lineTo = lineToH;
				drawAcc = drawAccH;
			}
			else {
				lineTo = lineToV;
				drawAcc = drawAccV;
			}

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let minY = inf,
				maxY = -inf,
				inY, outY, outX, drawnAtX;

			let gaps = [];

			let accX = pxRound(valToPosX(dataX[dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
			let accGaps = false;
			let prevYNull = false;

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * dir);
			let lftX =  pxRound(valToPosX(dataX[lftIdx], scaleX, xDim, xOff));
			let rgtX =  pxRound(valToPosX(dataX[rgtIdx], scaleX, xDim, xOff));

			if (lftX > xOff)
				addGap(gaps, xOff, lftX);

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let x = pxRound(valToPosX(dataX[i], scaleX, xDim, xOff));

				if (x == accX) {
					if (dataY[i] != null) {
						outY = pxRound(valToPosY(dataY[i], scaleY, yDim, yOff));

						if (minY == inf) {
							lineTo(stroke, x, outY);
							inY = outY;
						}

						minY = min(outY, minY);
						maxY = max(outY, maxY);
					}
					else if (dataY[i] === null)
						accGaps = prevYNull = true;
				}
				else {
					let _addGap = false;

					if (minY != inf) {
						drawAcc(stroke, accX, minY, maxY, inY, outY);
						outX = drawnAtX = accX;
					}
					else if (accGaps) {
						_addGap = true;
						accGaps = false;
					}

					if (dataY[i] != null) {
						outY = pxRound(valToPosY(dataY[i], scaleY, yDim, yOff));
						lineTo(stroke, x, outY);
						minY = maxY = inY = outY;

						// prior pixel can have data but still start a gap if ends with null
						if (prevYNull && x - accX > 1)
							_addGap = true;

						prevYNull = false;
					}
					else {
						minY = inf;
						maxY = -inf;

						if (dataY[i] === null) {
							accGaps = true;

							if (x - accX > 1)
								_addGap = true;
						}
					}

					_addGap && addGap(gaps, outX, x);

					accX = x;
				}
			}

			if (minY != inf && minY != maxY && drawnAtX != accX)
				drawAcc(stroke, accX, minY, maxY, inY, outY);

			if (rgtX < xOff + xDim)
				addGap(gaps, rgtX, xOff + xDim);

			if (series.fill != null) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = pxRound(valToPosY(series.fillTo(u, seriesIdx, series.min, series.max), scaleY, yDim, yOff));

				lineTo(fill, rgtX, fillTo);
				lineTo(fill, lftX, fillTo);
			}

			_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

			if (!series.spanGaps)
				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);

			if (u.bands.length > 0) {
				// ADDL OPT: only create band clips for series that are band lower edges
				// if (b.series[1] == i && _paths.band == null)
				_paths.band = clipBandLine(u, seriesIdx, idx0, idx1, stroke);
			}

			return _paths;
		});
	};
}