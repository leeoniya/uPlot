# Grafana bar-chart bundle size

Measured on 2026-10-11 with Bun 1.4.3. No Grafana dependencies were installed.

## Result

The Grafana bar-chart panel plus selected visualization support totals **81,627 bytes minified**, or **29,222 bytes with gzip**.
This estimate excludes the general Grafana framework, third-party dependencies, and uPlot itself. It is not a standalone bundle size.

All values in this table are bytes. Each row is a separate bundle, not an additive component size.

| Scope | Minified JS | gzip, level 9 | Brotli, quality 11 |
| --- | ---: | ---: | ---: |
| Grafana panel-local code | 18,489 | 7,801 | 7,085 |
| Panel plus shared chart support | 39,682 | 15,810 | 14,382 |
| Panel plus shared chart support and visualization UI | **81,627** | **29,222** | **25,982** |
| Current uPlot bar-chart plugin and helpers, with its control API | 14,617 | 6,470 | 5,841 |

The panel-local result omits substantial chart support. The largest scope is more useful for a comparison that includes tooltip and legend code.
Neither scope measures the incremental download size inside an existing Grafana application. Shared production chunks change that cost.

## Source revisions

Grafana uses `main`, not `master`. The measurement uses an archive of its current head at download time:

- Commit: `891f7973f81c6e4e0a24bed3120cca3b3cc93ebc`
- Commit date: `2026-10-10T13:30:30Z`
- Package version: `13.3.0-pre`
- Archive: <https://codeload.github.com/grafana/grafana/zip/891f7973f81c6e4e0a24bed3120cca3b3cc93ebc>
- Archive SHA-256: `537b57e82bc4c594d880dda0599728cb82e50177d3c229c57eb9b0875c2b347e`

The uPlot comparison uses the plugin sources at commit `100ca0fca4a17a73ef3afe5e5d48332e9fcec80a`.
No plugin source changes were necessary for this measurement.

## Included code

### Panel-local code

The entry point is `public/app/plugins/panel/barchart/BarChartPanel.tsx`.
Bun retains its exported component and bundles these local dependencies:

- `BarChartLegend.tsx`
- `utils.ts`
- `bars.ts`
- `distribute.ts`
- `quadtree.ts`
- Runtime values from `panelcfg.gen.ts`

Imports outside the bar-chart directory remain external in this scope.

### Shared chart support

The second scope adds the relevant source from these areas:

- `UPlotChart`, the React wrapper for uPlot
- `UPlotConfigBuilder`, axis, scale, and series builders
- Threshold and gradient helpers
- Plot data preparation, stacking groups, and stacking bands
- Scale keys, text measurement, and time-zone helpers
- Logging helpers and runtime schema values
- Shared palette assignment from the time-series panel

Bun removes unused exports where its tree shaking permits. Shared classes retain methods that the compiler cannot prove unnecessary.
Thus, this scope includes some capabilities that other Grafana chart types also use.

### Visualization UI

The third scope also adds these components and helpers:

- `TooltipPlugin2` and its close-button wrapper
- `TimeSeriesTooltip`
- `VizTooltip` components and helpers
- `VizLegend` components and helpers
- `VizLayout`
- Shared legend helpers for thresholds and value mappings
- Field-action preparation and the table filter constant

The source graph contains 7, 29, and 58 files respectively. These counts include parsed files whose unused exports Bun removes.
They do not describe retained bytes per file.

## Excluded code

All Grafana scopes exclude:

- uPlot and its stylesheet
- React, React DOM, and the JSX runtime
- Third-party packages such as Lodash, Emotion, TinyColor, and React Use
- `@grafana/data`, including field formatting, reducers, data-frame joins, and color utilities
- General Grafana runtime, localization, theme, and panel-context infrastructure
- Generic UI components such as buttons, icons, lists, portals, scrolling containers, and color pickers
- Application services for actions, assistant integration, and frame validation
- Panel registration, editor components, migrations, suggestions, tests, and demo controls

Some excluded modules retain side-effect imports after tree shaking. Their implementations do not contribute to the measured byte counts.
The JSON report lists every retained external import for each bundle.

CSS-in-JS declarations inside included components contribute to the JavaScript size. External stylesheets and the Emotion implementation do not.

## Method and validation

The script uses `Bun.build()` with the browser target, ESM output, full minification, and production `NODE_ENV`.
It creates no source maps. It measures UTF-8 output bytes, then compresses each complete bundle with gzip and Brotli.

For shared UI imports, the script reads the actual Grafana export declarations.
It redirects selected named imports to their source files and leaves the remaining imports external.
This avoids the full UI barrel and does not replace implementations with empty stubs.

All builds run sequentially with `bun --smol`. The process does not install packages or build the Grafana application.

Validation included:

- Successful Bun builds for all four scopes
- Output parsing and verification that each entry export remains present
- Inspection of the retained external imports
- A separate Terser syntax and scope analysis of the Bun output

The scope analysis found only standard JavaScript and browser globals.
Terser did not produce the measured bundles. No TypeScript type check or browser behavior test was performed.

### Earlier initialization-only estimate

The earlier uPlot estimate excluded the control API and live reconfiguration code.
Rollup plus Terser produced **13,898 bytes minified**, **5,997 bytes gzip**, and **5,433 bytes Brotli**.

That result uses a different minifier and a smaller feature scope.
The Bun comparison in this report includes the current control API, but excludes the demo UI and uPlot core.
It bundles `barChartPlugin.js`, `barHover.js`, `barValues.js`, and `distr.js`.

## Reproduction

The script and detailed results are adjacent to this report:

- [Bun measurement script](grafana-bar-chart-size.mjs)
- [Sizes, source lists, and external imports](grafana-bar-chart-size-results.json)

From the uPlot project root, download the pinned archive:

```sh
mkdir -p .grafana-bar-size
curl --fail --silent --show-error --max-time 120 \
  --output .grafana-bar-size/grafana.zip \
  https://codeload.github.com/grafana/grafana/zip/891f7973f81c6e4e0a24bed3120cca3b3cc93ebc
```

Extract the selected sources and package metadata:

```sh
unzip -q .grafana-bar-size/grafana.zip -d .grafana-bar-size \
  '*/public/app/plugins/panel/barchart/*' \
  '*/public/app/plugins/panel/timeseries/TimeSeriesTooltip.tsx' \
  '*/public/app/plugins/panel/timeseries/utils.ts' \
  '*/public/app/plugins/panel/status-history/utils.ts' \
  '*/public/app/core/components/TimelineChart/utils.ts' \
  '*/packages/grafana-ui/src/*' \
  '*/packages/grafana-schema/src/*' \
  '*/package.json' '*/tsconfig.json' \
  -x '*.test.*' '*__snapshots__*' '*.story.*'
```

Run the measurement with Bun 1.4.3:

```sh
bun --smol docs/investigations/grafana-bar-chart-size.mjs \
  .grafana-bar-size/grafana-891f7973f81c6e4e0a24bed3120cca3b3cc93ebc \
  .grafana-bar-size/output \
  .
```

The final argument enables the current uPlot plugin comparison. The script writes the minified bundles and `results.json` into the output directory.
The original measurement removed the downloaded archive, extracted sources, and generated bundles after it saved this report.
