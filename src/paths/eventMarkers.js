import { nonNullIdx, ifNull } from '../utils';
import { orient, BAND_CLIP_FILL } from './utils';
import { pxRatio } from '../dom';

export function eventMarkers() {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			const _paths = {stroke: new Path2D(), labels: new Array(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let labelOffset = 0;

			for (let i = idx0; i <= idx1; i++) {
				let yEventName = dataY[i];

				if (yEventName == null) {
					continue;
                }
                let x = pxRound(valToPosX(dataX[i], scaleX, xDim, xOff));
				let yBottom = yOff + yDim;
				let yTop = yOff;

                stroke.moveTo(x, yBottom);
                stroke.lineTo(x, yTop);

				let labelElement = {text: dataY[i], x: x, y: yTop + labelOffset};

				_paths.labels.push(labelElement);
			}

			_paths.gaps = null;
			_paths.fill = null;
			_paths.clip = null;
			_paths.band = null;

			return _paths;
		});
	};
}