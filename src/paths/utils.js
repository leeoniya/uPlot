import { round, incrRound, retArg0, nonNullIdx, min, EMPTY_ARR, ifNull } from "../utils";

export const BAND_CLIP_FILL   = 1 << 0;
export const BAND_CLIP_STROKE = 1 << 1;

export function orient(u, seriesIdx, cb) {
	const series = u.series[seriesIdx];
	const scales = u.scales;
	const bbox   = u.bbox;
	const scaleX = u.mode == 2 ? scales[series.facets[0].scale] : scales[u.series[0].scale];

	let dx = u._data[0],
		dy = u._data[seriesIdx],
		sx = scaleX,
		sy = u.mode == 2 ? scales[series.facets[1].scale] : scales[series.scale],
		l = bbox.left,
		t = bbox.top,
		w = bbox.width,
		h = bbox.height,
		H = u.valToPosH,
		V = u.valToPosV;

	return (sx.ori == 0
		? cb(
			series,
			dx,
			dy,
			sx,
			sy,
			H,
			V,
			l,
			t,
			w,
			h,
			moveToH,
			lineToH,
			rectH,
			arcH,
			bezierCurveToH,
		)
		: cb(
			series,
			dx,
			dy,
			sx,
			sy,
			V,
			H,
			t,
			l,
			h,
			w,
			moveToV,
			lineToV,
			rectV,
			arcV,
			bezierCurveToV,
		)
	);
}

export function bandFillClipDirs(self, seriesIdx) {
	let fillDir = 0;

	// 2 bits, -1 | 1
	let clipDirs = 0;

	let bands = ifNull(self.bands, EMPTY_ARR);

	for (let i = 0; i < bands.length; i++) {
		let b = bands[i];

		// is a "from" band edge
		if (b.series[0] == seriesIdx)
			fillDir = b.dir;
		// is a "to" band edge
		else if (b.series[1] == seriesIdx) {
			if (b.dir == 1)
				clipDirs |= 1;
			else
				clipDirs |= 2;
		}
	}

	return [
		fillDir,
		(
			clipDirs == 1 ? -1 : // neg only
			clipDirs == 2 ?  1 : // pos only
			clipDirs == 3 ?  2 : // both
			                 0   // neither
		)
	];
}

export function seriesFillTo(self, seriesIdx, dataMin, dataMax, bandFillDir) {
	let scale = self.scales[self.series[seriesIdx].scale];

	return (
		bandFillDir == -1 ? scale.min :
		bandFillDir ==  1 ? scale.max :
		scale.distr ==  3 ? (
			scale.dir == 1 ? scale.min :
			scale.max
		) : 0
	);
}

// creates inverted band clip path (from stroke path -> yMax || yMin)
// clipDir is always inverse of fillDir
// default clip dir is upwards (1), since default band fill is downwards/fillBelowTo (-1) (highIdx -> lowIdx)
export function clipBandLine(self, seriesIdx, idx0, idx1, strokePath, clipDir) {
	return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
		let pxRound = series.pxRound;

		const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
		const lineTo = scaleX.ori == 0 ? lineToH : lineToV;

		let frIdx, toIdx;

		if (dir == 1) {
			frIdx = idx0;
			toIdx = idx1;
		}
		else {
			frIdx = idx1;
			toIdx = idx0;
		}

		// path start
		let x0 = pxRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff));
		let y0 = pxRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff));
		// path end x
		let x1 = pxRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff));
		// upper or lower y limit
		let yLimit = pxRound(valToPosY(clipDir == 1 ? scaleY.max : scaleY.min, scaleY, yDim, yOff));

		let clip = new Path2D(strokePath);

		lineTo(clip, x1, yLimit);
		lineTo(clip, x0, yLimit);
		lineTo(clip, x0, y0);

		return clip;
	});
}

export function clipGaps(gaps, ori, plotLft, plotTop, plotWid, plotHgt) {
	let clip = null;

	// create clip path (invert gaps and non-gaps)
	if (gaps.length > 0) {
		clip = new Path2D();

		const rect = ori == 0 ? rectH : rectV;

		let prevGapEnd = plotLft;

		for (let i = 0; i < gaps.length; i++) {
			let g = gaps[i];

			if (g[1] > g[0]) {
				let w = g[0] - prevGapEnd;

				w > 0 && rect(clip, prevGapEnd, plotTop, w, plotTop + plotHgt);

				prevGapEnd = g[1];
			}
		}

		let w = plotLft + plotWid - prevGapEnd;

		w > 0 && rect(clip, prevGapEnd, plotTop, w, plotTop + plotHgt);
	}

	return clip;
}

export function addGap(gaps, fromX, toX) {
	let prevGap = gaps[gaps.length - 1];

	if (prevGap && prevGap[0] == fromX)			// TODO: gaps must be encoded at stroke widths?
		prevGap[1] = toX;
	else
		gaps.push([fromX, toX]);
}

export function pxRoundGen(pxAlign) {
	return pxAlign == 0 ? retArg0 : pxAlign == 1 ? round : v => incrRound(v, pxAlign);
}

// inefficient linear interpolation that does bi-directinal scans on each call
export function costlyLerp(i, idx0, idx1, _dirX, dataY) {
	let prevNonNull = nonNullIdx(dataY, _dirX == 1 ? idx0 : idx1, i, -_dirX);
	let nextNonNull = nonNullIdx(dataY, i, _dirX == 1 ? idx1 : idx0,  _dirX);

	let prevVal = dataY[prevNonNull];
	let nextVal = dataY[nextNonNull];

	return prevVal + (i - prevNonNull) / (nextNonNull - prevNonNull) * (nextVal - prevVal);
}

function rect(ori) {
	let moveTo = ori == 0 ?
		moveToH :
		moveToV;

	let arcTo = ori == 0 ?
		(p, x1, y1, x2, y2, r) => { p.arcTo(x1, y1, x2, y2, r) } :
		(p, y1, x1, y2, x2, r) => { p.arcTo(x1, y1, x2, y2, r) };

	let rect = ori == 0 ?
		(p, x, y, w, h) => { p.rect(x, y, w, h); } :
		(p, y, x, h, w) => { p.rect(x, y, w, h); };

	return (p, x, y, w, h, r = 0) => {
		if (r == 0)
			rect(p, x, y, w, h);
		else {
			r = min(r, w / 2, h / 2);

			// adapted from https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas/7838871#7838871
			moveTo(p, x + r, y);
			arcTo(p, x + w, y, x + w, y + h, r);
			arcTo(p, x + w, y + h, x, y + h, r);
			arcTo(p, x, y + h, x, y, r);
			arcTo(p, x, y, x + w, y, r);
			p.closePath();
		}
	};
}

// orientation-inverting canvas functions
export const moveToH = (p, x, y) => { p.moveTo(x, y); }
export const moveToV = (p, y, x) => { p.moveTo(x, y); }
export const lineToH = (p, x, y) => { p.lineTo(x, y); }
export const lineToV = (p, y, x) => { p.lineTo(x, y); }
export const rectH = rect(0);
export const rectV = rect(1);
export const arcH = (p, x, y, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); }
export const arcV = (p, y, x, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); }
export const bezierCurveToH = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export const bezierCurveToV = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };