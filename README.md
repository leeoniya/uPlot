## 📈 Plotty

An [exceptionally fast](#performance), tiny ([~4 KB min](https://github.com/leeoniya/plotty/tree/master/dist/plotty.iife.min.js)) time series chart _(MIT Licensed)_

---
### Introduction

Plotty is a very fast and memory-efficient [time series](https://en.wikipedia.org/wiki/Time_series) chart based on [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D); from a cold start it can create an interactive chart containing 150,000 data points in 50ms. In addition to fast initial render, the zooming and cursor performance if by far the best of any similar charting lib; at ~4 KB (min), it's likely the smallest and fastest time series plotter that doesn't make use of WebGL shaders or WASM, both of which have much higher startup cost and code size.

---
### Goals & Non-goals

---
<h3 align="center">Live Demo: <a href="https://leeoniya.github.io/plotty/demo/">https://leeoniya.github.io/plotty/demo/</a></h3>

---
### Installation

```html
<script src="dist/plotty.iife.min.js"></script>
```

---
### Usage & API

```js

```

---
### Features


---
### Performance


---
### Acknowledgements

- Luke Edwards' [tinydate](https://github.com/lukeed/tinydate) is integrated into Plotty (and exposed as `Plotty.tinydate`) for fast and terse date/time formatting.