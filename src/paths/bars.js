import { min, max, round, inf, ifNull, EMPTY_OBJ, incrRound, nonNullIdx } from '../utils';
import { orient, rectV, rectH } from './utils';
import { pxRatio } from '../dom';

export function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = ifNull(opts.size, [0.6, inf]);
	const align = opts.align || 0;

	const gapFactor = 1 - size[0];
	const maxWidth  = ifNull(size[1], inf) * pxRatio;

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let rect = scaleX.ori == 0 ? rectH : rectV;

			let colWid = valToPosX(dataX[1], scaleX, xDim, xOff) - valToPosX(dataX[0], scaleX, xDim, xOff);

			let gapWid = colWid * gapFactor;

			let fillToY = series.fillTo(u, seriesIdx, series.min, series.max);

			let y0Pos = valToPosY(fillToY, scaleY, yDim, yOff);

			let strokeWidth = round(series.width * pxRatio);

			let barWid = round(min(maxWidth, colWid - gapWid) - strokeWidth);

			let xShift = align == 1 ? 0 : align == -1 ? barWid : barWid / 2;

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null};

			const hasBands = u.bands.length > 0;
			let yLimit;

			if (hasBands) {
				// ADDL OPT: only create band clips for series that are band lower edges
				// if (b.series[1] == i && _paths.band == null)
				_paths.band = new Path2D();
				yLimit = incrRound(valToPosY(scaleY.max, scaleY, yDim, yOff), 0.5);
			}

			const stroke = _paths.stroke;
			const band = _paths.band;

			const _dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
				let yVal = dataY[i];

				// interpolate upwards band clips
				if (yVal == null) {
					if (hasBands) {
						// simple, but inefficient bi-directinal linear scans on each iteration
						let prevNonNull = nonNullIdx(dataY, _dir == 1 ? idx0 : idx1, i, -_dir);
						let nextNonNull = nonNullIdx(dataY, i, _dir == 1 ? idx1 : idx0,  _dir);

						let prevVal = dataY[prevNonNull];
						let nextVal = dataY[nextNonNull];

						yVal = prevVal + (i - prevNonNull) / (nextNonNull - prevNonNull) * (nextVal - prevVal);
					}
					else
						continue;
				}

				let xVal = scaleX.distr == 2 ? i : dataX[i];

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(yVal, scaleY, yDim, yOff);

				let lft = round(xPos - xShift);
				let btm = round(max(yPos, y0Pos));
				let top = round(min(yPos, y0Pos));
				let barHgt = btm - top;

				dataY[i] != null && rect(stroke, lft, top, barWid, barHgt);

				if (hasBands) {
					btm = top;
					top = yLimit;
					barHgt = btm - top;
					rect(band, lft, top, barWid, barHgt);
				}
			}

			if (series.fill != null)
				_paths.fill = new Path2D(stroke);

			return _paths;
		});
	};
}