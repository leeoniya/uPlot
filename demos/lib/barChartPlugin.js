/*
TODO:
  min width control
  value rendering

  legend toggles for points, not just series
  tooltip? w/metadata?
*/

import uPlot from '../../src/uPlot.js';
import { createBarHover } from './barHover.js';
import { distr, SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY } from './distr.js';

// One instance per chart: category X axis, numeric Y axis, and bar paths.
export function barChartPlugin({
	orientation = 'vertical',
	distribution = SPACE_AROUND,
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
	let justify;
	let groupWidth;
	let paths;
	let stackGroups = [];
	const barOffsets = [];
	// Bar paths read only size[0]; every distributed slot has the same width.
	const barWidth = [0];
	const hover = createBarHover();

	function xRange(u) {
		const count = u.data[0].length;
		if (count == 0)
			return [-.5, .5];
		if (count == 1 && justify != SPACE_BETWEEN)
			return [-1, 1];

		const max = Math.max(1, count - 1);
		let firstCenter;
		distr(count, groupWidth, justify, 0, (_, off, size) => {
			firstCenter = off + size / 2;
		});
		if (firstCenter == .5)
			return [-max, max];

		// Match the first ordinal tick to the center of the first distributed group.
		const offset = (max / (1 - firstCenter * 2) - max) / 2;
		return [-offset, max + offset];
	}

	function distributeBars(u) {
		const count = u.data[0].length;
		const groups = new Map();
		barOffsets.length = u.series.length;
		barOffsets.fill(null);
		barWidth[0] = 0;
		for (let si = 1; si < u.series.length; si++) {
			const series = u.series[si];
			if (!series.show || series.paths != paths)
				continue;
			const group = stackGroups.find(group => group.series.includes(si)) ?? series;
			let offsets = groups.get(group);
			if (offsets == null) {
				offsets = Array(count);
				groups.set(group, offsets);
			}
			barOffsets[si] = offsets;
		}
		const slots = [...groups.values()];
		if (slots.length == 0)
			return;
		distr(count, groupWidth, justify, null, (di, groupOff, groupSize) => {
			const size = barWidth[0] = groupSize / slots.length;
			for (let slot = 0; slot < slots.length; slot++)
				slots[slot][di] = groupOff + size * slot;
		});
	}

	function refreshDistribution() {
		if (plot != null) {
			plot.setScale('x', { min: null, max: null });
			// Width can change without changing the range, especially with SPACE_AROUND.
			plot.redraw(true, true);
		}
	}

	function setDistribution(value) {
		if (![SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY].includes(value))
			throw new RangeError('Distribution must be SPACE_BETWEEN, SPACE_AROUND, or SPACE_EVENLY.');
		if (justify != value) {
			justify = value;
			refreshDistribution();
		}
	}

	function setGroupWidth(fraction) {
		if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
			throw new RangeError('Group width must be greater than 0 and at most 1.');
		if (groupWidth != fraction) {
			groupWidth = fraction;
			refreshDistribution();
		}
	}

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
		// Rotated labels use a middle baseline.
		const height = rotation == 0 ? labelHeight : width * Math.sin(radians) + labelHeight / 2 * Math.cos(radians);

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
		const angled = !horizontal && rotation != 0;
		const radians = Math.abs(rotation) * Math.PI / 180;
		const left = angled ? (rotation > 0 ? Math.cos(radians) : 0) : .5;
		const right = angled ? (rotation < 0 ? Math.cos(radians) : 0) : .5;
		const labelOffset = angled ? axis.font[1] / u.pxRatio / 2 * Math.sin(radians) : 0;
		const leftPad = Math.max(inset, Math.ceil(inset + width * left + labelOffset - axisSpace[3]));
		const rightPad = Math.max(inset, Math.ceil(inset + width * right + labelOffset - axisSpace[1]));
		// Credit each label's distance from the edge without depending on the previous plot width.
		const minWidth = Math.max(0, u.width - axisSpace[3] - axisSpace[1] - leftPad - rightPad);
		const factor = side == 3 ? left : right;
		const scale = u.scales[axis.scale];
		let pad = inset;
		for (let i = 0; i < widths.length; i++) {
			// Use the expanded range, not an assumed half-category inset.
			let fraction = ((horizontal ? axis._splits[i] : i) - scale.min) / (scale.max - scale.min);
			if (scale.dir == -1)
				fraction = 1 - fraction;
			if (side == 1)
				fraction = 1 - fraction;
			const extent = widths[i] * factor + labelOffset;
			pad = Math.max(pad, inset + extent - axisSpace[side] - fraction * minWidth);
		}
		return Math.ceil(pad);
	}

	setDistribution(distribution);
	setGroupWidth(bars.size?.[0] ?? .6);
	setLabelRotation(labelRotation);
	setLabelTruncation(maxLabelLength, ellipsis);

	return {
		_controls: {
			setDistribution,
			setGroupWidth,
			setLabelRotation,
			setLabelTruncation,
			getLabelMetrics: () => ({ label: measured[0]?.label ?? '', width: measured[0]?.width ?? 0 }),
		},
		opts(u, opts) {
			opts.padding = [inset, padding, inset, padding];
			opts.cursor = uPlot.assign({}, { points: { fill: 'rgba(255,255,255,0.3)' } }, opts.cursor, {
				x: false,
				y: false,
				drag: { setScale: false },
				dataIdx: hover.dataIdx,
				points: { bbox: hover.bbox },
			});
			opts.scales ??= {};
			opts.scales.x = {
				...opts.scales.x,
				time: false, distr: 2, ori: horizontal ? 1 : 0, dir: horizontal ? -1 : 1,
				range: xRange,
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
			stackGroups = opts.stack?.groups ?? [];
			paths = uPlot.paths.bars({
				...bars,
				disp: {
					x0: { unit: 2, values: (u, si) => barOffsets[si] },
					size: { unit: 2, values: () => barWidth },
					...bars.disp,
				},
				each: hover.each,
			});
			for (const series of opts.series.slice(1)) {
				series.paths = paths;
				series.width ??= 0;
				series.fill ??= series.stroke ?? 'royalblue';
				series.points = { ...series.points, show: false };
			}
		},
		hooks: {
			init: u => {
				plot = u;
				hover.init(u);
				for (const el of u.over.querySelectorAll('.u-cursor-pt'))
					el.style.borderRadius = 'unset';
			},
			setData: refreshLabels,
			drawClear: u => {
				distributeBars(u);
				hover.reset(u, paths);
			},
			draw: hover.draw,
			destroy: () => {
				hover.destroy();
				plot = null;
				fullLabels = labels = splits = [];
				barOffsets.length = 0;
				measured.length = 0;
				measureContexts.clear();
			},
		},
	};
}
