# Zero-thickness strokes in stacked areas

## Status and scope

This investigation covers zero-thickness strokes, gap semantics, userspace workarounds, and possible support for stacking in core.

The current implementation includes `Paths.clipStroke` and a four-chart comparison demo. Core stacking and classified gaps remain proposals, not implemented features.

Relevant files:

- [Comparison page](../../demos/stacked-zero-gaps.html)
- [Demo implementation](../../demos/stacked-zero-gaps.js)
- [Existing stacking helpers](../../demos/stack.js)
- [Renderer](../../src/uPlot.js): `drawPath()`, `fillStroke()`, `strokeFill()`, and `doStroke()`
- [Path helpers](../../src/paths/utils.js): `clipGaps()` and `findGaps()`
- [Public typings](../../dist/uPlot.d.ts): `Series.Paths` and `Series.Points.Paths`
- [Renderer tests](../../test/clip-stroke.mjs)
- [Demo tests](../../test/stacked-zero-gaps.mjs)

## Problem

Stacking converts each layer's raw values into cumulative boundary values. A zero raw value places the upper boundary on the lower boundary. The upper layer still draws its stroke there, which can obscure the stroke of a nonzero layer underneath.

Zero thickness is not missing data. The boundary still exists and remains useful to the next band.

For nonnegative linear layers, a segment has zero thickness when both adjacent raw values are zero. An isolated zero is a contact point, not an interval to remove.

Example:

```text
x:       0  1  2  3
raw:     3  0  0  4
hide:       [1, 2]
keep:    [0, 1] and [2, 3]
```

The retained segments preserve the descent and ascent. The gap does not remove their boundary samples.

## Existing gap behavior

A standard path builder receives gap intervals from `series.gaps`. It converts those intervals into `Paths.clip`, a path that describes the retained drawing region.

The renderer applies `Paths.clip` to both the series fill and stroke. For bands, it also reads the lower boundary's clip:

```js
gapsClip2 = lowerEdge._paths.clip;
```

In the usual `BAND_CLIP_FILL` branch, the renderer applies `gapsClip2` while drawing the band's fill. It restores that temporary state before drawing the upper stroke.

| Band flags | Lower boundary gap clip affects |
| --- | --- |
| `BAND_CLIP_FILL` | Band fill |
| `BAND_CLIP_STROKE` only | Neither, in the current branch |
| Both flags | Band fill and upper stroke |

This is explicit clip reuse, not canvas-state leakage. Independent series do not inherit another series' gaps. The effect applies to bands that directly use the series as a boundary, not every layer above it.

For bands `[2, 1]` and `[3, 2]`, a gap on series 2 clips its own fill and stroke. It also clips the fill of band `[3, 2]` under the normal fill-clipping flag.

That behavior fits missing boundary data. It does not fit a zero-thickness layer whose cumulative boundary remains valid.

### Why local fill clipping is not the real problem

Over a genuinely zero-thickness interval, the layer has no fill area. Clipping that layer's own fill has no visible effect.

The important problem is propagation to another band whose area is nonzero. Therefore, this stacking case does not inherently require separate fill and stroke clips. It requires a distinction between a local drawing gap and an undefined boundary.

## Alternatives considered

### Apply `series.gaps` to the filled layers

This removes the unwanted stroke without duplicate series. However, its clip also reaches fills of bands that use the layer as their lower boundary.

The naive chart demonstrates this failure. The middle orange layer is zero across x=2–5. The purple layer above it has nonzero area within that interval, but inherits a hole.

### Replace cumulative values with nulls

Nulls mark the cumulative boundary as missing. The standard builders generate gap clips from those nulls, so the same dependent-band problem remains.

Null substitution also removes samples needed for transitions. It is not equivalent to hiding only the segment between consecutive raw zeros.

### Null-mask separate stroke copies

Continuous cumulative data can still supply the fills. Separate stroke series can replace raw-zero positions with nulls.

This avoids a custom gaps callback, but loses transition endpoints. Retaining the first and last zero of each run helps preserve transitions. However, a two-sample zero run then needs an extra sample to hold a null between those endpoints.

Explicit interval gaps express this case more directly.

### Give every layer private boundary series

Each layer can use its own upper and lower boundary data. Local nulls then do not remove a boundary needed by another layer.

This adds series and data bookkeeping. It also retains the transition problem from null substitution.

### Continuous fills with gap-clipped stroke overlays

This userspace approach needs no new renderer capability:

1. Build the cumulative data for all layers.
2. Draw continuous fill series with zero stroke width.
3. Add stroke-only series that reference the same cumulative arrays.
4. Generate their gaps from consecutive raw zeros.

The overlays have no band dependents, so their gap clips cannot remove another layer's fill. The prototype disables their extrema scans and point markers.

The cost is extra series, path generation, and drawing work. The arrays can share references, but the renderer still creates separate paths.

Overlay strokes draw after all fills. This changes compositing compared with the ordinary per-series order.

## Implemented primitive: `clipStroke`

The path-builder result now accepts an optional clip:

```ts
interface Paths {
  clip?: Path2D | null;
  clipStroke?: Path2D | null;
}
```

`clipStroke` is an additional retained-region path in canvas pixels. It intersects existing clips rather than replacing them.

```text
fill:   bounds ∩ clip ∩ applicable band clips
stroke: bounds ∩ clip ∩ applicable band clips ∩ clipStroke
```

The renderer applies it only around stroke drawing. It does not affect fills, and a dependent band does not inherit it from its boundary series.

An omitted or null `clipStroke` leaves existing behavior unchanged. A null result from `uPlot.clipGaps()` means no additional clipping. An empty `Path2D` instead clips away the entire stroke.

### Implementation scope

The renderer passes the field through `drawPath()`, `fillStroke()`, and `strokeFill()` to `doStroke()`. The latter scopes the extra clip with `save()` and `restore()`.

The implementation also restores the cached stroke style after the scoped clip. This matters for multi-color stroke maps, which change the context's stroke style during drawing.

The same primitive supports custom point paths. Standard path builders do not need new gap semantics or automatic zero detection.

The change is localized to the renderer and typings. It does not change stacking, scanning, ranging, or the meaning of `series.gaps`.

### Demo integration

`zeroStrokePaths()` wraps `uPlot.paths.linear()`. It preserves the returned fill, stroke, band, and native gap clip. It adds `clipStroke` through the existing public `uPlot.clipGaps()` helper.

`zeroIntervals()` merges adjacent zero segments in data coordinates. `zeroGaps()` converts them to canvas coordinates, sorts them, and merges overlapping intervals. Pixel conversion occurs during path generation, so zoom, resize, orientation, and DPR affect the clip correctly.

The fourth chart uses three layer series, without stroke overlays.

### Naming decision

`clipStroke` describes the operation, not the reason for the clip. The renderer truly applies it only to the stroke, even when a fill has nonzero area.

`strokeClip` was an equivalent naming candidate. `clipStroke` groups the property with the existing `clip` field.

A clip that affects both local fill and stroke, but not dependent bands, is a different primitive. The tentative name `clipLocal` describes that alternative better. It is not implemented.

### Cost and compatibility

A supplied `clipStroke` adds a scoped canvas clip to each applicable stroke operation. Without it, the renderer adds no extra canvas save, clip, or restore operations.

The new demo avoids duplicate stroke series and their paths. No benchmark established a net performance improvement over overlays. Browser clipping cost and workload size remain relevant.

Normal draw order remains unchanged. Later translucent fills can still tint lower strokes, even after the coincident upper stroke disappears.

## Demo and validation findings

The page compares four approaches against the same data:

| Chart | Series excluding X | Result |
| --- | --- | --- |
| Ordinary stacked strokes | 3 | Upper zero-thickness strokes obscure lower strokes |
| Naive shared gaps | 3 | Lower strokes become visible, but dependent fills acquire holes |
| Stroke overlays | 6 | Continuous fills and independent stroke gaps |
| `clipStroke` | 3 | Continuous fills and local stroke suppression |

The fixture includes zero runs at both ends, internal zero runs, and isolated zeros. Its base layer is blue, middle layer orange, and upper layer purple.

### Automated tests

Renderer tests cover:

- Intersection with the existing clip.
- All four combinations of band-clipping flags.
- Unaffected local fills and dependent bands.
- Ordinary paths and multi-color stroke maps.
- Balanced context state and no clip leakage into subsequent series.
- Stroke-style cache restoration.
- Custom point paths without a shared clip.

Demo tests cover:

- Zero runs, isolated zeros, and null handling in the interval helper.
- Canvas-coordinate conversion and merging with existing gap intervals.
- Preservation of the native path-builder result.
- Continuous fill geometry for both successful approaches.
- Naive gap clips on filled series.
- DPR 1 and 2, both orientations, reversed directions, zoom, and resize.

After implementation, the full suite passed with 1,472 tests. The build, syntax checks, and `git diff --check` also passed. These counts describe that validation run, not a permanent project total.

### Firefox pixel checks

A headless Firefox check sampled the actual demo canvas at two data positions:

- At `(3.5, 7)`, the naive chart had transparent pixels where the purple band belongs.
- At the same position, ordinary, overlay, and `clipStroke` charts retained matching purple fill pixels.
- At `(2.5, 4.5)`, the ordinary chart showed the orange stroke over the blue boundary.
- The overlay and `clipStroke` charts revealed the blue boundary.

The two successful approaches did not produce identical stroke pixels. Overlays draw all strokes last. The normal-order `clipStroke` chart allowed the later translucent purple fill to tint part of the blue stroke.

An initial pixel assertion required exact equality between those approaches and failed. The corrected assertion checked preserved fill and a revealed blue boundary. This distinction is now documented on the demo page.

The browser check sampled specific pixels. It was not a complete visual regression suite across browsers or devices.

## Future core stacking

Core stacking is not necessary for `clipStroke`, and `clipStroke` is not strictly necessary for core stacking.

If core retains raw values and cumulative boundaries, it can classify intervals before path generation:

| Interval kind | Meaning |
| --- | --- |
| Missing-data gap | The boundary is undefined under the selected missing-data policy |
| Zero-thickness interval | The boundary exists, but this layer contributes no area |

A possible design uses two clips:

| Clip | Contains | Consumers |
| --- | --- | --- |
| Local series clip | Missing-data and zero-thickness gaps | This series' fill and stroke |
| Boundary clip | Missing-data gaps only | Bands that use this series as a boundary |

This approach can suppress zero-thickness strokes without a stroke-only primitive. The local fill has no area over the additional intervals.

Core can derive zero-thickness intervals from raw data and retain the existing public `series.gaps` contract. A new public classification API is only necessary if callers need to supply both meanings themselves.

### Possible public API directions

These alternatives are not implemented:

- Separate local and boundary gap lists or callbacks.
- Tagged gap intervals with an explicit meaning or target.
- A separate boundary clip in the path-builder result, with an explicit fallback to the existing clip.

A single flag that makes all gaps local is insufficient for mixed input. It also changes how genuine missing-data gaps affect dependent bands.

The current callback returns one combined list of native and custom gaps. After merging, the renderer cannot recover which intervals represent missing boundaries versus local suppression.

Any split-clip API needs explicit omission semantics. An omitted boundary clip can retain compatibility through the existing clip. An explicit null boundary clip can mean no boundary clipping.

That API also needs definitions for native nulls, `spanGaps`, custom refiners, and the existing band-clipping flags.

### Decision still open

`clipStroke` is a general-purpose drawing primitive. It can preserve a nonzero fill while hiding part of its stroke.

Classified local and boundary gaps solve a different problem: whether other layers can rely on this boundary.

Both concepts can coexist. Future core stacking can use classified gaps without making `clipStroke` its internal mechanism. Its general-purpose value is a separate reason to retain the public primitive.

## Limits and follow-up work

The prototype covers nonnegative, linear layers with no missing values in the actual chart data. It does not implement interactive layer visibility, dynamic restacking, percent stacks, or mixed-sign stacks.

Stepped paths need interval boundaries based on step alignment. Splines need an interpolation-aware definition of zero thickness. Two zero samples alone do not establish that arbitrary interpolated boundaries coincide between them.

Further work also includes:

- Missing-data policies before and during stacking.
- Updates that invalidate cumulative data, zero intervals, and cached paths together.
- Visibility changes and layer reordering.
- Irregular X spacing and repeated X values.
- Dense data, pixel rounding, antialiasing, line caps, and gap endpoints.
- A deliberate choice between per-series draw order and all-strokes-last compositing.
- Performance measurements on realistic layer and sample counts.

## Reproduction

1. Run `npm run build` from the repository root.
2. Serve the repository with the existing demo server.
3. Open `demos/stacked-zero-gaps.html`.
4. Compare the purple fill and lower strokes around x=2–5.
5. Compare the connected transitions at the isolated zero at x=8.
6. Zoom and resize the page to inspect clip updates.
7. Run the focused tests:

```sh
npx mocha test/clip-stroke.mjs test/stacked-zero-gaps.mjs
```
