# Sine-stream bundle sizes

Measured on 2026-10-22 with Rolldown 1.2.15 and Node 26.12.0.

## Summary

The demo-specific library bundles range from **51.0 kB for D3** to **512.8 kB for ECharts** before compression.
These bundles retain the features that each demo uses. They do not provide identical interfaces or identical runtime workloads.

The original demo pages still load distribution files. This investigation builds separate bundles without replacing those script references.

## Versions

The npm `latest` tags matched these direct library versions on the measurement date:

| Library | Demo version | Change |
| --- | --- | --- |
| D3 | 7.9.0 | None |
| Chart.js | 4.6.1 | Updated from 4.5.1 |
| chartjs-adapter-date-fns | 3.0.0 | Pinned the previously unversioned CDN URL |
| ECharts | 6.1.0 | None |
| uPlot | Local build, package version 1.6.32 | None |

The ECharts filename still contains `5`, but the page loads version 6.1.0.
The uPlot results describe the local distribution files, not a fresh download of the npm release.

The adapter bundle includes date-fns. The ESM build uses **date-fns 2.19.0** to match the adapter release, not the latest standalone date-fns release.
The adapter package specifies `2.19` as its build dependency. Its [release lockfile](https://github.com/chartjs/chartjs-adapter-date-fns/blob/v3.0.0/package-lock.json) resolves 2.19.0.
The browser check confirmed that both pinned Chart.js CDN scripts match the installed distribution files byte for byte.

## Library bundles

All values in the tables are **bytes**. Gzip uses level 9. Brotli uses quality 11.
Each bundle contains its dependencies. Rows are not additive, except for the explicit Chart.js distribution total.

| Library | Full minified distribution | Demo-specific minified bundle | Gzip | Brotli |
| --- | ---: | ---: | ---: | ---: |
| D3 | 279,706 | **51,027** | 17,278 | 15,382 |
| uPlot, local build | 76,138 | **76,441** | 31,929 | 28,864 |
| Chart.js and date adapter | 260,732 | **219,327** | 69,180 | 60,561 |
| ECharts | 1,121,883 | **512,754** | 170,850 | 145,613 |

D3 decreases by about 81.8%, Chart.js by 15.9%, and ECharts by 54.3% before compression.
Ordinary tree-shaking does not materially reduce uPlot for this entry point.
Its small size increase reflects the different output and minifier configuration, not additional features.

### Full distribution details

| Distribution | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| D3 minified | 279,706 | 92,459 | 77,652 |
| Chart.js minified | 210,082 | 71,003 | 61,412 |
| Date adapter bundle, minified | 50,650 | 11,688 | 10,105 |
| Chart.js and adapter total | 260,732 | 82,691 | 71,517 |
| ECharts minified | 1,121,883 | 368,202 | 298,840 |
| uPlot minified | 76,138 | 31,893 | 28,842 |
| uPlot unminified, currently loaded by its demo | 185,025 | 47,474 | 41,312 |

The Chart.js total adds the sizes of two separately compressed files.
The uPlot library comparison uses its minified distribution, although the page currently loads the unminified file.

## Complete demo JavaScript

These bundles contain the library subset and all inline demo JavaScript.
That includes data generation, chart configuration, interactions, and the update loop.
HTML and CSS are not included.

| Demo | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| D3 | **53,982** | 18,593 | 16,544 |
| uPlot | **77,678** | 32,546 | 29,415 |
| Chart.js | **221,647** | 70,192 | 61,271 |
| ECharts | **515,881** | 171,946 | 146,177 |

The uPlot stylesheet adds 2,556 bytes, or 968 bytes with gzip and 800 bytes with Brotli.
The other demos use inline CSS or JavaScript-generated styles. Those costs are not separate stylesheet entries in this assessment.

## Included features

### D3

The subset exports eight functions from five packages:

```js
export {select, pointer} from "d3-selection";
export {scaleTime, scaleLinear} from "d3-scale";
export {line, area} from "d3-shape";
export {timeHour} from "d3-time";
export {bisectCenter} from "d3-array";
```

Direct package imports matter. The same exports from the umbrella `d3` package produce **67,541 bytes**, or 22,301 bytes with gzip.
That entry point retains side-effect code from modules that this demo does not otherwise need.
The direct imports avoid that code without unsafe side-effect overrides.

The demo caches the fixed Y tick positions and labels, both axis formatters, and the midnight/noon interval.
It still calculates X ticks for the moving domain each frame.
The legend resets only after it shows hover values, not on every unhovered frame.

### Chart.js

The bundle registers these components:

- `LineController`
- `LineElement` and `PointElement`
- `TimeScale` and `LinearScale`
- `Filler`, `Legend`, and `Tooltip`

It also imports the date adapter and its date-fns dependencies.
The bundle preserves filled lines, time ticks, the legend, and tooltips. It does not use `chart.js/auto`.

The demo retains its hourly tick generation and midnight/noon filter.
A twelve-hour step alone does not guarantee those local clock boundaries.
The demo also retains fresh point objects for each update, consistent with incoming data snapshots rather than persistent mutable objects.

### ECharts

The bundle uses `echarts/core` and registers these components:

- `LineChart`
- `GridComponent`
- `TooltipComponent`
- `LegendComponent`
- `DatasetComponent`
- `CanvasRenderer`

The current demo uses fixed grid margins:

```js
grid: {
    containLabel: false,
    outerBoundsMode: "none",
    left: 50,
    top: 50,
    right: 40,
    bottom: 50,
}
```

This configuration removes the need for `LegacyGridContainLabel` and disables automatic plot-boundary adjustment.
Normal axis layout and text measurement remain. Runtime configuration does not let the bundler remove every unused layout branch.

The current demo also uses a 1920-pixel container and explicit area opacity of 1.
The fill colors still contain alpha, so this configuration does not eliminate alpha blending.

The bundle retains the tooltip, legend, and packed `Float64Array` dataset.
The demo still converts epoch seconds to epoch milliseconds during packing.
Earlier input-format and tooltip experiments did not establish a compelling runtime improvement, so those experimental variants are not part of these sizes.

### uPlot

The bundle imports the local `dist/uPlot.esm.js` default export.
The constructor and attached APIs retain effectively the full library.
This assessment does not disable source feature flags or modify the library to remove unused methods.

## Method

The [measurement script](sine-stream-bundle-size.mjs) extracts the current inline scripts from these pages:

- `bench/D3-sine-stream.html`
- `bench/Chart.js4-sine-stream.html`
- `bench/ECharts5-sine-stream.html`
- `demos/sine-stream.html`

Library-only bundles use ES module output. Complete demo bundles use IIFE output.
All builds use the browser platform, `minify: true`, and default tree-shaking.
The production define replaces `process.env.NODE_ENV` with `"production"`.
No build uses an unsafe side-effect override or a custom minifier configuration.

Every build produces one self-contained JavaScript chunk without external imports, dynamic imports, or source maps.
Distribution sizes come from the installed release files. Compression uses local Node APIs, not CDN transfer headers.
The measurements exclude HTTP headers, source-map payloads, and HTML.

The [results file](sine-stream-bundle-size-results.json) records exact sizes, dependency versions, runtime versions, and SHA-256 hashes.
It also records hashes of the demo inputs and the local uPlot ESM distribution.

## Validation

All nine bundles built without warnings or unresolved imports.
The Chart.js 4.6.1 browser check passed in Firefox 158.0.1.
It compared the full distribution, the registered library subset, and the complete demo bundle.

The check covered initial rendering, one stream update, a legend toggle, and tooltip hover.
All three pages produced identical canvas pixels at each stage. The browser reported no errors.
The check used fixed time, seeded random data, and **15 controlled animation-frame steps total**.

A separate D3 check compared the original page against the axis-cache and legend changes in Firefox 158.0.1.
It used **16 controlled animation-frame steps total** and covered idle frames, hover, streaming, plot-margin exit, and canvas exit.
Canvas pixels and legend text matched at all nine snapshots. X ticks remained at midnight/noon in the UTC test timezone.
Mutation checks confirmed no idle legend writes and one reset per exit after hover values appeared.

Earlier browser checks covered the current ECharts fixed-layout configuration and subset registration.
This assessment did not repeat those checks. uPlot received build checks only.
No runtime performance benchmark accompanied this size assessment.

## Reproduction

With the project development dependencies installed, run these commands from the repository root:

```sh
npm install --prefix .cache/sine-stream-size --save-exact --ignore-scripts --no-audit --no-fund d3@7.9.0 chart.js@4.6.1 chartjs-adapter-date-fns@3.0.0 date-fns@2.19.0 echarts@6.1.0
node docs/investigations/sine-stream-bundle-size.mjs
```

The script requires Rolldown 1.2.15 from the project installation.
It writes generated entries and bundles into `.cache/sine-stream-size/`.
It updates `docs/investigations/sine-stream-bundle-size-results.json`.
It does not rebuild uPlot or modify the demo pages.

The isolated installation preserves the root dependency files.
Its package lock preserves resolved dependencies locally. A fresh installation can resolve different transitive versions later.
The recorded dependency versions and input hashes identify this measurement without reliance on the cache directory.

If a dependency URL or required version changes, update the script before the next measurement.
The script rejects unexpected versions and script references rather than silently comparing different inputs.
