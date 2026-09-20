# DOM legend implementation

The DOM legend keeps the existing core API: `createLegend(self, parent, opts)` returns `render(values, focus)` and `destroy()`.
It uses an internal keyed list and direct DOM updates.

## Boundaries

| File | Responsibility |
| --- | --- |
| `src/keyed-list.js` | Match keys, reuse instances, place root nodes, and remove obsolete instances. |
| `src/legend-dom-template.js` | Construct the table, headers, rows, markers, labels, and cells. Update values, styles, and bindings. |
| `src/h.js` | Construct real DOM nodes from nested hyperscript calls. |
| `src/legend-dom.js` | Adapt core data, select visible entries, and manage the table lifecycle. |

The reconciler has no legend, class-name, column, or template imports.
It accepts a factory that returns `{node, update(entry), destroy()}`.
Each instance owns one stable root node and all its contents.
The reconciler owns root placement and removal.

The template module defines the legend markup and dynamic fields.
If the factory contract stays the same, changes to this module do not require reconciler changes.

The template uses `h(tag, props, ...children)` to show the element hierarchy.
The helper accepts DOM properties, a style object, and nested arrays of nodes or text.
It omits null, false, and empty children. It does not parse text as HTML.
The helper runs during construction only. Existing update functions retain direct references to their DOM nodes.

A different root tag requires a new instance. The reconciler does not support multi-node fragments.

The keyed list reuses its map and order buffers across updates.
When the order is unchanged, it skips structural DOM writes.
If native `moveBefore()` is available, it uses this method for connected roots to preserve browser state.
Otherwise, it uses `insertBefore()`.
It does not use a longest increasing subsequence (LIS) algorithm to minimize every possible reorder.

## Selection and future features

The adapter creates reusable entries with `{series, index}`.
`series` is the identity key. `index` always refers to the core series array, not the display position.
Values, focus, marker callbacks, and X-series binding eligibility use this core index.

The adapter accepts an optional fourth argument, `selectRows(entries, values)`.
This callback returns the ordered subset to display.
It is an internal experiment, not a public uPlot option.
The adapter refreshes the borrowed entries and their input array on each render.

Tests use this callback for sorting, filtering, pagination, and visible-window subsets.
These operations do not mutate the core series array or require changes to the reconciler.
The keyed list also accepts an optional end-boundary node for independent regions and future spacer elements.

This is not a complete virtualization implementation.
Scroll handling, overscan, row measurements, and spacer calculations remain future work.
Core still prepares the complete legend values array.

## Metadata and lifecycle

The template caches labels and marker presentation by series identity.
Live row instances separately own DOM references, previous cell values, and event bindings.
A row that leaves the selected subset loses its instance. If it returns, the renderer creates a new row from cached metadata.

Caller-supplied HTMLElement labels retain their identity, input state, and external listeners.
Row destruction detaches these labels so the metadata cache does not retain discarded rows and value cells.
The table mount callback runs once, after the initial table is complete and attached.

## Validation commands

Run the compatibility suite:

```sh
bun run test --reporter dot
```

Run the DOM benchmark:

```sh
bun run bench:legend
```

The benchmark loads the DOM source modules directly. It does not require a build step.
Defaults remain 300 Y series plus X, 300 iterations, and the average of the fastest five calls.
The 100 ms setup pause and 20 ms pause after every ten iterations remain outside the measured intervals.

The runner uses a bare Chrome Headless Shell binary, without an automation package.
The first run downloads Chrome Headless Shell 153.0.8010.52 from Google.
Later runs use the cached binary in `node_modules/.cache/uplot-bench/`.
Automatic installation requires Linux x64 and `unzip`.
`CHROME_BIN` selects an existing binary without a download.
`--install-only` prepares the browser without a benchmark.

The package command limits the Node old-space heap to 96 MiB.
The runner sets the Chrome renderer process limit to one and the old-space heap limit to 128 MiB.
These limits do not bound total process memory.
The runner limits each benchmark to 120 seconds and removes its temporary browser files afterward.

Results and module hashes go to `node_modules/.cache/uplot-bench/legend-dom-n300-i300.json` with the default configuration.
The filename includes the series and iteration counts.
`--output FILE` selects a different output path.

## Previously reported DOM timings

The user reported these timings from `endeavour-p14s`, outside the VM.
The user saved the results on that machine as `legend-dom-n300-i300.json`.

These measurements include the hyperscript construction helper and reuse of the existing passive event helpers.
The recorded run used Chrome Headless Shell 153.0.8010.52, 300 Y series plus X, and 300 iterations per workload.
The statistic is the average of the fastest five calls.
The measurements cover synchronous DOM updates with a hidden host, not layout or paint.

| Workload | DOM |
| --- | ---: |
| Mount/destroy | 1,814 µs |
| Changed values | 115 µs |
| Unchanged values | 45 µs |
| Focus-only | 50 µs |
| Show/hide | 110 µs |
| Keyed reorder | 325 µs |
| Keyed add/remove | 310 µs |

These are historical measurements from one run, not confidence intervals or new validation results.
The local file `node_modules/.cache/uplot-bench/legend-dom-final-n300-i300.json` contains older VM timings, not the results in this table.
