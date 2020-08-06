## 📈 μPlot

A small ([< 25 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)), [fast](#performance) chart for time series, lines, areas, ohlc & bars _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)-based chart for plotting [time series](https://en.wikipedia.org/wiki/Time_series), lines, areas, ohlc & bars; from a cold start it can create an interactive chart containing 150,000 data points in 135ms, scaling linearly at [~25,000 pts/ms](https://leeoniya.github.io/uPlot/bench/uPlot-10M.html). In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at < 25 KB, it's likely the smallest and fastest time series plotter that doesn't make use of [context-limited](https://bugs.chromium.org/p/chromium/issues/detail?id=771792) WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

However, if you're looking for true real-time 60fps performance with massive datasets, uPlot [can only get you so far](https://huww98.github.io/TimeChart/docs/performance).
WebGL should still be the tool of choice for applications like realtime signal or waveform visualizations:
Try [danchitnis/webgl-plot](https://github.com/danchitnis/webgl-plot) or [huww98/TimeChart](https://github.com/huww98/TimeChart).

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
- No built-in drag scrolling/panning. Maintaining good perf with huge datasets would require a lot of extra code & multiple `<canvas>` elements to avoid continuous redraw and rescaling on each dragged pixel. If you have fewer than tens of thousands of datapoints, you can use uPlot's API to implement smooth zooming or panning. e.g. [zoom-wheel](https://leeoniya.github.io/uPlot/demos/zoom-wheel.html), [zoom-touch](https://leeoniya.github.io/uPlot/demos/zoom-touch.html). Pagination of data also works well.

---
### Documentation (WIP)

The docs are a perpetual work in progress, it seems.
Start with [/docs/README.md](https://github.com/leeoniya/uPlot/tree/master/docs) for a conceptual overview.
The full API is further documented via comments in [/dist/uPlot.d.ts](https://github.com/leeoniya/uPlot/blob/master/dist/uPlot.d.ts).
Additionally, an ever-expanding collection of runnable [/demos](https://leeoniya.github.io/uPlot/demos/index.html) covers the vast majority of uPlot's API.

---
### Performance

Benchmarks done on a ThinkPad T480S:

- Date: 2020-08-01
- Windows 10 x64, Chrome 84.0.4147.105 (Official Build) (64-bit)
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

![uPlot Performance](perf.png "uPlot Performance")

Full size: https://leeoniya.github.io/uPlot/demos/multi-bars.html

Raw data: https://github.com/leeoniya/uPlot/blob/master/bench/results.json

<pre>
| lib            | size    | done    | js,rend,paint,sys | heap peak,final | interact (10s)      |
| -------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>          |   26 KB |   68 ms |   99   3   4   68 |  12 MB   4 MB   |  196  458  135  264 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>  |  222 KB |  189 ms |  275   3   3   95 |  32 MB  21 MB   | 3411   35  112 6322 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a> |  964 KB |  --- ms |  378   4   2   70 |  24 MB  18 MB   | 9647   32   59  113 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>       |  125 KB |  190 ms |  286   5   3  174 |  57 MB  46 MB   | 2329  272  333  415 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>       |  477 KB |  320 ms |  400   4   2  103 |  40 MB  25 MB   | 2282  541  337  481 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>           |  494 KB |  320 ms |  205   7   6  307 |  24 MB  24 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/dvxcharts.html">dvxcharts</a>      |  369 KB |  347 ms |  633  41  45   72 |  42 MB  24 MB   | 1476  891  294  280 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>     |  381 KB |  --- ms |  757   9   2   63 |  27 MB  23 MB   | 1986  780  207  311 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>       |  245 KB |  668 ms |  747   6   7  174 |  82 MB  76 MB   | 5565    5   13 4111 |
| <a href="https://leeoniya.github.io/uPlot/bench/Plotly.js.html">Plotly.js</a>      | 3400 KB |  483 ms |  849  10   4   87 |  39 MB  24 MB   | 1601  216   58  203 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>        |  781 KB |  --- ms |  789   4   9 1119 |  79 MB  79 MB   | 2027   64   59 7696 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>     |  459 KB |  --- ms | 2298  30 135   61 | 151 MB 151 MB   | 2223  259 7802   66 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>      |  857 KB | 2632 ms | 2934   8   1   68 | 121 MB  97 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>       | 1200 KB | 6147 ms | 7159  56  15  112 | 251 MB 251 MB   | 6244 1163  598  448 |
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
