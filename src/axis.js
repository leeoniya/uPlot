import { PI, abs, ceil, clamp, cos, isArr, max, round, sin } from './utils.js';

const measureContexts = new Map();

function measureContext(font) {
	let ctx = measureContexts.get(font);
	if (ctx == null) {
		ctx = new OffscreenCanvas(1, 1).getContext('2d');
		ctx.font = font;
		measureContexts.set(font, ctx);
	}
	return ctx;
}

function measureAxisLabels(axis, pxRatio) {
	let values = axis._values;
	let prev = axis._labelValues;
	let same = values === prev || prev != null && values.length == prev.length && values.every((value, i) => value === prev[i]);

	if (!same) {
		let ctx = measureContext(axis.font[0]);
		axis._labelWidths = values.map(value => {
			if (value == null)
				return 0;
			let text = '' + value;
			if (text.indexOf('\n') == -1)
				return ctx.measureText(text).width / pxRatio;
			let width = 0;
			for (let line of text.split('\n'))
				width = max(width, ctx.measureText(line).width);
			return width / pxRatio;
		});
	}

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
