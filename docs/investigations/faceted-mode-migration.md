# Migration to a single faceted data model

Date: 2026-10-16

Status: investigation and proposed direction, not an approved API or an implementation plan.

## Goal

The long-term goal is to retain mode 2 and remove mode 1. Faceted data becomes the general representation. Shared, ordered X data becomes an optimized case within that representation.

During migration, mode 2 needs useful built-in behavior for ordered time series. Users must retain custom spatial lookup for unordered data, heatmaps, and other specialized charts.

The proposed design separates four concerns:

- Data representation and reference sharing.
- Positional relationships between series coordinates.
- Available algorithms, such as binary search over ordered X.
- Interaction and range policies, including the direction of automatic range adjustments.

One global “all series share X” flag cannot represent charts with several shared-X groups or mixed ordered and unordered series.

## Current behavior

These observations refer to the source and local prototypes at the time of this investigation.

| Area | Mode 1 | Mode 2 |
| --- | --- | --- |
| Data | Shared, ordered X array and aligned Y arrays | Per-series facets, with optional reference sharing |
| Default X ordering | Ascending | Facets default to `sorted: 0` |
| Cursor candidate | Binary search over shared X | No built-in nearest-X candidate in `updateCursor()` |
| Hover refinement | Built-in null skipping, proximity, and bias | Specialized charts supply `cursor.dataIdx` |
| Default drag selection | X only | X and Y |
| Y scan after an X change | Visible X interval | Full participating facets |

Mode 2 does revisit automatic Y scales after a change to the primary X scale. It does not restrict those scans to the visible X interval. As a result, unchanged full-data extrema usually produce unchanged Y bounds.

The local tick-aware ranging prototype supports mode-2 linear numeric scales. That work changes the calculation of bounds and ticks, not the selection of data for scans.

Relevant source locations:

- [`src/uPlot.js`](../../src/uPlot.js): `updateCursor()`, default `cursor.dataIdx`, `setScales()`, and `scanScaleInternal()`.
- [`src/opts.js`](../../src/opts.js): `xSeriesOpts`, `xySeriesOpts`, and facet defaults.
- [`dist/uPlot.d.ts`](../../dist/uPlot.d.ts): `Mode`, `Series.Sorted`, cursor indices, and facet declarations.

## Positional relationships and range dependencies

Positional pairing identifies coordinates that belong to the same observations or shapes. A range dependency specifies which selected coordinate window constrains another coordinate's automatic range.

These concepts are distinct. A positional pair does not necessarily need automatic range adjustments in either direction.

### Relationships belong to series

Ordinary XY facets already describe positional pairs:

```text
series A: time ↔ temperature
series B: time ↔ pressure
```

The arrows represent positional relationships, not a direction of automatic range adjustment.

An X-only zoom can select observations within the time window. The temperature and pressure scales can then independently range their contributing values.

A single `pairedWith` property on a scale cannot represent all relationships:

```text
series A: timeA ↔ temperature
series B: timeB ↔ temperature
```

Here, one temperature scale aggregates contributions from two positional pairs. Each contribution must respect its own X window.

The relationship belongs to the series. The aggregate range belongs to the scale.

The proposed default infers ordinary XY relationships from facets. Specialized charts can supply interval or spatial semantics. X and Y describe logical coordinate roles, not fixed screen directions, so rotated charts retain the same relationships.

Count, color, and size facets do not become positional counterparts merely because they occur in the same series.

### Range dependencies have a direction

The following policies describe possible behavior, not proposed configuration names:

| Policy | X-only zoom | Y-only zoom |
| --- | --- | --- |
| Independent | Preserve Y | Preserve X |
| X controls automatic Y | Fit Y to the X window | Preserve X |
| Y controls automatic X | Preserve Y | Fit X to the Y window |
| Reciprocal | Fit Y to the X window | Fit X to the Y window |

X-controlled automatic Y matches common time-series behavior. Reciprocal adjustment can serve scatterplots, but needs a bounded update rule.

The proposed rule permits one propagation step per zoom operation:

1. Apply the explicitly requested bounds.
2. Select contributions within those requested windows.
3. Aggregate eligible contributions for each automatic counterpart scale.
4. Calculate the counterpart ranges without another propagation step.

Automatic adjustments do not become new zoom requests. Otherwise, reciprocal adjustments can repeatedly shrink the selected population.

An explicit XY zoom keeps both requested bounds authoritative. Neither axis replaces the other axis's requested bounds through automatic fitting.

This relationship differs from `scale.from`. A derived scale follows another scale's range. A positional counterpart calculates a range from a selected population.

### Pairing defines semantics, ordering selects the algorithm

| Data | Contribution selection |
| --- | --- |
| Ordered X | Binary-search the X interval, then scan corresponding Y values |
| Shared ordered X | Reuse the interval calculation for the group |
| Unordered X | Filter observations by X, or query an external index |
| Custom shapes | Use the plugin's positional bounds and intersection rules |

A heatmap cell occupies both an X interval and a Y interval. Selection can mean intersection with the X window, rather than containment of `xMax`. Its Y-range contribution includes both Y edges.

Native nearest-X hover does not supply these interval semantics. The plugin needs a way to provide contributions without an unnecessary core scan.

## Proposed optimization unit: an X group

An X group contains series that share all three properties:

1. The same X array reference.
2. The same X scale.
3. The same declared ordering.

For example:

```js
[
	null,
	[xsA, ys1],
	[xsA, ys2],
	[xsB, ys3],
]
```

The first two series share one group, provided their X scales and ordering agree. The third series uses another group.

Each ordered group can share one cursor search and one calculation of its visible index interval. An independently sampled, ordered series can use the same algorithms without shared X references.

Reference sharing reduces work. It does not determine whether native binary-search hover is available.

Group construction needs no comparison of array contents and no copies of numeric data. Equal contents in different arrays remain separate groups. Separate typed-array views also remain separate unless they are the same object.

`setData()`, series addition, and series removal must refresh group membership. In-place data changes retain the existing requirement to notify uPlot. Conflicting ordering declarations must not silently share a search result.

## Cursor lookup and refinement

The current default refiner directly accesses mode-1 arrays:

```js
let xValues = data[0];
let yValues = data[seriesIdx];
```

The proposed refiner receives the relevant X array, Y array, and index window instead. Null skipping, proximity, and bias can then use one implementation for both input forms.

The proposed cursor flow is:

1. Convert the cursor position to an X value for each relevant X scale.
2. Search each ordered X group once.
3. Refine that candidate separately for each series.
4. Update cursor points and legend values.

Explicit `cursor.dataIdx` callbacks retain control. A heatmap with a spatial index must not pay for an unused native search. The exact callback contract for optional native candidates remains open.

`cursor.idxs` becomes the authoritative collection of per-series results. For compatibility, `cursor.idx` can represent the primary group's candidate. It cannot imply a shared index across unrelated groups.

### Ordering and duplicate values

The initial proposal requires explicitly ordered mode-2 X facets. A mode-1 compatibility adapter supplies `sorted: 1` automatically.

A later breaking release can make ascending order the default for X facets, with `sorted: 0` as an explicit unordered declaration. This default remains undecided. Applying it immediately to existing mode-2 charts can silently break scatterplots.

`sorted: -1` needs descending-search support. Descending data order is different from a reversed scale direction.

Ordered X values need not be unique. Duplicate values need a documented tie rule and inclusive window boundaries. A nearest-X candidate does not identify the correct cell among multiple heatmap cells at the same X.

## Visible-window Y ranging

Positional relationships and directional policies determine which contributions affect an automatic range:

```text
Series positional relationships
  + directional range policy
  + explicit zoom request
    → eligible data contributions
    → aggregate extrema per target scale
    → range policy and tick-aware layout
```

Ordered X groups optimize contribution selection for visible-window Y ranging:

```text
Requested X bounds
  → visible index interval per ordered X group
  → participating Y-facet extrema
  → aggregate extrema per Y scale
```

The group structure supports the range dependency. It does not define the dependency or its default behavior.

Cursor lookup and visible-window ranging remain separate features. Native hover must not silently change existing zoom or autoscale behavior.

The first ranging target is the mode-1-equivalent case: shared, ordered X. Independent ordered groups can subsequently use the same per-group path.

Two cache rules are essential:

- Full-data and windowed statistics must have unambiguous cache ownership. An X-window change invalidates the affected Y extrema and `minAbs`, not unrelated groups.
- Path clipping and range scanning need separate intervals. Paths can require neighboring points outside the window without including those points in the Y-range calculation.

A Y scale can combine facets from different X groups. Mixed ordered and unordered contributors need a defined policy. The implementation must not silently combine visible-window extrema with full-data extrema under an unclear default.

## Interaction defaults

The proposed long-term default is X-only drag selection. Scatterplots and heatmaps explicitly select XY drag.

Drag behavior must not change because `setData()` introduces or removes shared array references. Reference sharing is an optimization fact, not a reliable statement of chart intent.

The first cursor prototype retains current drag and autoscale defaults. Changes to those defaults require a separate compatibility decision.

## Mode-1 compatibility adapter

A shared internal representation can avoid maintaining two complete implementations until the final migration.

The proposed sequence is:

1. Introduce internal series descriptors and X groups.
2. Adapt mode-1 input through lightweight wrappers around existing arrays.
3. Move cursor lookup and window calculations onto the shared representation.
4. Migrate the remaining mode-1 features.
5. Remove the old public input form in a breaking release, or retain a small compatibility adapter.

The adapter does not copy numeric arrays or allocate objects per point. During migration, public `u.data` behavior needs a compatibility boundary separate from internal normalization.

Remaining mode-1 assumptions include:

- Stacking and other alignment-dependent features.
- Ordinal X scales.
- The shared-X legend entry and time formatting.
- Cursor synchronization across charts.
- `valToIdx()` and `posToIdx()`, which currently assume a primary X array.
- The role of the mode-2 placeholder at series index 0.

These decisions do not need to block the first cursor prototype.

## First prototype

Scope: native mode-2 hover for explicitly ordered X, with one candidate search per X group.

The prototype retains existing drag and autoscale defaults. It preserves explicit spatial lookup and does not change public data layout.

Required regression coverage:

- Shared X versus separate arrays with equal contents.
- Independently sampled ordered series and multiple X scales.
- Ascending, descending, and explicitly unordered X.
- Duplicate X values, empty arrays, and cursor positions outside the data range.
- Null skipping, proximity, and bias refinement.
- Explicit spatial-index callbacks without unnecessary native searches.
- Cursor points, legend values, primary indices, and per-series indices.
- Group changes after `setData()`, series addition, and series removal.
- Mode-1 compatibility behavior through the shared implementation.

Performance checks count searches as well as elapsed time. They must demonstrate one candidate search per eligible group, not one per series. Refinement remains per series and can require additional work around gaps.

This prototype provides a useful feature independently of the full migration. It also establishes the shared structure needed for visible-window Y ranging.

### Later positional-ranging coverage

The directional range proposal needs separate regression coverage:

- Multiple positional pairs that contribute to one target scale.
- Independent X windows and aggregation across their eligible contributions.
- X-controlled, Y-controlled, reciprocal, and independent range policies.
- Explicit XY bounds that automatic adjustment cannot replace.
- One propagation step without reciprocal feedback.
- Rotated charts and non-positional facets.
- Interval intersections, including cells whose `xMax` lies outside the selected window.
- External spatial indices and plugins that supply bounds without core data scans.

## Open decisions

- Does omitted X ordering eventually mean ascending, and in which release?
- What native candidate, if any, does an explicit `dataIdx` callback receive?
- What is the duplicate-X tie rule?
- How do primary-index APIs behave without an ordered primary group?
- How does a Y scale combine ordered and unordered contributors?
- How is visible-window ranging selected without changing existing mode-2 behavior unexpectedly?
- Where is the directional range policy configured: per series relationship, per scale, or at chart level?
- How are contributions combined when relationships request conflicting policies for one target scale?
- How do plugins declare positional intervals and supply eligible contributions?
- Which bounds apply when a selected population is empty?
- Does the legacy input form remain available through an adapter after mode 1 disappears internally?

No new configuration names or migration deadlines are selected by this document.
