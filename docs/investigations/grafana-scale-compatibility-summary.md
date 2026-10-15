# Grafana scale compatibility: confirmed findings

This summary compares Grafana's pinned `uplot@1.6.32` with the modified uPlot working tree based on `HEAD` `e27e409`.
The current behavior matrix covers `src/uPlot.js` and `dist/uPlot.esm.js`.
The npm 1.6.32 results are historical evidence.

| Priority | Consumer | Breakage |
| --- | --- | --- |
| **High** | TimeSeries and TimelineChart | Data updates can retain stale X bounds and leave pending-pan state unresolved. This affects time series, candlestick, state timeline, and status history. |
| **Medium** | Histogram singleton buckets | Removing X pre-expansion exposes collapsed or reversed ranges in its custom callback. |
| **Medium** | Histogram X zoom | The audited Grafana snapshot's deprecated `setScale: true` drag setting applies exact bounds. It bypasses bucket snapping and configured-limit enforcement. |
| **Conditional** | Exported legacy TimeSeries | Its numeric identity callback produces a zero-width range for singleton data. |

**The main problem is Grafana's `auto: false` time-X configuration.** Previously, `setData()` resubmitted the existing X bounds but still invoked `range()`.
Grafana used that callback to read updated dashboard bounds and acknowledge pans.
The current contract skips it.

Keeping the existing callback and using this configuration restores both behaviors:

```js
auto: true,
scan: false,
```

Grafana already exposes `auto` through its builder.
It needs to expose and forward `scan`.
Public `u.setRange(scaleKey, min, max)` is also available for explicit concrete updates.
It bypasses `scale.range()` and does not acknowledge pending pans by itself.

**The histogram issue is separate and directly related to the raw-X-extrema change.** For a single bucket `[5, 15]`, its callback returns:

- Historical npm 1.6.32: `[0, 10]`—already imperfect, but ordered.
- Current source and ESM bundle: `[10, 10]`—collapsed.
- Proposed dedicated singleton branch: `[5, 15]`.

That branch must return actual bucket edges **before** the generic zero-origin snapping.

For native histogram drag, Grafana can replace the deprecated `cursor.drag.setScale: true` alias with a `cursor.drag.setRange` callback.
The callback can apply the same bucket and limit calculation, then return `[min, max]`.
Programmatic `setScale()` and `setRange()` do not call the drag callback.

The audit probes reproduce these differences against the source and ESM bundle.
They verify the time migration, singleton branch, public `setRange()`, and drag-range callback behavior.
All 64 probes pass.
They do not replace full Grafana browser tests.

See the [full audit](grafana-scale-compatibility.md) for source references, reproduction instructions, existing defects, and the release checklist.
