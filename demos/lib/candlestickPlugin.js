// Ported from Grafana: https://github.com/grafana/grafana/blob/main/public/app/plugins/panel/candlestick/utils.ts
export function candlestickPlugin({
	fields,
	mode = 'candles+volume',
	candleStyle = 'candles',
	colorStrategy = 'open-close',
	upColor = '#56a64b',
	downColor = '#e02f44',
	flatColor = '#808080',
	volumeAlpha = 0.5,
	flatAsUp = true,
}) {
	const {open: oIdx, high: hIdx, low: lIdx, close: cIdx, volume: vIdx} = fields;
	const priceFields = [oIdx, hIdx, lIdx, cIdx];
	const isYField = idx => Number.isInteger(idx) && idx > 0;
	const renderPrice = mode != 'volume' && priceFields.every(isYField);
	const renderVolume = mode != 'candles' && isYField(vIdx);
	const asCandles = candleStyle == 'candles';
	const closeClose = colorStrategy == 'close-close';
	const colors = [upColor, downColor, flatColor];
	const customFields = [...(renderPrice ? priceFields : []), ...(renderVolume ? [vIdx] : [])];

	function position(u, scale, value) {
		return Number.isFinite(value) && scale != null ? Math.round(u.valToPos(value, scale, true)) : NaN;
	}

	function fillPaths(ctx, paths) {
		for (let i = 0; i < colors.length; i++) {
			ctx.fillStyle = colors[i];
			ctx.fill(paths[i]);
		}
	}

	function draw(u) {
		const drawPrice = renderPrice && u.series[cIdx] != null && u.series[cIdx].show !== false;
		const drawVolume = renderVolume && u.series[vIdx] != null && u.series[vIdx].show !== false;
		if (!drawPrice && !drawVolume)
			return;

		const tData = u.data[0];
		const oData = u.data[oIdx];
		const cData = u.data[cIdx];
		const hData = drawPrice ? u.data[hIdx] : null;
		const lData = drawPrice ? u.data[lIdx] : null;
		const vData = drawVolume ? u.data[vIdx] : null;
		const [idx0, idx1] = u.series[0].idxs ?? [];
		if (tData == null || oData == null || cData == null || idx0 == null || idx1 == null || idx0 > idx1)
			return;

		const {left, top, width, height} = u.bbox;
		const xScale = u.series[0].scale;
		const oScale = u.series[oIdx]?.scale;
		const hScale = u.series[hIdx]?.scale;
		const lScale = u.series[lIdx]?.scale;
		const cScale = u.series[cIdx]?.scale;
		const vScale = u.series[vIdx]?.scale;
		let colWidth = width;
		let prevIdx = null;
		let minDelta = Infinity;

		// Scan the full dataset, as in the source; X must use a linear time scale.
		for (let i = 0; i < tData.length; i++) {
			if (oData[i] === undefined || !Number.isFinite(tData[i]))
				continue;

			if (prevIdx != null) {
				const delta = Math.abs(tData[i] - tData[prevIdx]);
				if (delta < minDelta) {
					minDelta = delta;
					colWidth = Math.abs(u.valToPos(tData[i], xScale, true) - u.valToPos(tData[prevIdx], xScale, true));
				}
			}
			prevIdx = i;
		}

		if (!Number.isFinite(colWidth))
			return;

		const barWidth = Math.max(1, Math.round(0.6 * colWidth));
		const stickWidth = barWidth <= 12 ? 1 : 2;
		const outlineWidth = stickWidth;
		const halfWidth = Math.floor(barWidth / 2);
		const pricePaths = drawPrice ? colors.map(() => new Path2D()) : null;
		const volumePaths = drawVolume ? colors.map(() => new Path2D()) : null;
		const zeroPx = drawVolume ? position(u, vScale, 0) : NaN;

		for (let i = idx0; i <= idx1; i++) {
			const open = oData[i];
			const close = cData[i];
			if (!Number.isFinite(open) || !Number.isFinite(close))
				continue;

			const tPx = position(u, xScale, tData[i]);
			if (!Number.isFinite(tPx))
				continue;

			const dir = closeClose
				? (Number.isFinite(cData[i - 1]) ? close - cData[i - 1] : NaN)
				: close - open;
			const pathIdx = dir > 0 ? 0 : dir < 0 ? 1 : flatAsUp && dir == 0 ? 0 : 2;
			const barLeft = tPx - halfWidth;

			if (drawVolume) {
				const vPx = position(u, vScale, vData?.[i]);
				const volumeHeight = zeroPx - vPx;
				if (Number.isFinite(vPx) && Number.isFinite(volumeHeight))
					volumePaths[pathIdx].rect(barLeft, vPx, barWidth, volumeHeight);
			}

			if (drawPrice) {
				const oPx = position(u, oScale, open);
				const cPx = position(u, cScale, close);
				const hPx = position(u, hScale, hData?.[i]);
				const lPx = position(u, lScale, lData?.[i]);
				const bodyTop = Math.min(oPx, cPx);
				const bodyHeight = Math.max(1, Math.abs(cPx - oPx));
				const stickHeight = lPx - hPx;

				if (
					!Number.isFinite(oPx) || !Number.isFinite(cPx) ||
					!Number.isFinite(hPx) || !Number.isFinite(lPx) ||
					!Number.isFinite(bodyHeight) || !Number.isFinite(stickHeight)
				)
					continue;

				const outerPath = pricePaths[pathIdx];
				const stickLeft = tPx - Math.floor(stickWidth / 2);
				const hollow = asCandles && closeClose && close >= open && barWidth > 2 * outlineWidth && bodyHeight > 2 * outlineWidth;
				if (hollow) {
					outerPath.rect(stickLeft, hPx, stickWidth, bodyTop - hPx);
					outerPath.rect(stickLeft, bodyTop + bodyHeight, stickWidth, lPx - bodyTop - bodyHeight);
				}
				else
					outerPath.rect(stickLeft, hPx, stickWidth, stickHeight);

				if (asCandles) {
					outerPath.rect(barLeft, bodyTop, barWidth, bodyHeight);
					// Opposite winding leaves a hole without erasing the grid or volume beneath it.
					if (hollow)
						outerPath.rect(barLeft + outlineWidth, bodyTop + bodyHeight - outlineWidth, barWidth - 2 * outlineWidth, 2 * outlineWidth - bodyHeight);
				}
				else {
					outerPath.rect(barLeft, oPx, halfWidth, stickWidth);
					outerPath.rect(tPx, cPx, halfWidth, stickWidth);
				}
			}
		}

		const ctx = u.ctx;
		const clip = new Path2D();
		clip.rect(left, top, width, height);
		ctx.save();
		ctx.clip(clip);
		if (drawVolume) {
			ctx.globalAlpha = volumeAlpha;
			fillPaths(ctx, volumePaths);
		}
		if (drawPrice) {
			ctx.globalAlpha = 1;
			fillPaths(ctx, pricePaths);
		}
		ctx.restore();
	}

	return {
		opts(u, opts) {
			for (const idx of customFields) {
				const series = opts.series[idx];
				if (series != null) {
					series.paths = () => null;
					series.points = {...series.points, show: false};
				}
			}
		},
		hooks: {drawAxes: draw},
	};
}
