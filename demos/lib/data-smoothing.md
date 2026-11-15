# Smoothing ordered time series

`loess.js`, `mean-gam.js`, and `quantile-gam.js` are standalone classic scripts without runtime dependencies.
They expose one-shot functions (`loess`, `meanGAM`, `quantileGAM`) and reusable fitter factories (`createLoess`, `createMeanGAM`, `createQuantileGAM`).

The GAM demo defaults to a mean fit by penalized least squares.
The “Quantile fits (slower)” checkbox replaces the mean with lower, median, and upper quantile curves.
The demo creates the quantile fitter only on first use and retains it across mode changes.

## Input coordinates

All three helpers accept an optional `x` array in their options:

```js
const x = [0, 1, 3, 4, 12, 20, 21];
const y = [8, 9, 11, null, 16, 13, 14];

const trend = loess(y, {
    x,
    span: 0.3,
    robustnessIters: 2,
    maxFits: 512,
});

const mean = meanGAM(y, {x, knots: 30, lambda: 10});

const fit = quantileGAM(y, {
    x,
    quantiles: [0.1, 0.5, 0.9],
    knots: 30,
    lambda: 10,
    maxIterations: 10000,
});
// fit.curves, fit.iterations, fit.converged: one entry per requested quantile.
```

- `x` must have the same length as `y`. Arrays and numeric typed arrays are supported.
- Every x value must be finite and strictly increasing, including positions with missing y values. Duplicate or unordered coordinates cause an error.
- Without `x`, the helpers use the original sample indices.
- Nonfinite and nonnumeric y values do not participate. Their output positions remain `null`.
- The helpers do not sort or modify the input arrays.

Distances, interpolation, and spline coordinates use actual x values, not compressed sample ranks. Large timestamp offsets do not replace local differences.
Each observation has equal importance before distance or robustness weights. The helpers do not weight observations by elapsed time between samples.

## Repeated fits and buffer ownership

The one-shot functions return independent results. Reusable fitters retain scratch buffers and overwrite their output arrays:

```js
const smooth = createLoess();
const loessOptions = {x, span: 0.05};
const trend = smooth(y, loessOptions);

loessOptions.span = 0.1;
smooth(y, loessOptions); // Updates the same trend array.

const fitMean = createMeanGAM();
const fitQuantiles = createQuantileGAM();
const gamOptions = {x, quantiles: [0.1, 0.5, 0.9], knots: 30, lambda: 10};
const mean = fitMean(y, gamOptions);
const result = fitQuantiles(y, gamOptions);

gamOptions.lambda = 20;
fitMean(y, gamOptions); // Updates the same mean array.
fitQuantiles(y, gamOptions); // Reuses result, curves, iterations, and converged.
```

The demo passes these output arrays directly to uPlot. Slider events reuse the options objects and quantile array instead of copying full result columns.

- Each fitter owns a private workspace. Separate fitters do not share mutable buffers.
- Every call validates and rereads the inputs and options. In-place changes to caller-owned data and x arrays take effect on the next call.
- Numeric buffers grow geometrically. Smaller fits retain their capacity, and quantile GAM retains unused curve arrays for later reuse.
- Within existing sample, basis, and quantile capacities, successful refits create no helper-owned arrays, typed-array views, or result objects.
- Adaptive quantile GAM factorizations overwrite a preallocated factor buffer, separate from the initial factor.
- JavaScript-engine internals can still allocate, especially when output array lengths change. These guarantees concern helper-owned storage.

**The next call overwrites the previous result.** A persistent snapshot requires an explicit copy, such as `trend.slice()` or `result.curves.map(curve => curve.slice())`.
Both GAM fitters reject their own output arrays as inputs. The quantile fitter also rejects inactive pooled curves and metadata arrays.
Copy an owned array before you use it as data, x, or quantiles.

Retained memory follows the largest capacities seen by the fitter, not the latest input size. Releasing the fitter permits collection of its scratch buffers.

## LOESS

Each local regression fits a line with tricube distance weights. Optional bisquare residual weights reduce the influence of outliers.
`span` selects a fraction of finite samples, not a fixed duration. Local time widths therefore vary with sample density.

### Bounded fitting work

The default `maxFits: 512` limits local regressions per pass on large series:

- Regular coordinates use an evenly spaced sample-index grid, including both endpoints.
- Irregular coordinates combine a sample-index grid with sample pairs around a grid in x.
- Those pairs preserve both sides of gaps that contain x-grid points, including isolated observations between large gaps.
- Other finite samples use linear interpolation in x. Every robust pass updates residuals for all finite samples.

Series with at most `maxFits` finite samples use exact fits. Neighborhoods with at most 16 samples also use exact fits, regardless of the budget.

The bounded path is an approximation. A finite budget cannot preserve every narrow feature or gap, and there is no general interpolation-error bound.
A larger `maxFits` increases coverage and computation.

**Setting `maxFits` to the finite sample count requests exact fits. A fixed fractional span then restores quadratic work.**

Let `n` be the input length, `k` the neighborhood size, and `m` the number of local fits:

| Work | Cost |
| --- | --- |
| Coordinate validation, anchor selection, and monotone neighborhood scan | O(n) |
| Local regressions and interpolation, per pass | O(n + m·k) |
| Residual median selection, per robust pass | Normally O(n), worst-case O(n log n) |
| One-shot storage | O(n) |

For a fixed fit budget, local-regression work grows linearly with n, even when the fractional span stays fixed.
Median selection has a partition-work limit and an in-place heapsort fallback. It creates no temporary views and cannot accumulate quadratic partition work.
`robustnessIters` adds that many passes after the initial fit.

The demo span slider is logarithmic: `span = 0.05 * 2 ** sliderValue`.
It covers 0.0015625–0.4, defaults to 0.05, and changes by approximately 0.7% per step.

## GAM basis

Both GAMs have one smooth term over x, with the same cubic B-spline basis and second-difference penalty.
Each observation has four nonzero basis weights. The normal matrix has three subdiagonals, so factorization and solves use banded arrays, not dense matrices.
Neither GAM subsamples the observations.

The spline domain runs from the first finite response's x to the last finite response's x.
Missing endpoint padding does not change the domain. Internal gaps retain their actual spacing.

`knots` specifies the number of basis coefficients, with a minimum of four and a default of 30.
A positive `lambda` controls the penalty. The helpers default to `lambda: 1`, and the demo uses `lambda: 10`.
The response uses a centered, normalized scale. The loss is a sum, not a mean, so the effect of `lambda` also depends on sample count.

### Mean GAM (default)

`meanGAM(y, options)` returns an Array with one fitted mean per input position.
`createMeanGAM()` returns a reusable callable with the same arguments and return type.
The model minimizes:

```text
0.5 * sum((yNormalized - Bβ)^2) + lambda / 2 * ||D²β||²
```

The solver forms `BᵀB + lambda * DᵀD` and `Bᵀy`, then uses one banded Cholesky factorization and solve.
Preparation, fitting, and prediction take O(n + k) work and storage for n positions and k coefficients.
Empty, constant, and at most two observed responses use analytic results instead.

### Quantile GAM (optional)

The model minimizes summed quantile loss plus the coefficient penalty. It is not least-squares regression.
A fixed 256-bin histogram supplies initial quantile estimates only. The iterative ADMM solver still uses the exact observations and objective.

For n input positions, k coefficients, q quantiles, and at most I iterations per quantile:

| Work | Cost |
| --- | --- |
| Basis and penalty preparation | O(n + k) |
| Histogram initial estimates | O(256·q), after an O(n) histogram pass |
| Fit | O(q·I·(n + k)) |
| Workspace | O(n + k) |
| Returned curves | O(q·n) |

`maxIterations` bounds work per quantile. It does not guarantee convergence within that budget.
Convergence requires feasibility and stationarity checks. A `false` entry in `converged` means that the corresponding curve is the last iterate, not a certified optimum.
The iteration count depends on the data, so linear work per iteration does not imply linear time to convergence.

Quantiles fit independently and can cross. The curves describe conditional quantiles, not confidence intervals.
All three helpers saturate output overflow at `±Number.MAX_VALUE`. Quantile convergence describes the normalized spline before this output clamp.

### Runtime comparison

The mean GAM needs one solve. The quantile GAM needs repeated passes and solves for each requested probability.
The same basis does not make their runtime costs equal. Equal `lambda` values also do not imply equal smoothing across the two losses.

The ggplot GAM fallback uses mean regression, not quantile regression.
This demo supplies a manual-λ mean baseline, not mgcv automatic smoothing selection through REML.
The bounded LOESS approximation also differs from exact LOESS, which can require quadratic work.

## Validation and timing

The numerical tests include irregular coordinates, gaps, large timestamp offsets, clustered observations, and input immutability.
Operation counters check scaling without wall-clock thresholds. Allocation counters check warmed refits, adaptive factorizations, and capacity growth.
Reuse tests cover changing inputs and options, shrinking and growing series, independent fitters, and output resets.
LOESS tests also compare bounded fits with exact fits and exercise a 160,000-sample series.

Run the focused tests:

```sh
node scripts/test.mjs --no-coverage --workers=1 test/loess.mjs test/mean-gam.mjs test/quantile-gam.mjs test/data-smoothing.mjs
```

Normal runs skip the slow quantile numerical tests and real quantile integration tests.
Mean numerical tests and demo controls tests remain enabled. The controls tests use fast quantile stubs for checkbox changes and rendering.

Run the real quantile tests explicitly:

```sh
TEST_QUANTILE_GAM=1 node scripts/test.mjs --no-coverage --workers=1 test/quantile-gam.mjs test/data-smoothing.mjs
```

Run the timing benchmark:

```sh
node bench/data-smoothing.mjs
```

The benchmark compares one-shot and reused fitters for LOESS, mean GAM, and quantile GAM.
It verifies identical results and counts typed-buffer allocations separately from timing.
It separates fixed-budget quantile GAM timing from time to convergence. Its fixed-budget results are not necessarily converged fits.
The benchmark includes real quantile fits regardless of the test environment variable.
