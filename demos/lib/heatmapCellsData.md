# Synthetic heatmap cells

`generateHeatmapCells()` creates a deterministic, sparse latency dataset for the heatmap demos. It requires no dependencies or JSON download.

```js
import { generateHeatmapCells } from './lib/heatmapCellsData.js';

const frames = generateHeatmapCells();
const [xMax, yMin, yMax, count, yLayout] = frames[0].data.values;

const smaller = generateHeatmapCells({ seed: 42, columns: 256 });
const sparseX = generateHeatmapCells({ xGapProbability: 0.02 });
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `1` | Unsigned 32-bit integer for the local random generator. |
| `columns` | `2569` | Number of time intervals. Must be a positive safe integer. |
| `interval` | `1200000` | Width of each interval in milliseconds (20 minutes). Must be a positive safe integer. |
| `start` | `Date.UTC(2026, 7, 20, 10, 20)` | Left boundary of the first interval, in milliseconds since the Unix epoch. |
| `xGapProbability` | `0` | Probability of omission for each interior time column, from `0` to `1`. |

The start and final timestamps must be safe integers. Invalid option values throw an error.

The defaults produce 251,281 populated cells across about 35.7 days. Other seeds produce approximately 250,000 cells, not an exact cell count.

The same options produce the same data for this implementation. Each call returns fresh arrays and objects without changes to the options or global random state. Future model changes can change the output for a seed.

## Frame format

The result is a one-element Grafana-style frames array with `schema.meta.type: 'heatmap-cells'`.

The five arrays in `data.values` correspond to these fields:

- `xMax`: right boundary of each time interval, in milliseconds since the Unix epoch.
- `yMin`: lower latency boundary, in seconds.
- `yMax`: upper latency boundary, in seconds.
- `count`: positive fractional rate, in multiples of `1 / 285`, rather than an integer event count.
- `yLayout`: zero for each cell.

The interval width also appears in the `xMax` field configuration. Cells follow timestamp order, then latency order. Empty cells do not appear in the arrays.

## Missing time columns

By default, every time column contains cells. The partial outage removes some latency bands, not whole columns.

`xGapProbability` omits whole columns from the regular time grid. It does not change cell widths or fill gaps with zero counts. The first and last columns always remain, so the time range does not change. A value of `1` retains only those endpoint columns.

A separate seeded random stream selects the gaps. Surviving cells retain exactly the same latencies and counts as the output without gaps. Higher probabilities remove a superset of the columns for the same seed and other options.

The demo pages use `xGapProbability: 0.02` for approximately 2% missing interior columns. With the default seed, this produces 246,053 cells. At full scale, individual gaps can be narrower than one pixel. Zoom reveals the empty intervals.

The uPlot plugin leaves gap interiors unpainted and returns no hover hit there. Hit testing follows rounded canvas bounds. At an exact cell boundary, an adjacent painted cell can still respond. The shared comparison helper instead uses half-open data bounds: left-inclusive and right-exclusive.

## Approximation model

The generator combines Gaussian bands in log₂ latency with slow drift and Poisson sampling. The uniform grid has eight buckets per latency doubling.

The main features are:

- Persistent bands near 15 µs, 6–7 ms, 100 ms, 300–400 ms, and 1.5 s.
- Broad intermediate populations, sparse tails, and little traffic between 100 and 400 µs.
- Short daily count pulses across the millisecond-to-second populations, with little change in the microsecond band.
- Upper-tail humps that rise before the count pulses and fall rapidly afterward, plus smaller secondary humps.
- A brief partial outage near 26.5% of the time range, without missing timestamps.
- Additional traffic near 0.75 ms and 1.8 ms after 79.6% of the time range.
- A broader count increase from about day 28.4 to day 33, strongest at 10–100 ms, with smaller increases through several seconds.
- A gap in the fast band between 92.4% and 97.1%, with traffic shifted to the 1.8 ms band.

The upper-tail component moves from about 2.1 s to 4.5 s during each main hump. Sparse samples extend farther, up to the grid limit of 13.45 s. The reference also stops at 13.45 s, near the 16 s axis limit.

These features scale with the number of columns. The model uses 35.7 cycles across the full time range. Changes to `start` or `interval` affect timestamps, not the latency or rate arrays.

This model approximates the reference heatmap appearance and rate distribution. It does not reproduce the original measurements or mixed bucket resolutions.
