import { abs, floor, min, max, inf, ifNull, EMPTY_OBJ, fnOrSelf, clamp, retArg0, EMPTY_ARR } from '../utils';
import { orient, rectV, rectH } from './utils';
import { pxRatio } from '../dom';

function findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid = inf) {
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

	return colWid;
}

export function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = ifNull(opts.size, [0.6, inf, 1]);
	const align = opts.align || 0;
	const _extraGap = (opts.gap || 0);

	let ro = opts.radius;

	ro =
		// [valueRadius, baselineRadius]
		ro == null ? [0, 0] :
		typeof ro == 'number' ? [ro, 0] : ro;

	const radiusFn = fnOrSelf(ro);

	const gapFactor = 1 - size[0];
	const _maxWidth  = ifNull(size[1], inf);
	const _minWidth  = ifNull(size[2], 1);

	const disp = ifNull(opts.disp, EMPTY_OBJ);
	const _each = ifNull(opts.each, _ => {});

	const { fill: dispFills, stroke: dispStrokes } = disp;

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;
			let _align = align;

			let extraGap = _extraGap * pxRatio;
			let maxWidth = _maxWidth * pxRatio;
			let minWidth = _minWidth * pxRatio;

			let valRadius, baseRadius;

			if (scaleX.ori == 0)
				[valRadius, baseRadius] = radiusFn(u, seriesIdx);
			else
				[baseRadius, valRadius] = radiusFn(u, seriesIdx);

			const _dirX = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
		//	const _dirY = scaleY.dir * (scaleY.ori == 1 ? 1 : -1);

			let rect = scaleX.ori == 0 ? rectH : rectV;

			let each = scaleX.ori == 0 ? _each : (u, seriesIdx, i, top, lft, hgt, wid) => {
				_each(u, seriesIdx, i, lft, top, wid, hgt);
			};

			// band where this series is the "from" edge
			let band = ifNull(u.bands, EMPTY_ARR).find(b => b.series[0] == seriesIdx);

			let fillDir = band != null ? band.dir : 0;
			let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, fillDir);
			let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff))

			// barWid is to center of stroke
			let xShift, barWid, fullGap, colWid = xDim;

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
				_align = 1;
				dataX = x0.values(u, seriesIdx, idx0, idx1);

				if (x0.unit == 2)
					dataX = dataX.map(pct => u.posToVal(xOff + pct * xDim, scaleX.key, true));

				// assumes uniform sizes, for now
				let sizes = size.values(u, seriesIdx, idx0, idx1);

				if (size.unit == 2)
					barWid = sizes[0] * xDim;
				else
					barWid = valToPosX(sizes[0], scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff); // assumes linear scale (delta from 0)

				colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);

				let gapWid = colWid - barWid;
				fullGap = gapWid + extraGap;
			}
			else {
				colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);

				let gapWid = colWid * gapFactor;

				fullGap = gapWid + extraGap;
				barWid = colWid - fullGap;
			}

			if (fullGap < 1)
				fullGap = 0;

			if (strokeWidth >= barWid / 2)
				strokeWidth = 0;

			// for small gaps, disable pixel snapping since gap inconsistencies become noticible and annoying
			if (fullGap < 5)
				pxRound = retArg0;

			let insetStroke = fullGap > 0;

			let rawBarWid = colWid - fullGap - (insetStroke ? strokeWidth : 0);

			barWid = pxRound(clamp(rawBarWid, minWidth, maxWidth));

			xShift = (_align == 0 ? barWid / 2 : _align == _dirX ? 0 : barWid) - _align * _dirX * ((_align == 0 ? extraGap / 2 : 0) + (insetStroke ? strokeWidth / 2 : 0));


			const _paths = {stroke: null, fill: null, clip: null, band: null, gaps: null, flags: 0};  // disp, geom

			const stroke = multiPath ? null : new Path2D();

			let dataY0 = null;

			if (band != null)
				dataY0 = u.data[band.series[1]];
			else {
				let { y0, y1 } = disp;

				if (y0 != null && y1 != null) {
					dataY = y1.values(u, seriesIdx, idx0, idx1);
					dataY0 = y0.values(u, seriesIdx, idx0, idx1);
				}
			}

			let radVal = valRadius * barWid;
			let radBase = baseRadius * barWid;

			for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
				let yVal = dataY[i];

				if (yVal == null)
					continue;

				if (dataY0 != null) {
					let yVal0 = dataY0[i] ?? 0;

					if (yVal - yVal0 == 0)
						continue;

					fillToY = valToPosY(yVal0, scaleY, yDim, yOff);
				}

				let xVal = scaleX.distr != 2 || disp != null ? dataX[i] : i;

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(ifNull(yVal, fillTo), scaleY, yDim, yOff);

				let lft = pxRound(xPos - xShift);
				let btm = pxRound(max(yPos, fillToY));
				let top = pxRound(min(yPos, fillToY));
				// this includes the stroke
				let barHgt = btm - top;

				if (yVal != null) {  // && yVal != fillTo (0 height bar)
					let rv = yVal < 0 ? radBase : radVal;
					let rb = yVal < 0 ? radVal : radBase;

					if (multiPath) {
						if (strokeWidth > 0 && strokeColors[i] != null)
							rect(strokePaths.get(strokeColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);

						if (fillColors[i] != null)
							rect(fillPaths.get(fillColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
					}
					else
						rect(stroke, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);

					each(u, seriesIdx, i,
						lft    - strokeWidth / 2,
						top,
						barWid + strokeWidth,
						barHgt,
					);
				}
			}

			if (strokeWidth > 0)
				_paths.stroke = multiPath ? strokePaths : stroke;
			else if (!multiPath) {
				_paths._fill = series.width == 0 ? series._fill : series._stroke ?? series._fill;
				_paths.width = 0;
			}

			_paths.fill = multiPath ? fillPaths : stroke;

			return _paths;
		});
	};
}