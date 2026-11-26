import { PI, abs, ceil, clamp, cos, isArr, max, round, sin } from './utils.js';

const measureContexts = new Map();

function measureContext(font) {
	let ctx = measureContexts.get(font);
	if (ctx == null) {
		let canvas = typeof OffscreenCanvas != 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
		canvas.width = canvas.height = 1;
		ctx = canvas.getContext('2d');
		ctx.font = font;
		// Keep common fonts warm without retaining a canvas for every historical font/DPR.
		if (measureContexts.size == 16)
			measureContexts.delete(measureContexts.keys().next().value);
		measureContexts.set(font, ctx);
	}
	return ctx;
}

function textWidth(ctx, text) {
	if (text.indexOf('\n') == -1)
		return ctx.measureText(text).width;
	let width = 0;
	for (let line of text.split('\n'))
		width = max(width, ctx.measureText(line).width);
	return width;
}

function measureAxisLabels(axis, pxRatio) {
	let values = axis._values;
	let font = axis.font[0];
	// Rotation and tuple padding can request the same measurements in one layout.
	if (axis._labelValues === values && axis._widthFont === font)
		return;

	let texts = axis._labelTexts ??= [];
	let widths = axis._labelWidths ??= [];
	if (axis._widthFont !== font)
		texts.length = 0;

	let byText, ctx;
	for (let i = 0; i < values.length; i++) {
		let text = values[i] == null ? null : '' + values[i];
		if (text === texts[i])
			continue;

		// Index the previous view once, before overwriting its first changed slot.
		if (byText == null) {
			byText = new Map();
			for (let j = 0; j < texts.length; j++)
				byText.set(texts[j], widths[j]);
		}
		let width = byText.get(text);
		if (width == null) {
			width = text == null ? 0 : textWidth(ctx ??= measureContext(font), text) / pxRatio;
			byText.set(text, width);
		}
		texts[i] = text;
		widths[i] = width;
	}
	texts.length = widths.length = values.length;
	axis._widthFont = font;
	axis._labelValues = values;
}

// Keep exact right angles from adding an extra pixel when the result is rounded up.
function rotationCos(rotate) {
	let value = cos(-rotate * PI / 180);
	return rotate % 90 == 0 ? round(value) : value;
}

function rotationSin(rotate) {
	let value = sin(-rotate * PI / 180);
	return rotate % 90 == 0 ? round(value) : value;
}


function labelHeight(axis, height) {
	let lines = -1;
	for (let value of axis._values) {
		if (value != null) {
			if (axis.side == 0)
				return height;
			let text = '' + value;
			let count = 0;
			for (let pos = text.indexOf('\n'); pos != -1; pos = text.indexOf('\n', pos + 1))
				count++;
			lines = max(lines, count);
		}
	}
	return lines < 0 ? 0 : height + lines * height * axis.lineGap;
}

export function autoAxisSize(self, values, axisIdx) {
	let { pxRatio } = self;
	let axis = self.axes[axisIdx];
	let rotate = axis._rotate || 0;
	let vertical = axis.side % 2 == 1;
	let height = axis.font[1] / pxRatio;
	let extent = 0;

	if (vertical || rotate != 0) {
		measureAxisLabels(axis, pxRatio);
		let { _labelValues, _labelWidths } = axis;
		// A blank label has zero width but still reserves height; hidden labels do not.
		let width = -1;
		for (let i = 0; i < _labelWidths.length; i++) {
			if (_labelValues[i] != null)
				width = max(width, _labelWidths[i]);
		}
		if (width >= 0)
			extent = vertical ? width : width * abs(rotationSin(rotate)) + height / 2 * rotationCos(rotate);
	}
	else
		extent = labelHeight(axis, height);

	return (axis.ticks.show ? axis.ticks.size : 0) + axis.gap + extent;
}

function axisOverflow(axis, scale, pxRatio, minWidth, leftBase, rightBase, padding) {
	let { _labelValues, _labelWidths, _splits } = axis;
	let rotate = axis._rotate || 0;
	let cos = rotationCos(rotate);
	let leftFactor = rotate == 0 ? .5 : rotate > 0 ? cos : 0;
	let rightFactor = rotate == 0 ? .5 : rotate < 0 ? cos : 0;
	let heightExtent = axis.font[1] / pxRatio / 2 * abs(rotationSin(rotate));

	for (let i = 0; i < _labelWidths.length; i++) {
		if (_labelValues[i] == null)
			continue;
		let fraction = minWidth > 0 ? scale.valToPct(_splits[i]) : 0;
		if (scale.dir == -1)
			fraction = 1 - fraction;
		let width = _labelWidths[i];
		padding[3] = max(padding[3], leftBase + width * leftFactor + heightExtent - fraction * minWidth);
		padding[1] = max(padding[1], rightBase + width * rightFactor + heightExtent - (1 - fraction) * minWidth);
	}
}

function autoPad(self, padding, leftSize, rightSize, leftMax, rightMax) {
	let { axes, scales, pxRatio, _padding } = self;
	let leftMin = padding[3];
	let rightMin = padding[1];
	let leftBase = leftMin - leftSize;
	let rightBase = rightMin - rightSize;

	for (let axis of axes) {
		if (axis._show && axis.side % 2 == 0) {
			measureAxisLabels(axis, pxRatio);
			axisOverflow(axis, scales[axis.scale], pxRatio, 0, leftBase, rightBase, padding);
		}
	}

	// A lower bound on plot width avoids feedback from previous layouts or newly resolved padding.
	let minWidth = max(0, self.width - leftSize - rightSize - ceil(padding[3]) - ceil(padding[1]));
	padding[3] = leftMin;
	padding[1] = rightMin;

	for (let axis of axes) {
		if (axis._show && axis.side % 2 == 0)
			axisOverflow(axis, scales[axis.scale], pxRatio, minWidth, leftBase, rightBase, padding);
	}
	_padding[3] = clamp(ceil(padding[3]), leftMin, leftMax);
	_padding[1] = clamp(ceil(padding[1]), rightMin, rightMax);
}

export function resolvePadding(self, leftSize, rightSize) {
	let { padding, _padding } = self;
	let left = padding[3];
	let right = padding[1];
	let leftMax = isArr(left) ? left[1] : _padding[3];
	let rightMax = isArr(right) ? right[1] : _padding[1];

	if (leftMax > _padding[3] || rightMax > _padding[1])
		autoPad(self, _padding.slice(), leftSize, rightSize, leftMax, rightMax);
}
