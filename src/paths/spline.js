import { nonNullIdx } from '../utils';
import { orient, addGap, clipGaps, moveToH, moveToV, lineToH, lineToV, bezierCurveToH, bezierCurveToV, clipBandLine, BAND_CLIP_FILL, bandFillClipDirs } from './utils';

export function splineInterp(interp, opts) {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

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
			let firstXPos = pxRound(valToPosX(dataX[_dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
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

			const _paths = {stroke: interp(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff));

				lineTo(fill, prevXPos, fillToY);
				lineTo(fill, firstXPos, fillToY);
			}

			_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

			if (!series.spanGaps)
				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);

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
