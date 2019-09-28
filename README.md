## 📈 Plotty

An [exceptionally fast](#performance), tiny ([~4 KB min](https://github.com/leeoniya/plotty/tree/master/dist/plotty.iife.min.js)) time series chart _(MIT Licensed)_

---
### Introduction

Plotty is a very fast and memory-efficient [time series](https://en.wikipedia.org/wiki/Time_series) chart based on [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D); from a cold start it can create an interactive chart containing 150,000 data points in 50ms. In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at ~4 KB (min), it's likely the smallest and fastest time series plotter that doesn't make use of WebGL shaders or WASM, both of which have much higher startup cost and code size.

---
<h3 align="center">130,000 point demo: <a href="https://leeoniya.github.io/plotty/demo/">https://leeoniya.github.io/plotty/demo/</a></h3>

---
### Features

- Tiny lib size
- Starts fast and stays fast
- Easily handles 150k+ data points
- Multiple series, with live values in legend
- Zooming with auto-rescaling
- Support for gaps in data
- Crosshair cursor

---
### Goals & Non-goals

[TODO]

---
### Installation

```html
<script src="dist/plotty.iife.min.js"></script>
```

---
### Usage & API

[TODO]

---
### Performance

[TODO]

---
### Acknowledgements

- Luke Edwards' [tinydate](https://github.com/lukeed/tinydate) is integrated into Plotty (and exposed as `Plotty.tinydate`) for fast and terse date/time formatting.
- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for Plotty's inception.