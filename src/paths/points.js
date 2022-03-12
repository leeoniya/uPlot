import { orient, moveToH, moveToV, rectH, arcH, arcV, BAND_CLIP_FILL, BAND_CLIP_STROKE } from './utils';
import { roundDec, PI } from '../utils';
import { pxRatio } from '../dom';

// TODO: drawWrap(seriesIdx, drawPoints) (save, restore, translate, clip)
export function points(opts) {
	return (u, seriesIdx, idx0, idx1, filtIdxs) => {
	//	log("drawPoints()", arguments);

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let { pxRound, points } = series;

			let moveTo, arc;

			if (scaleX.ori == 0) {
				moveTo = moveToH;
				arc = arcH;
			}
			else {
				moveTo = moveToV;
				arc = arcV;
			}

			const width = roundDec(points.width * pxRatio, 3);

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

					moveTo(fill, x + rad, y);
					arc(fill, x, y, rad, 0, PI * 2);
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