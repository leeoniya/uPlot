# Decimal precision regression cases

This document records the precision regressions, their source reports, and the implemented fixes.

The review includes open and closed uPlot issues, issue comments, attached reproductions, Grafana #116559, and local Git history. Issue closure does not prove that every reported input is safe.

## Test files

- `test/precision-rounding.mjs`: increment rounding, decimal rounding, increment metadata, and linear ranges.
- `test/precision-scales.mjs`: axis splits, chart initialization, zooms, and time formatting.
- `test/precision-fixed-dec.mjs`: exact increment keys, decimal counts, registry overlap, and custom increment registration.
- `test/precision-boundaries.mjs`: decimal exponent boundaries, signed ties, large quotients, tiny grids, and precision-budget checks.
- `scripts/bench-rounding.mjs`: warm rounding and ranging benchmarks against commit `443333f`.
- `scripts/precision-probe.mjs`: chart and tick probes in a shared worker.
- `scripts/probe-worker.mjs`: sequential IPC requests, parent-enforced deadlines, and worker recovery.
- `test/probe-worker.mjs`: watchdog, failure-reporting, and cleanup regressions.

The tests exercise exported source functions. They do not require a rebuilt bundle or network access.

The previously pending #827, #620, and #1084 probes now run by default as low-level termination checks.
They do not establish how an application reaches those internal states or promise valid rendering for equal custom bounds.
The #827 probes also cover natural flat and near-flat data updates, immediate and later stalls, and completion at the upper bound.

### Run the cases

Run the historical regression cases:

```sh
npx mocha 'test/precision-*.mjs'
```


To isolate the Grafana cases, use:

```sh
npx mocha 'test/precision-*.mjs' --grep 'Grafana #116559'
```

Run the full suite with coverage:

```sh
npm test
```

**Safety:** The chart and tick probes share one sequential worker with a five-second startup limit.
After imports finish, the parent starts a separate execution timer for each probe.
The three degenerate-range probes retain their 100 ms execution limit. Other probes retain their five-second execution limit.
The parent kills a timed-out worker, even when a synchronous loop blocks its event loop.
Node workers retain the 128 MiB JavaScript heap limit. POSIX workers disable core dumps.
Bun workers have the time limits but not the Node heap limit.

A timeout, process failure, or memory exhaustion fails the current test. Mocha timeouts alone cannot interrupt a synchronous tick loop.
The next test starts a replacement worker only after the previous worker closes. An ordinary assertion failure also replaces the worker.
Each probe remains a separate Mocha test with the same assertions. Each chart has fresh data and options, with cleanup in `finally`.

The worker registers the mock DOM before importing chart modules, which capture the environment at initialization.
The existing loader test explicitly checks imports without a DOM.
Coverage counters accumulate across probes and flush on normal worker exit, including exits after ordinary assertion failures.
Shutdown has a separate five-second limit and does not consume the probe execution budget.
A killed or crashed worker can lose buffered coverage, but the run cannot pass.

The main process and worker share instrumented source through a temporary, per-run cache.
Cache keys include the source text, filename, and coverage configuration.
The cache owner removes the directory on exit, after its children finish. Cache hits avoid loading the instrumentation compiler.

## `fixedDec` generation and lookup

The tests compare exact numeric keys and decimal counts. An epsilon tolerance cannot protect a `Map` lookup.
The decimal oracle uses BigInt coefficients and exponent shifts, then parses a plain decimal string once.
It does not use production rounding functions to calculate expected values.
Each test restores the shared registry, including after a failed assertion.

Thirteen active tests cover:

- All 256 built-in decimal increments, their array partitions, ordering, and uniqueness.
- Fresh decimal generation across exponents `-32` through `31`, without extra rounded keys.
- Integral multipliers and overlapping decades.
- Seconds and milliseconds increments, including the precision of `2.5`.
- Overlapping numeric, time, and binary registry entries.
- Exact binary powers from `2^-21` through `2^52`.
- Repeated generation without changes to keys or counts.
- Custom `0.04` and `0.125` registration without changes to known tiny increments.
- All binary powers from `2^-53` through `2^52`, plus initialized small binary keys.
- Fractional multiplier precision after positive exponent shifts.
- Decimal counts across signs and plain/scientific notation boundaries.
- Scientific-notation custom increment registration.

These cases extend the work in commits `b2433b4` and `db2c897`, plus the custom-increment report in #805.
Four formerly strict-only cases are now active. They are derived checks, not datasets quoted from those reports.
The fixes resolve three problems:

| Problem | Before | After |
| --- | --- | --- |
| Binary generation changes exact powers from `2^-53` through `2^-22` | For `2^-53`, the key is `1.110223024625157e-16` | The key is exactly `1.1102230246251565e-16` |
| Positive exponent shifts retain excess decimal places | `0.125 × 10` registers `1.25` with 3 places | 2 places |
| Custom scientific-notation increments use incorrect decimal counts | `4e-7` registers with 0 places | 7 places |

Two promoted cases cover binary generation and the initialized lookup separately.
The other promoted cases cover fractional multipliers and custom scientific-notation increments.
Custom registration tests disable tick generation to isolate metadata registration.

Binary generation no longer applies decimal rounding to exact powers of two.
Decimal generation uses `max(0, multDec[i] - exp)` for the decimal count.
Custom metadata extraction handles the exponent and skips conversion for integer inputs. It uses no regex.
Canonical decimal increment generation still uses decimal string conversion.
The first `fixedDec` patch did not replace `fixFloat`, change `roundDec`, or modify range policies. The subsequent changes are described next.

### Performance measurement

Run the benchmark without coverage:

```sh
node scripts/bench-fixed-dec.mjs
bun scripts/bench-fixed-dec.mjs
```

The benchmark retains the pre-fix generation and metadata implementations for comparison with source.
It reports the median of nine samples after warmup and alternates the measurement order.
Generation includes clearing and repopulating the registry. Metadata operations process eight values each.
The baseline check before edits differed from unchanged source by less than 4% in all five workloads.

| Workload | Node before → after (µs/op) | Node change | Bun before → after (µs/op) | Bun change |
| --- | --- | --- | --- | --- |
| Decimal grid, 256 increments | 50.659 → 50.576 | -0.2% | 42.667 → 42.969 | +0.7% |
| Binary grid, 106 increments | 16.415 → 11.926 | -27.3% | 12.855 → 9.800 | -23.8% |
| All built-in grids | 81.078 → 67.546 | -16.7% | 81.932 → 77.621 | -5.3% |
| Plain metadata, 8 values | 1.698 → 0.634 | -62.6% | 0.973 → 0.490 | -49.6% |
| Exponent metadata, 8 values | 1.462 → 0.577 | -60.5% | 0.701 → 0.410 | -41.6% |

Runtimes: Node v26.8.2 and Bun 1.4.3 on the same machine, without concurrent tests.
These measurements concern initialization and registration, not per-frame rendering. Sub-percent differences are noise.
The exponent-metadata baseline returns incorrect counts. That comparison measures cost, not equivalent output.

## Grid-aware rounding and range policy

`numIntDigits()` now compares a logarithm estimate with cached canonical decimal thresholds.
The boundary tests cover both signs immediately below, on, and above decimal powers in the built-in increment range.
This avoids int32 wraparound and logarithm/exponentiation errors at decimal boundaries.

Increment rounding no longer uses the `fixFloat` regex.
It compares a reconstructed grid point with the input, rather than guessing intent from runs of decimal digits.
The correction allowance is two relative epsilons, capped at `1e-7` of an increment.
Grid quotients of `1e15` or more leave the input unchanged, rather than attempting to recover precision near the machine limit.
The explicit cleanup bypass remains available for partial log ranges.

`roundDec()` compares the input with the decimal midpoint instead of multiplying every input by an epsilon bias.
The supported decimal-rounding budget is approximately 15 significant digits. Finer requests leave the input unchanged.
Integer rounding still applies to large noninteger values.
Powers through `10^22` are exact integer divisors. Tiny magnitudes use native `toFixed` to canonicalize the result.
Midpoint conversion occurs only near half-steps. Increment rounding reuses the canonical candidate when it is the selected grid point.
The existing increment range ends at 32 decimal places. Requests beyond that range also leave the input unchanged.
There is no BigInt fallback, arbitrary-precision parser, or near-machine-limit directional correction.
The power cache contains 65 entries for exponents `-32` through `32`, rather than all floating-point exponents.

`Range.Config.flat` sets the relative flatness threshold for linear ranges, with a default of `1e-7`.
A span is flat when it is at most `flat * max(abs(min), abs(max))`.
The default preserves the legacy flat ranges in the `no-data` demo.
Nonzero relatively flat spans use a rounded midpoint before padding, so decimal residue does not enlarge the fallback range.

A value of `1e-12` preserves the reported Grafana variations. The Grafana range tests explicitly use this threshold.
A value of `0` disables relative flattening, but retains the `1e-24` absolute floor and the fallback for constant data.
This is an intentional display-precision limit, not an attempt to preserve every representable variation.
The positional `rangeNum(min, max, pad, extra)` API uses the default threshold.

The same configuration works with `scales.y.range` and the third argument of `uPlot.rangeNum`:

```js
{
  flat: 1e-12,
  zeroIf: 0.1,
  min: { pad: 0.1 },
  max: { pad: 0.1 },
}
```
Tiny magnitude and high significant-digit precision are different requirements: `1e-24` itself has one significant digit.
The redundant outer `roundDec(..., 24)` calls in linear ranging are removed.

Twelve formerly pending tests now pass and run by default:

- Three large-value digit-count cases.
- The cheap #1135 first-tick placement assertion.
- Both Grafana variation-preservation cases.
- All three Grafana excess-precision assertions.
- The Grafana lower-boundary tick case.
- Both #1135 explicit-range chart probes.

Seventeen boundary tests protect the reported cases, tiny half-step decisions, explicit precision limits, and configurable flatness.
The flatness tests cover both signs, the positional API, the absolute floor, hard limits, and independent chart scales.
They require a flat fallback below the supported range resolution and unchanged values beyond the rounding budget.
Three formerly pending probes now pass: #827 stalled splits, #620 equal bounds, and #1084 custom flat bounds.
Numeric tick generation returns no splits when a step fails to advance before completion.
A tick at the upper bound completes generation. Valid single-tick ranges retain their tick.
The guard does not change scale bounds, choose replacement increments, or change the default label formatter.

### Snapshot changes

The update includes 24 reviewed snapshots:

- Twenty snapshots contain coordinate differences of approximately `1e-14` to `1e-12` pixels.
- Four snapshots contain one-pixel changes at pixel-rounding boundaries.

Six `no-data` snapshots from the earlier rounding work now match upstream exactly and require no changes.
Only two one-pixel differences remain in that demo.
Applications that opt into narrow ranges can supply `axes.values` to avoid repeated labels from the default three-fractional-digit formatter.
A separate formatter-policy change is outside this patch.

Before the advancement guard, the full Bun suite and the Node suite without coverage each reported **357 passing tests and 3 pending tests**.
The latest Node coverage run reports **351 passing, 3 pending, and 6 failing**.
Those failures are subprocess timeouts: five precision probes during startup and one failure-report integration test.
There are no snapshot failures.

### Rounding performance

Run the benchmark without coverage:

```sh
node scripts/bench-rounding.mjs
bun scripts/bench-rounding.mjs
```

The benchmark loads the pre-change source from Git commit `443333f` and uses identical built-in increment metadata.
It alternates warmed baseline/source runs and reports the median of nine samples.
Imports, initialization, and input generation are excluded. The figures include loop, dispatch, and checksum overhead.

| Workload | Node before → after (ns/call) | Bun before → after (ns/call) |
| --- | --- | --- |
| `roundDec`, typical | 65.0 → 42.7 | 18.8 → 31.5 |
| `roundDec`, precision 24 | 76.3 → 58.5 | 22.4 → 52.9 |
| `incrRound`, common grids | 424.5 → 90.0 | 233.3 → 68.6 |
| `incrRoundUp`, common grids | 372.3 → 90.0 | 261.6 → 53.2 |
| `incrRoundDn`, common grids | 405.6 → 101.0 | 261.9 → 53.6 |
| `incrRound`, tiny grids | 881.8 → 509.5 | 649.2 → 690.7 |
| `incrRoundUp`, tiny grids | 949.3 → 419.1 | 612.2 → 429.0 |
| `incrRoundDn`, tiny grids | 855.7 → 475.4 | 630.6 → 482.5 |
| `numIntDigits` | 41.0 → 52.3 | 22.3 → 34.8 |
| `rangeNum`, normal/flat | 1020.1 → 585.1 | 719.7 → 409.8 |
| `rangeNum`, Grafana near-flat | 1427.7 → 361.1 | 975.9 → 267.7 |

Runtimes: Node v26.8.2 and Bun 1.4.3, measured sequentially without concurrent tests.
These measurements predate configurable flatness. The benchmark now explicitly uses `flat: 1e-12` for its Grafana cases.
Common-grid rounding and ranging are faster in both runtimes.
Tiny-grid upward/downward rounding is faster in both runtimes. Tiny-grid nearest rounding remains slightly slower in Bun.
Digit counts cost more in this run. Standalone decimal rounding is also slower in Bun.
The measurements include the two optimizations, not the earlier BigInt prototype.
These are warm microbenchmarks, not chart-rendering measurements. Some baseline results are incorrect, so these timings do not imply equivalent output.

### Cost of repeated conversion

An isolated comparison used the simplified implementation immediately before the two optimizations, rather than commit `443333f`.
Both versions ran in the same benchmark process with alternating measurement order.

| Tiny-grid operation | Node before → after (ns/call) | Bun before → after (ns/call) |
| --- | --- | --- |
| Nearest | 1224.6 → 532.9 | 1436.2 → 593.3 |
| Upward | 1030.5 → 454.9 | 1003.6 → 411.4 |
| Downward | 1030.7 → 523.8 | 991.0 → 470.3 |

The changes reduce these costs by 49–59%, without changes to the precision limits.
All benchmark checksums matched. A separate sweep also passed 11,088 exact before/after comparisons.
The temporary baseline copy was removed after validation.

## History: why there were two `fixFloat` calls

The original expression was:

```js
fixFloat(ceil(fixFloat(num / incr)) * incr)
```

The inner call corrects division residue before an integer boundary decision. The outer call corrects multiplication residue after that decision.

For the issue-provided `num = -0.6` and `incr = 0.2`:

```js
-0.6 / 0.2       // -2.9999999999999996
Math.ceil(-0.6 / 0.2) // -2: the wrong tick index
-3 * 0.2         // -0.6000000000000001: residue after the correct decision
```

The two stages have different purposes. Removing either stage requires an alternative for that stage's contract.

The nearest-rounding path has another requirement: decimal ties round away from zero. For example, `incrRound(-0.7, 0.2)` must return `-0.8`, not `-0.6`.

Source: [uPlot #771, maintainer expectations](https://github.com/leeoniya/uPlot/issues/771#issuecomment-1340294297).

## Git history

`git blame` attributes the current `fixFloat` body to `b2433b4`. Its callers predate that implementation.

| Commit | Change | Regression contract |
|---|---|---|
| [04c0541](https://github.com/leeoniya/uPlot/commit/04c054156c3941ab1ab8bf8ab3cb9eea2d923d32) | Added precision checks for increment selection and a sub-`1e-16` zoom guard. | Deep zoom must terminate or reject the requested range. Time ticks cannot advance below Date's millisecond precision. |
| [db2c897](https://github.com/leeoniya/uPlot/commit/db2c897ae7d89a8368d1748af7a9179681f434c4) | Adjusted increment generation and decimal metadata. | Increment values and their decimal counts must agree. |
| [b3a8368](https://github.com/leeoniya/uPlot/commit/b3a8368ca28e0706eca9538c82bc3dfd403fa5f0) | Corrected seconds/milliseconds conversion and time split arithmetic for #472. | A `.100` timestamp must not become `.099`. |
| [c801838](https://github.com/leeoniya/uPlot/commit/c801838d4611eec62a532b5b728c72ee8a5cf4d0) | Added the integer fast path and `(1 + Number.EPSILON)` multiplication in `roundDec`. | Preserve integers and decimal ties on both signs. Excessive precision needs separate fidelity checks. |
| [f8f5fa1](https://github.com/leeoniya/uPlot/commit/f8f5fa130c94bff44c891ded179540246f90dc53) | Treated ranges over ten orders below their values as flat, closing #760. | Built-in ranging must not cause a nonadvancing tick loop. This is a noise-suppression policy, not decimal correction alone. |
| [02039ae](https://github.com/leeoniya/uPlot/commit/02039ae35382f44751ba4848b1e4352def1afe9b) | Added/subtracted `Number.EPSILON` before floor/ceil for #771. | The first correction was insufficient, according to the issue discussion. |
| [9fc7bb4](https://github.com/leeoniya/uPlot/commit/9fc7bb4881c43eef11677661ad92b4320d7f8a13) | Introduced nested `fixFloat` calls and used `roundDec` for nearest rounding. | Protect both the quotient and product, including negative decimal ties. The initial helper rounded to 14 decimal places. |
| [eb11992](https://github.com/leeoniya/uPlot/commit/eb1199288a0209306e104410be85b58ec030e513) | Registered decimal counts for custom axis increments, closing #805. | Custom `0.04` increments must work like built-in `0.05` increments. |
| [b2433b4](https://github.com/leeoniya/uPlot/commit/b2433b4c2de735e88917f7cfefcfe24b0aa0f3e9) | Replaced fixed-14 rounding with the decimal regex and exponent recursion. Added canonical decimal increments and wider exponent support. | Values below `1e-14` must survive. Known increments must retain their values. Log splits must advance across tiny decades. |
| [a4edb29](https://github.com/leeoniya/uPlot/commit/a4edb297a9b80baf781f4d05a40fb52fae737bff) | Lowered the absolute flat-range threshold from `1e-9` to `1e-24`. Increased final range rounding from 9 to 24 places. | Small, nonflat ranges must not expand to a unit-scale fallback. |
| [f979884](https://github.com/leeoniya/uPlot/commit/f97988429568c04f1d96fef2e4865a111c390895) | Removed decimal rounding from log2 ranging for a wide-range loop. | Preserve binary powers over `1e-6` to `1e8`. |
| [0575cab](https://github.com/leeoniya/uPlot/commit/0575cab101aa600dc0cd1e9b0085811bcdd62ce4) | Corrected partial logarithmic ranges and added the `_fixFloat` bypass, closing #1052. | Preserve the intentional bypass and partial-decade bounds. |
| [6a3de08](https://github.com/leeoniya/uPlot/commit/6a3de08db3976fb0348f9ee57839f85599748b35) | Added nonzero fallback ranges after precision cleanup collapses both bounds. | Never return a collapsed built-in range. The fallback does not recover erased variation. |

A separate 10% fluctuation policy was added in `863fb22` and reverted in `8a8ba5a`. The tests do not reinstate that policy.

## Reported cases and coverage

“Derived” means that a test supplies geometry, increments, endpoint-only data, or acceptance limits absent from the original report. Test comments identify these choices.

| Report | Reported inputs | Test coverage and status |
|---|---|---|
| [#771](https://github.com/leeoniya/uPlot/issues/771), closed | Range `[-0.6, 1.6]`. Perturbing the minimum to `-0.600000001` restored the missing tick. | Active exact rounding table and a derived `0.2` tick grid. Positive counterparts are derived. |
| [#324](https://github.com/leeoniya/uPlot/issues/324#issuecomment-707233829), closed | Two precise X/Y zoom batches, reproduced below. | Active chart probe with the exact bounds and synthetic endpoint data. Tick suppression is valid at unsupported precision. |
| [#472](https://github.com/leeoniya/uPlot/issues/472), closed | A timestamp with 100 milliseconds displayed 099. | Active formatting and tick checks in seconds and milliseconds. `1615849200.1` is a derived timestamp, not a value quoted by the report. |
| [#805](https://github.com/leeoniya/uPlot/issues/805), closed | `space: 0`, custom X increments `[0.05]` and `[0.04]`. | Active two-axis chart with a derived `[0, 0.2]` range. Checks the complete tick arrays. |
| [#760](https://github.com/leeoniya/uPlot/issues/760), closed | `[99999999.99999996, 100000000.00000004]`. | Active built-in range containment and chart safety. Closure specifically covered built-in ranging, not arbitrary explicit bounds. |
| [#657](https://github.com/leeoniya/uPlot/issues/657), closed | Y extrema `-3.25076e-10` and `1.01506e-10`. | Active endpoint reduction of the 61-point report. Checks containment and absence of a unit-scale fallback. |
| [#1027](https://github.com/leeoniya/uPlot/issues/1027#issuecomment-2566530209), closed | Y extrema `7.256878746641693e-16` and `7.144987372566716e-12`. | Active log10 range and decimal tick checks. The reporter corrected the title's “base 2” to base 10. |
| [#826](https://github.com/leeoniya/uPlot/issues/826), closed | Log10 range `[1e-14, 100]`, incorrect filtering below `1e-9`. | Active numerical filtering test. Geometry is derived: 50 pixels per decade and 30 pixels between labels. |
| [#1052](https://github.com/leeoniya/uPlot/issues/1052#issuecomment-2802048496), closed | Extrema `990000, 1000001` and `99000, 100000.001`. | Active partial-log bounds. Expected maxima are `2000000` and `200000`. |
| [#1098](https://github.com/leeoniya/uPlot/issues/1098), closed | Explicit log range `[0.99e-3, 10]`. | Active finite decimal grid from `0.001` through `10`. |
| [#827](https://github.com/leeoniya/uPlot/issues/827), open | Flat data `[1e14, 1e14]`. Debugger: `min = max = 1e14`, increment `1e-8`. | Built-in autoranging and flat/near-flat data updates pass. The exact equal-bound debugger state terminates at the endpoint. |
| [#620](https://github.com/leeoniya/uPlot/issues/620), open | Custom ranges `[1,1]` and `[2,2]`. | Active `[1,1]` termination probe. This is invalid custom range input, not a promised built-in range. |
| [#1084](https://github.com/leeoniya/uPlot/issues/1084#issuecomment-3229683387), closed | `[[0],[5]]`, custom padding `(max-min)*0.1`. | Active termination probe for the zero-width custom range. Valid rendering is not guaranteed. |
| [#1135](https://github.com/leeoniya/uPlot/issues/1135), closed | Y near `2.700000047683715`, or X near `1e18`. | Built-in Y ranging passes. Explicit Y and X cases remain strict-only and currently exhaust the child heap. |
| [Grafana #116559](https://github.com/grafana/grafana/issues/116559), open | Precise frequency measurements and near-integer controls. | Active controls plus six strict-only precision tests, detailed below. |
| [Grafana #122055](https://github.com/grafana/grafana/issues/122055), closed | Values `1` and `0.9999999`, with a percent unit. | Active numeric safety checks. The related fallback fix does not preserve the small variation. |

### Exact #771 rounding table

The maintainer supplied these outputs. Columns follow the exported helper names.

| Value | Increment | `incrRound` | `incrRoundUp` | `incrRoundDn` |
|---:|---:|---:|---:|---:|
| -0.6 | 0.1 | -0.6 | -0.6 | -0.6 |
| -0.6 | 0.2 | -0.6 | -0.6 | -0.6 |
| -0.7 | 0.1 | -0.7 | -0.7 | -0.7 |
| -0.7 | 0.2 | -0.8 | -0.6 | -0.8 |

### Exact #324 zoom batches

```js
// First batch:
x: [1567600710.4851427, 1567600710.4993143]
'%': [14.573779120014906, 14.573779120043511]

// Second batch:
x: [1568046215.2288318, 1568046215.2345016]
'%': [14.573779120022353, 14.573779120022357]
```

### Exact #1135 attachment inputs

The [Y attachment](https://github.com/user-attachments/files/29349829/uplot-tick-totality-repro.html) contains 658 measurements. The tests reduce them to their extrema:

```js
[2.7000000476837114, 2.7000000476837194]
```

Its custom ranger returns `[min, max]` unchanged. The attachment pins uPlot 1.6.31. Its default-range view does not freeze.

The [X attachment](https://github.com/user-attachments/files/29327341/x-zoom.html) uses:

```js
const xs = Array.from({ length: 200 }, (_, i) => 1e18 + i * 5000);
u.setScale('x', { min: 1e18, max: 1e18 + 200 });
```

JavaScript represents the requested upper offset as 256, not 200. The safety assertion concerns termination, not recovery of unrepresentable decimal precision.

## Grafana #116559: separate failure mechanisms

### Sourced datasets

The [snapshot dashboard](https://github.com/grafana/grafana/issues/116559#issuecomment-4013257350) repeats this triplet for 60 rows:

```js
[10000000.000027, 9999999.999959, 9999999.999753]
```

Its timestamps start at `1772799310885` milliseconds and advance by `366000` milliseconds. These timestamps do not affect the Y range test.

The [five-panel dashboard](https://github.com/grafana/grafana/issues/116559#issuecomment-4111259061) supplies:

```js
[36, 51]
[9.999999, 10.000001]
[10, 10]
[9.9999999, 10.0000001]
[10000000.000027, 9999999.999753]
```

Both reproductions use linear scales without explicit hard bounds, decimal counts, or tick increments.
The historical test configuration used Grafana's default 10% padding and conditional soft zero:

```js
{
  min: { pad: 0.1, hard: -Infinity, soft: 0, mode: 3 },
  max: { pad: 0.1, hard:  Infinity, soft: 0, mode: 3 },
}
```

Source: [UPlotScaleBuilder.ts at the related fallback fix](https://github.com/grafana/grafana/blob/5f696663c357a5da3bd2e3288d8750245763fb85/packages/grafana-ui/src/components/uPlot/config/UPlotScaleBuilder.ts).

This quoted configuration is historical, not current API guidance. The current policy replaces the default soft-zero mode with `zeroIf: 0.1`.
The [migration guide](../README.md#soft-limit-migration) explains the removed modes.

### Results before the rounding fixes

| Input | Current `rangeNum` result | Interpretation |
|---|---|---|
| `[36, 51]` | `[34, 53]` | Ordinary control passes. |
| `[9.999999, 10.000001]` | Approximately `[9.9999988, 10.0000012]` | Small variation remains visible. |
| `[10, 10]` | `[0, 20]` | Genuinely constant control has a usable range. |
| `[9.9999999, 10.0000001]` | `[0, 20]` | Decimal cleanup collapses the padded bounds to 10. |
| Original 10 MHz triplet | `[0, 20000000]` | The magnitude-gap rule treats the measurements as flat before normal padding. |

The last case spans approximately `0.00027400068938732147`. Its magnitude gap is approximately `10.562`, exceeding the existing threshold of 10.

The near-10 case has a magnitude gap below 10. Its padded bounds include `9.99999988` and `10.00000012`. The decimal regex rounds both to 10.

The [maintainer's diagnosis](https://github.com/grafana/grafana/issues/116559#issuecomment-4111695833) identifies the regex cleanup. The two test cases keep the regex failure separate from the magnitude-gap policy.

### Acceptance tests (now active)

1. The near-10 pair retains its small range.
2. The original frequency triplet retains its small range.
3. `roundDec(9.9999999, 24)` preserves the input.
4. `roundDec(10.0000001, 24)` preserves the input.
5. `roundDec(10000000.000027, 24)` preserves the input.
6. With a derived increment of `1e-7`, the near-10 pair includes its lower boundary tick.

The range tests require finite, enclosing bounds with a span less than twice the data span. This is a proposed acceptance limit for these fixtures. It is not a general `rangeNum` contract or an exact range promised by Grafana.

The three `roundDec` tests isolate drift from multiplication by `(1 + Number.EPSILON)`. The requested decimal precision exceeds the useful precision of these values.

The tick test expects:

```js
[9.9999999, 10, 10.0000001]
```

The original output omitted `9.9999999`. The corrected output includes it.
This test uses explicit bounds to separate tick generation from autoranging.

The related [Grafana #122057 fix](https://github.com/grafana/grafana/pull/122057) changes fallback bounds after collapse. It does not resolve #116559. The active safety tests permit a future narrow range instead of requiring the current wide fallback.

## Proposed large-value fix: PR #1142

[PR #1142](https://github.com/leeoniya/uPlot/pull/1142) is open. Its [patch](https://github.com/leeoniya/uPlot/pull/1142.diff) proposes two changes:

1. Avoid signed-int32 coercion in `numIntDigits()` for large magnitudes.
2. Stop `numAxisSplits()` when the next value does not exceed the previous value.

The first change corrects an input to `findIncr()`'s precision guard. The second change protects against nonadvancing arithmetic even when increment selection fails.

The PR description links #827. It does not change `fixFloat()`, `roundDec()`, or the flat-range policy.

The merged digit-count fix covers the first change and corrects rounded logarithms at decimal boundaries.
The subsequent advancement guard returns no splits for stalled generation, rather than retaining a partial axis.
The `no-data` page updates ten values to flat or nearly flat data at `1e14`, with automatic ranging and normal series drawing.
The near-flat data uses steps of `0.015625`, one representable step at that magnitude. Tick selection remains automatic.
These are data-flow controls, not confirmed reproductions of the historical hang. This page loads source without a bundle rebuild.

### Relationship to decimal cleanup

The problems share the tick-generation path, but they are not identical.

`numIntDigits()` supplies the number of integer digits to `findIncr()`. The original implementation coerced its input to a signed 32-bit integer:

```js
(log10((x ^ (x >> 31)) - (x >> 31)) | 0) + 1
```

Examples measured before the fixes:

| Input magnitude | Original count | PR count | Correct count |
|---:|---:|---:|---:|
| `2147483648` | 10 | 10 | 10 |
| `4294967296` | 1 | 10 | 10 |
| `1e14` | 9 | 15 | 15 |
| `1e18` | 10 | 19 | 19 |
| `1e21` | 9 | 22 | 22 |
| `999999999999999` | 10 | 16 | 15 |

Positive and negative inputs produce the same counts in these examples. The tests include both signs.

Wrapping starts at `2^31`, but an incorrect digit count is not guaranteed for every wrapped value. For example, `2147483648` still gets ten digits.

The proposed logarithm has another boundary problem. `999999999999999` is an exactly representable integer, but `Math.log10()` returns `15` in the tested runtime. The proposed expression therefore overcounts by one. That can reject usable increments rather than select an unsafe one.

The digit-count tests use explicit expected counts. They do not use string conversion or `Math.log10()` as their oracle.

### Experimental patch results

The review applied the two PR edits with a temporary Node module loader. Production files remained unchanged. The experiment ran the full precision suite in strict mode.

| Probe group | Result with proposed patch |
|---|---|
| All 41 active historical/demo cases | Pass |
| Int32-wrap tests near `2^32`, `1e14`, `1e18`, and `1e21` | Pass |
| #827 stalled split state | Pass |
| #620 equal custom range | Pass |
| #1084 single-point custom ranger | Pass |
| #1135 explicit X zoom near `1e18` | Pass |
| Six Grafana #116559 precision tests | Still fail |
| Digit count for `999999999999999` | Still fails |
| #1135 explicit Y range near `2.7` | Still exhausts the isolated heap |
| Cheap #1135 first-tick placement assertion | Still fails |

The measured strict total for this patch is **47 passing and 9 failing**. Passing safety tests establish termination for these inputs, not complete chart fidelity.

### Why a monotonicity guard is not sufficient

The #1135 chart probe selects:

```js
scaleMin = 2.7000000476837114;
scaleMax = 2.7000000476837194;
foundIncr = 1e-15;
numDec = 15;
```

The first-tick calculation returns:

```js
roundDec(incrRoundUp(scaleMin, foundIncr), numDec)
// 2.700000000000001
```

This start is approximately `4.77e-8` below the requested minimum. The nominal distance is about 47.7 million increments, rather than the intended handful.

Subsequent rounded ticks still increase. Therefore, the PR's `val > prevVal` guard does not stop this excessive sequence. The exact count differs because decimal correction also changes each step.

The suite now includes a cheap assertion for first-tick placement, in addition to the bounded chart reproduction. A replacement must protect both progress and placement.

## Magnitude demos

The main magnitude stress page is `demos/log-scales2.html`, not the server-count example in `demos/log-scales.html`.

`log-scales2.html` is not registered in `test/demos.mjs`. Its cases therefore lacked snapshot coverage before this review. Three grouped probes now cover eight charts from that page.

| Active demo input | Scale variants | Added coverage |
|---|---|---|
| Decimal grid from `1e-6` through `1e8`, 127 points | Linear, log10, log2 | Automatic bounds, finite ordered ticks, exact log grids |
| `[[0,1],[1e-14,1e14]]` | Explicit log10 range `[1e-14,1e14]` | Full split grid, label thinning, distinct visible labels |
| `[[0,1],[2**-10,2**20]]` | Explicit log2 range `[2**-10,2**20]` | Full split grid and label thinning |
| `[[0,1],[3.1992e-16,4.9047e-13]]` | Automatic log10 | Bounds `[1e-16,1e-12]` and split grid |
| A: `[1000001,1000000,990000]`, B: `[99000,100000,100000.001]` | Separate partial-log10 scales | Bounds `[900000,2000000]` and `[90000,200000]` |
| The same A divided by `10000000`, B divided by `1000000` | Separate partial-log10 scales | Both ranges `[0.09,0.2]` |

The partial-log charts use the exact X values `[1704326400,1704412800,1704499200]`.

The tiny chart's title says “Handle 3e-24 y values.” Its active data actually spans `3.1992e-16` to `4.9047e-13`. The separate `b2433b4` probe covers `1e-24` to `1e-22` instead of relying on that title.

Other relevant demos already have coverage:

- `demos/no-data.js` includes the six near-flat pairs and their negative counterparts. Snapshots `0-12` through `0-23` cover these charts.
- `demos/arcsinh-scales.js` covers signed values from `0.001` through `1000`, with manual and adaptive thresholds.
- `test/demo-extractions.mjs` exercises the arcsinh sliders, not only their initial snapshots.

No commented-out magnitude datasets were found in these pages. Commented `log: 10` declarations only repeat the active default. No demo or snapshot files changed during this audit.

## Limits and replacement criteria

The tests distinguish valid precision from unattainable precision. Cases near `1e18` or with zero-width custom ranges require termination, not arbitrarily fine ticks.

The open [#775 report](https://github.com/leeoniya/uPlot/issues/775) describes problems near `1e-10` to `1e-11`, but supplies no complete numerical fixture. The suite uses other sourced tiny-range cases instead.

Reports [#549](https://github.com/leeoniya/uPlot/issues/549) and [#674](https://github.com/leeoniya/uPlot/issues/674) concern unsupported timestamp/integer precision. They are context, not evidence that binary64 can represent every requested value. Report [#467](https://github.com/leeoniya/uPlot/issues/467) primarily concerns label width and layout.

GitHub rate limits prevented complete comment review for #813 and #713. They are not treated as verified regression cases.

The suite covers numeric values and selected time labels. It does not exercise Grafana's unit formatter or browser rasterization. The two-epsilon tolerance in the tiny log grid allows existing binary residue, not missing, repeated, or unordered ticks.

A replacement needs all of these properties:

- Correct integer-boundary decisions after division.
- Correct decimal values after multiplication.
- Consistent negative tie handling.
- Valid precision metadata for built-in and custom increments.
- Preserved tiny increments and exponent-form values.
- Preserved log2 behavior and explicit cleanup bypasses.
- Finite ranges and terminating tick generation.
- Preservation of real near-integer variation where the selected policy permits it.

A blanket fixed-decimal cleanup cannot meet the tiny-increment tests. Removing the range guards without another safety mechanism risks the historical tick loops.
