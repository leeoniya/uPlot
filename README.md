## 📈 μPlot

An [exceptionally fast](#performance), tiny ([~7 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)) time series chart _(MIT Licensed)_

---
### Introduction

μPlot is a very fast and memory-efficient [time series](https://en.wikipedia.org/wiki/Time_series) chart based on [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D); from a cold start it can create an interactive chart containing 150,000 data points in 50ms. In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at ~7 KB (min), it's likely the smallest and fastest time series plotter that doesn't make use of WebGL shaders or WASM, both of which have much higher startup cost and code size.

---
<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

---
### Features

- Multiple series
- Multiple y-axes & grids
- Zooming with auto-rescale
- Support for gaps in data
- Legend with live values
- Crosshair cursor
- [WIP] API for programmatic interaction

---
### Usage & API

Example: https://jsfiddle.net/v439aL1k/

```html
<link rel="stylesheet" href="src/uPlot.css">
<script src="dist/uPlot.iife.min.js"></script>
<script>
    const data = [
        [1566453600, 1566457260, 1566460860, 1566464460],   // Unix timestamps
        [0.54,       0.15,       3.27,       7.51      ],   // CPU
        [12.85,      13.21,      13.65,      14.01     ],   // RAM
        [0.52,       1.25,       0.75,       3.62      ],   // TCP Out
    ];

    const opts = {
        width: 800,
        height: 400,
        cursor: true,
        series: {
            x: {
                data: data[0],
            },
            y: [
                {
                    label: "CPU",
                    data: data[1],
                    scale: "%",
                    value: v => v.toFixed(1) + "%",
                    color: "red",
                    width: 2,
                    dash: [10, 5],
                },
                {
                    label: "RAM",
                    data: data[2],
                    scale: "%",
                    value: v => v.toFixed(1) + "%",
                    color: "blue",
                },
                {
                    label: "TCP Out",
                    data: data[3],
                    scale: "mb",
                    value: v => v.toFixed(2) + "MB",
                    color: "green",
                }
            ],
        },
        axes: {
            y: [
                {
                    scale: '%',
                    values: (vals, space) => vals.map(v => +v.toFixed(1) + "%"),
                },
                {
                    side: 3,
                    scale: 'mb',
                    values: (vals, space) => vals.map(v => +v.toFixed(2) + "MB"),
                    grid: null,
                },
            ],
        },
    };

    let uplot = new uPlot(opts);

    document.body.appendChild(uplot.root);
</script>
```

---
### Performance

<table>
    <thead>
        <tr>
            <th>Bench Demo</th>
            <th>Size (min)</th>
            <th>Render (167k)</th>
            <th>Total</th>
            <th>JS Heap</th>
            <th>Interact (10s)</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a></td>
            <td>7 KB</td>
            <td>50 ms</td>
            <td>85 ms</td>
            <td>15.2 MB</td>
            <td>254 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a></td>
            <td>121 KB</td>
            <td>195 ms</td>
            <td>287 ms</td>
            <td>113 MB</td>
            <td>2019 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a></td>
            <td>448 KB</td>
            <td>367 ms</td>
            <td>396 ms</td>
            <td>81.7 MB</td>
            <td>3418 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/jqChart.html">jqChart</a></td>
            <td>270 KB</td>
            <td>525 ms</td>
            <td>648 ms</td>
            <td>100 MB</td>
            <td>588 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a></td>
            <td>270 KB</td>
            <td>621 ms</td>
            <td>777 ms</td>
            <td>72.8 MB</td>
            <td>1275 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a></td>
            <td>153 KB</td>
            <td>1430 ms</td>
            <td>1505 ms</td>
            <td>134 MB</td>
            <td>7217 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a></td>
            <td>430 KB</td>
            <td>1440 ms</td>
            <td>2794 ms</td>
            <td>165 MB</td>
            <td>7644 ms</td>
        </tr>
        <tr>
            <td><a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a></td>
            <td>1,034 KB</td>
            <td>5134 ms</td>
            <td>5174 ms</td>
            <td>368 MB</td>
            <td>3516 ms</td>
        </tr>
    </tbody>
</table>

---
### Acknowledgements

- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for μPlot's inception.