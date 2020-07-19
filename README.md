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

- Windows 10 x64, Chrome 83.0.4103.24 (Official Build) (32-bit)
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

![uPlot Performance](perf.png "uPlot Performance")

Full size: https://leeoniya.github.io/uPlot/demos/multi-bars.html

Raw data: https://github.com/leeoniya/uPlot/blob/master/bench/results.json

<pre>
| lib            | size    | done    | js,rend,paint,sys | heap peak,final | interact (10s)      |
| -------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>          |   24 KB |   68 ms |   93   3   3   74 |  16 MB   3 MB   |  245  434  136  263 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>  |  253 KB |  241 ms |  299   3   3   94 |  35 MB  28 MB   | 3029   35   96 6704 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>       |  125 KB |  199 ms |  263   6   4  177 |  64 MB  47 MB   | 2610  268  331  441 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>           |  494 KB |  325 ms |  210   8   5  290 |  25 MB  24 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>       |  459 KB |  347 ms |  424   4   3  113 |  37 MB  26 MB   | 2499  561  346  456 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a> |  924 KB |  --- ms |  600   5   4   89 |  39 MB  13 MB   | 9534   34   56  119 |
| <a href="https://leeoniya.github.io/uPlot/bench/jqChart.html">jqChart</a>        |  280 KB |  509 ms |  654   7   6  106 |  92 MB  53 MB   | 1277  400  300  369 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>     |  292 KB |  --- ms |  746   8   2   72 |  46 MB  30 MB   | 2102  778  200  290 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>       |  245 KB |  695 ms |  755   7   6  185 |  78 MB  78 MB   | 6230    4   10 3009 |
| <a href="https://leeoniya.github.io/uPlot/bench/Plotly.js.html">Plotly.js</a>      | 3400 KB |  492 ms |  884  11   2   90 |  51 MB  48 MB   | 1676  242   61  234 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>        |  752 KB |  --- ms |  777   5  11 1132 | 120 MB  81 MB   | 2425   60   54 7650 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>     |  458 KB |  --- ms | 2357  31  69   64 | 162 MB  96 MB   | 2179  219 7806   59 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>      |  699 KB | 2720 ms | 2992   8   1   65 | 202 MB 119 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>       | 1200 KB | 6700 ms | 6704  49  25   99 | 268 MB 268 MB   | 6700 1414 1183  505 |
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
