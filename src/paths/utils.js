import { incrRound } from "../utils";

export function orient(u, seriesIdx, cb) {
	const series = u.series[seriesIdx];
	const scales = u.scales;
	const bbox   = u.bbox;
	const scaleX = scales[u.series[0].scale];

	let dx = u._data[0],
		dy = u._data[seriesIdx],
		sx = scaleX,
		sy = scales[series.scale],
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

// creates inverted band clip path (towards from stroke path -> yMax)
export function clipBandLine(self, seriesIdx, idx0, idx1, strokePath) {
	return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
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
		let x0 = incrRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff), 0.5);
		let y0 = incrRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff), 0.5);
		// path end x
		let x1 = incrRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff), 0.5);
		// upper y limit
		let yLimit = incrRound(valToPosY(scaleY.max, scaleY, yDim, yOff), 0.5);

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

			rect(clip, prevGapEnd, plotTop, g[0] - prevGapEnd, plotTop + plotHgt);

			prevGapEnd = g[1];
		}

		rect(clip, prevGapEnd, plotTop, plotLft + plotWid - prevGapEnd, plotTop + plotHgt);
	}

	return clip;
}

export function addGap(gaps, fromX, toX) {
	if (toX > fromX) {
		let prevGap = gaps[gaps.length - 1];

		if (prevGap && prevGap[0] == fromX)			// TODO: gaps must be encoded at stroke widths?
			prevGap[1] = toX;
		else
			gaps.push([fromX, toX]);
	}
}

// orientation-inverting canvas functions
export function moveToH(p, x, y) { p.moveTo(x, y); }
export function moveToV(p, y, x) { p.moveTo(x, y); }
export function lineToH(p, x, y) { p.lineTo(x, y); }
export function lineToV(p, y, x) { p.lineTo(x, y); }
export function rectH(p, x, y, w, h) { p.rect(x, y, w, h); }
export function rectV(p, y, x, h, w) { p.rect(x, y, w, h); }
export function arcH(p, x, y, r, startAngle, endAngle) { p.arc(x, y, r, startAngle, endAngle); }
export function arcV(p, y, x, r, startAngle, endAngle) { p.arc(x, y, r, startAngle, endAngle); }
export function bezierCurveToH(p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export function bezierCurveToV(p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };