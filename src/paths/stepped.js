import { round, nonNullIdx, ifNull } from '../utils';
import { orient, addGap, clipGaps, lineToH, lineToV, clipBandLine } from './utils';
import { pxRatio } from '../dom';

export function stepped(opts) {
	const align = ifNull(opts.align, 1);

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let lineTo = scaleX.ori == 0 ? lineToH : lineToV;

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null};
			const stroke = _paths.stroke;

			const _dir = 1 * scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			idx0 = nonNullIdx(dataY, idx0, idx1,  1);
			idx1 = nonNullIdx(dataY, idx0, idx1, -1);

			let gaps = [];
			let inGap = false;
			let prevYPos  = round(valToPosY(dataY[_dir == 1 ? idx0 : idx1], scaleY, yDim, yOff));
			let firstXPos = round(valToPosX(dataX[_dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
			let prevXPos = firstXPos;

			lineTo(stroke, firstXPos, prevYPos);

			for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
				let yVal1 = dataY[i];

				let x1 = round(valToPosX(dataX[i], scaleX, xDim, xOff));

				if (yVal1 == null) {
					if (yVal1 === null) {
						addGap(gaps, prevXPos, x1);
						inGap = true;
					}
					continue;
				}

				let y1 = round(valToPosY(yVal1, scaleY, yDim, yOff));

				if (inGap) {
					addGap(gaps, prevXPos, x1);

					// don't clip vertical extenders
					if (prevYPos != y1) {
						let halfStroke = (series.width * pxRatio) / 2;

						let lastGap = gaps[gaps.length - 1];
						lastGap[0] += halfStroke;
						lastGap[1] -= halfStroke;
					}

					inGap = false;
				}

				if (align == 1)
					lineTo(stroke, x1, prevYPos);
				else
					lineTo(stroke, prevXPos, y1);

				lineTo(stroke, x1, y1);

				prevYPos = y1;
				prevXPos = x1;
			}

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
		});
	};
}