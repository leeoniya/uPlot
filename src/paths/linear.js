import { aliasProps } from './aliasProps';
import { min, max, round, roundDec, incrRound, nonNullIdx, inf } from '../utils';
import { addGap, clipGaps } from './utils';
import { pxRatio } from '../dom';

let dir = 1;

function drawAcc(stroke, accX, minY, maxY, outY) {
	stroke.lineTo(accX, minY);
	stroke.lineTo(accX, maxY);
	stroke.lineTo(accX, outY);
}

export function linear() {
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

		const isGap = series.isGap;

		const _paths = dir == 1 ? {stroke: new Path2D(), fill: null, clip: null} : u.series[seriesIdx - 1]._paths;
		const stroke = _paths.stroke;
		const width = roundDec(series.width * pxRatio, 3);

		let minY = inf,
			maxY = -inf,
			outY, outX, drawnAtX;

		// todo: don't build gaps on dir = -1 pass
		let gaps = [];

		let accX = round(valToPosX(dataX[dir == 1 ? idx0 : idx1], scaleX, plotWid, plotLft));
		let accGaps = false;

		// data edges
		let lftIdx = nonNullIdx(dataY, idx0, idx1,  1);
		let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1);
		let lftX = incrRound(valToPosX(dataX[lftIdx], scaleX, plotWid, plotLft), 0.5);
		let rgtX = incrRound(valToPosX(dataX[rgtIdx], scaleX, plotWid, plotLft), 0.5);

		if (lftX > plotLft)
			addGap(gaps, plotLft, lftX);

		// the moves the shape edge outside the canvas so stroke doesnt bleed in
		if (series.band && dir == 1)
			stroke.lineTo(lftX - width * 2, round(valToPosY(dataY[idx0], scaleY, plotHgt, plotTop)));

		for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
			let x = round(valToPosX(dataX[i], scaleX, plotWid, plotLft));

			if (x == accX) {
				if (dataY[i] != null) {
					outY = round(valToPosY(dataY[i], scaleY, plotHgt, plotTop));

					if (minY == inf)
						stroke.lineTo(x, outY);

					minY = min(outY, minY);
					maxY = max(outY, maxY);
				}
				else if (!accGaps && isGap(u, seriesIdx, i))
					accGaps = true;
			}
			else {
				let _addGap = false;

				if (minY != inf) {
					drawAcc(stroke, accX, minY, maxY, outY);
					outX = drawnAtX = accX;
				}
				else if (accGaps) {
					_addGap = true;
					accGaps = false;
				}

				if (dataY[i] != null) {
					outY = round(valToPosY(dataY[i], scaleY, plotHgt, plotTop));
					stroke.lineTo(x, outY);
					minY = maxY = outY;

					// prior pixel can have data but still start a gap if ends with null
					if (x - accX > 1 && dataY[i - 1] == null && isGap(u, seriesIdx, i - 1))
						_addGap = true;
				}
				else {
					minY = inf;
					maxY = -inf;

					if (!accGaps && isGap(u, seriesIdx, i))
						accGaps = true;
				}

				_addGap && addGap(gaps, outX, x);

				accX = x;
			}
		}

		if (minY != inf && minY != maxY && drawnAtX != accX)
			drawAcc(stroke, accX, minY, maxY, outY);

		if (rgtX < plotLft + plotWid)
			addGap(gaps, rgtX, plotLft + plotWid);

		if (series.band) {
			let _x, _iy, _data = u._data, dataY2;

			// the moves the shape edge outside the canvas so stroke doesnt bleed in
			if (dir == 1) {
				_x = rgtX + width * 2;
				_iy = rgtIdx;
				dataY2 = _data[seriesIdx + 1];
			}
			else {
				_x = lftX - width * 2;
				_iy = lftIdx;
				dataY2 = _data[seriesIdx - 1];
			}

			stroke.lineTo(_x, round(valToPosY(dataY[_iy],  scaleY, plotHgt, plotTop)));
			stroke.lineTo(_x, round(valToPosY(dataY2[_iy], scaleY, plotHgt, plotTop)));
		}

		if (dir == 1) {
			if (!series.spanGaps)
				_paths.clip =  clipGaps(gaps, 1, plotLft, plotTop, plotWid, plotHgt);

			if (series.fill != null) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = round(valToPosY(series.fillTo(u, seriesIdx, series.min, series.max), scaleY, plotHgt, plotTop));
				fill.lineTo(rgtX, fillTo);
				fill.lineTo(lftX, fillTo);
			}
		}

		if (series.band)
			dir *= -1;

		return _paths;
	};
}
