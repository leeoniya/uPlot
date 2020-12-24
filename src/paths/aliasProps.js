export function aliasProps(u, seriesIdx, cb) {
	const series = u.series[seriesIdx];
	const scales = u.scales;
	const bbox   = u.bbox;
	const scaleX = scales[u.series[0].scale];

	let dx = u._data[0],
		dy = u._data[seriesIdx],
		sx = scaleX,
		sy = scales[series.scale],
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
		)
	);
}