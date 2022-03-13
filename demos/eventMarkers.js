function eventMarkers(opts) {
	opts = opts || {};

	let labels = [];
	let textFill = "black";
	let rectFill = "white";
	let rectStroke = "black";

	let showLabels = opts.showLabels == null ? true: opts.showLabels;
	let labelsAlign = opts.labelsAlign == null ? "top" : opts.labelsAlign;

	function drawPathLabels(u, seriesIdx) {
		let rectPadding = 7;

		let s = u.series[seriesIdx];

		textFill = s._stroke == null ? textFill : s._stroke;
		rectFill = s._fill == null ? rectFill : s._fill;
		rectStroke = s._stroke == null ? rectStroke : s._stroke;

		u.ctx.fillStyle = textFill;
		u.ctx.textAlign = "center";
		u.ctx.textBaseline = "center";

		labels.forEach((label) => {
			let text = u.ctx.measureText(label.text);
	
			let textWidth = text.width;
			let textHeight = text.actualBoundingBoxDescent + text.actualBoundingBoxAscent;
	
			let rectWidth = textWidth + (rectPadding * 2);
			let rectHeight = textHeight + (rectPadding * 2);
	
			let yOffAlign = text.actualBoundingBoxAscent + rectPadding;
	
			if (label.align == "center")
			{
				yOffAlign = rectHeight;
			}
			else if (label.align == "bottom")
			{
				yOffAlign = -(text.actualBoundingBoxDescent + rectPadding);
			}
	
			let textCenterX = label.x;
			let textCenterY = label.y + yOffAlign;
	
			let rectTop = textCenterX - (rectWidth / 2);
			let rectLeft = textCenterY - (rectHeight / 2);
	
			u.ctx.fillStyle = rectFill;
			u.ctx.strokeStyle = rectStroke;
	
			u.ctx.fillRect(rectTop, rectLeft, rectWidth, rectHeight);
			u.ctx.strokeRect(rectTop, rectLeft, rectWidth, rectHeight);
	
			u.ctx.fillStyle = textFill;
			u.ctx.fillText(label.text, textCenterX, textCenterY);
		});
	}
	
	return (u, seriesIdx, idx0, idx1) => {
		return uPlot.orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			
			labels = [];
	
			let pxRound = series.pxRound;
			const _paths = {stroke: new Path2D(), fill: null, text: drawPathLabels, clip: null, band: null, gaps: null, flags: uPlot.BAND_CLIP_FILL};
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
					labels.push(labelElement);
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