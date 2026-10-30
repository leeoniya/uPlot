// Compile-only consumer fixture; see docs/investigations/legend-selection.md.
import uPlot from '../dist/uPlot.js';

declare const u: uPlot;
let offset = 0;

const legend: uPlot.Legend = {
	mode: 'table',
	valueSrc: 'values',
	side: 1,
	filter: (self, si) => self.series[si].show !== false && (self.cursor.dists?.[si] ?? Infinity) <= 5,
	sort: (self, a, b) => (self.cursor.dists?.[a] ?? Infinity) - (self.cursor.dists?.[b] ?? Infinity),
	limit: (self, indices) => {
		const filtered: readonly number[] = indices;
		// @ts-expect-error Selection inputs are borrowed, readonly buffers.
		indices.sort();
		return [offset, Math.min(offset + 20, filtered.length)] as const;
	},
};

const opts: uPlot.Options = {
	width: 400,
	height: 300,
	series: [{}, {}],
	legend,
	tooltip: {
		show: true,
		gap: 5,
		mode: 'table',
		valueSrc: 'value',
		filter: (self, si) => self.tooltip.idxs?.[si] != null,
		sort: (self, a, b) => b - a,
		limit: (self, indices) => [0, Math.min(5, indices.length)],
		mount: (self, el) => el.classList.add('tooltip'),
	},
	cursor: { trackDists: true },
};

const order: readonly number[] | undefined = u.legend.order;
const count: number | undefined = u.legend.count;
const range: readonly [number, number] | undefined = u.legend.range;
const distances: readonly number[] | null | undefined = u.cursor.dists;

if (order) {
	// @ts-expect-error Selection order is readonly.
	order.push(2);
}
if (range) {
	// @ts-expect-error Effective bounds are readonly.
	range[0] = 0;
}
if (distances) {
	// @ts-expect-error Distances are readonly to consumers.
	distances[1] = 0;
}

// @ts-expect-error Layout mode must be inline, table, or null.
const invalidMode: uPlot.Legend = { mode: 'grid' };
// @ts-expect-error Formatter source must be value or values.
const invalidValueSrc: uPlot.Legend = { valueSrc: 'auto' };
// @ts-expect-error Tooltip uses the same formatter sources as Legend.
const invalidTooltipValueSrc: uPlot.Tooltip = { valueSrc: 'stats' };
// @ts-expect-error Side uses the four numeric axis sides.
const invalidSide: uPlot.Legend = { side: 4 };

// @ts-expect-error A filter must return a boolean.
const invalidFilter: uPlot.Legend = { filter: () => 1 };
// @ts-expect-error A comparator must return a number.
const invalidSort: uPlot.Legend = { sort: () => true };
// @ts-expect-error A limit returns a range, not a count.
const invalidLimit: uPlot.Legend = { limit: () => 10 };
// @ts-expect-error A limit returns two numeric boundaries.
const invalidBounds: uPlot.Legend = { limit: () => ['0', '10'] };

const tooltip: uPlot.Tooltip = u.tooltip;
const tooltipOrder: readonly number[] | undefined = tooltip.order;
// @ts-expect-error The tooltip is always live and has no independent live option.
const invalidTooltipLive: uPlot.Tooltip = { live: false };
// @ts-expect-error The tooltip has no outside-plot side.
const invalidTooltipSide: uPlot.Tooltip = { side: 2 };

u.setLegend({});
u.setLegend({ idx: null }, false);
u.setLegend({ idxs: [0, null, 2] });
