export function clipGaps(gaps, ori, plotLft, plotTop, plotWid, plotHgt) {
	let clip = null;

	// create clip path (invert gaps and non-gaps)
	if (gaps.length > 0) {
		clip = new Path2D();

		if (ori == 1) {
			let prevGapEnd = plotLft;

			for (let i = 0; i < gaps.length; i++) {
				let g = gaps[i];

				clip.rect(prevGapEnd, plotTop, g[0] - prevGapEnd, plotTop + plotHgt);

				prevGapEnd = g[1];
			}

			clip.rect(prevGapEnd, plotTop, plotLft + plotWid - prevGapEnd, plotTop + plotHgt);
		}
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