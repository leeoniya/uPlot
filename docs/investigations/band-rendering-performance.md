# Remaining band-rendering optimizations

Recorded on 2026-09-22. Baseline: checkpoint `d47f2742`.

Status: investigation only. These proposals do not change the implementation.

## Scope

The renderer caches band groups and band ownership. It separates group fills, strokes, and points into three passes.
The remaining opportunities concern repeated work during drawing, especially path rebuilds during pixel resize.

The benefits below describe potential work reductions, not measured timing improvements. Browser benchmarks must establish the net benefit.

## 1. Cache `bandFillClipDirs()` results

**Current work:** `bandFillClipDirs()` in `src/paths/utils.js` scans all bands for each call.
The linear, stepped, and spline path builders call it during path rebuilds, including resize.

**Proposal:** Cache the fill direction and clipping-direction bits per series in flat numeric arrays.
A topology pass can replace repeated scans with direct lookups.
This is the next candidate for investigation.

**Constraints:**

- The cache must exist before path building. The current group-cache rebuild occurs after path building.
- Invalidation must cover direction changes as well as endpoint changes, series changes, and generated stack changes.
- The last owning band determines the fill direction. Lower-edge clipping directions accumulate across bands.
- The implementation must preserve the current `if`/`else if` behavior for a series that occupies both endpoints.
- Cache entries must contain primitives only. Cache release and chart destruction must clear them.

This proposal needs coordination between the renderer and path builders. It is not only a replacement of the lookup loop.

## 2. Reuse bounds clips between fill/stroke passes

**Current work:** `fillStroke()` in `src/uPlot.js` constructs a bounds `Path2D` for each active pass.
The fill and stroke passes normally use the same bounds geometry for a given series.
Multiple bands within one pass already share its bounds clip.

**Proposal:** Lazily retain each bounds clip for reuse within the current draw.
Frame-local storage can avoid persistent path caching.

**Constraints:**

- Bounds depend on the plot rectangle and effective stroke width. One clip cannot automatically serve every series.
- Reuse must preserve path-level width overrides and the existing pixel translation.
- Storage must remain separate from the primitive-only group and ownership caches.
- Path references must not remain after the draw.
- Series without paint must retain the current allocation-free behavior.

This proposal removes duplicate path construction and `rect()` calls. It does not remove the corresponding `ctx.clip()` calls.

## 3. Share lower-edge data checks

**Current work:** Bands with the same lower endpoint can repeat `hasData()` during the fill pass.
The existing `bandHasData` cache already avoids the repeated check during the stroke pass.

**Proposal:** Use a per-series value with three states: unchecked, data present, and data absent.
Reset these values for each draw and calculate them only on demand.

**Constraints:**

- Only the data-presence result can be shared. Visibility and directional clip eligibility remain band-specific.
- Results depend on the current data and visible index range. They must not survive into another draw.
- Band fill callbacks must retain their current order and frequency.

`hasData()` stops at the first non-null value.
The potential benefit is greatest for long null runs or all-null ranges with shared lower endpoints.
For dense data, cache bookkeeping can outweigh the saved checks.

## 4. Avoid repeated calculations between passes

**Current work:** `drawPath()` repeats width rounding and pixel-offset calculations between fill and stroke passes.
The draw helpers also repeat some paint checks.

**Proposal:** Calculate shared numeric values once per series per draw, or remove redundant checks without another cache.

**Constraints:**

- Effective width includes path-level overrides, pixel ratio, and pixel alignment.
- Fill and stroke passes require different paint checks. A shared value must not replace a pass-specific decision.
- Map paths carry their own styles. Null series styles do not imply that a Map has no paint.
- Reuse must not change callback timing or retain paths, styles, or data through a structural cache.

These calculations are small. Additional storage and lookups can cost more than recomputation.

## Validation plan

1. Compare each candidate against the checkpoint separately.
2. Measure cached redraws and repeated pixel resizes in a browser.
3. Include band-free charts to detect overhead outside band groups.
4. Include shared lower endpoints, multiple bands per owner, hidden series, and sparse data.
5. Compare complete canvas recordings before and after each change.
6. Run the band-order, clipping, Map-style, series-toggle, and cache-lifecycle tests.
7. Measure allocation changes separately from canvas call counts and elapsed time.

Recording equality supports command-level equivalence. It does not establish pixel equivalence or a timing improvement.
