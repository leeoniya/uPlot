# Demo regression tests

The demo tests render uPlot with a deterministic random-number generator. Each
snapshot stores the DOM and canvas commands for one plot.

- Single-plot step: `test/demos/<demo>/<group>-<step>.json`
- Multi-plot step: `test/demos/<demo>/<group>-<step>/<plot-index>.json`

Group and step IDs default to their zero-based indexes. An optional `id` field
provides a stable name when cases change order. IDs accept letters, digits,
underscores, and hyphens. The recorder rejects duplicate group IDs and snapshot paths.

## Scan API declarations

`test/scale-scan-types.ts` is a compile-only regression fixture, separate from the runtime suite.
It covers scan callbacks, nullish indices, explicit cache mutation, nullable range inputs, and mixed concrete/null scale bounds.
It also rejects obsolete callback signatures and return values.

Run the consumer type check without adding a project dependency:

```sh
npm exec --yes --package=typescript@5.9.3 -- tsc --strict --noEmit --skipLibCheck --target es2020 --module commonjs test/scale-scan-types.ts
```

`--skipLibCheck` skips declaration-file diagnostics, but still checks the consumer fixture against the declared API.
Without that flag, the existing unqualified `DateZoned` return type in `tzDate()` blocks the full declaration check.
The command can download the pinned compiler into the npm cache.

## Additional demo snapshots

Ten extracted demos add 54 plot snapshots across 42 steps:

- `months` and `months-ru`
- `grid-over-series`
- `bars-grouped-stacked` and `stacked-series`
- `candlestick-ohlc`
- `annotations`
- `soft-minmax`
- `nearest-non-null`
- `log-scales2`

The snapshots retain the original datasets. They total approximately 812 KiB, with no individual snapshot larger than 57 KiB.
Each render creates fresh mutable state. The harness resets the random seed for each step.
`log-scales2` uses a fixed timestamp by default. Its HTML page supplies the current timestamp through `createGroups(now)`.

`test/demo-migrations.mjs` verifies repeatable renders, shared data updates, legend toggles, linked cursors, annotations, hover behavior, and listener cleanup.
The recorder normalizes signed-zero drawing arguments because JSON stores `-0` as `0`. Shared paths still appear separately in fill and stroke commands.

Run the migration regressions:

```sh
npm test -- -t '^demo migrations'
```

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
NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit test/demo-extractions.mjs test/test.mjs -t 'demo extraction support|^points >'
```

## Mouse-driven selection regressions

`test/cursor-drag.mjs` uses Happy DOM and the existing canvas mock. It dispatches mouse events through the normal uPlot listeners.

The tests cover:

- X-only, Y-only, and XY zoom in both drag directions at pixel ratios 1 and 2.
- Persistent selection with `drag.setRange: false`.
- Clicks, zero-movement events, and the `drag.dist` threshold.
- Edge selection and release outside the plot through the document listener.
- Rectangle-cache invalidation after external resize and axis collapse or restoration.
- Double-click reset after X-only, Y-only, and XY zoom at pixel ratios 1 and 2.
- Selection clearing on reset, including `drag.setRange: false`, and preservation of non-auto Y ranges.
- Reset after resize or axis autosizing, followed by another drag with the restored geometry.
- Ignored non-primary-button double-clicks that preserve both the selection and scale ranges.
- Selection state, inline styles, scale ranges, and hook notifications.

Happy DOM does not calculate CSS layout. The fixture supplies `getBoundingClientRect()` from the applied overlay styles and a nonzero page offset.
Mouse events include explicit `movementX` and `movementY` values. Assertions for completed zoom wait for the commit microtask.

These tests do not verify browser hit testing, native CSS layout, or rasterized appearance.

Run the selection and layout tests one file at a time:

```sh
NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit --no-file-parallelism test/cursor-drag.mjs test/layout.mjs
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
NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit test/cursor-points.mjs
```

### Native hover performance benchmark

[`scripts/bench-hover.mjs`](../scripts/bench-hover.mjs) compares the pre-alignment commit with the current distribution build in headless Firefox.
It measures mouse handlers and forced style/layout updates separately. Cases include 1, 10, and 100 series, pixel-ratio overrides, and an inline legend.

Run the build and benchmark sequentially:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
node --max-old-space-size=128 scripts/bench-hover.mjs
```

The runner has a 120-second limit and removes its temporary browser profile.
[Recorded results and limitations](../docs/investigations/hover-performance.md) describe the measured slowdown and the extra scale conversions.

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

Run the legend, selection, and layout tests one file at a time:

```sh
NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit --no-file-parallelism test/legend.mjs test/cursor-drag.mjs test/layout.mjs
```

## Decimal precision regressions

The precision tests cover reported rounding errors, missing ticks, tiny ranges,
nonadvancing tick loops, and exact `fixedDec` keys and decimal counts.
Sources and expected behavior are documented in
[`docs/investigations/precision-regressions.md`](../docs/investigations/precision-regressions.md).

Run the historical regression cases:

```sh
npx vp test run --project unit test/precision-
```

The previously pending #827, #620, and #1084 cases now run by default.
A stalled step discards all accumulated splits.
Reaching the upper bound completes generation without requiring another step.
Automatic-ranging tests cover flat and near-flat data updates on both signs, with finite ticks and pixel positions.
Low-level termination tests do not promise valid rendering for equal custom bounds.

All 24 chart and tick probes run sequentially in one child process.
The worker registers Happy DOM and imports chart modules once before it reports readiness.
Each probe remains a separate test. Each chart has fresh data and options, with cleanup in `finally`.

The parent starts an execution timer before each request and clears it after the result.
The three degenerate-range probes retain their 100 ms execution limit. Other probes retain their five-second execution limit.
Startup and shutdown each have a separate five-second limit. Node workers retain the 128 MiB heap limit, and POSIX workers disable core dumps.
A timeout or crash fails the current test. The next test starts a replacement only after the failed worker closes.
An ordinary assertion failure also replaces the worker, after a normal exit.

Code coverage covers the test processes only, not child processes such as this worker.
`test/legend-build.mjs` explicitly checks imports without a DOM, instead of relying on numeric-only subprocesses to exercise that path.

`test/probe-worker.mjs` covers reuse, assertion failures, crashes, synchronous hangs, startup failures, invalid replies, shutdown failures, and active-request cancellation.
It also verifies normal exit hooks and rejects concurrent requests. The watchdog tests use small fixtures, not repeated chart imports.

### Runtime investigation

Sequential measurements on Node 26.8.2 identified subprocess startup as the main cost.
One baseline run spent 16.1 seconds in the 24 precision tests and 1.2 seconds in all 237 demo snapshot tests.
A separate precision run spent 14.6 of its 16.0 seconds on child startup.

The final comparison used the original harness from `9f77dfb` and the sequential worker, with the same 553 tests in both runs.
Both runs included the new cache and watchdog regressions.

| Measurement | One process per probe | Sequential worker |
| --- | ---: | ---: |
| Full command, including coverage reporting | 37.37 s | 17.98 s |
| Test execution | 32.75 s | 13.83 s |
| Precision test bodies | 20.17 s | 1.14 s |

The precision suite improved by approximately 94%, and the full command improved by approximately 52%.
Absolute timings varied with machine load, so these numbers are not performance thresholds.
Both runs passed all tests and produced identical Istanbul statement, function, and branch hit sets.
All 24 probes also passed in forward, reverse, and forward order in the same worker (72 executions).

No precision cases or assertions were removed. The per-case execution limits and Node heap limit are unchanged.
The execution timer no longer includes process shutdown or coverage serialization.
The investigation rejected Node compilation caching and an exclusion-filter shortcut.

These measurements predate the move from Mocha and NYC/Istanbul to `vp test` (Vitest).

### Benchmark increment generation and metadata

```sh
node scripts/bench-fixed-dec.mjs
bun scripts/bench-fixed-dec.mjs
```

The benchmark compares source with the pre-fix implementation, without coverage or DOM startup.
It reports median timings for decimal/binary generation and plain/scientific-notation metadata extraction.
These operations affect initialization and registration, not per-frame rendering.

### Benchmark rounding and ranges

```sh
node scripts/bench-rounding.mjs
bun scripts/bench-rounding.mjs
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

## Test runner

The tests run with [`vp test`](https://viteplus.dev/) (Vitest), configured in `vite.config.ts`.
Tests use Vitest globals (`describe`, `it`, `beforeEach`, ...). Each test file runs in its own worker process.

| Command | Purpose |
| --- | --- |
| `npm test` | Unit and snapshot tests with Istanbul coverage (`--project unit --coverage`) |
| `npm run test:update` | Record snapshots |
| `npm run test:server` | Demo HTTP server tests (`--project server`) |

Vitest arguments pass through:

```sh
npm test -- -t '^area-fill >'
npx vp test run --project unit test/legend.mjs
```

Full test names join the suite and test titles with ` > `, e.g. `area-fill > 0-0`.
Coverage includes `src/**/*.js` and reports even when tests fail.

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
UPDATE=1 NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit test/test.mjs -t '^multi-bars >'
NODE_OPTIONS=--max-old-space-size=256 npx vp test run --project unit test/test.mjs -t '^multi-bars >'
```
