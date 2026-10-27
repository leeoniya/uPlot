# Tests

## Test suites

| Command | Scope | Source coverage |
| --- | --- | --- |
| `npm test` | Core and plugin suites together in one shared test process | Yes |
| `npm run test:core` | Core behavior and core-owned demo regressions in `test/*.mjs` | Yes |
| `npm run test:plugins` | Plugin behavior, helpers, and plugin-owned demo regressions in `test/plugins/*.mjs` | Yes |
| `npm run test:tooling` | Tooling in `test/tooling/*.mjs` and the demo HTTP server in `test/server/*.mjs` | No suite-wide report |
| `npm run test:integration` | Demo support, adapters, and asset integration in `test/integration/*.mjs` | No suite-wide report |
| `npm run test:all` | Core, plugins, integration, and tooling in one shared test process | Yes |
| `npm run test:server` | Only the demo HTTP server | No |
| `npm run test:update` | Default suite, with snapshot updates | Yes |

Use `bun run test` for the default suite under Bun.
For the other commands, use `bun run` instead of `npm run` to select Bun.
The default command selects `test/*.mjs` and `test/plugins/*.mjs` explicitly, without recursive discovery.
Helpers, fixtures, and manual browser tests are not part of test discovery.

The core suite covers native paths, stacking, scales, axes, cursor behavior, legends, and the plugin extension API.
The plugin suite covers bar-chart, heatmap, and scatter implementations, their helpers, and the grouped-bars, candlestick, box-whisker, and annotation demos.
Plugin tests also exercise core code through normal chart construction.

`npm test` runs the union of the two suites, not two npm subprocesses.
The runner continues after test failures and reports failures from both suites.

The command returns zero when tests and coverage reporting succeed, or nonzero if either fails.
The shared recorder collects snapshot failures from both suites in one `test/output/index.html` report.
The recorder finalizes this combined report synchronously at process exit.
Coverage merges once after the combined run, including when tests fail.

The tooling suite covers benchmark measurement and reports, profiling, patch utilities, canvas recording and replay, snapshot capture, worker protocols, and coverage infrastructure.
Coverage tests enable their own instrumentation.
The tooling command does not clear or replace the source coverage output.
It includes the server tests, which bind a temporary loopback port.

The integration suite covers synthetic heatmap data, benchmark and third-party adapters, demo support helpers, repeatability, and actual demo asset contracts.
It also checks generated ECharts and Bokeh bundles when those files exist.
Those two checks skip when the generated bundles are absent. They do not download bundles.
The integration command does not clear or replace the source coverage output.

Both default groups retain their rendering snapshots. The core group retains the timezone/DST matrix and legend-selection regressions.
The plugin group retains the larger rotation and heatmap integration regressions.
The tooling suite retains extractor validation, patch transformations, installation, rollback, and CLI checks.
No browser benchmark runs as part of any suite.

Use `--test-name-pattern` to select tests by name:

```sh
npm test -- --test-name-pattern '^demo migrations'
npm run test:core -- --test-name-pattern '^cursor'
npm run test:plugins -- --test-name-pattern '^barChartPlugin'
npm run test:tooling -- --test-name-pattern '^sequential probe worker'
npm run test:integration -- --test-name-pattern '^demo migrations'
npm run test:all -- --reporter dot
```

The wrapper retains `--grep` and `-g` as aliases for `--test-name-pattern`.
It accepts `--reporter`, `-R`, and `--test-reporter` with these mappings:

- `spec`: Node's `spec` reporter or Bun's default reporter.
- `dot` or `dots`: Node's `dot` reporter or Bun's `dots` reporter.

## Coverage tables

The wrapper uses the vendored ESTree instrumenter and the existing Istanbul reporter, with separate coverage tables for core and plugin code.
It does not use the built-in coverage reports from Node or Bun.

The tables cover:

- **uPlot core**: the existing `src` and distribution coverage.
- **Plugins**: `barChartPlugin.js`, `barHover.js`, `barValues.js`, `distr.js`, `heatmapPlugin.js`, and `scatterPlugin.js` under `demos/lib/`.

The plugin list includes the local dependencies of the three plugins, except Flatbush.
Other demo modules, controls, data generators, and third-party libraries remain outside coverage instrumentation.
The `nyc.include` list in `package.json` defines the instrumented files.
`scripts/coverage-files.mjs` selects files with native filesystem globs and path matching.
It supports string or array patterns, directory patterns, negated include/exclude patterns, and extension filters.
It rejects paths outside `cwd` and excludes `node_modules` unless `excludeNodeModules` is false.
`NYC_CONFIG` can override the selection configuration. Paths remain relative to `cwd`. The selector does not support `relativePath: false`.
Explicit dotfile paths work, but implicit dotfile matching and advanced globs can differ between runtimes.

Each table has its own totals and uncovered lines.
Plugin coverage does not change the core percentages.
The reporter merges coverage from the main process and workers before it separates the tables.
Only loaded modules appear, and empty tables are omitted for focused runs.
`test:core` and `test:plugins` report coverage for the code each suite exercises.
Use `npm test` for combined coverage. Separate invocations replace the previous coverage output rather than merge it.

The plugin tests remain in the default suite.
No additional test suite or browser run is necessary to collect plugin coverage.

### ESTree instrumentation

The vendored ESTree instrumenter is the default and only source instrumenter.
It retains Istanbul counters and uses Meriyah for parsing and Astring for code generation.
Normal test commands use this instrumenter without additional configuration.
Both runtimes retain the existing test and coverage reporters.
Node writes coverage to `.nyc_output`. Bun writes coverage to `.nyc_output/bun`.

The instrumenter supports the project's JavaScript coverage requirements, not the complete upstream package API.
It rejects `reportLogic: true`, nonempty `parserPlugins` or `generatorOpts`, and `preserveComments: true`.
It does not support TypeScript, JSX, Babel plugin transforms, or the Babel-specific `programVisitor()` API.
Ordinary comments are absent from generated code. Input source maps require explicit `inputSourceMap` configuration.

See [the vendored instrumenter notes](../scripts/vendor/istanbul/README.md) for provenance, limits, validation commands, and benchmarks.
The benchmark measures only ESTree and verifies internal output consistency, not independent upstream parity.

## Demo regression tests

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
It accepts nullable `minAbs` caches on series and facets, but rejects `minAbs` on scales.
It also checks callback argument optionality and rejects invalid return types.

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

`test/demo-migrations.mjs` verifies core data updates, stacking, linked cursors, and legend behavior.
`test/plugins/demo-migrations.mjs` verifies plugin controls, annotations, hover behavior, and listener cleanup.
`test/integration/demo-repeatability.mjs` verifies repeated renders with fresh state.
The recorder normalizes signed-zero drawing arguments because JSON stores `-0` as `0`. Shared paths still appear separately in fill and stroke commands.

Run the chart migration regressions:

```sh
npm test -- --test-name-pattern '^demo migrations'
```

Run the repeatability checks:

```sh
npm run test:integration -- --test-name-pattern '^demo migrations'
```

## Points demo snapshots

`demos/points.html` uses `renderDemo()` and one step that returns all four original charts.
The snapshots include default points, filled points, points without lines, density limits, and sparse-data filtering.


Each render creates fresh random-walk state so that seeded recordings do not depend on previous renders.
`test/demo-extractions.mjs` checks that repeated seeded renders match.

These snapshots cover the initial DOM and canvas commands, not hovered markers.
`test/cursor-points.mjs` covers marker alignment.

Run the points snapshots and extraction tests:

```sh
NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs test/demo-extractions.mjs test/test.mjs --reporter spec --test-name-pattern 'demo extraction support|^points '
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

Run the selection and layout tests sequentially in one process:

```sh
NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs --no-coverage test/cursor-drag.mjs test/layout.mjs --reporter dot
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
NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs --no-coverage test/cursor-points.mjs --reporter dot
```

### Native hover performance benchmark

[`scripts/bench-hover.mjs`](../scripts/bench-hover.mjs) compares Git commit `8c0bce3` with the local distribution build in headless Firefox.
The commit must exist in the local repository. `FIREFOX_BIN` selects the executable, with `firefox` as the default.
It measures mouse handlers and forced style/layout updates separately. Cases include 1, 10, and 100 series, pixel-ratio overrides, and an inline legend.

Run the build and benchmark sequentially:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
node --max-old-space-size=128 scripts/bench-hover.mjs
```

The runner has a 120-second limit and removes its temporary browser profile.
The results describe handler and forced-layout costs, not end-to-end presentation latency.

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
NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs --no-coverage test/legend.mjs test/cursor-drag.mjs test/layout.mjs --reporter dot
```

## Decimal precision regressions

The precision tests cover reported rounding errors, missing ticks, tiny ranges,
nonadvancing tick loops, and exact `fixedDec` keys and decimal counts.
Sources and expected behavior are documented in
[`docs/investigations/precision-regressions.md`](../docs/investigations/precision-regressions.md).

Run the precision regression cases:

```sh
node scripts/test.mjs --no-coverage 'test/precision-*.mjs'
```

The #827, #620, and #1084 regression cases run by default.
A stalled step discards all accumulated splits.
Reaching the upper bound completes generation without requiring another step.
Automatic-ranging tests cover flat and near-flat data updates on both signs, with finite ticks and pixel positions.
Low-level termination tests do not promise valid rendering for equal custom bounds.

All 24 chart and tick probes run sequentially in one child process.
The worker registers Happy DOM and imports chart modules once before it reports readiness.
Each probe remains a separate `node:test` test. Each chart has fresh data and options, with cleanup in `finally`.

The parent starts an execution timer before each request and clears it after the result.
The three degenerate-range probes retain their 100 ms execution limit. Other probes retain their five-second execution limit.
Startup and shutdown each have a separate five-second limit. Node workers retain the 128 MiB heap limit, and POSIX workers disable core dumps.
A timeout or crash fails the current test. The next test starts a replacement only after the failed worker closes.
An ordinary assertion failure also replaces the worker, after a normal exit to flush coverage.

Coverage counters accumulate in the worker and flush on normal shutdown. Forced termination can discard buffered coverage, but cannot count as a passing test.
The main process and worker share a temporary cache of instrumented source, not runtime state.
Cache entries depend on the filename, source content, and coverage configuration. Cached code retains its source map.
The process that creates the cache removes it on exit. Children do not remove an inherited cache.
Without the coverage preload, the precision suite creates and removes its own cache.
The existing loader test explicitly checks imports without a DOM, instead of relying on numeric-only subprocesses to exercise that path.

`test/tooling/probe-worker.mjs` covers reuse, assertion failures, crashes, synchronous hangs, startup failures, invalid replies, shutdown failures, and active-request cancellation.
It also verifies normal exit hooks and rejects concurrent requests. The watchdog tests use small fixtures, not repeated chart imports.

### Benchmark increment generation and metadata

```sh
node scripts/bench-fixed-dec.mjs
bun scripts/bench-fixed-dec.mjs
```

The benchmark compares source with an embedded baseline, without coverage or DOM startup.
It reports median timings for decimal/binary generation and plain/scientific-notation metadata extraction.
These operations affect initialization and registration, not per-frame rendering.

### Benchmark rounding and ranges

```sh
node scripts/bench-rounding.mjs
bun scripts/bench-rounding.mjs
```

This benchmark compares source with Git commit `443333f`.
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

## Node and Bun runtimes

All test commands use the `scripts/test.mjs` wrapper under both runtimes.
The wrapper detects `process.versions.bun` and prints the selected runtime before the tests start.
The tooling, integration, and server commands use `scripts/test.mjs --no-coverage`, without suite-wide source instrumentation.
This flag skips the wrapper's coverage instrumentation and report. It leaves existing source coverage output unchanged.
There is no separate Bun test implementation.
The project's `bunfig.toml` sets `[run] bun = true`, so `bun run` uses Bun even when a script specifies `node`.
This configuration applies to all `bun run` scripts. It does not affect npm.

| Command | Runtime |
| --- | --- |
| `npm test` | Node |
| `bun run test` | Bun |
| `node scripts/test.mjs "test/*.mjs" "test/plugins/*.mjs"` | Node |
| `bun scripts/test.mjs "test/*.mjs" "test/plugins/*.mjs"` | Bun |

The wrapper runs `node --test --test-isolation=none` under Node, or `bun test` under Bun.
Both runtimes use the same tests with imports from `node:test`.
The selected files run in one shared test process, not an isolated process for each file.
This preserves shared DOM state and snapshot reporting across suites. Probe workers remain separate child processes.

Both runtimes have a common per-test default timeout of 2000 ms.
The wrapper sets Node's `--test-timeout=2000` or Bun's `--timeout=2000`.
Longer tests and hooks use explicit `timeout` options.

The wrapper preserves the caller's timezone under Bun. Without this, `bun test` defaults to UTC.

The wrapper explicitly expands file globs before it starts either runner.
Bun receives explicit file paths instead of quoted globs or its default test discovery patterns.
Both runtimes therefore use the same file selection, including suite files without `.test` or `.spec` names.

Bare `bun test` bypasses the wrapper's file selection, instrumentation, and coverage report.
Use `bun run test` for the default suite and its Istanbul report.
The tests and coverage reporter run under the selected runtime.

Both runtimes use the instrumentation preload to write one coverage file per process on normal exit.
Node writes to `.nyc_output`. Bun writes to `.nyc_output/bun`. The harness merges these files and generates the final Istanbul report without wrapping the test processes.
Node children inherit the preload through `NODE_OPTIONS`, unless a fixture explicitly clears it.
The Bun precision worker receives an explicit preload because child processes do not inherit the parent's `--preload` flag.
The worker-coverage regression verifies instrumentation and the coverage file after normal shutdown under both runtimes.
With coverage enabled, each Bun run clears `.nyc_output/bun`.
With coverage enabled, each Node run clears `.nyc_output`, including the Bun results.

The runner caches instrumented source in `.cache/test-instrument/<namespace>` across runs.
A cold run loads the vendored ESTree instrumenter. A warm run reuses cached output without an instrumenter instance for unchanged files.
The namespace changes with either lockfile, the vendored implementation, the instrumentation cache code, the loader, or the coverage selector.
Each entry also depends on the filename, source contents, and instrumentation configuration.

The cache contains no test results or coverage counters.
With coverage enabled, each run collects fresh coverage and clears its previous coverage output.

To remove the default cache, run `rm -rf .cache/test-instrument`.
To use another directory, set `UPLOT_INSTRUMENT_CACHE_DIR`. The runner creates that directory and preserves the explicit path without adding a namespace.
After dependency or instrumentation changes, remove the contents of that explicit directory.

Pass test-name filters through the wrapper:

```sh
npm test -- --test-name-pattern '^area-fill '
bun run test --test-name-pattern '^area-fill '
```

The Bun loader selects source files at startup. Files created later in the run
are not instrumented. The current suite uses existing source files.

To record snapshots under Bun, run:

```sh
bun run test:update
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
2. Add `<name>` to `demos` in `test/demos.mjs`. For a plugin demo, also add it to `pluginDemos`.
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
UPDATE=1 NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs --no-coverage test/plugins/test.mjs --test-name-pattern '^multi-bars '
NODE_OPTIONS='--max-old-space-size=256' node scripts/test.mjs --no-coverage test/plugins/test.mjs --test-name-pattern '^multi-bars '
```

For multiple demos, run one process at a time.
