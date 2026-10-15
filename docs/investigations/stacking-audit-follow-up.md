# Stacking audit: remaining follow-up

Date: 2026-09-21

Baseline: local `origin/master` at `88d47517`.
The audit covered the stacking checkpoint `b7064a80` and subsequent working-tree changes.

## Status

One scheduler defect remains open. The defect also occurs upstream.
The stacking-specific invalidation regression and the bar-radius defect are resolved.

| Item | Status |
| --- | --- |
| Range requests from `setScale` hooks can disappear | Open, separate scheduler fix |
| Deferred batch hooks can run after data disposal | Accepted legacy behavior, no fix planned |
| Full restacking and global path invalidation | Accepted simplicity tradeoff |
| Baseline storage for all integrated bar stacks | Accepted memory tradeoff |
| One overlapping stack in the grouped-bars plugin | Accepted demo constraint |

## Open: range requests from hooks can disappear

### Effect

A `setScale` hook can change series visibility through `setSeries()`.
The next commit recomputes stacked data, but the scale can retain its previous range.
This is a stale final range, not only an intermediate draw.

The audit reproduced this defect with sign-consistent groups and mixed-sign bar groups.
A fresh probe after the simplifications reproduced it again with `dir: 0`.

### Reproduction

1. Create a mode-1 chart with this data:

   ```js
   const data = [
       [0, 1, 2],
       [10, 10, 10],
       [1, 2, 3],
   ];
   ```

2. Configure bar paths and `stack: {groups: [{series: [1, 2], dir: 0}]}`.
3. Configure `scales.x.time: false` and `scales.y.range: (u, min, max) => [0, max]`.
4. Wait for the initial commit.
5. Install a one-shot `setScale` hook that hides series 1 when the X scale changes.
6. Call `u.setScale('x', {min: 0, max: 1})`.
7. Wait for the queued commits.
8. Compare the final data and range with this table:

| Final state | Actual | Expected |
| --- | --- | --- |
| `u._data[2]` | `[1, 2, 3]` | `[1, 2, 3]` |
| X range | `[0, 1]` | `[0, 1]` |
| Y range | `[0, 12]` | `[0, 2]` |

### Cause

The relevant functions are in [`src/uPlot.js`](../../src/uPlot.js):

1. `setScales()` calls the `setScale` hooks.
2. The hook calls `setSeries()`, which queues a new range request and marks the stack scale dirty.
3. At the end of `setScales()`, the loop clears every entry in `pendScales`, including the new request.
4. After `setScales()` returns, `_commit()` also clears `shouldSetScales`.
5. `stackDirty` causes another commit, but the new range request is absent.

The dirty-scale set preserves restacking and targeted extrema invalidation. It does not preserve pending range requests.

### Investigation plan

1. Add a regression for the reproduction before changing the scheduler.
2. Separate pending requests from requests that the current scale pass consumes.
3. Preserve requests that hooks add during that pass.
4. Consume the current scale flag before callbacks can request another pass.
5. Preserve explicit bounds from later calls instead of replacing them with automatic ranges.
6. Check that untouched scales do not receive extra range calls.
7. Check both stacked and unstacked visibility changes.
8. Check multiple scale requests and termination with one-shot hooks.

A snapshot of pending requests is a candidate implementation, not an established design.
Unconditional reranging of every scale is not an acceptable workaround.

Related coverage:
- [`test/master-scheduler-bugs.mjs`](../../test/master-scheduler-bugs.mjs) records other upstream scheduler defects.
- [`test/stacks.mjs`](../../test/stacks.mjs) covers queued restacking, affected scales, and final draw data.
- The reproduction above does not yet have a committed regression test.

## Accepted: deferred batch hooks and data disposal

With `cache: {data: false}`, this call can dispose data before deferred hooks run:

```js
u.batch(() => u.setData(nextData), true);
```

The deferred `draw` hook can observe empty `u.data` and `u._data`, plus `u._base === null`.
`batch()` calls `_commit()` before the microtask that runs `flushHooks()`.
Automatic disposal occurs inside `_commit()`.

This behavior also occurs upstream. `batch(..., true)` is a legacy API.
The accepted direction permits lifecycle changes and does not require preservation of its former expectations.
No compatibility fix is planned for this combination.

Ordinary draw hooks still receive final endpoints and baselines before automatic disposal.
Pending render work keeps those arrays alive until the next commit completes.

## Accepted tradeoffs

- **Full transform:** a visibility change recomputes all groups once per commit. No incremental buffers or per-group caches are necessary now.
- **Path invalidation:** restacking invalidates all Y paths. Only affected scales lose their cached extrema.
- **Bar baselines:** every integrated bar group uses `dir: 0`, including sign-consistent input. Each visible member retains one baseline array.
- **Line and area groups:** `dir: 1` and `dir: -1` use generated bands without per-point baseline storage.
- **Demo layout:** the grouped-bars plugin assumes one overlapping stack. Independent side-by-side stack groups remain outside its layout contract.

These choices do not require immediate changes. Further optimization needs workload measurements and a separate complexity assessment.

## Resolved findings

- Restacking no longer clears extrema on unrelated scales. Regression tests cover custom `fillTo()` inputs and multiple scale updates.
- Integrated bars use `_base` directly. The renderer no longer constructs or traverses predecessor chains.
- Stacked ordinal data no longer receives a redundant outer-array copy.
- The demos use the simplified bar contract. Duplicate baseline tests and unused plugin arguments are removed.
- Bar radii now follow mapped endpoint and baseline positions, including reversed scales and nonzero baselines.

Radius coverage is in [`test/bar-radii.mjs`](../../test/bar-radii.mjs).
Baseline and disposal coverage is in [`test/stack-baselines.mjs`](../../test/stack-baselines.mjs).

## Validation record

After the radius fix:
- Full suite: **1816 passing, 39 pending**.
- Bundle build: passed.
- Existing demo snapshots: unchanged by the simplifications and radius fix.
- `git diff --check`: passed.

During preparation of this document, the focused scheduler probe still produced Y range `[0, 12]` instead of `[0, 2]`.
