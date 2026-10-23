# Heatmap color LUTs: exact roots and approximate Log

Date: 2026-10-17

## Status and scope

This document records the LUT design for heatmap color indices, with emphasis on Log.
Log now uses the approximate `logApproxLut` helper. Linear remains the default.
The demo no longer has corrected Log or a separate `log-approx` mode.
The helper, its math, and its error bounds remain unchanged.

Relevant files:

- `demos/heatmap-cells.js`: exact root LUTs, palette setup, and Log integration.
- `demos/lib/heatmapColorLut.js`: the approximate Log helper, with the `logApproxLut` export.
- `scripts/bench-heatmap-color-blocks.mjs`: root LUT benchmarks and numerical assertions.
- `scripts/bench-heatmap-log-blocks.mjs`: the demo Log benchmark, independent density experiments, and numerical assertions.

The reported measurements are historical. They came from prior prototypes with uncommitted source revisions on `0c01f6df`.
They do not measure the final helper. The corrected Log implementation in those comparisons is now removed.


## Definitions and existing exact modes

`N` is the palette size, from 11 through 32. `n = N - 1` is the largest color index.
For a nonconstant count domain, the normalized count is:

```text
x = (count - min) / (max - min),  0 <= x <= 1
```

### Square root: exact flat Uint8 LUT

The target color is `round(n * sqrt(x))`.
The transition from color `k` to `k + 1` occurs at:

```text
x_k = ((k + 0.5) / n)^2 = (2k + 1)^2 / (4n^2)
M_sqrt = 4n^2
j = floor(M_sqrt * x)
```

Every transition has an integer grid index: `(2k + 1)^2`.
A flat `Uint8Array(M_sqrt + 1)` stores the color for each grid point.
Each interval starts at an odd square. Runtime lookup needs no square root or boundary correction.

### Cube root: exact shared64 LUT

The target color is `round(n * cbrt(x))`.
Its transitions also align with an integer grid:

```text
x_k = ((k + 0.5) / n)^3 = (2k + 1)^3 / (8n^3)
M_cbrt = 8n^3
j = floor(M_cbrt * x)
```

A flat table grows cubically with `n`.
The demo instead uses a shared64 layout: a page directory and shared 64-entry blocks.
Solid blocks share storage by color. Blocks that contain transitions have unique storage.
The directory and blocks both use `Uint8Array`.

| Palette size | Square-root flat bytes | Cube-root virtual flat bytes | Cube-root shared64 bytes |
| ---: | ---: | ---: | ---: |
| 24 | 2,117 | 97,337 | 4,273 |
| 32 | 3,845 | 238,329 | 7,500 |

These byte counts exclude object headers.
Shared64 adds a directory access but substantially reduces cube-root storage.
The small square-root table remains flat to avoid that extra access.

The root LUTs are exact in real arithmetic because their transitions align with the grid.
Floating-point evaluation can still differ at ties between colors.
The word “exact” describes the aligned construction, not universal bit-for-bit agreement between different floating-point expressions.

### HISTORICAL: removed Log LUT with correction

For `0 < min < max`, the ideal Log color is:

```text
L = log(max) - log(min)
color = round(n * (log(count) - log(min)) / L)
threshold_k = min * exp(L * (k + 0.5) / n)
```

Log thresholds generally do not align with a finite uniform grid.
The removed Log mode started with a flat LUT result, then compared the count against precomputed thresholds.
Correction loops moved the color up or down until the threshold interval matched.
This mode needed no logarithm per lookup, but it retained correction comparisons.

The demo no longer contains this LUT, its thresholds, or its correction callback.
The benchmarks no longer retain this implementation.
Direct logarithms remain the accuracy oracle, not a selectable exact Log mode.

## Current Log design

### Integration and lifetime

The selector has one Log entry, with value `'log'` and label `Log`.
There is no `'log-approx'` option. The default remains `'linear'`.
Log uses `logApproxLut(...).lookup` and ideal logarithmic legend positions.
The root setup block defines only square root, linear, and cube root callbacks.
The demo assigns the Log helper after the legend setup.

`logApproxLut` setup uses only the initial `min`, `max`, and `N`.
It does not inspect individual counts or require a histogram.
The demo retains the initial count domain across `setData` calls.
Palette changes rebuild the LUT. Redraws and color-mode changes reuse the LUT.

The lookup contract covers counts within the retained domain.
New data outside that domain needs a separate domain policy. Domain retention does not imply automatic rescaling or clamping.

### Resolution from the smallest transition spacing

For a positive, nonconstant domain:

```text
R = max / min
L = log(max) - log(min)
n = N - 1
a = L / n

x = (count - min) / (max - min)
t_k = expm1(a * (k + 0.5)) / expm1(L),  k = 0, ..., n - 1
```

`t_k` is the normalized count at the exact transition from color `k` to `k + 1`.
In real arithmetic, `expm1(L) = R - 1`.
The difference of logarithms avoids a required direct ratio calculation during setup.
`expm1` reduces cancellation for small arguments, but it does not remove all floating-point limits.

Adjacent transition spacings increase with `k`:

```text
t_(k+1) - t_k = exp(a * (k + 0.5)) * expm1(a) / expm1(L)
g = exp(a / 2) * expm1(a) / expm1(L)
```

Thus, `g` is the smallest spacing between adjacent exact transitions.
The baseline resolution and the fourfold resolution in the demo are:

```text
B = 4 * n * n
M_base = B * max(1, ceil(1 / g / B))
M = 4 * M_base
q_k = ceil(M * t_k)
virtualLength = M + 1
```

The baseline already satisfies `M_base * g >= 1` in exact arithmetic.
The demo uses four times this safe baseline to reduce the width of error intervals.
This extra density does not make the approximation exact.

### Error bound and proof

Let `C(x)` denote the exact Log color.
The virtual table stores `C(j / M)` at integer index `j`.
A transition begins at `q_k = ceil(M * t_k)`, so this table represents the color at each left endpoint.

For a lookup in bin `j`:

```text
j = floor(M * x)
j / M <= x < (j + 1) / M
```

`C` is monotone. Therefore, `C(j / M) <= C(x)`.
Because `M * g >= 1`, a bin cannot contain two transitions after its left endpoint and before its right endpoint.
A transition exactly at the left endpoint already contributes to the stored color.
A transition at the right endpoint belongs to the next bin.
Therefore:

```text
C(x) - 1 <= C(j / M) <= C(x)
approximateColor - exactColor is either -1 or 0
```

The endpoint `x = 1` has its own entry at `j = M` and maps to color `n`.
This proof covers the full domain in exact arithmetic. It does not depend on observed counts.

Floating-point rounding can affect `t_k`, `q_k`, the runtime index, and direct-log reference values near ties.
The proof alone does not establish a one-sided floating-point bound for every representable input.
Prior prototype validation observed absolute color-index error at most 1 for the sampled domains and threshold neighborhoods.
The unit tests validate the helper against direct-log reference values across count ratios, palette sizes, and threshold neighborhoods.

### Error frequency is a separate property

Each exact transition has a possible error interval:

```text
[t_k, q_k / M)
width_k = q_k / M - t_k
0 <= width_k < 1 / M
```

An aligned transition has an empty error interval.
The intervals do not overlap under the spacing condition.
For an ideal continuous uniform distribution in count space, the mismatch probability is:

```text
P_count = sum_k(width_k) < n / M
```

For an ideal continuous uniform distribution in log space:

```text
P_log = sum_k(
  log1p(width_k * expm1(L) / (1 + t_k * expm1(L))) / L
)
```

Neither expression predicts the mismatch frequency of arbitrary data.
Repeated counts can concentrate inside a very narrow error interval.
The full-domain bound limits error magnitude, not the percentage of cells with an error.

### Direct shared64 construction

The helper generates compressed blocks directly. It never allocates the full virtual LUT.
The compressed representation contains:

- A `Uint8Array` directory with `ceil((M + 1) / 64)` page IDs.
- At most one shared solid block for each color.
- Unique mixed blocks at transitions.
- A final partial block padded with the last color.

There are at most `N` solid blocks.
Each mixed block contains at least one transition, so there are at most `N - 1` mixed blocks.
A block can contain several transitions without an additional block allocation.
Therefore, the total block count is at most `2N - 1`.

At `N = 32`, this bound gives 63 blocks and 4,032 block bytes.
Every page ID fits in one byte.
The retained byte count is:

```text
sharedBytes = ceil((M + 1) / 64) + 64 * blockCount
blockCount <= 2N - 1
```

This count excludes object headers, temporary setup arrays, and scratch storage.
Direct generation avoids an `M + 1` byte allocation even during setup.

### Runtime lookup and rejection limits

The conceptual lookup is:

```js
// Setup:
const countScale = M / (max - min);
// Lookup:
const j = Math.floor((count - min) * countScale);
return blocks[(directory[j >>> 6] << 6) | (j & 63)];
```

The implementation precomputes `M / (max - min)` as a count scale.
Floating-point multiplication order still matters near bin boundaries.
The hot path has no root, logarithm, or correction comparisons.

A constant finite domain maps to color 0 without division or logarithms.
This degenerate case precedes the nonconstant log-domain requirements.
For nonconstant domains, bounds must be finite and satisfy `0 < min < max`.

The helper returns `null` for an invalid log domain, a nonfinite resolution or count scale, or `M > 2**24`.
It also rejects unsupported palette sizes and distinct domains whose logarithms round to the same value.
The demo disables the Log option in these cases.
An unsupported Log selection falls back to Linear, not to a corrected Log implementation.

The resolution limit bounds allocation and avoids bitwise index overflow.
At `M = 2**24`, the directory needs 262,145 bytes: approximately 256 KiB, plus one byte.
The block storage adds at most 4,032 bytes.
Large ratios can therefore disable the mode instead of creating an excessive directory.

## HISTORICAL: prototype memory tradeoffs across ratios

These historical prototype results show the maximum shared64 bytes across all palette sizes from 11 through 32.
They are not fresh measurements of the current helper.
Each column has its own maximum. A row does not describe one fixed palette size.
The baseline uses `M_base`. The demo uses `4 * M_base`.

| Ratio `R` | Baseline maximum bytes | 4× maximum bytes |
| ---: | ---: | ---: |
| 100 | 2,237 | 3,441 |
| 1,000 | 1,955 | 2,953 |
| 10,000 | 2,661 | 4,434 |
| 100,000 | 5,504 | 14,717 |
| 1,000,000 | 25,036 | 92,205 |

The ratio and palette size determine the resolution.
Transition alignment with 64-entry blocks determines the compressed block count.
These effects explain the variable sizes, including the smaller maximum at ratio 1,000 than at ratio 100.
No data histogram is necessary to construct these tables.

At large ratios, the directory dominates storage.
A fourfold resolution increases directory storage approximately fourfold, but shared blocks can keep total storage growth much smaller for moderate ratios.

## HISTORICAL: prototype results and removed implementation timings

### Dataset and mismatch counts

The prototype used `generateHeatmapCells({ xGapProbability: .02 })`.
The generated frame contained 246,053 cells and 282 distinct counts.
The minimum was `1 / 285`, and the maximum was `392 / 285`, for ratio 392.

“Wrong cells” means cells whose color index differed from the direct-log reference.
Byte counts include the directory and retained blocks, without object headers.

| Colors | Baseline wrong cells | 4× wrong cells | 4× bytes |
| ---: | ---: | ---: | ---: |
| 11 | 4,166 | 0 | 730 |
| 18 | 71,510 | 0 | 1,417 |
| 19 | 0 | 0 | 1,490 |
| 24 | 215 | 4 | 2,053 |
| 25 | 55,755 | 0 | 2,129 |
| 32 | 32,776 | 0 | 2,993 |

The 14-color case is an important counterexample to broad accuracy claims.
Both 4× and 16× density produced 50,834 wrong cells, or 20.6598% of the frame.
Every mismatch had error `-1`.
Dense repeated counts near thresholds caused this high frequency despite narrow error intervals.
Zero mismatches for selected palette sizes do not establish exactness for other data or palette sizes.

### Historical lookup timing

These historical medians cover one pass over the generated counts with 24 colors.
The corrected Log implementation is now removed. The 4× column measures the independent prototype, not the current demo helper.

| Runtime | Removed corrected Log median | Prototype 4× shared64 Log median |
| --- | ---: | ---: |
| Node 26.11.1 | 1.6485 ms | 0.3889 ms |
| Bun 1.4.4 | 1.7867 ms | 0.5770 ms |

The environment reported an AMD Ryzen 7 PRO 5850U and was virtualized.
The measurement procedure used three process runs, 31 samples per run, rotated variant order, and one reversed-order run.
Node and Bun ran sequentially.
The benchmark warmed each variant and adjusted passes to reduce timer noise.

These measurements cover lookup only, not LUT setup, browser drawing, or complete frame time.
The benchmark constructed its own approximate tables.
It did not time the final `logApproxLut` helper.
Runtime versions, JIT behavior, source revisions, and virtualization limit direct comparisons with other environments.

## Current benchmark reproduction

The current benchmark compares the actual helper as `demo Log` with independent 1×, 4×, and 16× experiments.
Direct `Math.log` values provide the accuracy oracle. They are not a corrected LUT baseline.
The commands no longer reproduce the removed corrected Log timing column.
The obsolete correction-only script, `scripts/bench-heatmap-color-lut.mjs`, is removed.

Run these commands from the repository root without coverage instrumentation.
Run each command only after the previous command finishes.

### Numerical assertions without timing

```sh
node scripts/bench-heatmap-log-blocks.mjs --verify-only
bun scripts/bench-heatmap-log-blocks.mjs --verify-only
```

### Full runs with JSON output

```sh
node scripts/bench-heatmap-log-blocks.mjs --json
node scripts/bench-heatmap-log-blocks.mjs --json
node scripts/bench-heatmap-log-blocks.mjs --reverse --json
bun scripts/bench-heatmap-log-blocks.mjs --json
bun scripts/bench-heatmap-log-blocks.mjs --json
bun scripts/bench-heatmap-log-blocks.mjs --reverse --json
```

The script accepts `--verify-only`, `--reverse`, and `--json`.
Without `--json`, it prints tables. Full runs include numerical assertions before timing.
The JSON includes runtime information, source SHA-256 values, sizes, mismatch counts, timing quantiles, and a checksum.

The Log script imports `logApproxLut` directly and constructs the independent density variants locally.
It does not extract Log callbacks from the demo source.
For the fourfold density, it compares the helper's intervals, directory, and blocks with the prototype.
Full runs time the actual helper lookup as `demo Log` alongside the independent variants.

The root benchmark retains source extraction through the `// Legend position is linear in count;` marker.
That block contains only square root, linear, and cube root callbacks. It does not contain the later Log helper assignment.
The root benchmark neither returns nor asserts the removed `logLookup`.
Source extraction has explicit marker assertions.

### Root LUT runs

```sh
node scripts/bench-heatmap-color-blocks.mjs --json
bun scripts/bench-heatmap-color-blocks.mjs --json
```

## Integration tests

The focused suites are `test/plugins/heatmap-color-lut.mjs`, `test/plugins/heatmap-cells-demo.mjs`, and `test/plugins/heatmap-plugin.mjs`.

Run each suite with both runtimes, sequentially:

```sh
node scripts/test.mjs test/plugins/heatmap-color-lut.mjs test/plugins/heatmap-plugin.mjs test/plugins/heatmap-cells-demo.mjs --reporter dot
bun scripts/test.mjs test/plugins/heatmap-color-lut.mjs test/plugins/heatmap-plugin.mjs test/plugins/heatmap-cells-demo.mjs --reporter dot
```

The integration checks for the current design cover:

- Every palette size from 11 through 32, with integer color indices in `[0, N - 1]`.
- Minimum and maximum endpoints, constant finite domains, and small positive domain widths.
- Ratios from 100 through 1,000,000, plus scaled domains with small and large magnitudes.
- Exact thresholds, nearby floating-point values, and both sides of virtual transition indices.
- Samples across count space and log space, with absolute error at most 1 against the reference.
- Directory entries, transition positions, monotone block contents, and final-block padding.
- The `2N - 1` block bound and byte accounting without a full virtual-table allocation.
- Invalid domains, nonfinite resolution, and the `2**24` resolution limit.
- A disabled Log option and fallback to Linear for an unsupported Log selection.
- An unchanged linear default, one `Log` entry, and no `log-approx` option.
- A retained domain across `setData`, palette-triggered rebuilds, and reuse across redraws and color-mode changes.
- Unchanged exact root modes and use of the existing approximate helper for Log.

Finite numerical samples supplement the real-arithmetic proof. They do not replace its assumptions or establish exhaustive floating-point correctness.
