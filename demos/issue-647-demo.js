import uPlot from "../dist/uPlot.esm.js";
const { spline } = uPlot.paths;


var tapedTwice = false;

export const moveToH = (p, x, y) => { p.moveTo(x, y); }
export const moveToV = (p, y, x) => { p.moveTo(x, y); }
export const lineToH = (p, x, y) => { p.lineTo(x, y); }
export const lineToV = (p, y, x) => { p.lineTo(x, y); }

const _spline = spline();
export function drawSpline(u, seriesIdx, idx0, idx1) {
  return _spline(u, seriesIdx, idx0, idx1);
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

export const arcH = (p, x, y, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); }
export const arcV = (p, y, x, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); }
export const bezierCurveToH = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export const bezierCurveToV = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
export const rectH = rect(0);
export const rectV = rect(1);
export const BAND_CLIP_FILL = 1 << 0;

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

export function nonNullIdx(data, _i0, _i1, dir) {
	for (let i = dir == 1 ? _i0 : _i1; i >= _i0 && i <= _i1; i += dir) {
		if (data[i] != null)
			return i;
	}

	return -1;
}


function _drawAcc(lineTo) {
	return (stroke, accX, minY, maxY, inY, outY) => {
		if (minY != maxY) {
			if (inY != minY && outY != minY)
				lineTo(stroke, accX, minY);
			if (inY != maxY && outY != maxY)
				lineTo(stroke, accX, maxY);

			lineTo(stroke, accX, outY);
		}
	};
}


export function clipBandLine(self, seriesIdx, idx0, idx1, strokePath) {
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
		// upper y limit
		let yLimit = pxRound(valToPosY(scaleY.max, scaleY, yDim, yOff));

		let clip = new Path2D(strokePath);

		lineTo(clip, x1, yLimit);
		lineTo(clip, x0, yLimit);
		lineTo(clip, x0, y0);

		return clip;
	});
}


const drawAccH = _drawAcc(lineToH);
const drawAccV = _drawAcc(lineToV);

export function linear2() {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			let lineTo, drawAcc;

			if (scaleX.ori == 0) {
				lineTo = lineToH;
				drawAcc = drawAccH;
			}
			else {
				lineTo = lineToV;
				drawAcc = drawAccV;
			}

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let minY = Infinity,
				maxY = -Infinity,
				inY, outY, outX, drawnAtX;

			let gaps = [];

			let accX = pxRound(valToPosX(dataX[dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
			let accGaps = false;
			let prevYNull = false;
      let prevY = null;
      let prevX = 0;

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * dir);
			let lftX =  pxRound(valToPosX(dataX[lftIdx], scaleX, xDim, xOff));
			let rgtX =  pxRound(valToPosX(dataX[rgtIdx], scaleX, xDim, xOff));

			if (lftX > xOff)
				addGap(gaps, xOff, lftX);

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let x = pxRound(valToPosX(dataX[i], scaleX, xDim, xOff));
        outY = pxRound(valToPosY(dataY[i], scaleY, yDim, yOff));

				if (x == accX) {
					if (dataY[i] != null) {
            if (prevYNull || (Math.abs(dataY[i] - prevY) > 30) || (i - prevX) > 1) {
              moveToH(stroke, x, outY);
            } else if (minY == Infinity) {
							lineTo(stroke, x, outY);
							inY = outY;
						}

						minY = Math.min(outY, minY);
						maxY = Math.max(outY, maxY);
            prevYNull = false;
					} else if (dataY[i] === null) {
						prevYNull = true;
          }
				} else {
					if (dataY[i] != null) {
            // prior pixel can have data but still start a gap if ends with null
            if (prevYNull || (Math.abs(dataY[i] - prevY) > 30) || (i - prevX) > 1) {
              moveToH(stroke, x, outY);
            } else {
              lineTo(stroke, x, outY);
            }

            minY = maxY = inY = outY;

						prevYNull = false;
					} else {
						minY = Infinity;
						maxY = -Infinity;

						if (dataY[i] === null) {
							prevYNull = true;
						}
					}
					accX = x;
				}

        prevY = dataY[i];
        prevX = i;
			}

			if (minY != Infinity && minY != maxY && drawnAtX != accX)
				drawAcc(stroke, accX, minY, maxY, inY, outY);

			if (rgtX < xOff + xDim)
				addGap(gaps, rgtX, xOff + xDim);

			if (series.fill != null) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = pxRound(valToPosY(series.fillTo(u, seriesIdx, series.min, series.max), scaleY, yDim, yOff));

				lineTo(fill, rgtX, fillTo);
				lineTo(fill, lftX, fillTo);
			}

			_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

			if (!series.spanGaps)
				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);

			if (u.bands.length > 0) {
				// ADDL OPT: only create band clips for series that are band lower edges
				// if (b.series[1] == i && _paths.band == null)
				_paths.band = clipBandLine(u, seriesIdx, idx0, idx1, stroke);
			}

			return _paths;
		});
	};
}