# Tooltip and stats legend

`tooltip.show: true` enables a live tooltip and makes the regular legend non-live.
Only one component follows the cursor. Without a tooltip, the legend retains its existing live behavior.

```js
const opts = {
  width: 600,
  height: 400,
  scales: {x: {time: false}},
  legend: {mode: 'table', valueSrc: 'values'},
  tooltip: {show: true, mode: 'table', valueSrc: 'value', gap: 12},
  series: [
    {label: 'Sample'},
    {
      label: 'Temperature',
      stroke: 'red',
      value: (u, value) => value?.toFixed(2),
      values(u, seriesIdx) {
        const values = u.data[seriesIdx].filter(value => value != null);
        return {Count: values.length, Sum: values.reduce((a, b) => a + b, 0)};
      },
    },
  ],
};
```

## Formatter source and layout

`legend.valueSrc` and `tooltip.valueSrc` independently select the formatter:

- `'value'` uses `series.value`, including its default formatter, for one scalar value per row.
- `'values'` uses `series.values` for named columns. Each Y series must supply this callback.
- For non-live legends, an omitted option shows labels and markers only. It does not call either value callback.
- For live legends and tooltips, an omitted option uses `series.values` when `series[1].values` exists. Otherwise, it uses `series.value`.

`mode` selects the layout, not the formatter. A table can show scalar values without a column header.
In mode 1, a live scalar view also includes the X-series row. Multi-value views and non-live legends omit this row.
The example shows stats columns in the legend and scalar cursor values in the tooltip.
A labels-only legend uses inline layout by default, even when the series supply `values` callbacks.

| Legend configuration | Output |
| --- | --- |
| `{live: false}` | Labels and markers only |
| `{live: false, valueSrc: 'value'}` | Scalar stats |
| `{live: false, valueSrc: 'values'}` | Named stats columns |

### Transposed tables

`legend.transpose: true` or `tooltip.transpose: true` shows series as columns and named values as rows.
The default is `false`. Each component uses its own setting. Inline layouts ignore this setting.

```js
legend: {mode: 'table', transpose: true, valueSrc: 'values'},
tooltip: {show: true, mode: 'table', transpose: true, valueSrc: 'values'},
```

Series headers retain their markers. Legend headers retain click and focus interactions.
The `filter`, `sort`, and `limit` callbacks select series columns instead of series rows.
Scalar tables omit field labels. Live scalar time tables keep the timestamp above all series columns.

CSS Grid and nested subgrids change the visual layout. Each series retains one `tr.u-series` container and all its cells.
The table sections and series rows retain layout boxes. This layout does not use `display: contents`.

Both orientations share value formatting, cached text updates, and keyed series identity.
CSS places series columns in DOM order, without separate JavaScript placement or copied values.
Subgrid keeps field heights aligned across series, including multiline labels.

This layout requires [CSS subgrid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid): Chrome/Edge 117+, Firefox 71+, or Safari/iOS 16+.
DOM order and table-header relationships remain series-oriented, rather than visually transposed.
Changing a table to CSS Grid can affect [accessibility in some browsers](https://developer.mozilla.org/en-US/docs/Web/CSS/display#accessibility). Browser and screen-reader combinations still require verification.
The `mode` and `transpose` settings select the initial layout, not a runtime layout switch.

## Live values and stats

The live component uses the existing per-series cursor indices and value callbacks.
A numeric index can identify a null-valued datum. A null index means that the series has no selected datum.
Both cursor exit and a missing scatter hit produce null indices. The callbacks retain this existing behavior.

With an explicit `valueSrc`, the non-live legend calls `series.value(u, null, seriesIdx, null)` or `series.values(u, seriesIdx, null)`.
It refreshes after initialization, `setData`, `setSeries`, `setScale`, `addSeries`, and `delSeries`.
These refreshes run during the next commit, after scale resolution. Batches combine pending refreshes.
Ordinary cursor movement and internal cursor-focus changes do not recalculate stats.

The legend and tooltip can use different column names. Each multi-value component derives columns from the first Y series.
Live multi-value columns retain the initial index-zero probe. Series insertion and deletion refresh the live schema.
Each stats refresh also checks the stats schema. Column changes retain the outer table and do not repeat the mount callback.
As with other series changes, `addSeries` and `delSeries` require matching data columns before the next draw.

The stats legend and tooltip retain separate value snapshots.
Callbacks can reuse a mutable result object without overwriting the other component's values.
The ordinary live legend retains its existing caller-owned multi-value records.

## Selection and interactions

The legend and tooltip each use their own `filter`, `sort`, and `limit` callbacks.
Only the live component's selection controls hover-point visibility.
Stats selection never restricts hover points, with or without a tooltip.

With an explicit `valueSrc`, the non-live legend calculates all Y-series stats before it applies its selection callbacks.
Its callbacks can read `u.legend.values`, series labels, or other series metadata.
Stats refreshes also refresh selection. Cursor movement does neither.
Labels-only legends use the same selection refreshes but skip value callbacks. Their `u.legend.values` entries remain null.
Without selection callbacks, the stats legend includes all Y series, including hidden series for toggle access.
A custom filter can exclude hidden series, but those rows are then unavailable for legend toggles.

For example, these options show the first ten nonempty series, ordered by their total:

```js
legend: {
  live: false,
  mode: 'table',
  valueSrc: 'values',
  filter: (u, si) => u.legend.values[si].Count > 0,
  sort: (u, a, b) => u.legend.values[b].Sum - u.legend.values[a].Sum,
  limit: (u, indices) => [0, Math.min(10, indices.length)],
},
```

A name comparator can use `String(u.series[a].label).localeCompare(String(u.series[b].label))` instead.
Equal comparisons retain the original series order.
The two components have separate `order`, `count`, and `range` buffers.
Limits reduce the number of rendered rows, not the number of stats calculations.

Only the legend binds focus and click-toggle listeners. The tooltip ignores pointer events and binds no row listeners.
Both components reflect series visibility and focus changes.

`u.legend` contains the regular legend state. `u.tooltip` contains tooltip values, indices, selection order, count, and range.
`u.setLegend(...)` refreshes the live component and reselects the stats legend from its cached values.
An explicit `u.setLegend({})` applies changed filters, sorting, or pagination without recalculating stats or changing cursor indices.
The existing `setLegend` hook runs after this refresh.

## Tooltip options

| Option | Default | Behavior |
| --- | --- | --- |
| `show` | `false` | Enables the tooltip when overlay DOM and the cursor are enabled. |
| `gap` | `12` | Cursor gap in CSS pixels. |
| `mode` | `'table'` | Table or inline layout. |
| `transpose` | `false` | Shows series as columns and values as rows in table layout. |
| `valueSrc` | Inferred from `series[1].values` | `'value'` for scalar values or `'values'` for named columns. |
| `markers` | Legend marker defaults | Independent marker options. |
| `filter`, `sort`, `limit` | `null` | Existing live legend selection callbacks. |
| `mount` | No operation | Receives the complete tooltip table after placement in `u.over`. |

The tooltip uses fixed positioning and a CSS transform.
A `ResizeObserver` caches its border-box size. Cursor updates do not measure the tooltip or schedule animation frames.
It prefers below-right placement and flips each axis when that side cannot fit.
It returns to below-right as soon as that placement fits. Scroll and resize events refresh the viewport position.
A tooltip larger than the available space on both sides can still overflow. No scrolling or size-constraining wrapper is added.

The `.u-tooltip` rule supplies positioning and pointer-event behavior.
Unlocked tooltips ignore pointer events. With `cursor.lock: true`, a plot click locks the cursor and adds `u-locked` to the chart root.
Tooltips within that root then accept pointer events and text selection. Interactions inside the tooltip do not unlock the cursor.
A click on the plot outside the tooltip unlocks the cursor and removes the class.

Applications can supply background, border, shadow, and stacking styles.
A transformed ancestor can change the containing block for fixed positioning.

The tooltip deep-clones HTMLElement series labels. The regular legend retains the original nodes.
Clones do not copy event listeners or track later changes to the original label.
Applications must avoid duplicate IDs in labels that appear in both components.

## Compatibility change

A non-live legend without `valueSrc` shows labels only, including when a tooltip makes it non-live.
To retain static stats, set `legend.valueSrc` to `'value'` or `'values'`.
Live legends and tooltip formatter inference do not change.
Non-live selection callbacks run after data, series, and scale changes or explicit `setLegend` calls, not cursor movement.
The tooltip does not activate without `.u-over` or with `cursor.show: false`.
Component ownership is fixed at initialization. Runtime changes to `show` or `live` do not switch that ownership.
