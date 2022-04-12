import { min, max, nonNullIdx, inf } from '../utils';
import { orient, addGap, clipGaps, lineToH, lineToV, clipBandLine, BAND_CLIP_FILL, bandFillClipDirs } from './utils';

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

function findGaps(xs, ys, idx0, idx1, dir, pixelForX) {
	let gaps = [];

	for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
		let yVal = ys[i];

		if (yVal === null) {
			let fr = i, to = i;

			if (dir == 1) {
				while (++i <= idx1 && ys[i] === null)
					to = i;
			}
			else {
				while (--i >= idx0 && ys[i] === null)
					to = i;
			}

			let frPx = pixelForX(xs[fr]);
			let toPx = to == fr ? frPx : pixelForX(xs[to]);

			// if value adjacent to edge null is same pixel, then it's partially
			// filled and gap should start at next pixel
			let frPx2 = pixelForX(xs[fr-dir]);
		//	if (frPx2 == frPx)
		//		frPx++;
		//	else
				frPx = frPx2;

			let toPx2 = pixelForX(xs[to+dir]);
		//	if (toPx2 == toPx)
		//		toPx--;
		//	else
				toPx = toPx2;

			if (toPx >= frPx)
				gaps.push([frPx, toPx]); // addGap
		}
	}

	return gaps;
}

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

			let accX = pxRound(valToPosX(dataX[dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * dir);
			let lftX =  pxRound(valToPosX(dataX[lftIdx], scaleX, xDim, xOff));
			let rgtX =  pxRound(valToPosX(dataX[rgtIdx], scaleX, xDim, xOff));

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
				}
				else {
					if (minY != inf) {
						drawAcc(stroke, accX, minY, maxY, inY, outY);
						outX = drawnAtX = accX;
					}

					if (dataY[i] != null) {
						outY = pxRound(valToPosY(dataY[i], scaleY, yDim, yOff));
						lineTo(stroke, x, outY);
						minY = maxY = inY = outY;
					}
					else {
						minY = inf;
						maxY = -inf;
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
				let fillToY = pxRound(valToPosY(fillToVal, scaleY, yDim, yOff));

				lineTo(fill, rgtX, fillToY);
				lineTo(fill, lftX, fillToY);
			}


			if (!series.spanGaps) {
				//	console.time('gaps');
				let gaps = [];

				if (lftX > xOff)
					gaps.push([xOff, lftX]);

					gaps.push(...findGaps(dataX, dataY, idx0, idx1, dir, v => pxRound(valToPosX(v, scaleX, xDim, xOff))));

				if (rgtX < xOff + xDim)
					gaps.push([rgtX, xOff + xDim]);
			//	console.timeEnd('gaps');
			//	console.log('gaps', JSON.stringify(gaps2));

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