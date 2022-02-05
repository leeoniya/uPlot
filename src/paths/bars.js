import { abs, floor, min, max, inf, ifNull, EMPTY_OBJ } from '../utils';
import { orient, rectV, rectH, BAND_CLIP_FILL, BAND_CLIP_STROKE, bandFillClipDirs } from './utils';
import { pxRatio } from '../dom';

export function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = ifNull(opts.size, [0.6, inf, 1]);
	const align = opts.align || 0;
	const extraGap = (opts.gap || 0) * pxRatio;

	const radius = ifNull(opts.radius, 0);

	const gapFactor = 1 - size[0];
	const maxWidth  = ifNull(size[1], inf) * pxRatio;
	const minWidth  = ifNull(size[2], 1) * pxRatio;

	const disp = ifNull(opts.disp, EMPTY_OBJ);
	const _each = ifNull(opts.each, _ => {});

	const { fill: dispFills, stroke: dispStrokes } = disp;

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			const _dirX = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
			const _dirY = scaleY.dir * (scaleY.ori == 1 ? 1 : -1);

			let rect = scaleX.ori == 0 ? rectH : rectV;

			let each = scaleX.ori == 0 ? _each : (u, seriesIdx, i, top, lft, hgt, wid) => {
				_each(u, seriesIdx, i, lft, top, wid, hgt);
			};

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

		//	let fillToY = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
			let fillToY = scaleY.distr == 3 ? (bandFillDir == 1 ? scaleY.max : scaleY.min) : 0;

			let y0Pos = valToPosY(fillToY, scaleY, yDim, yOff);

			// barWid is to center of stroke
			let xShift, barWid;

			let strokeWidth = pxRound(series.width * pxRatio);

			let multiPath = false;

			let fillColors = null;
			let fillPaths = null;
			let strokeColors = null;
			let strokePaths = null;

			if (dispFills != null && (strokeWidth == 0 || dispStrokes != null)) {
				multiPath = true;

				fillColors = dispFills.values(u, seriesIdx, idx0, idx1);
				fillPaths = new Map();
				(new Set(fillColors)).forEach(color => {
					if (color != null)
						fillPaths.set(color, new Path2D());
				});

				if (strokeWidth > 0) {
					strokeColors = dispStrokes.values(u, seriesIdx, idx0, idx1);
					strokePaths = new Map();
					(new Set(strokeColors)).forEach(color => {
						if (color != null)
							strokePaths.set(color, new Path2D());
					});
				}
			}

			let { x0, size } = disp;

			if (x0 != null && size != null) {
				dataX = x0.values(u, seriesIdx, idx0, idx1);

				if (x0.unit == 2)
					dataX = dataX.map(pct => u.posToVal(xOff + pct * xDim, scaleX.key, true));

				// assumes uniform sizes, for now
				let sizes = size.values(u, seriesIdx, idx0, idx1);

				if (size.unit == 2)
					barWid = sizes[0] * xDim;
				else
					barWid = valToPosX(sizes[0], scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff); // assumes linear scale (delta from 0)

				barWid = pxRound(barWid - strokeWidth);

				xShift = (_dirX == 1 ? -strokeWidth / 2 : barWid + strokeWidth / 2);
			}
			else {
				let colWid = xDim;

				if (dataX.length > 1) {
					// prior index with non-undefined y data
					let prevIdx = null;

					// scan full dataset for smallest adjacent delta
					// will not work properly for non-linear x scales, since does not do expensive valToPosX calcs till end
					for (let i = 0, minDelta = Infinity; i < dataX.length; i++) {
						if (dataY[i] !== undefined) {
							if (prevIdx != null) {
								let delta = abs(dataX[i] - dataX[prevIdx]);

								if (delta < minDelta) {
									minDelta = delta;
									colWid = abs(valToPosX(dataX[i], scaleX, xDim, xOff) - valToPosX(dataX[prevIdx], scaleX, xDim, xOff));
								}
							}

							prevIdx = i;
						}
					}
				}

				let gapWid = colWid * gapFactor;

				barWid = pxRound(min(maxWidth, max(minWidth, colWid - gapWid)) - strokeWidth - extraGap);

				xShift = (align == 0 ? barWid / 2 : align == _dirX ? 0 : barWid) - align * _dirX * extraGap / 2;
			}

			const _paths = {stroke: null, fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL | BAND_CLIP_STROKE};  // disp, geom

			let yLimit;

			if (bandClipDir != 0) {
				_paths.band = new Path2D();
				yLimit = pxRound(valToPosY(bandClipDir == 1 ? scaleY.max : scaleY.min, scaleY, yDim, yOff));
			}

			const stroke = multiPath ? null : new Path2D();
			const band = _paths.band;

			let { y0, y1 } = disp;

			let dataY0 = null;

			if (y0 != null && y1 != null) {
				dataY = y1.values(u, seriesIdx, idx0, idx1);
				dataY0 = y0.values(u, seriesIdx, idx0, idx1);
			}

			for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
				let yVal = dataY[i];

			/*
				// interpolate upwards band clips
				if (yVal == null) {
				//	if (hasBands)
				//		yVal = costlyLerp(i, idx0, idx1, _dirX, dataY);
				//	else
						continue;
				}
			*/

				let xVal = scaleX.distr != 2 || disp != null ? dataX[i] : i;

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(ifNull(yVal, fillToY), scaleY, yDim, yOff);

				if (dataY0 != null && yVal != null)
					y0Pos = valToPosY(dataY0[i], scaleY, yDim, yOff);

				let lft = pxRound(xPos - xShift);
				let btm = pxRound(max(yPos, y0Pos));
				let top = pxRound(min(yPos, y0Pos));
				// this includes the stroke
				let barHgt = btm - top;

				let r = radius * barWid;

				if (yVal != null) {  // && yVal != fillToY (0 height bar)
					if (multiPath) {
						if (strokeWidth > 0 && strokeColors[i] != null)
							rect(strokePaths.get(strokeColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), r);

						if (fillColors[i] != null)
							rect(fillPaths.get(fillColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), r);
					}
					else
						rect(stroke, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), r);

					each(u, seriesIdx, i,
						lft    - strokeWidth / 2,
						top,
						barWid + strokeWidth,
						barHgt,
					);
				}

				if (bandClipDir != 0) {
					if (_dirY * bandClipDir == 1) {
						btm = top;
						top = yLimit;
					}
					else {
						top = btm;
						btm = yLimit;
					}

					barHgt = btm - top;

					rect(band, lft - strokeWidth / 2, top, barWid + strokeWidth, max(0, barHgt), 0);
				}
			}

			if (strokeWidth > 0)
				_paths.stroke = multiPath ? strokePaths : stroke;

			_paths.fill = multiPath ? fillPaths : stroke;

			return _paths;
		});
	};
}