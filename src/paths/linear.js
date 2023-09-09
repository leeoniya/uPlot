import { min, max, nonNullIdx, inf, ifNull } from '../utils';
import { orient, clipGaps, lineToH, lineToV, clipBandLine, BAND_CLIP_FILL, bandFillClipDirs, findGaps } from './utils';

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

export function linear(opts) {
	const alignGaps = ifNull(opts?.alignGaps, 0);

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));

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

			let accX = pixelForX(dataX[dir == 1 ? idx0 : idx1]);

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * dir);
			let lftX   =  pixelForX(dataX[lftIdx]);
			let rgtX   =  pixelForX(dataX[rgtIdx]);

			let hasGap = false;

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let x = pixelForX(dataX[i]);
				let yVal = dataY[i];

				if (x == accX) {
					if (yVal != null) {
						outY = pixelForY(yVal);

						if (minY == inf) {
							lineTo(stroke, x, outY);
							inY = outY;
						}

						minY = min(outY, minY);
						maxY = max(outY, maxY);
					}
					else {
						if (yVal === null)
							hasGap = true;
					}
				}
				else {
					if (minY != inf) {
						drawAcc(stroke, accX, minY, maxY, inY, outY);
						outX = drawnAtX = accX;
					}

					if (yVal != null) {
						outY = pixelForY(yVal);
						lineTo(stroke, x, outY);
						minY = maxY = inY = outY;
					}
					else {
						minY = inf;
						maxY = -inf;

						if (yVal === null)
							hasGap = true;
					}

					accX = x;
				}
			}

			if (minY != inf && minY != maxY && drawnAtX != accX)
				drawAcc(stroke, accX, minY, maxY, inY, outY);

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillToVal = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillToVal);

				lineTo(fill, rgtX, fillToY);
				lineTo(fill, lftX, fillToY);
			}

			if (!series.spanGaps) {
			//	console.time('gaps');
				let gaps = [];

				hasGap && gaps.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));

			//	console.timeEnd('gaps');

			//	console.log('gaps', JSON.stringify(gaps));

				_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
			}

			if (bandClipDir != 0) {
				_paths.band = bandClipDir == 2 ? [
					clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
					clipBandLine(u, seriesIdx, idx0, idx1, stroke,  1),
				] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
			}

			return _paths;
		});
	};
}