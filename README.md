## 📈 μPlot

An [exceptionally fast](#performance), tiny ([< 20 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)) time series & line chart _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [time series](https://en.wikipedia.org/wiki/Time_series) & line chart based on [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D); from a cold start it can create an interactive chart containing 150,000 data points in 40ms, scaling linearly at ~4,000 pts/ms. In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at < 20 KB, it's likely the smallest and fastest time series plotter that doesn't make use of WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

---
![uPlot Chart](uPlot.png "uPlot Chart")

---
### 🚧 UNDER CONSTRUCTION 🚧

**2019-10-24:** μPlot is now mostly feature-complete and its declarative `opts` API is in pretty good, future-accommodating shape. Its imperative API, docs and additional examples are still in progress.

v1.0 and API stabilization are loosely targetted for sometime before 2020-01-01. Until then, feedback, feature suggestions and real use-cases can be submitted to the issue tracker for consideration & further discussion.

---
### Features

- Multiple series w/toggle
- Multiple y-axes, scales & grids
- Temporal or numeric x-axis
- Line & Area styles (color, fill, width, dash)
- Zoom with auto-rescale
- Legend with live values
- Support for [IANA Time Zone Names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) & DST
- [Support for missing data](https://leeoniya.github.io/uPlot/demos/missing-data.html)
- [Cursor sync for multiple charts](https://leeoniya.github.io/uPlot/demos/sync-cursor.html)
- [Focus closest series](https://leeoniya.github.io/uPlot/demos/focus-cursor.html)
- [Data streaming (live update)](https://leeoniya.github.io/uPlot/demos/stream-data.html)
- [High / Low bands](https://leeoniya.github.io/uPlot/demos/high-low-bands.html)
- WIP: [Range, point & line annotations](https://github.com/leeoniya/uPlot/issues/27)
- WIP: [.resize()](https://github.com/leeoniya/uPlot/issues/36)

---
### Non-Features

In order to stay lean, fast and focused the following features will not be added:

- No data parsing, aggregation, summation or statistical processing - just do it in advance. e.g. https://simplestatistics.org/, https://www.papaparse.com/
- No transitions or animations - they're always pure distractions.
- No DOM measuring; uPlot does not know how much space your dynamic labels & values will occupy, so requires explicit sizing and/or some CSS authoring.
- No [stacked series](https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html) or [line smoothing](http://www.vizwiz.com/2011/12/when-you-use-smoothed-line-chart-your.html). See links for how these are each terrible at actually communicating information.
- Probably no drag scrolling/panning. Maintaining good perf with huge datasets would require a lot of extra code & multiple `<canvas>` elements to avoid continuous redraw and rescaling on each dragged pixel. However, since uPlot's performance allows rendering of very wide canvases, they can be scrolled naturally with CSS's `overflow-x: auto` applied to a narrower containing element. Pagination of data also works well.

---
### Documentation

- [Installation](#installation)
- [Data Format](#data-format)
- [Basics](#basics)
- [High/Low Bands](#highlow-bands)
- [Scales, Axes, Grid](#scales-axes-grid)
- [Multiple Scales & Axes](#multiple-scales--axes)
- [Scale Opts](#scale-opts)
- [Axis & Grid Opts](#axis--grid-opts)
- WIP: [#48](https://github.com/leeoniya/uPlot/issues/48)

---
#### Installation

```html
<link rel="stylesheet" href="src/uPlot.css">
<script src="dist/uPlot.iife.min.js"></script>
```

---
#### Data Format

```js
let data = [
  [1546300800, 1546387200],    // x-values (timestamps)
  [        35,         71],    // y-values (series 1)
  [        90,         15],    // y-values (series 2)
];
```

uPlot expects a columnar data format as shown above.

- x-values must be numbers, unique, and in ascending order.
- y-values must be numbers (or `null`s for missing data).
- x-values and y-values arrays must be of equal lengths >= 2.

By default, x-values are assumed to be [unix timestamps](https://en.wikipedia.org/wiki/Unix_time) (seconds since 1970-01-01 00:00:00) but can be treated as plain numbers via `scales.x.time = false`.
JavaScript uses millisecond-precision timestamps, but this precision is rarely necessary on calendar-aware `time: true` scales/plots, which honor DST, timezones, leap years, etc.
For sub-second periods, it's recommended to set `time: false` and simply use ms offsets from 0.
If you truly need calendar-aware ms level precision, simply provide the timestamps as floats, e.g. `1575354886.419`.
[More info...](https://github.com/leeoniya/uPlot/issues/60#issuecomment-561158077).

This format has implications that can make uPlot an awkward choice for multi-series datasets which cannot be easily aligned along their x-values.
If one series is data-dense and the other is sparse, then the latter will need to be filled in with mostly `null` y-values.
If each series has data at arbitrary x-values, then the x-values array must be augmented with all x-values, and all y-values arrays must be augmented with `null`s, potentially leading to exponential growth in dataset size, and a structure consisting of mostly `null`s.

This does not mean that all series must have identical x-values - just that they are alignable.
For instance, it is possible to plot [series that express different time periods](https://leeoniya.github.io/uPlot/demos/time-periods.html), because the data is equally spaced.

**Before choosing uPlot, ensure your data can conform to these requirements.**

---
#### Basics

```js
let opts = {
  title: "My Chart",
  id: "chart1",
  class: "my-chart",
  width: 800,
  height: 600,
  spanGaps: false,
  series: {
    y: [
      {
        // initial toggled state (optional)
        show: true,

        // in-legend display
        label: "RAM",
        value: (self, rawValue) => "$" + rawValue.toFixed(2),

        // series style
        color: "red",
        width: 1,
        fill: "rgba(255, 0, 0, 0.3)",
        dash: [10, 5],
      }
    ]
  }
};

let uplot = new uPlot.Line(opts, data);

document.body.appendChild(uplot.root);
```

- `id` and `class` are optional HTML attributes to set on the chart's container `<div>` (`uplot.root`).
- `width` and `height` are required dimensions in *logical* [CSS] pixels of the plotting area & axes, but **excluding** `title` or `legend` dimensions (which can be variable based on user CSS).
- `spanGaps` can be set to `true` to connect `null` data points.
- For a series to be rendered, it **must** be specified in the opts; simply having it in the data is insufficient.
- All series' options are optional; `label` will default to "Value" and `color` will default to "black".
- Series' line `width` is specified in *physical* [device] pixels (e.g. on high-DPI displays with a pixel ratio = 2, `width: 1` will draw a line with an effective width of 0.5 logical [CSS] pixels).
- `color`, `width`, `fill`, and `dash` map directly to Canvas API's [ctx.strokeStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/strokeStyle), [ctx.lineWidth](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineWidth), [ctx.fillStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillStyle), and [ctx.setLineDash](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setLineDash).

---
#### High/Low Bands

High/Low bands are defined by two adjacent `data` series in low,high order and matching opts with `series.band = true`.

```js
const opts = {
  series: {
    y: [
      {
        label: "Low",
        fill: "rgba(0, 255, 0, .2)",
        band: true,

      },
      {
        label: "High",
        fill: "rgba(0, 255, 0, .2)",
        band: true,
      },
    ],
  },
};
```

---
#### Scales, Axes, Grid

uPlot's API strives for brevity, uniformity and logical consistency.
Understanding the roles and processing order of `data`, `series`, `scales`, and `axes` will help with the remaining topics. The high-level rendering flow is this:

1. `data` is the first input into the system.
0. `series` holds the config of each dataset, such as visibility, styling, labels & value display in the legend, and the `scale` key along which they should be drawn. Implicit scale keys are `x` for the `data[0]` series and `y` for `data[1..N]`.
0. `scales` reflect the min/max ranges visible within the view. All view range adjustments such as zooming and pagination are done here. If not explicitly set via opts, `scales` are automatically initialized using the `series` config and auto-ranged using the provided `data`.
0. `axes` render the ticks, values, labels and grid along their `scale`. Tick & grid spacing, value granularity & formatting, timezone & DST handling is done here.

---
#### Multiple Scales & Axes

Series with differing units can be plotted along additional scales and display corresponding y-axes.

1. Use the same `series.scale` key.
2. Optionally, specify an additional `axis` with the `scale` key.

```js
let opts = {
  series: {
    y: [
      {
        label: "CPU",
        color: "red",
        scale: '%',
        value: (self, rawValue) => rawValue.toFixed(1) + "%",
      }
      {
        label: "RAM",
        color: "blue",
        scale: '%',
        value: (self, rawValue) => rawValue.toFixed(1) + "%",
      },
      {
        label: "TCP",
        color: "green",
        scale: 'mb',
        value: (self, rawValue) => rawValue.toFixed(2) + "MB",
      },
    ]
  },
  axes: {
    y: [
      {
        scale: '%',
        values: (self, ticks) => ticks.map(rawValue => rawValue.toFixed(1) + "%"),
      },
      {
        scale: 'mb',
        values: (self, ticks) => ticks.map(rawValue => rawValue.toFixed(2) + "MB"),
        side: 1,
        grid: {show: false},
      },
    ]
  },
};
```

- `side` is the where to place the axis (0: top, 1: right, 2: bottom, 3: left).


#### Axes for Alternate Units

Sometimes it's useful to provide an additional axis to display alternate units, e.g. °F / °C. This is done using derived scales.

```js
let opts = {
  series: {
    y: [
      {
        label: "Temp",
        color: "red",
        scale: 'F',
      },
    ]
  },
  axes: {
    y: [
      {
        scale: 'F',
        values: (self, ticks) => ticks.map(rawValue => rawValue + '° F'),
      },
      {
        scale: 'C',
        values: (self, ticks) => ticks.map(rawValue => rawValue + '° C'),
        side: 1,
        grid: {show: false},
      }
    ],
  },
  scales: {
    'C': {
      base: 'F',
      range: (self, baseMin, baseMax) => [
        (baseMin - 32) * 5/9,
        (baseMax - 32) * 5/9,
      ],
    }
  },
```

- `base` specifies the key of the scale from which another is derived.
- `range` converts the base scale's min/max into the new scale's min/max.

---
#### Scale Opts

If a scale does not need auto-ranging from the visible data, you can provide static min/max values.
This is also a performance optimization, since the data does not need to be scanned on every view change.

```js
let opts = {
  scales: {
    '%': {
      auto: false,
      range: [0, 100],
    }
  },
}
```

The default x scale is temporal, but can be switched to plain numbers. This can be used to plot functions.

```js
let opts = {
  scales: {
    'x': {
      time: false,
    }
  },
}
```

A scale's default distribution is linear `type: 1`, but can be switched to indexed/evenly-spaced.
This is useful when you'd like to squash periods with no data, such as weekends.
Keep in mind that this will prevent logical temporal tick baselines such as start of day or start of month.

```js
let opts = {
  scales: {
    'x': {
      type: 2,
    }
  },
}
```

---
#### Axis & Grid Opts

Most options are self-explanatory:

```js
let opts = {
  axes: {
    y: [
      {
        show: true,
        label: "Population",
        width: 50,
        class: 'my-y',
        color: 'red',
        grid: {
          show: true,
          color: "#eee",
          width: 2,
          dash: [],
        }
      }
    ]
  },
}
```

Customizing the tick/grid spacing, value formatting and granularity is somewhat more involved:

```js
let opts = {
  axes: {
    x: {
      space: 40,
      incrs: [
         // minute divisors (# of secs)
         1,
         5,
         10,
         15,
         30,
         // hour divisors
         60,
         60 * 5,
         60 * 10,
         60 * 15,
         60 * 30,
         // day divisors
         3600,
      // ...
      ],
      values: [
        [3600 * 24 * 365,    "{YYYY}",               7,   "{YYYY}"                    ],
        [3600 * 24 * 28,     "{MMM}",                7,   "{MMM}\n{YYYY}"             ],
        [3600 * 24,          "{M}/{D}",              7,   "{M}/{D}\n{YYYY}"           ],
        [3600,               "{h}{aa}",              4,   "{h}{aa}\n{M}/{D}"          ],
        [60,                 "{h}:{mm}{aa}",         4,   "{h}:{mm}{aa}\n{M}/{D}"     ],
        [1,                  "{h}:{mm}:{ss}{aa}",    4,   "{h}:{mm}:{ss}{aa}\n{M}/{D}"],
      ],
  //  ticks:
    }
  },
}
```

- `space` is the minumum space between adjacent ticks; a smaller number will result in smaller selected divisors.
- `incrs` are divisors available for segmenting the axis to produce ticks.
- `values` can be an array of tick formatters with breakpoints. more format details can be found in the source: https://github.com/leeoniya/uPlot/blob/master/src/opts.js#L110

---
### Performance

Benchmarks done on a ThinkPad T480S:

- Windows 10 x64, Chrome 78.0.3904.70
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

<table>
    <thead>
        <tr>
            <th>Bench Demo</th>
            <th>Size (min)</th>
            <th>Render (167k)</th>
            <th>Total</th>
            <th>Mem (peak)</th>
            <th>Mem (retained)</th>
            <th>Interact (10s)</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a></td>
            <td>20 KB</td>
            <td>39 ms</td>
            <td>71 ms</td>
            <td>19.6 MB</td>
            <td>3.7 MB</td>
            <td>154 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a></td>
            <td>172 KB</td>
            <td>130 ms</td>
            <td>190 ms</td>
            <td>42.7 MB</td>
            <td>17.3 MB</td>
            <td>--</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a></td>
            <td>121 KB</td>
            <td>168 ms</td>
            <td>251 ms</td>
            <td>113 MB</td>
            <td>66.0 MB</td>
            <td>2569 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a></td>
            <td>448 KB</td>
            <td>295 ms</td>
            <td>414 ms</td>
            <td>49.2 MB</td>
            <td>39.1 MB</td>
            <td>2401 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a></td>
            <td>883 KB</td>
            <td>--</td>
            <td>500 ms</td>
            <td>43.5 MB</td>
            <td>21.5 MB</td>
            <td>9446 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/jqChart.html">jqChart</a></td>
            <td>270 KB</td>
            <td>450 ms</td>
            <td>577 ms</td>
            <td>142 MB</td>
            <td>99.9 MB</td>
            <td>600 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a></td>
            <td>270 KB</td>
            <td>--</td>
            <td>717 ms</td>
            <td>71.7 MB</td>
            <td>40.7 MB</td>
            <td>1122 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a></td>
            <td>734 KB</td>
            <td>513 ms</td>
            <td>765 ms</td>
            <td>179 MB</td>
            <td>118.8 MB</td>
            <td>2194 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a></td>
            <td>239 KB</td>
            <td>653 ms</td>
            <td>741 ms</td>
            <td>117 MB</td>
            <td>78.9 MB</td>
            <td>5408 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a></td>
            <td>430 KB</td>
            <td>1269 ms</td>
            <td>2441 ms</td>
            <td>142 MB</td>
            <td>157.9 MB</td>
            <td>7559 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a></td>
            <td>682 KB</td>
            <td>2324 ms</td>
            <td>2518 ms</td>
            <td>220 MB</td>
            <td>175.7 MB</td>
            <td>--</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a></td>
            <td>1,034 KB</td>
            <td>6514 ms</td>
            <td>6730 ms</td>
            <td>397 MB</td>
            <td>430.0 MB</td>
            <td>7539 ms</td>
        </tr>
        <tr>
            <td>Chartist.js</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
        <tr>
            <td>C3.js (d3-based)</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
        <tr>
            <td>dc.js (d3-based)</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
        <tr>
            <td>Plotly (d3-based)</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
        <tr>
            <td>MetricsGraphics (d3-based)</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
        <tr>
            <td>rickshaw (d3-based)</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
            <td>--</td>
        </tr>
    </tbody>
</table>

```
Chrome 78.0.3904.108 (2019-11-23)

                   rend       js      sys     size  heap max  heap ret
----------------------------------------------------------------------
uPlot             40 ms    72 ms    71 ms    20 KB   19.7 MB    3.8 MB
dygraphs         180 ms   241 ms   183 ms   123 KB  113.0 MB   64.1 MB
Flot             338 ms   182 ms   290 ms   172 KB   43.5 MB   17.2 MB
CanvasJS         327 ms   374 ms    60 ms   448 KB   48.5 MB   38.2 MB
LightningChart   --- ms   490 ms    78 ms   883 KB   42.4 MB   21.1 MB
jqChart          506 ms   574 ms    96 ms   269 KB  134.0 MB  100.3 MB
Highcharts       --- ms   707 ms    62 ms   272 KB   80.4 MB   77.2 MB
Chart.js         650 ms   700 ms   178 ms   239 KB  141.0 MB  122.2 MB
ECharts          515 ms   769 ms  1043 ms   734 KB  182.0 MB  125.0 MB
ApexCharts      1255 ms  2360 ms    67 ms   435 KB  159.4 MB  159.4 MB
ZingChart       5820 ms  5957 ms    72 ms   690 KB  182.0 MB  162.8 MB
amCharts        6732 ms  6697 ms    88 ms  1024 KB  405.8 MB  405.8 MB
```

---
### Acknowledgements

- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for μPlot's inception.
- Adam Pearce for [#15 - remove redundant lineTo commands](https://github.com/leeoniya/uPlot/issues/15).
