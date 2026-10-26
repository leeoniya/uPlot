/*
TODO:
  min width control

  legend toggles for points, not just series
  tooltip? w/metadata?
*/

import uPlot from '../../src/uPlot.js';
import { createBarHover } from './barHover.js';
import { createBarValues } from './barValues.js';
import { distr, SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY } from './distr.js';

// One instance per chart: category X axis, numeric Y axis, and bar paths.
export function barChartPlugin({
	orientation = 'vertical',
	distribution = SPACE_AROUND,
	barDistribution = SPACE_AROUND,
	barWidth: initialBarWidth = 1,
	groupSeries = [],
	ignore = [],
	showValues = false,
	hoverMode = 'bar',
	labelRotation = 0,
	minLabelSpacing = 0,
	maxLabelLength = null,
	ellipsis = 'end',
	inset = 8,
	bars = {},
} = {}) {
	if (orientation != 'vertical' && orientation != 'horizontal')
		throw new RangeError('Orientation must be vertical or horizontal.');
	if (bars.disp != null && (typeof bars.disp != 'object' || Array.isArray(bars.disp) || Object.keys(bars.disp).some(key => key != 'fill' && key != 'stroke')))
		throw new TypeError('Only bar fill and stroke display options are supported.');
	if (!Array.isArray(ignore))
		throw new TypeError('Ignored series must be an array of trailing series indices.');
	if (!Array.isArray(groupSeries))
		throw new TypeError('Group series must be an array of series indices.');
	const fullGroupSeries = new Set(groupSeries);
	if (fullGroupSeries.size != groupSeries.length)
		throw new RangeError('Group series indices must be unique.');
	const horizontal = orientation == 'horizontal';
	let plot = null;
	let rotation = 0;
	let labelSpacing = 0;
	let limit = null;
	let placement = 'end';
	let justify;
	let groupWidth;
	let barJustify;
	let barWidthFactor;
	let firstGroupCenter = 0;
	let groupStep = 0;
	let paths;
	let groupPaths;
	let seriesEnd;
	const groupOffsets = [];
	let groupSize = 0;
	const groupForSeries = [];
	const barOffsets = [];
	let barWidth = 0;
	const hover = createBarHover(horizontal, ignore.length);
	hover.setMode(hoverMode);
	const values = createBarValues(horizontal);
	let valuesShown = false;

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
		const groups = [];
		const slots = [];
		barOffsets.length = u.series.length;
		barOffsets.fill(null);
		barWidth = groupSize = 0;
		groupOffsets.length = count;
		firstGroupCenter = groupStep = 0;
		for (let si = 1; si < seriesEnd; si++) {
			const series = u.series[si];
			if (!series.show || series.paths != paths)
				continue;
			const group = groupForSeries[si];
			let offsets = groups[group];
			if (offsets == null) {
				offsets = groups[group] = Array(count);
				slots.push(offsets);
			}
			barOffsets[si] = offsets;
		}

		distr(count, groupWidth, justify, null, (di, groupOff, size) => {
			groupOffsets[di] = groupOff;
			groupSize = size;
			const center = groupOff + size / 2;
			if (di == 0)
				firstGroupCenter = center;
			else if (di == count - 1)
				groupStep = (center - firstGroupCenter) / (count - 1);
		});

		if (count > 0 && slots.length > 0) {
			const size = groupSize;
			distr(slots.length, barWidthFactor, barJustify, null, (slot, off, width) => {
				barWidth = size * width;
				const offsets = slots[slot];
				const offset = size * off;
				for (let di = 0; di < count; di++)
					offsets[di] = groupOffsets[di] + offset;
			});
		}
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

	function setBarDistribution(value) {
		if (![SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY].includes(value))
			throw new RangeError('Bar distribution must be SPACE_BETWEEN, SPACE_AROUND, or SPACE_EVENLY.');
		if (barJustify != value) {
			barJustify = value;
			plot?.redraw(true);
		}
	}

	function setBarWidth(fraction) {
		if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)
			throw new RangeError('Bar width must be greater than 0 and at most 1.');
		if (barWidthFactor != fraction) {
			barWidthFactor = fraction;
			plot?.redraw(true);
		}
	}

	function setShowValues(show) {
		if (typeof show != 'boolean')
			throw new TypeError('Show values must be a boolean.');
		if (valuesShown != show) {
			valuesShown = show;
			plot?.redraw(false);
		}
	}

	function formatLabel(value) {
		const label = String(value ?? '');
		if (limit == null || label.length <= limit)
			return label;

		const keep = limit - 1;
		const end = Math.floor(keep / 2);
		return placement == 'middle'
			? label.slice(0, keep - end) + '…' + (end > 0 ? label.slice(-end) : '')
			: label.slice(0, keep) + '…';
	}

	function categorySplits(u, axisIdx, min, max, incr) {
		const step = labelSpacing == 0 ? 1 : Math.max(1, Math.ceil(incr));
		const splits = [];
		const last = Math.min(u.data[0].length - 1, Math.floor(max));
		for (let i = Math.ceil(Math.max(0, min) / step) * step; i <= last; i += step)
			splits.push(i);
		return splits;
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

	function setMinLabelSpacing(pixels) {
		if (!Number.isFinite(pixels) || pixels < 0)
			throw new RangeError('Minimum label spacing must be a finite nonnegative number.');
		if (labelSpacing != pixels) {
			labelSpacing = pixels;
			plot?.redraw(false, true);
		}
	}

	function setLabelTruncation(maxLength, position = placement) {
		if (maxLength != null && (!Number.isInteger(maxLength) || maxLength < 1))
			throw new RangeError('Maximum label length must be a positive integer or null.');
		if (position != 'end' && position != 'middle')
			throw new RangeError('Ellipsis position must be end or middle.');
		maxLength ??= null;
		if (limit != maxLength || placement != position) {
			limit = maxLength;
			placement = position;
			plot?.redraw(false, true);
		}
	}

	function getLabelMetrics() {
		const axis = plot?.axes[0];
		let label = '';
		let width = 0;
		for (let i = 0; i < (axis?._labelWidths?.length ?? 0); i++) {
			const labelWidth = axis._labelWidths[i];
			if (labelWidth > width) {
				width = labelWidth;
				label = axis._labelValues[i];
			}
		}
		return { label, width };
	}

	setShowValues(showValues);
	setDistribution(distribution);
	setGroupWidth(bars.size?.[0] ?? .6);
	setBarDistribution(barDistribution);
	setBarWidth(initialBarWidth);
	setLabelRotation(labelRotation);
	setMinLabelSpacing(minLabelSpacing);
	setLabelTruncation(maxLabelLength, ellipsis);

	return {
		_controls: {
			setHoverMode: hover.setMode,
			setShowValues,
			setDistribution,
			setGroupWidth,
			setBarDistribution,
			setBarWidth,
			setLabelRotation,
			setMinLabelSpacing,
			setLabelTruncation,
			getLabelMetrics,
		},
		opts(u, opts) {
			opts.padding = [inset, [inset, Infinity], inset, [inset, Infinity]];
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
			opts.axes ??= [{}, {}];
			const numericScale = opts.axes[1]?.scale ?? 'y';
			opts.scales[numericScale] = {
				axis: 1,
				range: { min: { soft: 0 }, max: { soft: 0 } },
				...opts.scales[numericScale],
				ori: horizontal ? 0 : 1,
			};
			opts.axes[0] = {
				grid: { show: false },
				...opts.axes[0],
				scale: 'x', side: horizontal ? 3 : 2, align: 0, alignTo: 1,
				space: () => Math.max(1, labelSpacing),
				splits: categorySplits,
				values: (u, ticks) => ticks.map(value => formatLabel(value)),
				rotate: () => rotation,
				size: 'auto',
			};
			opts.axes[1] = { ...(horizontal ? { space: 100 } : {}), ...opts.axes[1], scale: numericScale, size: 'auto' };
			if (horizontal)
				Object.assign(opts.axes[1], { side: 2, rotate: 0, align: 0 });
			opts.series ??= [{}, {}];
			seriesEnd = opts.series.length - ignore.length;
			if (seriesEnd < 1)
				throw new RangeError('Ignored series must be trailing value series.');
			for (let i = 0; i < ignore.length; i++) {
				if (ignore[i] !== seriesEnd + i)
					throw new RangeError('Ignored series must be contiguous trailing value series.');
			}
			opts.series[0].value ??= (u, value) => String(value ?? '');
			const stackGroups = opts.stack?.groups ?? [];
			for (const si of fullGroupSeries) {
				if (!Number.isInteger(si) || si < 1 || si >= seriesEnd)
					throw new RangeError('Group series indices must refer to value series.');
			}
			if (fullGroupSeries.size > 0 && stackGroups.length > 0)
				throw new RangeError('Group series require stacking to be off.');
			groupForSeries.length = 0;
			for (let gi = 0; gi < stackGroups.length; gi++) {
				for (const si of stackGroups[gi].series) {
					if (!Number.isInteger(si) || si < 1 || si >= seriesEnd)
						throw new RangeError('Stack groups must refer to bar series.');
					groupForSeries[si] = gi;
				}
			}
			for (let si = 1; si < seriesEnd; si++) {
				if (stackGroups.length == 0)
					groupForSeries[si] = si;
				else if (groupForSeries[si] == null)
					throw new RangeError('Stack groups must include all value series.');
			}
			values.configure(stackGroups, opts.stack?.percent === true, fullGroupSeries);
			const each = (u, si, di, left, top, width, height) => {
				hover.each(u, si, di, left, top, width, height);
				values.each(u, si, di, left, top, width, height);
			};
			paths = uPlot.paths.bars({
				...bars,
				disp: {
					...bars.disp,
					x0: { unit: 2, values: (u, si) => barOffsets[si] },
					size: { kind: 1, unit: 2, values: () => barWidth },
				},
				each,
			});
			if (fullGroupSeries.size > 0) {
				groupPaths = uPlot.paths.bars({
					...bars,
					// Individual bar gaps and width limits must not shrink the group background.
					size: [1, Infinity, 0], gap: 0,
					disp: {
						...bars.disp,
						x0: { unit: 2, values: () => groupOffsets },
						size: { kind: 1, unit: 2, values: () => groupSize },
					},
					each,
				});
			}
			for (let si = 1; si < seriesEnd; si++) {
				const series = opts.series[si];
				const scale = series.scale ?? 'y';
				opts.scales[scale] = { ...opts.scales[scale], ori: horizontal ? 0 : 1 };
				series.paths = fullGroupSeries.has(si) ? groupPaths : paths;
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
			setData: () => values.invalidate(),
			setCursor: hover.update,
			drawClear: u => {
				distributeBars(u);
				hover.reset(u, paths, firstGroupCenter, groupStep, groupPaths);
				values.reset(u, valuesShown);
			},
			draw: u => {
				hover.draw(u);
				values.draw(u);
			},
			destroy: () => {
				hover.destroy();
				values.destroy();
				plot = paths = groupPaths = null;
				fullGroupSeries.clear();
				groupOffsets.length = 0;
				bars = {};
				groupForSeries.length = 0;

				barOffsets.length = 0;

			},
		},
	};
}
