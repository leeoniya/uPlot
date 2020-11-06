## 📈 μPlot

A small ([< 30 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)), [fast](#performance) chart for time series, lines, areas, ohlc & bars _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)-based chart for plotting [time series](https://en.wikipedia.org/wiki/Time_series), lines, areas, ohlc & bars; from a cold start it can create an interactive chart containing 150,000 data points in 135ms, scaling linearly at [~25,000 pts/ms](https://leeoniya.github.io/uPlot/bench/uPlot-10M.html). In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at < 30 KB, it's likely the smallest and fastest time series plotter that doesn't make use of [context-limited](https://bugs.chromium.org/p/chromium/issues/detail?id=771792) WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

However, if you're looking for true real-time 60fps performance with massive datasets, uPlot [can only get you so far](https://huww98.github.io/TimeChart/docs/performance).
WebGL should still be the tool of choice for applications like realtime signal or waveform visualizations:
Try [danchitnis/webgl-plot](https://github.com/danchitnis/webgl-plot), [huww98/TimeChart](https://github.com/huww98/TimeChart), [epezent/implot](https://github.com/epezent/implot).

---
![uPlot Chart](uPlot.png "uPlot Chart")

---
### Features

- Multiple series w/toggle
- Multiple y-axes, scales & grids
- Temporal or numeric x-axis
- Linear, uniform or [logarithmic](https://leeoniya.github.io/uPlot/demos/log-scales.html) scales
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
- No collision avoidance for axis tick labels, so may require manual tweaking of spacing metrics if label customization signficiantly increases default label widths.
- No [stacked series](https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html) or [line smoothing](http://www.vizwiz.com/2011/12/when-you-use-smoothed-line-chart-your.html). See links for how these are each terrible at actually communicating information. While neither will be part of the core, uPlot's API makes it easy to implement both: [stacked-series](https://leeoniya.github.io/uPlot/demos/stacked-series.html), [line-smoothing](https://leeoniya.github.io/uPlot/demos/line-smoothing.html).
- No built-in drag scrolling/panning due to ambiguous native zoom/selection behavior. However, this can be added externally via the plugin/hooks API: [zoom-wheel](https://leeoniya.github.io/uPlot/demos/zoom-wheel.html), [zoom-touch](https://leeoniya.github.io/uPlot/demos/zoom-touch.html).

---
### Documentation (WIP)

The docs are a perpetual work in progress, it seems.
Start with [/docs/README.md](https://github.com/leeoniya/uPlot/tree/master/docs) for a conceptual overview.
The full API is further documented via comments in [/dist/uPlot.d.ts](https://github.com/leeoniya/uPlot/blob/master/dist/uPlot.d.ts).
Additionally, an ever-expanding collection of runnable [/demos](https://leeoniya.github.io/uPlot/demos/index.html) covers the vast majority of uPlot's API.

---
### Performance

Benchmarks done on a ThinkPad T480S:

- Date: 2020-09-18
- Windows 10 x64, Chrome 85.0.4183.102 (Official Build) (64-bit)
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

![uPlot Performance](perf.png "uPlot Performance")

Full size: https://leeoniya.github.io/uPlot/demos/multi-bars.html

Raw data: https://github.com/leeoniya/uPlot/blob/master/bench/results.json

<pre>
| lib            | size    | done    | js,rend,paint,sys | heap peak,final | interact (10s)      |
| -------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>          |   28 KB |   65 ms |   99   5   1   67 |  15 MB   3 MB   |  198  371  129  237 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>  |  229 KB |  235 ms |  289   2   1   95 |  32 MB  20 MB   | 3604   34   46 6125 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a> |  931 KB |  --- ms |  356   3   1   70 |  26 MB  20 MB   | 9114   65   55  272 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>       |  125 KB |  185 ms |  260   4   2  171 |  93 MB  48 MB   | 2294  241  114  404 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>       |  479 KB |  323 ms |  378   5   1   93 |  40 MB  25 MB   | 2173  457  119  397 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>           |  494 KB |  334 ms |  202   7   2  283 |  24 MB  19 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/dvxcharts.html">dvxcharts</a>      |  369 KB |  326 ms |  585  34   2   62 |  62 MB  26 MB   | 1394  717  204  270 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>     |  384 KB |  --- ms |  748   9   2   75 |  49 MB  21 MB   | 2012  725  217  317 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>       |  245 KB |  654 ms |  718   4   2  164 | 101 MB  85 MB   | 5550    5    7 4020 |
| <a href="https://leeoniya.github.io/uPlot/bench/Plotly.js.html">Plotly.js</a>      | 3400 KB |  465 ms |  828   7   1   83 |  50 MB  28 MB   | 1507  229   53  177 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>        |  785 KB |  --- ms |  718   6   7 1120 | 116 MB  77 MB   | 2016   70   25 7856 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>     |  460 KB |  --- ms | 2137  28   3   73 | 170 MB  97 MB   | 2030  220   28  122 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>      |  857 KB | 2535 ms | 2711   7   1   66 | 143 MB  85 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>       | 1200 KB | 5825 ms | 7509  47  13   78 | 256 MB 256 MB   | 6932 1288  282  512 |
</pre>

- `size` includes the lib itself plus any dependencies required to render the benchmark, e.g. Moment, jQuery, etc.
- Flot does not make available any minified assets and all their examples use the uncompressed sources; they also use an uncompressed version of jQuery :/

TODO (all of these use SVG, so performance should be similar to Highcharts):

- Chartist.js
- d3-based
  - C3.js
  - dc.js
  - MetricsGraphics
  - rickshaw

---
### Acknowledgements

- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for μPlot's inception.
- Adam Pearce for [#15 - remove redundant lineTo commands](https://github.com/leeoniya/uPlot/issues/15).
