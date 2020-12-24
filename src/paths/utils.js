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
export function rectH(p, x, y, w, h) { p.rect(x, y, w, h); }
export function rectV(p, y, x, h, w) { p.rect(x, y, w, h); }
export function moveToH(p, x, y) { p.moveTo(x, y); }
export function moveToV(p, y, x) { p.moveTo(x, y); }
export function lineToH(p, x, y) { p.lineTo(x, y); }
export function lineToV(p, y, x) { p.lineTo(x, y); }
export function arcToH(p, x, y, r, startAngle, endAngle) { p.arc(x, y, r, startAngle, endAngle); }
export function arcToV(p, y, x, r, startAngle, endAngle) { p.arc(x, y, r, startAngle, endAngle); }
export function bezierCurveToH(p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export function bezierCurveToV(p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };