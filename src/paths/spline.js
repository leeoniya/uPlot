import { ifNull, nonNullIdx } from '../utils';
import { orient, clipGaps, moveToH, moveToV, lineToH, lineToV, bezierCurveToH, bezierCurveToV, clipBandLine, BAND_CLIP_FILL, bandFillClipDirs, findGaps } from './utils';

export function splineInterp(interp, opts) {
	const alignGaps = ifNull(opts?.alignGaps, 0);

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));

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

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			idx0 = nonNullIdx(dataY, idx0, idx1,  1);
			idx1 = nonNullIdx(dataY, idx0, idx1, -1);

			let firstXPos = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
			let prevXPos = firstXPos;

			let xCoords = [];
			let yCoords = [];

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let yVal = dataY[i];

				if (yVal != null) {
					let xVal = dataX[i];
					let xPos = pixelForX(xVal);

					xCoords.push(prevXPos = xPos);
					yCoords.push(pixelForY(dataY[i]));
				}
			}

			const _paths = {stroke: interp(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillTo);

				lineTo(fill, prevXPos, fillToY);
				lineTo(fill, firstXPos, fillToY);
			}

			if (!series.spanGaps) {
			//	console.time('gaps');
				let gaps = [];

				gaps.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));

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
