import { aliasProps } from './aliasProps';
import { min, max, round, roundDec, incrRound, nonNullIdx, inf } from '../utils';
import { addGap, clipGaps, lineToH, lineToV } from './utils';
import { pxRatio } from '../dom';

let dir = 1;

function _drawAcc(lineTo) {
	return (stroke, accX, minY, maxY, outY) => {
		lineTo(stroke, accX, minY);
		lineTo(stroke, accX, maxY);
		lineTo(stroke, accX, outY);
	};
}

const drawAccH = _drawAcc(lineToH);
const drawAccV = _drawAcc(lineToV);

export function linear() {
	return (u, seriesIdx, idx0, idx1) => {
		return aliasProps(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let lineTo, drawAcc;

			if (scaleX.ori == 0) {
				lineTo = lineToH;
				drawAcc = drawAccH;
			}
			else {
				lineTo = lineToV;
				drawAcc = drawAccV;
			}

			const isGap = series.isGap;

			const _dir = dir * scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			const _paths = dir == 1 ? {stroke: new Path2D(), fill: null, clip: null} : u.series[seriesIdx - 1]._paths;
			const stroke = _paths.stroke;
			const width = roundDec(series.width * pxRatio, 3);

			let minY = inf,
				maxY = -inf,
				outY, outX, drawnAtX;

			// todo: don't build gaps on dir = -1 pass
			let gaps = [];

			let accX = round(valToPosX(dataX[_dir == 1 ? idx0 : idx1], scaleX, xDim, xOff));
			let accGaps = false;

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * _dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * _dir);
			let lftX = incrRound(valToPosX(dataX[lftIdx], scaleX, xDim, xOff), 0.5);
			let rgtX = incrRound(valToPosX(dataX[rgtIdx], scaleX, xDim, xOff), 0.5);

			if (lftX > xOff)
				addGap(gaps, xOff, lftX);

			// the moves the shape edge outside the canvas so stroke doesnt bleed in
			if (series.band && _dir == 1)
				lineTo(stroke, lftX - width * 2, round(valToPosY(dataY[idx0], scaleY, yDim, yOff)));

			for (let i = _dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dir) {
				let x = round(valToPosX(dataX[i], scaleX, xDim, xOff));

				if (x == accX) {
					if (dataY[i] != null) {
						outY = round(valToPosY(dataY[i], scaleY, yDim, yOff));

						if (minY == inf)
							lineTo(stroke, x, outY);

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
						outY = round(valToPosY(dataY[i], scaleY, yDim, yOff));
						lineTo(stroke, x, outY);
						minY = maxY = outY;

						// prior pixel can have data but still start a gap if ends with null
						if (x - accX > 1 && dataY[i - _dir] == null && isGap(u, seriesIdx, i - _dir))
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

			if (rgtX < xOff + xDim)
				addGap(gaps, rgtX, xOff + xDim);

			if (series.band) {
				let _x, _iy, _data = u._data, dataY2;

				// the moves the shape edge outside the canvas so stroke doesnt bleed in
				if (_dir == 1) {
					_x = rgtX + width * 2;
					_iy = rgtIdx;
					dataY2 = _data[seriesIdx + 1];
				}
				else {
					_x = lftX - width * 2;
					_iy = lftIdx;
					dataY2 = _data[seriesIdx - 1];
				}

				lineTo(stroke, _x, round(valToPosY(dataY[_iy],  scaleY, yDim, yOff)));
				lineTo(stroke, _x, round(valToPosY(dataY2[_iy], scaleY, yDim, yOff)));
			}

			if (dir == 1) {
				if (!series.spanGaps)
					_paths.clip =  clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);

				if (series.fill != null) {
					let fill = _paths.fill = new Path2D(stroke);

					let fillTo = round(valToPosY(series.fillTo(u, seriesIdx, series.min, series.max), scaleY, yDim, yOff));
					lineTo(fill, rgtX, fillTo);
					lineTo(fill, lftX, fillTo);
				}
			}

			if (series.band)
				dir *= -1;

			return _paths;
		});
	};
}