import { orient, pointPos, moveToH, moveToV, rectH, arcH, arcV, pxOffset, BAND_CLIP_FILL, BAND_CLIP_STROKE } from './utils.js';
import { roundDec, PI, EMPTY_OBJ, EMPTY_ARR } from '../utils.js';
import { cacheDisp, cacheColors, colorPaths, dispReader } from './disp.js';


export function points(opts) {
	opts = opts || EMPTY_OBJ;
	const disp = opts.disp;
	const batch = opts.batch ?? (disp == null);
	const singlePath = batch && disp == null;
	const each = opts.each;

	return (u, seriesIdx, idx0, idx1, filtIdxs) => {
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let { pxRound, points } = series;
			const horizontal = scaleX.ori == 0;
			const moveTo = horizontal ? moveToH : moveToV;
			const arc = horizontal ? arcH : arcV;
			const width = roundDec(points.width * pxRatio, 3);
			const sizes = disp?.size == null ? null : cacheDisp(u, seriesIdx, disp.size);
			const fills = batch || disp?.fill == null ? null : cacheColors(u, seriesIdx, disp.fill);
			const strokes = batch || width <= 0 || disp?.stroke == null ? null : cacheColors(u, seriesIdx, disp.stroke);
			const sizeValue = dispReader(disp?.size?.kind);
			const fillIndex = dispReader(disp?.fill?.kind == 1 ? 1 : 3);
			const strokeIndex = dispReader(disp?.stroke?.kind == 1 ? 1 : 3);
			const sizeScale = disp?.size?.scale == null ? null : u.scales[disp.size.scale];
			const sizeRange = sizeScale == null ? null : disp.size.range;
			if (sizeScale != null && (sizeScale.min == null || sizeScale.max == null))
				return null;
			const sizeSpan = sizeRange == null ? 0 : sizeRange[1] - sizeRange[0];
			const cullPad = sizeRange == null ? 0 : sizeRange[1] * pxRatio / 2;
			let rad = (points.size - points.width) / 2 * pxRatio;
			const clipPad = sizes != null ? 0 : disp == null ? roundDec(rad * 2, 3) : points.size * pxRatio / 2;

			let fill = singlePath ? new Path2D() : null;
			let clip = new Path2D();
			let { left: lft, top, width: wid, height: hgt } = u.bbox;

			rectH(clip, lft - clipPad, top - clipPad, wid + clipPad * 2, hgt + clipPad * 2);

			const ctx = u.ctx;
			const offset = pxOffset(width, points.pxAlign);
			const xMin = xOff - cullPad - offset;
			const xMax = xOff + xDim + cullPad - offset;
			const yMin = yOff - cullPad - offset;
			const yMax = yOff + yDim + cullPad - offset;
			const strokeStyle = points._stroke;
			const fillStyle = points._fill ?? (width > 0 ? '#fff' : strokeStyle);

			const colors = !singlePath && batch ? colorPaths(u, seriesIdx, disp, fillStyle, strokeStyle, width > 0) : null;

			if (!singlePath) {
				ctx.save();
				// Bubble clipping stays at the plot boundary, independent of stroke alignment.
				if (sizes != null)
					ctx.clip(clip);
				ctx.translate(offset, offset);
				if (sizes == null)
					ctx.clip(clip);
				if (width > 0)
					ctx.lineWidth = width;
				ctx.lineCap = points.cap ?? 'butt';
				ctx.lineJoin = 'round';
				ctx.setLineDash(points.dash ?? EMPTY_ARR);
			}

			const drawPoint = pi => {
				const xVal = dataX[pi];
				const yVal = dataY[pi];
				if (xVal == null || yVal == null || sizeRange == null && (
					xVal < scaleX.min || xVal > scaleX.max ||
					yVal < scaleY.min || yVal > scaleY.max))
					return;

				let x = pointPos(xVal, scaleX, xDim, xOff, valToPosX, pxRound);
				let y = pointPos(yVal, scaleY, yDim, yOff, valToPosY, pxRound);

				// Compare mapped centers to avoid extrapolating nonlinear inverse transforms.
				if (sizeRange != null && (x < xMin || x > xMax || y < yMin || y > yMax))
					return;

				if (sizes != null) {
					let size = sizeValue(sizes, pi);
					if (sizeScale != null) {
						const pct = Math.max(0, Math.min(1, sizeScale.valToPct(size)));
						size = sizeRange[0] + pct * sizeSpan;
					}
					if (size <= points.width)
						return;
					rad = (size - points.width) / 2 * pxRatio;
				}


				if (colors != null) {
					const path = colors.path(pi);
					if (path == null)
						return;

					moveTo(path, x + (horizontal ? rad : 0), y + (horizontal ? 0 : rad));
					arc(path, x, y, rad, 0, PI * 2);
				}
				else if (!singlePath) {
					const colorFill = fills == null ? fillStyle : fills[0][fillIndex(fills[1], pi)];
					const colorStroke = strokes == null ? strokeStyle : strokes[0][strokeIndex(strokes[1], pi)];
					if (colorFill == null && (width <= 0 || colorStroke == null))
						return;

					ctx.beginPath();
					moveTo(ctx, x + (horizontal ? rad : 0), y + (horizontal ? 0 : rad));
					arc(ctx, x, y, rad, 0, PI * 2);
					if (colorFill != null) {
						ctx.fillStyle = colorFill;
						ctx.fill();
					}
					if (width > 0 && colorStroke != null) {
						ctx.strokeStyle = colorStroke;
						ctx.stroke();
					}
				}
				else {
					moveTo(fill, x + (horizontal ? rad : 0), y + (horizontal ? 0 : rad));
					arc(fill, x, y, rad, 0, PI * 2);
				}

				if (each != null) {
					const cx = (horizontal ? x : y) + offset;
					const cy = (horizontal ? y : x) + offset;
					const outer = rad + width / 2;
					each(u, seriesIdx, pi, cx - outer, cy - outer, outer * 2, outer * 2);
				}
			};

			if (filtIdxs)
				filtIdxs.forEach(drawPoint);
			else {
				for (let pi = idx0; pi <= idx1; pi++)
					drawPoint(pi);
			}

			if (!singlePath) {
				if (colors != null) {
					colors.groups.forEach(group => {
						if (group?.fill != null) {
							ctx.fillStyle = group.fill;
							ctx.fill(group.path);
						}
					});
					colors.groups.forEach(group => {
						if (group?.stroke != null) {
							ctx.strokeStyle = group.stroke;
							ctx.stroke(group.path);
						}
					});
				}
				ctx.restore();
				return null;
			}

			return {
				stroke: width > 0 ? fill : null,
				fill,
				clip,
				flags: BAND_CLIP_FILL | BAND_CLIP_STROKE,
			};
		});
	};
}
