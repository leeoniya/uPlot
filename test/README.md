# Demo regression tests

The demo tests render uPlot with a deterministic random-number generator. Each
snapshot stores the DOM and canvas commands for one plot.

- Single-plot step: `test/demos/<demo>/<group>-<step>.json`
- Multi-plot step: `test/demos/<demo>/<group>-<step>/<plot-index>.json`

Group and step IDs default to their zero-based indexes. An optional `id` field
provides a stable name when cases change order. IDs accept letters, digits,
underscores, and hyphens. The recorder rejects duplicate group IDs and snapshot paths.

## Points demo snapshots

`demos/points.html` uses `renderDemo()` and one step that returns all four original charts.
The snapshots include default points, filled points, points without lines, density limits, and sparse-data filtering.

The four snapshots come from commit `8c0bce3`, before the cursor-marker alignment changes.
The original inline demo and the extracted demo produce identical recordings with that build.
The current implementation matches the same snapshots without updates.

Each render creates fresh random-walk state so that seeded recordings do not depend on previous renders.
`test/demo-extractions.mjs` checks that repeated seeded renders match.

These snapshots cover the initial DOM and canvas commands, not hovered markers.
`test/cursor-points.mjs` covers marker alignment.

Run the points snapshots and extraction tests:

```sh
node --max-old-space-size=256 --import ./scripts2/register-hooks.mjs node_modules/mocha/bin/mocha.js --no-config --no-package --reporter spec test/demo-extractions.mjs test/test.mjs --grep 'demo extraction support|^points '
```

## Mouse-driven selection regressions

`test/cursor-drag.mjs` uses Happy DOM and the existing canvas mock. It dispatches mouse events through the normal uPlot listeners.

The tests cover:

- X-only, Y-only, and XY zoom in both drag directions at pixel ratios 1 and 2.
- Persistent selection with `drag.setScale: false`.
- Clicks, zero-movement events, and the `drag.dist` threshold.
- Edge selection and release outside the plot through the document listener.
- Rectangle-cache invalidation after external resize and axis collapse or restoration.
- Double-click reset after X-only, Y-only, and XY zoom at pixel ratios 1 and 2.
- Selection clearing on reset, including `drag.setScale: false`, and preservation of non-auto Y ranges.
- Reset after resize or axis autosizing, followed by another drag with the restored geometry.
- Ignored non-primary-button double-clicks that preserve both the selection and scale ranges.
- Selection state, inline styles, scale ranges, and hook notifications.

Happy DOM does not calculate CSS layout. The fixture supplies `getBoundingClientRect()` from the applied overlay styles and a nonzero page offset.
Mouse events include explicit `movementX` and `movementY` values. Assertions for completed zoom wait for the commit microtask.

These tests do not verify browser hit testing, native CSS layout, or rasterized appearance.

Run the selection and layout tests sequentially in one process:

```sh
node --max-old-space-size=256 node_modules/mocha/bin/mocha.js --no-config --no-package --reporter dot test/cursor-drag.mjs test/layout.mjs
```

## Cursor marker alignment regressions

`test/cursor-points.mjs` compares DOM marker centers against recorded canvas arcs and their drawing transforms.
The comparison uses the completed CSS dimensions and actual canvas dimensions, not the requested pixel ratio alone.

The tests cover:

- Pixel ratios 1, 1.25, 1.5, 2, and 3.
- Disabled, fractional, and integer pixel snapping, including per-series overrides.
- Zero, odd, even, and fractional point stroke widths.
- Plot edges, rotated axes, reversed scales, and aligned or faceted data.
- Single-point focus, including series with different snapping and stroke widths.
- Stationary markers after resize, axis sizing, and pixel-ratio changes.
- Custom bounding boxes, hidden cursors, non-live legends, missing values, and stale indices after `setData(..., false)`.

These tests verify geometric centers. They do not compare browser antialiasing or rendered pixels.

Run the alignment tests:

```sh
node --max-old-space-size=256 node_modules/mocha/bin/mocha.js --no-config --no-package --reporter dot test/cursor-points.mjs
```

### Native hover performance benchmark

[`scripts2/bench-hover.mjs`](../scripts2/bench-hover.mjs) compares the pre-alignment commit with the current distribution build in headless Firefox.
It measures mouse handlers and forced style/layout updates separately. Cases include 1, 10, and 100 series, pixel-ratio overrides, and an inline legend.

Run the build and benchmark sequentially:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
node --max-old-space-size=128 scripts2/bench-hover.mjs
```

The runner has a 120-second limit and removes its temporary browser profile.
[Recorded results and limitations](../docs/hover-performance.md) describe the measured slowdown and the extra scale conversions.

## Legend interaction regressions

`test/legend.mjs` covers inline legends with `series.value` and table legends with multiple `series.values` columns.
Both modes use Happy DOM mouse events and the existing canvas mock.

The tests cover:

- Formatted values, missing values, cursor movement, and cursor leave.
- Shared and per-series `setLegend()` indices, including suppressed hooks.
- Value updates at a stationary cursor after data replacement, empty data, and recovery.
- Label and marker clicks, axis collapse, and axis restoration.
- Ctrl/Meta isolation, restoration of all series, and `legend.isolate` inversion.
- Ignored clicks from non-primary buttons and clicks on value cells or headings.
- Hover focus, legend and cursor-point opacity, and focus reset on legend leave.
- Disabled focus and cursor locking.
- Unchanged cursor indices without redundant legend updates, and focus redraws that retain cached series paths.

These tests verify state, inline styles, and hooks. They do not verify native browser layout or hit testing.

Run the legend, selection, and layout tests sequentially in one process:

```sh
node --max-old-space-size=256 node_modules/mocha/bin/mocha.js --no-config --no-package --reporter dot test/legend.mjs test/cursor-drag.mjs test/layout.mjs
```

## Decimal precision regressions

The precision tests cover reported rounding errors, missing ticks, tiny ranges,
nonadvancing tick loops, and exact `fixedDec` keys and decimal counts.
Sources and expected behavior are documented in
[`docs/precision-regressions.md`](../docs/precision-regressions.md).

Run the historical regression cases:

```sh
npx mocha 'test/precision-*.mjs'
```

The previously pending #827, #620, and #1084 cases now run by default.
A stalled step discards all accumulated splits.
Reaching the upper bound completes generation without requiring another step.
Automatic-ranging tests cover flat and near-flat data updates on both signs, with finite ticks and pixel positions.
Low-level termination tests do not promise valid rendering for equal custom bounds.

Each chart or tick probe runs in a child process.
The three degenerate-range probes have a 100 ms execution limit after imports finish.
Other probes have a five-second execution limit. All probes have a separate five-second startup limit.
Node children also have a 128 MiB heap limit.

Coverage runs share a temporary cache of instrumented source between probes.
Each probe still has a fresh process and independent coverage counters.
The suite removes the cache after the run.
Numeric-only probes skip Happy DOM and the chart module. Chart probes retain the full mock DOM.

### Benchmark increment generation and metadata

```sh
node scripts2/bench-fixed-dec.mjs
bun scripts2/bench-fixed-dec.mjs
```

The benchmark compares source with the pre-fix implementation, without coverage or DOM startup.
It reports median timings for decimal/binary generation and plain/scientific-notation metadata extraction.
These operations affect initialization and registration, not per-frame rendering.

### Benchmark rounding and ranges

```sh
node scripts2/bench-rounding.mjs
bun scripts2/bench-rounding.mjs
```

This benchmark compares source with Git commit `443333f`, after the `fixedDec` fixes and before the broader rounding changes.
The commit must exist in the local repository. The benchmark uses no network access or coverage instrumentation.
Results include both common and tiny grids, large digit counts, and the Grafana near-flat ranges.

## Validate snapshots

```sh
npm test
```

This command validates the snapshots and reports code coverage. If snapshots
differ, the recorder writes one self-contained report to `test/output/index.html`
after the run. The report includes every mismatched plot, including multiple
plots from one test step.

The report displays all failed snapshots in order, each with its own comparison canvas.
Hover over a chart to show the actual rendering. Move the pointer away to
restore the expected rendering. The hover area keeps the larger dimensions of
the two snapshots to prevent flicker when their sizes differ.

A validation run clears previous reports before the tests start. A passing run
creates no report.

The report embeds the recorded commands and replays them with the browser's
native Canvas and `Path2D` APIs. Open the HTML file directly in a browser.
No server or network access is required. Rendering uses the browser's fonts and
rasterization rather than pre-rendered PNG images. Snapshot comparisons still
use the recorded commands, not pixels.

## Run natively with Bun

```sh
bun run test:bun
```

This command runs Mocha and the NYC coverage reporter under Bun. It uses the
same snapshots, Istanbul instrumentation, and file-selection rules as the Node command.
The runner writes coverage from the test process and its subprocesses to
`.nyc_output/bun`. Each Bun run clears that directory. A Node test run clears
`.nyc_output`, including the Bun results.

`bun run test` still runs the existing Node command. Use `test:bun` for native Bun execution.

Mocha arguments pass through to the Bun runner:

```sh
bun run test:bun --grep '^area-fill '
```

The Bun loader selects source files at startup. Files created later in the run
are not instrumented. The current suite uses existing source files.

To record snapshots under Bun, run:

```sh
UPDATE=1 bun run test:bun
```

This command replaces snapshots. Both runtimes share the same snapshot files.

## Record snapshots

```sh
npm run test:update
```

This command sets `UPDATE=1` and replaces all snapshots with the current
output. Review the JSON changes before you commit them.

## Add a demo

1. Export the demo's test groups from `demos/<name>.js`.
2. Add `<name>` to `test/demos.mjs`.
3. Run `npm run test:update`.
4. Run `npm test`.

## Define render steps

`plotStep()` accepts a function that returns one plot or an array of related
plots. The function can be asynchronous. The helper returns a step with an
async `render()` method and normalizes its result to a plot array.

```js
import { plotStep } from './renderDemo.js';

export default [{
	id: 'comparison',
	steps: [{
		id: 'variants',
		...plotStep(async () => {
			const data = await loadData();
			return [makeChart(data), makeOtherChart(data)];
		}),
		breakAfter: 1,
	}],
}];
```

Here, `loadData`, `makeChart`, and `makeOtherChart` are demo-specific functions.
The recorder captures both plots and destroys them after validation, including
when a comparison fails. Each step must return at least one plot.

The helper awaits construction, which lets the initial uPlot microtask complete.
It does not wait for timers, images, or animation. If a demo requires additional
asynchronous work, await that work inside its callback.

Existing hand-written `render()` methods remain supported. They must return a
nonempty plot array. Layout fields such as `name`, `breakBefore`, and `breakAfter`
keep their existing behavior.

If an ID or the plot count changes, move or remove the previous snapshot files.
Update mode does not remove obsolete snapshots.

## Run one demo with a memory limit

The following commands skip coverage and limit the JavaScript heap to 256 MiB.

```sh
UPDATE=1 node --max-old-space-size=256 --import ./scripts2/register-hooks.mjs ./node_modules/mocha/bin/mocha.js --grep '^multi-bars '
node --max-old-space-size=256 --import ./scripts2/register-hooks.mjs ./node_modules/mocha/bin/mocha.js --grep '^multi-bars '
```

For multiple demos, run one process at a time.
