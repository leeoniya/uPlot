# Non-iterative layout: status and remaining work

Status recorded on 2026-09-15. This document describes the working tree at that checkpoint, not only the committed code.

## Goal and status

The original layout refactor is complete. uPlot no longer uses a convergence loop to fit axes and padding.

The longer-term goal remains: scale ranges can use available space and tick configuration without introducing another feedback loop.

The governing constraint is directional dependency. A stage can use dimensions established earlier, but must not change those dimensions through feedback.

## Completed work

### Ordered layout

- Removed `convergeSize()` and its cycle limit.
- Separated outer canvas sizing from internal plot layout.
- Established a height-first sequence based on physical axis orientation, not x/y scale names or axis indices.
- Consolidated geometry calculation and application in `updateLayout()`.
- Removed `shouldSetSize` and the persistent previous-rectangle fields.
- Replaced repeated full-rectangle calculations with directional calculations.
- Reduced `_commit()` to orchestration of scales, layout, drawing, interactions, and lifecycle notifications.

The current sequence is:

1. Resolve scale ranges and axis visibility.
2. Reserve horizontal-axis heights and establish baseline padding.
3. Establish the final plot height.
4. Generate vertical ticks and labels, then measure vertical-axis widths.
5. Establish the provisional plot width and generate horizontal ticks and labels.
6. Calculate final left/right overflow padding.
7. Establish the final plot width and axis positions.
8. Apply geometry, invalidate affected paths, update overlays, and draw.

### Sizing and invalidation

- `setSize()` records outer dimensions without publishing provisional geometry.
- Internal layout changes do not reset the canvas backing store.
- Identical size or pixel-ratio requests are no-ops.
- Canvas-style caches reset only after an actual backing-store reset, including initial canvas setup.
- Unchanged geometry preserves series paths unless data, scales, or an explicit rebuild invalidates them.
- Multiple size requests before a commit produce one geometry notification, including resize-away-and-back requests.
- Font scaling and path invalidation use only the final requested pixel ratio. Cancelled ratio requests preserve the existing fonts and paths.
- Plot and axis DOM writes depend on their respective geometry changes. Pixel-ratio-only updates and resize-back requests do not rewrite unchanged CSS geometry.

### Bugs fixed during review

- Canvas-coordinate conversions disagreed during a pending pixel-ratio change. `posToVal()` now uses the same rounded pixel rectangle as `valToPos()`.
- A synchronous `batch()` left an obsolete queued callback that caused a second draw. Callback identity now prevents obsolete callbacks from running.
- An obsolete callback also cannot consume later work out of microtask order. Regression tests cover later queued work and deferred hooks.

### Cursor marker alignment

- Default DOM hover markers now use the same bitmap-space position calculation as built-in canvas markers, including pixel snapping and stroke offsets.
- CSS positions use the completed canvas dimensions and retain fractional coordinates. Layout and pixel-ratio changes update stationary markers without new `_commit()` stages.
- Custom bounding boxes retain their positioning behavior. Visibility guards cover plot edges, hidden cursors, hidden series, missing values, and stale data indices.
- Regression tests compare DOM centers with recorded canvas arcs and drawing transforms. Matching centers does not guarantee identical browser antialiasing.
- A native Firefox benchmark shows extra hover cost for changed indices. [Recorded results](hover-performance.md) identify repeated scale conversions as an optimization candidate.

### Demo and tests

- Updated the axis-autosize demo to measure labels and reserve conservative overflow padding without position feedback.
- Removed the unsuccessful `nice-scale` experiment and its demo index entry.
- Added layout regressions for multiple axes, orientations, callback order, overflow, ordinal data, empty data, geometry publication, canvas state, batching, and conversions.
- Added series-toggle regressions for shared scales and multiple axes. Auto-ranged axes collapse when `scale.min == null`, then return when either series becomes visible.
- Fixed-range axes remain active after all their series become hidden. Tests also cover default padding, titles, callbacks, path invalidation, and unchanged canvas dimensions.
- Retained cursor and selection regression coverage for valid dimensions.
- Added mouse-driven selection regressions for drag directions, thresholds, outside release, pixel ratios, and rectangle-cache invalidation after resize or axis collapse.
- Added double-click reset regressions for zoomed ranges, retained selections, non-auto Y ranges, resize, axis autosizing, and non-primary buttons.
- Added inline and table legend regressions for value updates, click toggles, isolation, hover focus, cursor locking, and cached paths during focus redraws.
- Removed expectations for negative or collapsed plot dimensions. Nonpositive plot dimensions are undefined behavior, not a recovery guarantee.
- Raised the three short precision-probe deadlines from 50ms to 100ms.

## Current API contracts

### Axis sizes and participation

Horizontal `axis.size(self, null, axisIdx)` callbacks run once before tick generation. They must reserve sufficient height for rotation, truncation, and multiline labels.

Vertical `axis.size(self, values, axisIdx)` callbacks run once with formatted labels. They receive an empty array when there are no ticks, never a preliminary `null` reservation.

`cycleNum` is removed. Side participation derives from axis configuration at initialization:

- Positive numeric sizes and size callbacks participate, even when a callback returns zero.
- Numeric `size: 0` does not participate unless an axis title reserves nonzero `labelSize`.
- Hidden or inactive axes do not participate.

### Padding and overflow

All padding callbacks receive the `Layout` (0) phase for baseline padding. Only left/right callbacks then receive `Overflow` (1), after horizontal labels exist.

Both overflow callbacks see the same provisional geometry and baseline padding. Each returns a final total in CSS pixels, not an adjustment amount.

Horizontal ticks remain fixed after overflow padding changes. Drawing uses their positions in the final rectangle.

**Intentional tradeoff:** final horizontal spacing can be smaller than the `axis.space` selection target. Exact minimum-spacing enforcement and optimal edge fitting are not unfinished parts of this implementation.

Top/bottom padding and horizontal-axis heights cannot depend on the final tick selection. Measurement callbacks must preserve canvas state.

### Commit timing and notifications

`setSize()` updates `self.width` and `self.height` immediately. Geometry and coordinate conversions retain the previous completed layout until commit. Initial `bbox` fields are zero.

`setPxRatio()` updates the public requested ratio immediately. Font scaling and path invalidation wait until layout commit.

`batch()` completes pending work synchronously. Its obsolete queued callback does not draw again.

The `setSize` hook reports outer size updates and internal plot or axis geometry changes. Coalesced resize-away-and-back requests still emit one notification. Identical requests alone emit none.

`redraw(false, true)` explicitly refreshes axes and layout without a size change.

## Remaining design work: space-aware scale ranges

`setScales()` still resolves ranges before layout. Tick selection already uses the range, available dimension, and tick configuration through `getIncrSpace()` and `findIncr()`.

The remaining goal is range selection that uses the available dimension and tick configuration. It is not additional dimension awareness for tick selection.

The next architectural steps are:

1. Separate data-extents calculation from display-range selection. Preserve existing min/max caches independently of geometry.
2. Make vertical range selection use the established plot height and tick configuration.
3. Make horizontal range selection use available width and tick configuration.
4. Define how horizontal ranging interacts with subsequent overflow padding.

### Two dependencies require explicit policies

**Horizontal overflow:** width determines ranges and ticks, labels determine padding, and padding changes width. Requiring the exact final width at every stage recreates convergence.

Possible policies include padding reservations before selection, frozen ranges and ticks after selection, or a bounded final adjustment that cannot change padding. These are future design choices.

**Visible data window:** in aligned mode, a changed horizontal range can change the visible data window and vertical extrema. Vertical labels then change axis widths and available horizontal space.

The future design must break this dependency rather than iterate it. Fixing the horizontal range or data window before vertical ranging is one possible policy.

Dimension-aware ranges are compatible with directed layout. Arbitrary bidirectional dependencies are not.

## Validation at this checkpoint

- Full suite with coverage: **538 passing tests**, including **27 layout tests**, **35 selection/reset tests**, **20 legend tests**, and **28 marker-alignment tests**.
- Demo snapshots: **242 snapshots across 22 demos** passed against both the pre-alignment build (`8c0bce3`) and the current implementation.
- The four new points snapshots preserve the original inline demo output. Existing snapshots required no updates.
- Repeated seeded renders of the extracted points demo produce identical recordings.
- Distribution build: passed.
- `git diff --check`: passed.

The automated checks use canvas-command recordings and stateful mocks, not native-browser rasterization. A native-browser smoke check remains advisable for autosizing, rotation, resize interactions, and pixel-ratio changes.

### Resource-bounded validation

Run these commands sequentially from the repository root. Do not run builds, regression suites, or other heavy jobs concurrently.

Focused layout tests:

```sh
node --max-old-space-size=256 node_modules/mocha/bin/mocha.js --no-config --no-package --reporter dot test/layout.mjs
```

Full suite with coverage:

```sh
NODE_OPTIONS='--max-old-space-size=256 --import ./scripts/register-hooks.mjs' npx --no-install nyc mocha --reporter dot --bail
```

Distribution build:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
```

The latest full suite used a three-minute execution limit. The build used a one-minute limit. The heap limit applies per Node process.

## Branch and checkpoint history

Branch: `non-iterative-layout`.

- `63dbaa2` — Replace size convergence with ordered axis layout.
- `2b39125` — Raise degenerate-range probe timeout to 100ms.
- `3a8ff7c` — Simplify layout commits and fix queued batch redraws.
- `8c0bce3` — Optimize layout invalidation and cover mouse and legend interactions.

The cursor marker alignment changes, their regression tests, documentation, and rebuilt bundles remain uncommitted at this checkpoint.

The review left the small layout-array allocations unchanged. Reusable scratch arrays add persistent state without a measured benefit. Caching arbitrary tick callback results requires an explicit dependency contract because callbacks can depend on external state.

## Relevant files

- [Core implementation](../../src/uPlot.js)
- [Layout regressions](../../test/layout.mjs)
- [Mouse-driven selection regressions](../../test/cursor-drag.mjs)
- [Cursor marker alignment regressions](../../test/cursor-points.mjs)
- [Hover performance results](hover-performance.md)
- [Legend interaction regressions](../../test/legend.mjs)
- [API contracts](../README.md#axis-layout--padding)
- [Type declarations](../../dist/uPlot.d.ts)
- [Axis-autosize demo](../../demos/axis-autosize.html)
- [Precision regressions](precision-regressions.md)
