import { aliasProps } from './aliasProps';
import { round, nonNullIdx, ifNull } from '../utils';
import { addGap, clipGaps } from './utils';
import { pxRatio } from '../dom';

export function stepped(opts) {
	const align = ifNull(opts.align, 1);

	return (u, seriesIdx, idx0, idx1) => {
		const [
			series,
			dataX,
			dataY,
			scaleX,
			scaleY,
			valToPosX,
			valToPosY,
			plotLft,
			plotTop,
			plotWid,
			plotHgt,
		] = aliasProps(u, seriesIdx);

		const stroke = new Path2D();

		const _dir = 1 * scaleX.dir;

		idx0 = nonNullIdx(dataY, idx0, idx1,  1);
		idx1 = nonNullIdx(dataY, idx0, idx1, -1);

		let gaps = [];
		let inGap = false;
		let prevYPos = round(valToPosY(dataY[_dir == 1 ? idx0 : idx1], scaleY, plotHgt, plotTop));
		let firstXPos = round(valToPosX(dataX[_dir == 1 ? idx0 : idx1], scaleX, plotWid, plotLft));
		let prevXPos = firstXPos;

		stroke.moveTo(firstXPos, prevYPos);

		for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
			let yVal1 = dataY[i];

			let x1 = round(valToPosX(dataX[i], scaleX, plotWid, plotLft));

			if (yVal1 == null) {
				if (series.isGap(u, seriesIdx, i)) {
					addGap(gaps, prevXPos, x1);
					inGap = true;
				}
				continue;
			}

			let y1 = round(valToPosY(yVal1, scaleY, plotHgt, plotTop));

			if (inGap) {
				addGap(gaps, prevXPos, x1);

				// don't clip vertical extenders
				if (prevYPos != y1) {
                    let halfStroke = (series.width * pxRatio) / 2;

					let lastGap = gaps[gaps.length - 1];
					lastGap[0] += halfStroke;
					lastGap[1] -= halfStroke;
				}

				inGap = false;
			}

			if (align == 1)
				stroke.lineTo(x1, prevYPos);
			else
				stroke.lineTo(prevXPos, y1);

			stroke.lineTo(x1, y1);

			prevYPos = y1;
			prevXPos = x1;
		}

		const fill = new Path2D(stroke);

		let fillTo = series.fillTo(u, seriesIdx, series.min, series.max);

		let minY = round(valToPosY(fillTo, scaleY, plotHgt, plotTop));

		fill.lineTo(prevXPos, minY);
		fill.lineTo(firstXPos, minY);

		let clip = !series.spanGaps ? clipGaps(gaps, 1, plotLft, plotTop, plotWid, plotHgt) : null;

		return {
			stroke,
			fill,
			clip,
		};
	};
}
