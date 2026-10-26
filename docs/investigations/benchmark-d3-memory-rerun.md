# Memory comparison after the numeric and timezone changes

## Result

The changes removed the main retained-memory gap between uPlot and the D3 min/max variants.
Across two fresh comparisons, uPlot retained 4.70–5.09 MB less memory than the pre-change bundle.
Its sampled peak decreased by 4.27–5.48 MB.

Current uPlot retained 0.70–0.77 MB more than D3 canvas min/max in these runs.
Its sampled peak was 0.77–2.22 MB lower than D3 canvas min/max.
D3 SVG still had a substantially higher peak.

These results do not attribute the remaining approximately 0.7 MB retained difference to a specific component.

## Method

The rerun used the production capture and analysis functions:

- `captureBenchmarkTrace()` with memory enabled and tracing disabled.
- `summarizeAdjustedProcessMemory()` for the normal blank-page and idle adjustment.
- Three warmups and seven measured sessions per variant, each with small initialization and a full-data update.
- Chrome Headless Shell `156.0.8078.47`, DPR 1, hardware AMD graphics, and Vulkan requested.
- One browser at a time, with a fresh profile for each variant.

Each comparison started with a fresh idle control. The second comparison reversed the order of the four chart variants.
The before control served the minified uPlot bundle from commit `28b7be5dd5301daf6d61e76ffaa14a17063be88b`.
The current control served the rebuilt working-tree bundle.

All adapters, styles, data, and lifecycle code remained current for both uPlot controls.
Their served source hashes differed only for `/dist/uPlot.iife.min.js`.
The runner did not replace repository files or existing benchmark reports.

## Adjusted process-tree PSS

Values are decimal MB. Each cell is the minimum across seven measured sessions, not an average.
Retained memory follows the full-data update, settling, and forced garbage collection.
Peak memory is the maximum sampled within each session, followed by the minimum across sessions.

### Run A

Order: idle, pre-change uPlot, current uPlot, D3 canvas min/max, D3 SVG min/max.

| Variant | Peak MB | Retained MB |
| --- | ---: | ---: |
| uPlot before | 18.364 | 14.883 |
| uPlot current | 14.090 | 10.179 |
| D3 canvas min/max | 14.857 | 9.404 |
| D3 SVG min/max | 21.618 | 10.911 |

uPlot reduction: **4.274 MB peak**, **4.704 MB retained**.

### Run B

Order: idle, D3 SVG min/max, D3 canvas min/max, current uPlot, pre-change uPlot.

| Variant | Peak MB | Retained MB |
| --- | ---: | ---: |
| uPlot before | 16.189 | 12.536 |
| uPlot current | 10.711 | 7.447 |
| D3 canvas min/max | 12.927 | 6.746 |
| D3 SVG min/max | 21.719 | 9.873 |

uPlot reduction: **5.478 MB peak**, **5.089 MB retained**.

## Same-chart ICU confirmation

A separate probe kept the current uPlot chart alive and changed neither its data nor its drawing.
It forced garbage collection before and after these operations:

```js
new Intl.NumberFormat();
new Intl.DateTimeFormat().resolvedOptions().timeZone;
void 0
```

The operations added **3.652608 MB** of process-tree PSS and **zero bytes** of live JavaScript heap.
The mapping changes were:

| Mapping | PSS increase |
| --- | ---: |
| ICU data | 2.095104 MB |
| Native allocator | 1.319936 MB |
| Chrome executable | 0.237568 MB |
| C runtime | 0.001024 MB |

The earlier pre-change uPlot control added only 0.041 MB because it already initialized ICU.
The new result supports the conclusion that the current benchmark avoids those eager initializations.

The same-chart increase is not identical to the separate-browser before/after difference.
Independent browser baselines, code changes, and allocator state affect those comparisons.

## Limits

Absolute adjusted values changed between runs. The idle retained-minus-blank control changed from 22.593 MB to 24.153 MB.
Per-browser blank measurements and allocator behavior also varied.
The before/after reduction and the remaining canvas retained-memory difference were more consistent than absolute values.

Every variant had seven valid retained checkpoints and seven valid sampled-peak values in both comparisons.
Some other process observations were incomplete because processes disappeared during `/proc` reads.
The production analyzer excluded those observations. The saved evidence records their phases and errors.

These are memory-only measurements, without trace-buffer overhead. They are not an exact replay of the earlier screenshot.
They also do not establish the same savings for applications that initialize ICU elsewhere or request an explicit timezone.

## Reproduction and saved evidence

From the repository root, run the commands serially:

```sh
node docs/investigations/benchmark-d3-memory-rerun.mjs
node docs/investigations/benchmark-d3-memory-rerun.mjs --reverse
node docs/investigations/benchmark-d3-retention-probe.mjs uplot
```

The runner uses cached dependencies and the pinned browser. Each run stores raw evidence under `/tmp` and removes its browser profiles.

[Saved results](benchmark-d3-memory-rerun-results.json) include both tables, individual rounds, source hashes, incomplete observations, and the paired ICU measurement.
The [original investigation](benchmark-d3-retention.md) contains the data-retention, hover, path-cache, and SVG string-construction controls.
