import { aliasProps } from './aliasProps';
import { min, max, round, inf, ifNull, EMPTY_OBJ } from '../utils';
import { rectV, rectH } from './utils';
import { pxRatio } from '../dom';

export function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = ifNull(opts.size, [0.6, inf]);

	const gapFactor = 1 - size[0];
	const maxWidth  = ifNull(size[1], inf) * pxRatio;

	return (u, seriesIdx, idx0, idx1) => {
		return aliasProps(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let rect = scaleX.ori == 0 ? rectH : rectV;

			let colWid = valToPosX(dataX[1], scaleX, xDim, xOff) - valToPosX(dataX[0], scaleX, xDim, xOff);

			let gapWid = colWid * gapFactor;

			let fillToY = series.fillTo(u, seriesIdx, series.min, series.max);

			let y0Pos = valToPosY(fillToY, scaleY, yDim, yOff);

			let strokeWidth = round(series.width * pxRatio);

			let barWid = round(min(maxWidth, colWid - gapWid) - strokeWidth);

			let stroke = new Path2D();

			const _dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
				let yVal = dataY[i];

				if (yVal == null)
					continue;

				let xVal = scaleX.distr == 2 ? i : dataX[i];

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(yVal, scaleY, yDim, yOff);

				let lft = round(xPos - barWid / 2);
				let btm = round(max(yPos, y0Pos));
				let top = round(min(yPos, y0Pos));
				let barHgt = btm - top;

				rect(stroke, lft, top, barWid, barHgt);
			}

			let fill = series.fill != null ? new Path2D(stroke) : undefined;

			return {
				stroke,
				fill,
			};
		});
	};
}