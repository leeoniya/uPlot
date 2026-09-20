# Internal legend renderer prototype

The prototype keeps the existing core API: `createLegend(self, parent, opts)` returns `render(values, focus)` and `destroy()`.
The production renderer and distribution builds still use ivi. No dependency or public option changed.

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

To change legend markup or dynamic fields, edit the template module.
The factory contract stays the same, so the reconciler does not need to change.
The template uses `h(tag, props, ...children)` to show the element hierarchy.
The helper accepts DOM properties, a style object, and nested arrays of nodes or text.
It omits null, false, and empty children. It does not parse text as HTML.
The helper runs during construction only. Existing update functions retain direct references to their DOM nodes.
A different root tag requires a new instance. Multi-node fragments are outside this prototype's scope.

The keyed list reuses its map and order buffers across updates.
It skips structural DOM writes when the order is unchanged.
For connected roots, it uses native `moveBefore()` when available to preserve browser state. Otherwise, it uses `insertBefore()`.
It does not use an LIS algorithm to minimize every possible reorder.

## Selection and future features

The adapter creates reusable entries with `{series, index}`.
`series` is the identity key. `index` always refers to the core series array, not the display position.
Values, focus, marker callbacks, and X-series binding eligibility use this core index.

The prototype accepts an optional fourth argument, `selectRows(entries, values)`.
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

Labels and marker presentation stay cached by series identity, as in the ivi implementation.
Live row instances separately own DOM references, previous cell values, and event bindings.
A row that leaves the selected subset loses its instance. If it returns, the renderer creates a new row from cached metadata.

Caller-supplied HTMLElement labels retain their identity, input state, and external listeners.
Row destruction detaches these labels so the metadata cache does not retain discarded rows and value cells.
The table mount callback runs once, after the initial table is complete and attached.

## Validation commands

Run the prototype against the existing source compatibility suite:

```sh
bun run test --require ./scripts/legend-dom-hook.mjs --reporter dot
```

The hook redirects source legend imports. Distribution tests still exercise the unchanged ivi artifacts.

Run each benchmark separately:

```sh
bun run bench:legend --renderer ivi
bun run bench:legend --renderer dom
```

Both commands use the same cached Chrome binary and benchmark fixtures.
Defaults remain 300 Y series plus X, 300 iterations, and the average of the fastest five calls.
The 100 ms setup pause and 20 ms pause after every ten iterations remain outside the measured intervals.
Results and module hashes go to separate JSON files in `node_modules/.cache/uplot-bench/`.

## Measurements with hyperscript and shared helpers

These measurements include the hyperscript construction helper and reuse of the existing passive event helpers.
Both runs use Chrome Headless Shell 153.0.8010.52.
They cover synchronous renderer work with a hidden host, not layout or paint.

| Workload | ivi | Prototype |
| --- | ---: | ---: |
| Mount/destroy | 1,525 µs | 1,814 µs |
| Changed values | 150 µs | 115 µs |
| Unchanged values | 66 µs | 45 µs |
| Focus-only | 80 µs | 50 µs |
| Show/hide | 145 µs | 110 µs |
| Keyed reorder | 379 µs | 325 µs |
| Keyed add/remove | 305 µs | 310 µs |

These are individual runs, not confidence intervals.

Size comparisons use Rollup and the Terser settings from `rollup.config.js`.
The experimental full bundle substitutes the prototype at the existing source import boundary.

| Output | ivi | Prototype |
| --- | ---: | ---: |
| Legend, minified | 8,594 bytes | 4,189 bytes |
| Legend, gzip | 3,985 bytes | 1,994 bytes |
| Full bundle, minified | 69,009 bytes | 64,098 bytes |
| Full bundle, gzip | 29,642 bytes | 27,436 bytes |

The full bundle shares helpers with core, so its savings differ from the standalone legend comparison.
The experimental bundles and measurements do not replace the production distribution files.

Saved results in `node_modules/.cache/uplot-bench/`:

- `legend-size-final.json`
- `legend-ivi-final-n300-i300.json`
- `legend-dom-final-n300-i300.json`
