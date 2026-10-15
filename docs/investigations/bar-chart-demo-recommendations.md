# Bar chart demo recommendations

Status: proposed follow-up work, not an implementation plan or a confirmed audit of missing features.

Demo: [`demos/axis-label-rotation.html`](../../demos/axis-label-rotation.html).
Related documentation: [`barChartPlugin.md`](../../demos/lib/barChartPlugin.md).

## Current coverage

The demo covers grouped bars, normal and percent stacking, both orientations, and separate positive and negative totals.
It also includes value labels, category-label rotation, truncation, spacing filters, bar and group hover, chart resizing, and one to five component series.

## Recommended additions

| Feature | Benefit | Suggested implementation location |
| --- | --- | --- |
| Category sorting | Ranks categories by a selected series or total, especially for horizontal bars. | External data preparation. Apply the same category order to every column, then call `setData()`. |
| Dataset presets | Exercises missing values, zeros, empty categories, single-category data, and groups with only one sign. | Demo data generation and controls. Fixed presets complement random data. |
| Maximum bar thickness | Prevents excessively wide bars with few categories. A CSS-pixel cap complements percentage widths. | Bar geometry. Reuse existing path-builder configuration where possible. |
| Reference line | Shows a target, average, or threshold. | A drawing hook or small plugin rather than a core change. |
| Value formatting controls | Keeps currency, units, and percentages consistent across axes, value labels, and hover readouts. | Shared formatter configuration in the demo and helpers. |
| Accessible data table | Exposes chart values as readable document content rather than canvas pixels alone. | A collapsible HTML table outside the plot. |

## Suggested priorities

### 1. Category sorting

Sorting adds a common chart feature without extra renderer complexity.
Useful choices include original order, ascending order, and descending order, based on a selected series or total.

For mixed-sign data, the sort key needs an explicit meaning: positive total, negative total, or net total.
The same permutation must apply to category labels and every value column.

### 2. Dataset presets

Presets make edge cases reproducible and improve the demo as a regression aid.
Useful examples include:

- Missing values (`null`) versus real zeros (`0`).
- Categories with no values.
- A single category.
- Positive-only and negative-only data.
- Mixed signs, including a single contributor to either total.
- Enough categories to exercise label thinning and narrow bars.

These cases help check geometry, totals, label placement, hover behavior, and axis ranges.

### 3. Zero-baseline visibility

Check whether the zero baseline is visually distinct from the other grid lines.
A distinct baseline helps readers compare positive and negative bars.
This is a readability review item, not a confirmed missing feature.

## More specialized additions

- **Error bars:** show uncertainty around each value.
- **Range or floating bars:** show intervals with independent starts and ends rather than values measured from zero.
- **Category scrolling or zooming:** supports dense data when label thinning still leaves bars too narrow.
- **Per-bar colors:** highlight selected categories or values beyond a threshold.

These features need separate design decisions and are lower priorities than sorting and presets.

## Scope

Most recommendations belong in the demo, external data preparation, or small helpers.
They do not imply a need for new uPlot core APIs.
Existing API support needs review before implementation, especially for bar thickness, reference lines, and range bars.
