/*
TODO:
  grouped, multi-series (walk2)
  stacked, percent stacked
  bar width control, min width
  value rendering
  flatbush hover
  legend toggles for points, not just series
  tooltip? w/metadata?
*/

import uPlot from '../../src/uPlot.js';

// One instance per chart: category X axis, numeric Y axis, and bar paths.
export function barChartPlugin({
	orientation = 'vertical',
	labelRotation = 0,
	maxLabelLength = null,
	ellipsis = 'end',
	inset = 8,
	bars = {},
} = {}) {
	if (orientation != 'vertical' && orientation != 'horizontal')
		throw new RangeError('Orientation must be vertical or horizontal.');
	const horizontal = orientation == 'horizontal';
	let plot = null;
	let fullLabels = [];
	let labels = [];
	let splits = [];
	let rotation = 0;
	let limit = null;
	let placement = 'end';
	const measured = [];
	const measureContexts = new Map();
	let leftFactor = .5;
	let rightFactor = .5;
	let labelOffset = 0;

	function formatLabels() {
		return fullLabels.map(label => {
			if (limit == null || label.length <= limit)
				return label;

			const keep = limit - 1;
			const end = Math.floor(keep / 2);
			return placement == 'middle'
				? label.slice(0, keep - end) + '…' + (end > 0 ? label.slice(-end) : '')
				: label.slice(0, keep) + '…';
		});
	}

	function refreshLabels(u) {
		const xs = u.data[0];
		fullLabels = xs.map(value => String(value ?? ''));
		splits = xs.map((_, i) => i);
		labels = formatLabels();
	}

	function setLabelRotation(degrees) {
		if (!Number.isFinite(degrees) || degrees < -90 || degrees > 90)
			throw new RangeError('Label rotation must be between -90 and 90 degrees.');
		if (horizontal && degrees != 0)
			throw new RangeError('Horizontal bars do not support label rotation.');
		if (rotation != degrees) {
			rotation = degrees;
			plot?.redraw(false, true);
		}
	}

	function setLabelTruncation(maxLength, position = placement) {
		if (maxLength != null && (!Number.isInteger(maxLength) || maxLength < 1))
			throw new RangeError('Maximum label length must be a positive integer or null.');
		if (position != 'end' && position != 'middle')
			throw new RangeError('Ellipsis position must be end or middle.');
		limit = maxLength;
		placement = position;
		const next = formatLabels();
		if (next.length != labels.length || next.some((label, i) => label != labels[i])) {
			labels = next;
			plot?.redraw(false, true);
		}
	}

	function measureLabels(u, axisIdx, values) {
		const axis = u.axes[axisIdx];
		let cache = measured[axisIdx];
		if (cache == null || cache.font != axis.font[0] || cache.pxRatio != u.pxRatio ||
			cache.values.length != values.length || values.some((value, i) => value != cache.values[i])) {
			cache = { font: axis.font[0], pxRatio: u.pxRatio, values: values.slice(), widths: [], width: 0, label: '' };
			let ctx = measureContexts.get(cache.font);
			if (ctx == null) {
				ctx = new OffscreenCanvas(1, 1).getContext('2d');
				ctx.font = cache.font;
				measureContexts.set(cache.font, ctx);
			}
			for (const value of values) {
				const width = value == null ? 0 : ctx.measureText(String(value)).width / u.pxRatio;
				cache.widths.push(width);
				if (width > cache.width) {
					cache.width = width;
					cache.label = value;
				}
			}
			measured[axisIdx] = cache;
		}
		return cache;
	}

	function xAxisSize(u, values, axisIdx) {
		const axis = u.axes[axisIdx];
		// Horizontal size runs before ticks; its formatted labels are already known.
		const { width } = measureLabels(u, axisIdx, labels);
		if (horizontal)
			return Math.ceil((axis.ticks.show ? axis.ticks.size : 0) + axis.gap + width + inset);
		const labelHeight = axis.font[1] / u.pxRatio;
		const radians = Math.abs(rotation) * Math.PI / 180;
		const sin = Math.sin(radians);
		const cos = Math.cos(radians);
		let height;

		if (rotation == 0) {
			leftFactor = rightFactor = .5;
			labelOffset = 0;
			height = labelHeight;
		}
		else {
			// Rotated labels use a middle baseline and align toward the tick.
			labelOffset = labelHeight / 2 * sin;
			leftFactor = rotation > 0 ? cos : 0;
			rightFactor = rotation < 0 ? cos : 0;
			height = width * sin + labelHeight / 2 * cos;
		}

		return Math.ceil((axis.ticks.show ? axis.ticks.size : 0) + axis.gap + height + inset);
	}

	function yAxisSize(u, values, axisIdx) {
		const axis = u.axes[axisIdx];
		const size = horizontal ? axis.font[1] / u.pxRatio : measureLabels(u, axisIdx, values).width;
		return Math.ceil((axis.ticks.show ? axis.ticks.size : 0) + axis.gap + size + inset);
	}

	function padding(u, side, sidesWithAxes, phase) {
		const axisIdx = horizontal ? 1 : 0;
		const axis = u.axes[axisIdx];
		if (phase == 0 || !axis._show)
			return inset;

		// Horizontal numeric ticks are available only after the category axis has its width.
		const metrics = horizontal ? measureLabels(u, axisIdx, axis._values) : measured[axisIdx];
		if (metrics == null)
			return inset;

		const axisSpace = [0, 0, 0, 0];
		for (const axis of u.axes) {
			if (axis._show)
				axisSpace[axis.side] += Math.max(0, axis._size + (axis.label != null ? axis.labelSize : 0));
		}

		const { width, widths } = metrics;
		const left = horizontal ? .5 : leftFactor;
		const right = horizontal ? .5 : rightFactor;
		const leftPad = Math.max(inset, Math.ceil(inset + width * left + labelOffset - axisSpace[3]));
		const rightPad = Math.max(inset, Math.ceil(inset + width * right + labelOffset - axisSpace[1]));
		// Full overhang padding gives a lower bound on plot width, independent
		// of the final geometry. Credit each label's distance from this edge.
		const minWidth = Math.max(0, u.width - axisSpace[3] - axisSpace[1] - leftPad - rightPad);
		const factor = side == 3 ? left : right;
		const scale = u.scales[axis.scale];
		let pad = inset;
		for (let i = 0; i < widths.length; i++) {
			let fraction = horizontal ? (axis._splits[i] - scale.min) / (scale.max - scale.min) : (i + .5) / widths.length;
			if (horizontal && scale.dir == -1)
				fraction = 1 - fraction;
			if (side == 1)
				fraction = 1 - fraction;
			const extent = widths[i] * factor + labelOffset;
			pad = Math.max(pad, inset + extent - axisSpace[side] - fraction * minWidth);
		}
		return Math.ceil(pad);
	}

	setLabelRotation(labelRotation);
	setLabelTruncation(maxLabelLength, ellipsis);

	return {
		_setLabelRotation: setLabelRotation,
		_setLabelTruncation: setLabelTruncation,
		_getLabelMetrics: () => ({ label: measured[0]?.label ?? '', width: measured[0]?.width ?? 0 }),
		opts(u, opts) {
			opts.padding = [inset, padding, inset, padding];
			opts.cursor = uPlot.assign({}, opts.cursor, { drag: { setScale: false } });
			opts.scales ??= {};
			opts.scales.x = {
				...opts.scales.x,
				time: false, distr: 2, ori: horizontal ? 1 : 0, dir: horizontal ? -1 : 1,
				range: u => [-.5, Math.max(1, u.data[0].length) - .5],
			};
			opts.scales.y = {
				axis: 1,
				range: { min: { soft: 0 }, max: { soft: 0 } },
				...opts.scales.y,
				ori: horizontal ? 0 : 1,
			};
			opts.axes ??= [{}, {}];
			opts.axes[0] = {
				grid: { show: false },
				...opts.axes[0],
				scale: 'x', side: horizontal ? 3 : 2, align: 0, alignTo: 1, space: 1,
				splits: () => splits,
				values: () => labels,
				rotate: () => rotation,
				size: xAxisSize,
			};
			opts.axes[1] = { ...(horizontal ? { space: 100 } : {}), ...opts.axes[1], scale: 'y', size: yAxisSize };
			if (horizontal)
				Object.assign(opts.axes[1], { side: 2, rotate: 0, align: 0 });
			opts.series ??= [{}, {}];
			opts.series[0].value ??= (u, value) => String(value ?? '');
			const paths = uPlot.paths.bars(bars);
			for (const series of opts.series.slice(1)) {
				series.paths = paths;
				series.width ??= 0;
				series.fill ??= series.stroke ?? 'royalblue';
				series.points = { ...series.points, show: false };
			}
		},
		hooks: {
			init: u => { plot = u; },
			setData: refreshLabels,
			destroy: () => {
				plot = null;
				fullLabels = labels = splits = [];
				measured.length = 0;
				measureContexts.clear();
			},
		},
	};
}
