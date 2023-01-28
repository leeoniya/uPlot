import { nonNullIdx, ifNull, floor } from '../utils';
import { orient, clipGaps, lineToH, lineToV, clipBandLine, BAND_CLIP_FILL, bandFillClipDirs, findGaps } from './utils';
import { lttb } from './lttb';

export function linear2(opts) {
	const alignGaps = ifNull(opts?.alignGaps, 0);

	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));
			let lineTo = scaleX.ori == 0 ? lineToH : lineToV;

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			// data edges
			let lftIdx = nonNullIdx(dataY, idx0, idx1,  1 * dir);
			let rgtIdx = nonNullIdx(dataY, idx0, idx1, -1 * dir);
			let lftX   =  pixelForX(dataX[lftIdx]);
			let rgtX   =  pixelForX(dataX[rgtIdx]);

			let hasGap = false;

            let sampleSize = u.bbox.width;

            let [ dataX2, dataY2 ] = lttb([dataX, dataY], sampleSize);

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let x = pixelForX(dataX2[i]);
				let y = pixelForY(dataY2[i]);
                lineTo(stroke, x, y);
			}

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillToVal = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillToVal);

				lineTo(fill, rgtX, fillToY);
				lineTo(fill, lftX, fillToY);
			}

			if (!series.spanGaps) {
			//	console.time('gaps');
				let gaps = [];

				hasGap && gaps.push(...findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps));

			//	console.timeEnd('gaps');

			//	console.log('gaps', JSON.stringify(gaps));

				_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
			}

			if (bandClipDir != 0) {
				_paths.band = bandClipDir == 2 ? [
					clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
					clipBandLine(u, seriesIdx, idx0, idx1, stroke,  1),
				] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
			}

			return _paths;
		});
	};
}