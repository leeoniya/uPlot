## 📈 μPlot

A small ([~35 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)), [fast](#performance) chart for time series, lines, areas, ohlc & bars _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)-based chart for plotting [time series](https://en.wikipedia.org/wiki/Time_series), lines, areas, ohlc & bars; from a cold start it can create an interactive chart containing 150,000 data points in 135ms, scaling linearly at [~25,000 pts/ms](https://leeoniya.github.io/uPlot/bench/uPlot-10M.html). In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at ~35 KB, it's likely the smallest and fastest time series plotter that doesn't make use of [context-limited](https://bugs.chromium.org/p/chromium/issues/detail?id=771792) WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

However, if you need 60fps performance with massive streaming datasets, uPlot [can only get you so far](https://huww98.github.io/TimeChart/docs/performance).
WebGL should still be the tool of choice for applications like realtime signal or waveform visualizations:
See [danchitnis/webgl-plot](https://github.com/danchitnis/webgl-plot), [huww98/TimeChart](https://github.com/huww98/TimeChart), [epezent/implot](https://github.com/epezent/implot), or commercial products like [LightningChart®](https://www.arction.com/lightningchart-js/).

---
![uPlot Chart](uPlot.png "uPlot Chart")

---
### Features

- Multiple series w/toggle
- Multiple y-axes, scales & grids
- Temporal or numeric x-axis
- Linear, uniform or [logarithmic](https://leeoniya.github.io/uPlot/demos/log-scales.html) scales
- Line & Area styles (stroke, fill, width, dash)
- Pluggable path renderers [linear, spline, stepped, bars](https://leeoniya.github.io/uPlot/demos/line-paths.html)
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
- No collision avoidance for axis tick labels, so may require manual tweaking of spacing metrics if label customization significiantly increases default label widths.
- No stacked series: see ["Stacked Area Graphs Are Not Your Friend"](https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html) and a [horrific demo](https://leeoniya.github.io/uPlot/demos/stacked-series.html). While smooth spline interpolation is available, its use is strongly discouraged: [Your data is misrepresented!](http://www.vizwiz.com/2011/12/when-you-use-smoothed-line-chart-your.html). Both visualizations are terrible at accurately communicating information.
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

- Date: 2020-12-25
- Windows 10 x64, Chrome 87.0.4280.88 (Official Build) (64-bit)
- Core i5-8350U @ 1.70GHz, 16GB RAM
- Intel HD 620 GPU, 2560x1440 res

![uPlot Performance](perf.png "uPlot Performance")

Full size: https://leeoniya.github.io/uPlot/demos/multi-bars.html

Raw data: https://github.com/leeoniya/uPlot/blob/master/bench/results.json

<pre>
| lib             | size    | done    | js,rend,paint,sys | heap peak,final | mousemove (10s)     |
| --------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>           |   38 KB |   65 ms |   93   2   1   50 |  13 MB   3 MB   |  167  384  128  223 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>         |  954 KB |  114 ms |  149   2   2   55 |  13 MB   5 MB   | 2783  495  147  698 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>            |  494 KB |  110 ms |  166   5   2   73 |  32 MB  18 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>        |  125 KB |  155 ms |  200   4   1   98 |  72 MB  49 MB   | 1663  237  113  374 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>   |  219 KB |  250 ms |  290   2   1   65 |  33 MB  20 MB   | 6256   50   79 1313 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart®</a> | 1000 KB |  --- ms |  359   3   1   54 |  26 MB  18 MB   | 9308   87   71  279 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>        |  479 KB |  292 ms |  340   3   1   80 |  38 MB  27 MB   | 1782  431  112  354 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>      |  319 KB |  --- ms |  370   8   2   61 |  52 MB  38 MB   | 1806  661  176  243 |
| <a href="https://leeoniya.github.io/uPlot/bench/dvxcharts.html">dvxcharts</a>       |  362 KB |  310 ms |  518  26   2   68 |  62 MB  24 MB   | 1033  592  146  189 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>        |  245 KB |  616 ms |  661   3   2   70 |  92 MB  79 MB   | 8471    6    9 1152 |
| <a href="https://leeoniya.github.io/uPlot/bench/Plotly.js.html">Plotly.js</a>       | 3500 KB |  449 ms |  769   8   2   82 |  56 MB  23 MB   | 1522  201   52  172 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>      |  471 KB |  --- ms | 2070  25   2   76 | 154 MB  95 MB   | 8593  713  106  174 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>       |  856 KB | 2476 ms | 2640   7   1   47 | 140 MB 111 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>        | 1200 KB | 5564 ms | 6057  40  11   80 | 235 MB 231 MB   | 6309  650  248  375 |
</pre>

- libs are sorted by their initial, cold-start, render performance (excluding network transfer time to download the lib)
- `size` includes the lib itself plus any dependencies required to render the benchmark, e.g. Moment, jQuery, etc.
- Flot does not make available any minified assets and all their examples use the uncompressed sources; they also use an uncompressed version of jQuery :/

Some libraries provide their own performance demos:

- https://echarts.apache.org/next/examples/en/index.html
- https://github.com/sveinn-steinarsson/flot-downsample/
- https://dygraphs.com/tests/dygraph-many-points-benchmark.html
- https://www.chartjs.org/docs/latest/general/performance.html
- https://dash.plotly.com/performance
- https://www.highcharts.com/docs/advanced-chart-features/boost-module
- https://danchitnis.github.io/webgl-plot-examples/vanilla/
- https://huww98.github.io/TimeChart/docs/performance
- https://www.arction.com/lightningchart-js-performance/

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
