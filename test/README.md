# Demo regression tests

The demo tests render uPlot with a deterministic random-number generator. Each
snapshot stores the DOM and canvas commands for one plot.

- Single-plot step: `test/demos/<demo>/<group>-<step>.json`
- Multi-plot step: `test/demos/<demo>/<group>-<step>/<plot-index>.json`

Group and step IDs default to their zero-based indexes. An optional `id` field
provides a stable name when cases change order. IDs accept letters, digits,
underscores, and hyphens. The recorder rejects duplicate group IDs and snapshot paths.

## Validate snapshots

```sh
npm test
```

This command validates the snapshots and reports code coverage. If snapshots
differ, the recorder writes one self-contained report to `test/output/index.html`
after the run. The report includes every mismatched plot, including multiple
plots from one test step.

Use the failure selector or the Previous and Next buttons to choose a snapshot.
Hover over the chart to show the actual rendering. Move the pointer away to
restore the expected rendering. The hover area keeps the larger dimensions of
the two snapshots to prevent flicker when their sizes differ.
The report renders only the selected comparison and reuses one canvas.
A validation run clears previous reports before the tests start. A passing run
creates no report.

The report embeds the recorded commands and replays them with the browser's
native Canvas and `Path2D` APIs. Open the HTML file directly in a browser.
No server or network access is required. Rendering uses the browser's fonts and
rasterization rather than pre-rendered PNG images. Snapshot comparisons still
use the recorded commands, not pixels.

## Run natively with Bun

```sh
bun run test:bun
```

This command runs Mocha and the NYC coverage reporter under Bun. It uses the
same snapshots, Istanbul instrumentation, and file-selection rules as the Node command.
The runner writes coverage from the test process and its subprocesses to
`.nyc_output/bun`. Each Bun run clears that directory. A Node test run clears
`.nyc_output`, including the Bun results.

`bun run test` still runs the existing Node command. Use `test:bun` for native Bun execution.

Mocha arguments pass through to the Bun runner:

```sh
bun run test:bun --grep '^area-fill '
```

The Bun loader selects source files at startup. Files created later in the run
are not instrumented. The current suite uses existing source files.

To record snapshots under Bun, run:

```sh
UPDATE=1 bun run test:bun
```

This command replaces snapshots. Both runtimes share the same snapshot files.

## Record snapshots

```sh
npm run test:update
```

This command sets `UPDATE=1` and replaces all snapshots with the current
output. Review the JSON changes before you commit them.

## Add a demo

1. Export the demo's test groups from `demos/<name>.js`.
2. Add `<name>` to `test/demos.mjs`.
3. Run `npm run test:update`.
4. Run `npm test`.

## Define render steps

`plotStep()` accepts a function that returns one plot or an array of related
plots. The function can be asynchronous. The helper returns a step with an
async `render()` method and normalizes its result to a plot array.

```js
import { plotStep } from './renderDemo.js';

export default [{
	id: 'comparison',
	steps: [{
		id: 'variants',
		...plotStep(async () => {
			const data = await loadData();
			return [makeChart(data), makeOtherChart(data)];
		}),
		breakAfter: 1,
	}],
}];
```

Here, `loadData`, `makeChart`, and `makeOtherChart` are demo-specific functions.
The recorder captures both plots and destroys them after validation, including
when a comparison fails. Each step must return at least one plot.

The helper awaits construction, which lets the initial uPlot microtask complete.
It does not wait for timers, images, or animation. If a demo requires additional
asynchronous work, await that work inside its callback.

Existing hand-written `render()` methods remain supported. They must return a
nonempty plot array. Layout fields such as `name`, `breakBefore`, and `breakAfter`
keep their existing behavior.

If an ID or the plot count changes, move or remove the previous snapshot files.
Update mode does not remove obsolete snapshots.

## Run one demo with a memory limit

The following commands skip coverage and limit the JavaScript heap to 256 MiB.

```sh
UPDATE=1 node --max-old-space-size=256 --import ./scripts2/register-hooks.mjs ./node_modules/mocha/bin/mocha.js --grep '^multi-bars '
node --max-old-space-size=256 --import ./scripts2/register-hooks.mjs ./node_modules/mocha/bin/mocha.js --grep '^multi-bars '
```

For multiple demos, run one process at a time.
