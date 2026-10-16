# Data modes

uPlot supports two data modes. `mode: 1` is the default. `mode: 2` uses per-series facets.

This page describes current behavior. The [faceted-mode migration investigation](investigations/faceted-mode-migration.md) describes proposals, not existing capabilities.

## Comparison

| Behavior | Mode 1: aligned | Mode 2: faceted |
| --- | --- | --- |
| Data shape | `[xs, ys1, ys2, ...]` | `[null, [xs1, ys1, ...], [xs2, ys2, ...], ...]` |
| Series index 0 | Shared X configuration | Placeholder, not a data series |
| X arrays | One shared array | Separate or shared references per series |
| Alignment | All Y arrays align with shared X | Facets align within each series, not across series |
| X ordering | Ascending, unique X values | No general ascending or uniqueness requirement |
| Scale mapping | `series[0].scale` for X, `series[i].scale` for Y | `series[i].facets[j].scale` for each scaled facet |
| Native cursor lookup | Binary search over shared X, then per-series refinement | No built-in nearest-X search |
| Hover indices | Native candidates, with an optional `cursor.dataIdx` override | Application or plugin supplies `cursor.dataIdx` |
| Default drag selection | X only | X and Y |
| Automatic Y scan | Visible shared-X interval | Full participating facets |
| Primary X scale | `series[0].scale` | `series[1].facets[0].scale` |

A shared array reference or `sorted: 1` declaration does not enable mode-1 cursor or visible-window behavior in mode 2.

## Data shape and configuration

### Mode 1: aligned columns

```js
const data = [
	[10, 20, 30],
	[ 2,  5,  4],
	[ 7, null, 9],
];

const opts = {
	mode: 1,
	width: 800,
	height: 400,
	scales: {
		x: { time: false },
		y: {},
	},
	series: [
		{ scale: 'x' },
		{ scale: 'y', label: 'A', stroke: 'red' },
		{ scale: 'y', label: 'B', stroke: 'blue' },
	],
};
```

`data[0]` contains the shared X values. Each subsequent array contains one series' Y values at those same indices. Missing samples use `null` to retain alignment.

All arrays have the same length. Empty and single-point datasets are supported.

The first series entry configures shared X. It is not an ordinary Y series.

### Mode 2: per-series facets

```js
const data = [
	null,
	[[30, 10, 20], [4, 2, 5]],
	[[15, 25], [7, 9]],
];

const opts = {
	mode: 2,
	width: 800,
	height: 400,
	scales: {
		x: { time: false },
		y: {},
	},
	// This example omits interactive lookup.
	cursor: { show: false },
	series: [
		{},
		{
			label: 'A',
			stroke: 'red',
			paths: () => null,
			points: { show: true },
			facets: [{ scale: 'x', sorted: 0 }, { scale: 'y', sorted: 0 }],
		},
		{
			label: 'B',
			stroke: 'blue',
			paths: () => null,
			points: { show: true },
			facets: [{ scale: 'x', sorted: 1 }, { scale: 'y', sorted: 0 }],
		},
	],
};
```

`data[0]` is a placeholder. Each subsequent entry contains the facet arrays for the matching series. `series[0]` is also a placeholder.

Within a series, corresponding facet indices describe the same observation. Different series can have different lengths and unrelated X values. They do not need a union of X values or cross-series null padding.

Series can reuse the same X array reference. This does not currently trigger shared cursor searches or shared visible-window calculations.

## Facets and ordering

The default mode-2 positional facets are:

- Facet 0: X, mapped to scale `x`.
- Facet 1: Y, mapped to scale `y`.

`series[i].facets[j]` configures `data[i][j]`. The facet's `scale` selects its scale. Both the series and the facet must participate in a built-in scan for that facet to contribute.

Mode 2 uses facet scale mappings for positional data, rather than a single `series.scale` mapping. An explicit `facets` array replaces the default array. It must include the required X and Y entries.

Additional arrays can contain bounds or metadata for custom drawing. Additional configured facets can contribute to scale extrema. Extra arrays do not automatically acquire drawing or hover behavior.

For example, the heatmap plugin uses:

```js
// Data for one series:
[xMax, yMin, yMax, count]

// Configured scale facets:
[
	{ scale: 'x', sorted: 1 },
	{ scale: 'y' },
	{ scale: 'y' },
]
```

Both Y-bound arrays contribute to Y scans. The count array supplies color data to the plugin, not an automatic positional facet.

Facet ordering declarations are:

| `sorted` | Meaning |
| --- | --- |
| `0` | Unordered |
| `1` | Ascending |
| `-1` | Descending |

Mode-2 default facets use `sorted: 0`. The declaration can optimize extrema scans. It does not sort the data, enable native cursor search, or create visible-window Y scans.

Mode 2 accepts unordered and repeated X values. A chosen path builder or plugin can impose stricter requirements. For example, the heatmap plugin requires ascending X runs and ascending Y cells within each run.

Explicit scale declarations belong in `opts.scales`, including custom scales referenced by facets. The default X scale is temporal. Numeric X data uses `time: false`, as in the examples.

## Cursor and hover

Mode 1 calculates a shared nearest-X candidate with binary search. Its default refiner handles missing values, proximity, and bias separately for each series.

Mode 2 does not calculate that candidate. Applications that need hover selection supply `cursor.dataIdx`, typically through a plugin or an external spatial index.

A mode-2 callback returns an index into that series' facet arrays, or `null` for no hit. Its result can drive cursor markers and live legend values. Thus, mode 2 does not disable hover indices themselves. It delegates their calculation.

`cursor.idxs` stores per-series lookup results. `cursor.idx` is not a native shared nearest-X result in mode 2. A mode-2 callback cannot assume that its `closestIdx` and `xValue` arguments contain the mode-1 candidate.

The callback can derive coordinates from the cursor position and the relevant scales. Specialized shapes can also supply custom cursor-marker bounds and legend content.

Core does not build a spatial index automatically. `valToIdx()` and `posToIdx()` retain shared-X assumptions and are not general mode-2 facet lookup helpers.

## Selection and zoom

The default drag configuration differs:

```js
// Mode 1 default:
cursor: { drag: { x: true, y: false } }

// Mode 2 default:
cursor: { drag: { x: true, y: true } }
```

Explicit `cursor.drag` configuration overrides these defaults. Mode 2 can use X-only selection without changing its data representation or cursor lookup.

Selection directions do not define positional scale pairs or reciprocal automatic range dependencies.

## Automatic ranging

### Mode 1

The primary X scale establishes a visible interval in the shared X array. Built-in automatic Y scans use that interval for participating series.

An X-only zoom can therefore change Y bounds as observations enter or leave the visible interval. Explicit Y bounds, scan configuration, and range policies can override automatic behavior.

### Mode 2

Built-in scans aggregate extrema across full participating facets mapped to a scale. They do not restrict Y observations to the displayed X window.

A primary-X update can still schedule automatic Y recalculation. Since the scan uses full facets, unchanged data usually produces unchanged Y bounds. A custom scanner or range callback can produce different behavior.

Independent X scales do not establish per-series range dependencies automatically. There is no built-in reciprocal policy that fits X to a selected Y interval.

`scale.scan: false` disables automatic range scans. It also disables default adaptive asinh threshold scans. An explicit threshold, custom scanner, or range callback remains available.

### Axis-aware ranging is separate

The experimental `scale.axis` support in this source tree selects display bounds and ticks together for eligible linear numeric scales. It supports both modes, including numeric X in mode 2.

It does not change which observations contribute to the extrema. A mode-2 chart can supply plugin-prepared bounds through a custom scanner and reuse the shared layout calculation.

`scale.axis` links a scale to an axis. It does not pair X and Y scales or enable visible-window data selection.

## X-facet specialness

Mode 2 is faceted, but its positional machinery is not symmetric across all facets:

- Facet 0 supplies X coordinates to standard positional paths.
- Facet 1 supplies the primary Y coordinates to standard paths and cursor markers.
- The first data series' facet 0 selects the chart's primary X scale.
- The primary X scale participates in reset, redraw, orientation, and automatic-scale scheduling.
- Additional facets do not receive those primary-coordinate roles automatically.

Multiple series can use different X arrays and scale mappings. This does not remove the primary-X role or create independent positional pairs with automatic range dependencies.

## Examples and related design work

- [Heatmap cells demo](../demos/heatmap-cells.html): additional Y bounds, sparse cells, and custom hover lookup.
- [Heatmap plugin](../demos/lib/heatmapPlugin.js): custom preparation, drawing, and cell hit testing.
- [Faceted-mode migration investigation](investigations/faceted-mode-migration.md): proposed native ordered-X hover, shared groups, and directional range dependencies.
