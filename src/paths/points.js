import { orient, rectH, BAND_CLIP_FILL, BAND_CLIP_STROKE } from './utils';
import { roundDec, PI } from '../utils';

// TODO: drawWrap(seriesIdx, drawPoints) (save, restore, translate, clip)
export function points(opts) {
	return (u, seriesIdx, idx0, idx1, filtIdxs) => {
	//	log("drawPoints()", arguments);
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim, moveTo, lineTo, rect, arc, bezier) => {
			let { pxRound, points } = series;

			const width = roundDec(points.width * pxRatio, 3);
			const size = roundDec(points.size * pxRatio, 3);

			let rad = (points.size - points.width) / 2 * pxRatio;
			let dia = roundDec(rad * 2, 3);

			let fill = new Path2D();
			let clip = new Path2D();

			let { left: lft, top: top, width: wid, height: hgt } = u.bbox;

			rectH(clip,
				lft - dia,
				top - dia,
				wid + dia * 2,
				hgt + dia * 2,
			);

			const drawPoint = pi => {
				if (dataY[pi] != null) {
					let x = pxRound(valToPosX(dataX[pi], scaleX, xDim, xOff));
					let y = pxRound(valToPosY(dataY[pi], scaleY, yDim, yOff));

					points.form.draw(fill, x, y, size, width, moveTo, lineTo, arc, bezier);
				}
			};

			if (filtIdxs)
				filtIdxs.forEach(drawPoint);
			else {
				for (let pi = idx0; pi <= idx1; pi++)
					drawPoint(pi);
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

export const CIRCLE = {
	name: 'CIRCLE',
	draw: (path, centerX, centerY, size, strokeWidth, moveTo, lineTo, arc, bezier) => {
		const dist = (size - strokeWidth) / 2;
		moveTo(path, centerX + dist, centerY);
		arc(path, centerX, centerY, dist, 0, 2 * Math.PI);
	},
}