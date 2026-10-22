import { abs, floor, min, max, inf, EMPTY_OBJ, fnOrSelf, clamp, retArg0, EMPTY_ARR } from '../utils.js';
import { orient, rectV, rectH } from './utils.js';
import { colorPaths, paintPaths, dispReader } from './disp.js';

function percentToPos(pct, scale, dim, off) {
	return off + pct * dim;
}

function findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid = inf, xValue = dispReader()) {
	if (dataY.length > 1) {
		// prior index with non-undefined y data
		let prevIdx = null;

		// scan full dataset for smallest adjacent delta
		// will not work properly for non-linear x scales, since does not do expensive valToPosX calcs till end
		for (let i = 0, minDelta = Infinity; i < dataY.length; i++) {
			if (dataY[i] !== undefined) {
				if (prevIdx != null) {
					let delta = abs(xValue(dataX, i) - xValue(dataX, prevIdx));

					if (delta < minDelta) {
						minDelta = delta;
						colWid = abs(valToPosX(xValue(dataX, i), scaleX, xDim, xOff) - valToPosX(xValue(dataX, prevIdx), scaleX, xDim, xOff));
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
	const size = opts.size ?? [0.6, inf, 1];
	const align = opts.align || 0;
	const gap = opts.gap ?? 0;
	const [gapLead, gapTrail] = typeof gap == 'number' ? [0, gap] : gap;
	const _extraGap = gapLead + gapTrail;

	let ro = opts.radius;

	ro =
		// [valueRadius, baselineRadius]
		ro == null ? [0, 0] :
		typeof ro == 'number' ? [ro, 0] : ro;

	const radiusFn = fnOrSelf(ro);

	const gapFactor = 1 - size[0];
	const _maxWidth  = size[1] ?? inf;
	const _minWidth  = size[2] ?? 1;

	const disp = opts.disp ?? EMPTY_OBJ;
	const _each = opts.each ?? (_ => {});

	const { fill: dispFills, stroke: dispStrokes } = disp;

	return (u, seriesIdx, idx0, idx1) => {
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;
			let _align = align;

			let extraGap = _extraGap * pxRatio;
			let maxWidth = _maxWidth * pxRatio;
			let minWidth = _minWidth * pxRatio;

			let [valRadius, baseRadius] = radiusFn(u, seriesIdx);

			const _dirX = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			let rect = scaleX.ori == 0 ? rectH : rectV;

			let each = scaleX.ori == 0 ? _each : (u, seriesIdx, i, top, lft, hgt, wid) => {
				_each(u, seriesIdx, i, lft, top, wid, hgt);
			};

			let dataY0 = u._base?.[seriesIdx];

			// band where this series is the "from" edge
			let band = dataY0 == null ? (u.bands ?? EMPTY_ARR).find(b => b.series[0] == seriesIdx) : null;

			let fillDir = band != null ? band.dir : 0;
			let fillTo = dataY0 == null ? series.fillTo(u, seriesIdx, series.min, series.max, fillDir) : 0;
			let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff))

			// barWid is to center of stroke
			let xShift, barWid, fullGap, colWid = xDim;

			let strokeWidth = pxRound(series.width * pxRatio);


			let { x0, size } = disp;
			let xToPos = valToPosX;
			let xValue = dispReader();

			if (x0 != null && size != null) {
				_align = 1;
				dataX = x0.values(u, seriesIdx, idx0, idx1);
				xValue = dispReader(x0.kind);

				if (x0.unit == 2)
					xToPos = percentToPos;

				// TODO: support variable bar widths, including position-dependent widths on log X scales.
				let width = size.values(u, seriesIdx, idx0, idx1); // kind: 1 only

				if (size.unit == 2)
					barWid = width * xDim;
				else
					barWid = valToPosX(width, scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff); // assumes linear scale (delta from 0)

				colWid = findColWidth(dataX, dataY, xToPos, scaleX, xDim, xOff, colWid, xValue);

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

			// Inset the anchored edge along the bar's direction; centered bars use only the total gap.
			xShift = (_align == 0 ? barWid / 2 : _align == _dirX ? 0 : barWid) - _align * _dirX * (insetStroke ? gapLead * pxRatio + strokeWidth / 2 : 0);


			const _paths = {stroke: null, fill: null, clip: null, band: null, gaps: null, flags: 0};  // disp, geom

			const colors = dispFills != null || dispStrokes != null ? colorPaths(u, seriesIdx, disp, series._fill, series._stroke, strokeWidth > 0) : null;
			const stroke = colors == null ? new Path2D() : null;

			let yValue = dispReader();
			let y0Value = dispReader();
			let hasY0 = dataY0 != null || band != null;

			if (band != null)
				dataY0 = u._data[band.series[1]];
			else if (dataY0 == null) {
				let { y0, y1 } = disp;

				if (y0 != null && y1 != null) {
					dataY = y1.values(u, seriesIdx, idx0, idx1);
					dataY0 = y0.values(u, seriesIdx, idx0, idx1);
					yValue = dispReader(y1.kind);
					y0Value = dispReader(y0.kind);
					hasY0 = true;
				}
			}


			let radVal = valRadius * barWid;
			let radBase = baseRadius * barWid;

			for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
				let yVal = yValue(dataY, i);

				if (yVal == null)
					continue;

				if (hasY0) {
					let yVal0 = y0Value(dataY0, i) ?? 0;

					if (yVal - yVal0 == 0)
						continue;

					fillToY = valToPosY(yVal0, scaleY, yDim, yOff);
				}

				let xVal = xValue(dataX, i);

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = xToPos(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(yVal, scaleY, yDim, yOff);

				let lft = pxRound(xPos - xShift);
				let btm = pxRound(max(yPos, fillToY));
				let top = pxRound(min(yPos, fillToY));
				// this includes the stroke
				let barHgt = btm - top;

				if (yVal != fillTo) {
					let rv = yPos < fillToY ? radVal : radBase;
					let rb = yPos < fillToY ? radBase : radVal;

					const path = colors == null ? stroke : colors.path(i);
					if (path != null)
						rect(path, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);

					each(u, seriesIdx, i,
						lft    - strokeWidth / 2,
						top,
						barWid + strokeWidth,
						barHgt,
					);
				}
			}

			if (strokeWidth > 0)
				_paths.stroke = colors == null ? stroke : paintPaths(colors.groups, 'stroke');
			else if (colors == null) {
				_paths._fill = series.width == 0 ? series._fill : series._stroke ?? series._fill;
				_paths.width = 0;
			}

			_paths.fill = colors == null ? stroke : paintPaths(colors.groups, 'fill');

			return _paths;
		});
	};
}