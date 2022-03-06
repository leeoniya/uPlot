import { nonNullIdx, ifNull, EMPTY_OBJ } from '../utils';
import { orient, BAND_CLIP_FILL } from './utils';
import { pxRatio } from '../dom';

export function eventMarkers(opts) {
	opts = opts || EMPTY_OBJ;
	const showLabels = ifNull(opts.showLabels, true);
	const labelsAlign = ifNull(opts.labelsAlign, "top");

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, labels: new Array(), flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let yBottom = yOff + yDim;
			let yTop = yOff;

			let labelPadding = 6;
			let yLabel = yTop + labelPadding;

			if (labelsAlign == "bottom")
			{
				yLabel = yBottom - labelPadding;
			}
			else if (labelsAlign == "center")
			{
				yLabel = (yBottom - yTop) / 2;
			}

			for (let i = idx0; i <= idx1; i++) {
				let yEventName = dataY[i];

				if (yEventName == null) {
					continue;
				}
				let x = pxRound(valToPosX(dataX[i], scaleX, xDim, xOff));

				stroke.moveTo(x, yBottom);
				stroke.lineTo(x, yTop);

				if (showLabels)
				{	
					let labelElement = {text: dataY[i], align: labelsAlign, x: x, y: yLabel};
					_paths.labels.push(labelElement);
				}
			}

			_paths.gaps = null;
			_paths.fill = null;
			_paths.clip = null;
			_paths.band = null;

			return _paths;
		});
	};
}