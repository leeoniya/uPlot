import { abs, min, max, inf, ifNull, EMPTY_OBJ, incrRound, nonNullIdx } from '../utils';
import { orient, rectV, rectH, BAND_CLIP_FILL, BAND_CLIP_STROKE } from './utils';
import { pxRatio } from '../dom';

export function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = ifNull(opts.size, [0.6, inf, 1]);
	const align = opts.align || 0;
	const extraGap = (opts.gap || 0) * pxRatio;

	const gapFactor = 1 - size[0];
	const maxWidth  = ifNull(size[1], inf) * pxRatio;
	const minWidth  = ifNull(size[2], 1) * pxRatio;

	// custom layout cache getter
	const layout = opts.layout;

	const each = ifNull(opts.each, _ => {});

	return (u, seriesIdx, idx0, idx1) => {
		let xLayout;

		if (layout != null) {
			// these come back in % of plottable area (0..1), so assume idx0 & idx1
			// are full range of data, and don't handle scale dir or ori
			xLayout = layout(seriesIdx);
		}

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			const _dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			let rect = scaleX.ori == 0 ? rectH : rectV;

			let fillToY = series.fillTo(u, seriesIdx, series.min, series.max);

			let y0Pos = valToPosY(fillToY, scaleY, yDim, yOff);

			let xShift, barWid;

			let strokeWidth = pxRound(series.width * pxRatio);

			if (xLayout != null) {
				dataX = xLayout.offs.map(v => v * (dataX.length - 1));
				barWid = pxRound(xLayout.size[0] * xDim - strokeWidth);
				xShift = (_dir == 1 ? -strokeWidth / 2 : barWid + strokeWidth / 2);
			}
			else {
				let colWid = xDim;

				if (dataX.length > 1) {
					// scan full dataset for smallest adjacent delta
					// will not work properly for non-linear x scales, since does not do expensive valToPosX calcs till end
					for (let i = 1, minDelta = Infinity; i < dataX.length; i++) {
						let delta = abs(dataX[i] - dataX[i-1]);

						if (delta < minDelta) {
							minDelta = delta;
							colWid = abs(valToPosX(dataX[i], scaleX, xDim, xOff) - valToPosX(dataX[i-1], scaleX, xDim, xOff));
						}
					}
				}

				let gapWid = colWid * gapFactor;

				barWid = pxRound(min(maxWidth, max(minWidth, colWid - gapWid)) - strokeWidth - extraGap);

				xShift = (align == 0 ? barWid / 2 : align == _dir ? 0 : barWid) - align * _dir * extraGap / 2;
			}

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL | BAND_CLIP_STROKE};  // disp, geom

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

				let xVal = scaleX.distr != 2 || xLayout != null ? dataX[i] : i;

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(yVal, scaleY, yDim, yOff);

				let lft = pxRound(xPos - xShift);
				let btm = pxRound(max(yPos, y0Pos));
				let top = pxRound(min(yPos, y0Pos));
				let barHgt = btm - top;

				if (dataY[i] != null) {
					rect(stroke, lft, top, barWid, barHgt);

					if (scaleX.ori == 0) {
						each(seriesIdx, i,
							lft - xOff - strokeWidth / 2,
							top - yOff - strokeWidth / 2,
							barWid     + strokeWidth,
							barHgt     + strokeWidth,
						);
					}
					else {
						each(seriesIdx, i,
							top - yOff  - strokeWidth / 2,
							lft - xOff  - strokeWidth / 2,
							barHgt      + strokeWidth,
							barWid      + strokeWidth,
						);
					}
				}

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