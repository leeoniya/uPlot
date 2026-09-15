# Local reproduction of issue #1108

These screenshots reproduce the green hover-marker displacement from https://github.com/leeoniya/uPlot/issues/1108.
They are local browser captures, not images from the issue.

## Setup

- Demo: the second chart from `demos/points.js`, isolated on the page without changes to its data configuration or chart dimensions.
- Data: the existing snapshot seed, identical before and after the fix. The random data differs from the issue attachment.
- Before: `dist/uPlot.esm.js` from commit `8c0bce3`, before our cursor-marker alignment changes.
- After: the working-tree `dist/uPlot.esm.js`.
- Browser: headless Firefox 155.0.1 on Linux, at device pixel ratio 2.
- Viewport: 1980 × 440 CSS pixels. Native screenshots: 3960 × 880 pixels.
- Interaction: a WebDriver BiDi mouse move at the same position in each capture.

The capture selects an interior point with a large displacement in the old implementation.
Both versions use this same point (index 46, X = 47).

## Results

Coordinates use CSS pixels relative to the viewport.

| Center | Before | After |
| --- | --- | --- |
| Canvas marker | (544, 217) | (544, 217) |
| DOM hover marker | (545, 218) | (544, 217) |
| Hover displacement | (+1, +1) | (0, 0) |

The old hover marker sits two screenshot pixels right and two screenshot pixels below the canvas marker.
The fixed hover marker shares the canvas marker center.
DOM and canvas rasterization can still differ.

`measurements.json` contains the data, browser details, and measurements.
The page records native canvas arcs and drawing transforms without changes to their arguments.
DOM measurements come from `getBoundingClientRect()` after the mouse move.

## Images

- `before-full.png`, `after-full.png`: native browser screenshots.
- `canvas-only-full.png`: the same fixed chart without hover, for reference.
- `*-crop.png`: identical crops around the selected point, at native resolution.
- `*-zoom.png`: nearest-neighbor enlargements of those crops to four times their CSS size.
- `comparison.png`: labeled reference, before, and after panels. Labels sit outside the plot images.

## Capture again

Run these commands sequentially from the repository root:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
node --max-old-space-size=128 artifacts/point-alignment/capture.mjs
```

The capture command replaces the three full screenshots and `measurements.json`.
It starts one Firefox instance and removes its temporary profile after the captures.
It requires Firefox, Node with built-in WebSocket support, and commit `8c0bce3` in the local repository.
