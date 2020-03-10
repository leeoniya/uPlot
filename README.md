## 📈 μPlot

A small ([< 25 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)), [fast](#performance) chart for time series, lines, areas, ohlc & bars _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)-based chart for plotting [time series](https://en.wikipedia.org/wiki/Time_series), lines, areas, ohlc & bars; from a cold start it can create an interactive chart containing 150,000 data points in 60ms, scaling linearly at ~4,000 pts/ms. In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at < 25 KB, it's likely the smallest and fastest time series plotter that doesn't make use of [context-limited](https://bugs.chromium.org/p/chromium/issues/detail?id=771792) WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

---
![uPlot Chart](uPlot.png "uPlot Chart")

---
### Features

- Multiple series w/toggle
- Multiple y-axes, scales & grids
- Temporal or numeric x-axis
- Line & Area styles (stroke, fill, width, dash)
- Zoom with auto-rescale
- Legend with live values
- Support for [IANA Time Zone Names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) & DST
- [Support for missing data](https://leeoniya.github.io/uPlot/demos/missing-data.html)
- [Cursor sync for multiple charts](https://leeoniya.github.io/uPlot/demos/sync-cursor.html)
- [Focus closest series](https://leeoniya.github.io/uPlot/demos/focus-cursor.html)
- [Data streaming (live update)](https://leeoniya.github.io/uPlot/demos/stream-data.html)
- [High / Low bands](https://leeoniya.github.io/uPlot/demos/high-low-bands.html)
- A lean, consistent, and powerful API with hooks & plugins

---
### Non-Features

In order to stay lean, fast and focused the following features will not be added:

- No data parsing, aggregation, summation or statistical processing - just do it in advance. e.g. https://simplestatistics.org/, https://www.papaparse.com/
- No transitions or animations - they're always pure distractions.
- No DOM measuring; uPlot does not know how much space your dynamic labels & values will occupy, so requires explicit sizing and/or some CSS authoring.
- No [stacked series](https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html) or [line smoothing](http://www.vizwiz.com/2011/12/when-you-use-smoothed-line-chart-your.html). See links for how these are each terrible at actually communicating information. While neither will be part of the core, uPlot's API makes it easy to implement both: [stacked-series](https://leeoniya.github.io/uPlot/demos/stacked-series.html), [line-smoothing](https://leeoniya.github.io/uPlot/demos/line-smoothing.html).
- No built-in drag scrolling/panning. Maintaining good perf with huge datasets would require a lot of extra code & multiple `<canvas>` elements to avoid continuous redraw and rescaling on each dragged pixel. If you have fewer than tens of thousands of datapoints, you can use uPlot's API to implement smooth zooming or panning. e.g. [zoom-wheel](https://leeoniya.github.io/uPlot/demos/zoom-wheel.html), [zoom-touch](https://leeoniya.github.io/uPlot/demos/zoom-touch.html). Pagination of data also works well.

---
### Documentation (WIP)

The docs are a work in progress: https://github.com/leeoniya/uPlot/tree/master/docs

An outline of the API can be found in [issue #48](https://github.com/leeoniya/uPlot/issues/48). For the time being, visit the ever-expanding collection of [/demos](https://leeoniya.github.io/uPlot/demos/index.html) which covers the vast majority of uPlot's config & API.

---
### Performance

Benchmarks done on a ThinkPad T480S:

- Windows 10 x64, 80.0.3987.132 (Official Build) (64-bit)
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

![uPlot Performance](perf.png "uPlot Performance")

Full size: https://leeoniya.github.io/uPlot/demos/multi-bars.html

Raw data: https://github.com/leeoniya/uPlot/blob/master/bench/results.json

<pre>
| lib            | size    | done    | js,rend,paint,sys | heap peak,final | interact (10s)      |
| -------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>          |   23 KB |   60 ms |   87   4   2   62 |  15 MB   7 MB   |  162  412  134  239 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>  |  244 KB |  195 ms |  276   3   3   83 |  32 MB  20 MB   | 3391   41   98 6380 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>       |  125 KB |  165 ms |  255   5   5  172 |  89 MB  46 MB   | 1992  268  307  361 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>           |  494 KB |  345 ms |  193   6   6  291 |  23 MB  11 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>       |  448 KB |  314 ms |  398   5   4  103 |  35 MB  25 MB   | 2572 1007  346  470 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a> |  883 KB |  --- ms |  411   4   3   72 |  37 MB  16 MB   | 9742   28   46   87 |
| <a href="https://leeoniya.github.io/uPlot/bench/jqChart.html">jqChart</a>        |  273 KB |  462 ms |  547   5   2   83 |  89 MB  52 MB   |  830  605  306  421 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>     |  285 KB |  --- ms |  698   7   2   62 |  48 MB  24 MB   | 1104  610  184  289 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>       |  239 KB |  671 ms |  695   4   3  172 |  94 MB  76 MB   | 5690    5   12 4221 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>        |  734 KB |  --- ms |  734   5   8 1121 | 111 MB  76 MB   | 2286   57   53 7398 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>     |  441 KB | 1194 ms | 2216  28  71   53 | 138 MB  94 MB   | 2106  232 7972   65 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>      |  691 KB | 2567 ms | 2694   7   1   49 | 140 MB 119 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>       | 1100 KB | 5400 ms | 5860  49  13   90 | 235 MB 235 MB   | 4218 1634 3186  477 |
</pre>

- `size` includes the lib itself plus any dependencies required to render the benchmark, e.g. Moment, jQuery, etc.
- Flot does not make available any minified assets and all their examples use the uncompressed sources; they also use an uncompressed version of jQuery :/

TODO (all of these use SVG, so performance should be similar to Highcharts):

- Chartist.js
- d3-based
  - C3.js
  - dc.js
  - Plotly
  - MetricsGraphics
  - rickshaw

---
### Acknowledgements

- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for μPlot's inception.
- Adam Pearce for [#15 - remove redundant lineTo commands](https://github.com/leeoniya/uPlot/issues/15).
