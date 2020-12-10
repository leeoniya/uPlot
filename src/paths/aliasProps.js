const props = Array(11);

export function aliasProps(u, seriesIdx) {
	const series = u.series[seriesIdx];
	const scales = u.scales;
	const bbox   = u.bbox;

	props[0]  = series;						// series
	props[1]  = u._data[0];					// dataX
	props[2]  = u._data[seriesIdx];			// dataY
	props[3]  = scales[u.series[0].scale];	// scaleX
	props[4]  = scales[series.scale];		// scaleY
	props[5]  = u.valToPosX;				// valToPosX
	props[6]  = u.valToPosY;				// valToPosY
	props[7]  = bbox.left;					// plotLft
	props[8]  = bbox.top;					// plotTop
	props[9]  = bbox.width;					// plotWid
	props[10] = bbox.height;				// plotHgt

	return props;
}