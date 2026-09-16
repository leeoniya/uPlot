# Issue 20: export pixel ratio reproduction

## Result

The final substantive [comment](https://github.com/leeoniya/uPlot/issues/20#issuecomment-4369427688) reports a limitation in npm `uplot@1.6.32`.
The [last comment](https://github.com/leeoniya/uPlot/issues/20#issuecomment-4449203114) repeats the request to release per-instance pixel ratio support.

**The published-package limitation reproduces.** The current repository bundle does not have that limitation.
Both advertise version `1.6.32`, but their implementations differ.

The author-facing demo is [issue-20-export-pxratio.html](../demos/issues/issue-20-export-pxratio.html).
It uses only the local current build, with no external requests.
Two detached chart instances export at DPR 1 and 4. The page shows PNG previews, dimensions, and download links.
The comparison results in this report came from the earlier diagnostic version of that page.

## Release evidence

- npm `1.6.32` was published on 2025-03-14 at 02:51:47 UTC.
- Its `gitHead` is `e995b061e9fc5476a6d862cd2fb2ebc7452ca012`, also the local `1.6.32` tag.
- Per-instance DPR support arrived in `58a67b2c61e02533d98eecd4882e4eb5229575b9` later that day, at 15:40:04 UTC.
- The published package's ESM, CJS, IIFE, declarations, and package metadata match the files at that tag byte-for-byte.
- At this review, npm's `latest` tag still points to `1.6.32`.
- The current source and distribution at `e75c8b4` include the feature, but the package version string remains `1.6.32`.

The published constructor ignores `opts.pxRatio`. It has no instance `pxRatio` property or `setPxRatio()` method.
Its private ratio comes from browser DPR. The similarly named private setter is not a public instance method.

Thus, the final comments identify a release gap, not a malfunction of an implemented npm option.

## Native-browser reproduction

Environment: Linux, Firefox 155.0.1, headless, with fresh profiles at browser DPR 1 and 2.
Review date: 2026-09-16.

The test creates a 480 × 240 CSS-pixel chart with `opts.pxRatio: 4`.
It waits for the initial render, copies the chart bitmap without resampling, and exports PNG.
The checks read PNG header dimensions and require nontransparent rendered pixels.

| Bundle | Browser DPR | Requested chart DPR | Exported PNG |
| --- | --- | --- | --- |
| Published npm 1.6.32 | 1 | 4 | 480 × 240 |
| Published npm 1.6.32 | 2 | 4 | 960 × 480 |
| Current repository `dist` | 1 | 4 | 1920 × 960 |
| Current repository `dist` | 2 | 4 | 1920 × 960 |

Each result reproduces in all three container configurations:

- An attached container positioned outside the viewport.
- A detached container, without insertion into the document.
- An attached container with `display: none`.

The test uses a normal HTML canvas in an offscreen container, not the worker `OffscreenCanvas` API.
It does not reproduce the reporter's exact typography, export compositing, or screenshots, because that application code is unavailable.

The automated run served the downloaded published module locally, after a byte comparison against tag `1.6.32`.
This avoided browser network dependencies during measurement. The simplified demo no longer imports the published module.

## Current setter timing

The public setter works after a chart's initial render, but does not synchronously redraw:

| Operation | Instance ratio | Bitmap |
| --- | --- | --- |
| Initial chart at ratio 1 | 1 | 480 × 240 |
| Immediately after `u.setPxRatio(4)` | 4 | 480 × 240 |
| After its queued commit | 4 | 1920 × 960 |
| After `u.batch(() => u.setPxRatio(2))` returns | 2 | 960 × 480 |

Waiting for the commit is part of the current documented behavior.
A synchronous `batch()` also completes the render before the export reads the canvas.
Exporting at the source bitmap size avoids an additional resize of the bitmap.

## Fixed in source: setter inside `ready`

The initial probe found this defect in the `e75c8b4` build:

```js
const opts = {
  width: 480,
  height: 240,
  pxRatio: 1,
  hooks: {
    ready: [u => u.setPxRatio(4)],
  },
};
```

Before the fix, `u.pxRatio` reported `4` after a timer, but the canvas and exported PNG remained 480 × 240.
A later `redraw()` scheduled the pending work and produced 1920 × 960.
This defect reproduced at browser DPR 1 and 2.

The initial commit called `ready` before clearing `queuedCommit`.
The setter marked layout and canvas work pending, but `commit()` saw an existing commit and did not enqueue another.

The source fix completes commit cleanup before it calls `ready`.
Setters in `ready` can now schedule a follow-up commit. Immediate exports still need to wait for that asynchronous render.
The fix does not change the scheduling behavior of earlier drawing hooks.

This is not evidence that the reporter used a `ready` hook. Their final comments contain no reproduction code.
The reliable constructor path is to supply `pxRatio: 4` before construction, as the main test does.
`test/ready.mjs` contains nine regressions for the fix, including no-op updates, coalescing, synchronous batches, deferred hooks, and obsolete callbacks.
Six tests fail against the old source. All nine pass with the cleanup order corrected.

## Validation and artifacts

The initial comparison passed 18 browser checks, with additional observations that exposed the `ready` defect.
After the fix:

- The full Node suite passed **918 tests**.
- The focused ready, layout, and issue-demo suites passed **43 tests**.
- Firefox 155 verified the simplified demo at browser DPR 1 and 2.
- The demo exported 480 × 240 and 1920 × 960 PNGs in both profiles, with previews and download links.
- A separate native-browser probe loaded the patched source and verified the `ready` setter without an extra `redraw()`.
- That probe recorded exactly two draws, one `ready` call, and a nonempty 1920 × 960 PNG in both profiles.

The browser checks use actual canvas rendering, not DOM/canvas mocks.
Chromium, Edge, and WebKit were not tested.
This review does not revisit the earlier SVG/CORS discussion in the same issue.

Generated distribution bundles remain unchanged. The constructor-based demo already works with the existing local bundle.
The `ready` timing fix is in source and needs a rebuild before distribution.

Latest local, ignored artifacts are in `test/output/issue20/`:

- `fixed-results-dpr1.json` and `fixed-results-dpr2.json`
- `ready-fixed-dpr1.png` and `ready-fixed-dpr2.png`

The runtime suite clears `test/output`, so these artifacts are temporary.
The original published export dimensions remain recorded in the comparison table.
