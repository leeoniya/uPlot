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

Core applies `legend.filter`, `legend.sort`, and `legend.limit` before the DOM update.
The adapter reads the resulting `legend.order` and adds the eligible X row before the selected Y rows.
The [live selection contract](investigations/legend-selection.md) describes callbacks, cursor distances, readback, and invalidation.

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

## Layout and position

`legend.mode` selects `'inline'` or `'table'` independently of value formatting.
The default `null` retains layout inference from `series.values`.
Scalar tables retain the eligible X row and do not show an internal column-key header.
Multi-value legends retain their named headers. Nonlive legends contain labels without value cells.

`legend.side` selects top (`0`), right (`1`), bottom (`2`, default), or left (`3`).
Both layout options apply at initialization.
All positions use one fixed CSS Grid on the root, without another wrapper.
The legend table receives `.u-top`, `.u-rgt`, `.u-btm`, or `.u-lft`. The default bottom legend also receives `.u-btm`.
The root has no position attribute or class. Side columns use `max-content`, while the center column uses `auto`.
The title spans the layout, and left/right legends align with the chart wrapper's top edge.
Chart dimensions exclude the legend. Custom mounting remains available.
Every legend render invalidates cached overlay geometry for the next pointer event, without an immediate geometry read.

## Metadata and lifecycle

The template caches labels and marker presentation by series identity.
Rows prepare metadata when created. The adapter does not make a separate preparation pass over selected entries.
Metadata callbacks can interleave with earlier row updates. No separate preparation-phase ordering is guaranteed.
Live row instances separately own DOM references, previous cell values, and event bindings.
A row that leaves the selected subset loses its instance. If it returns, the renderer creates a new row from cached metadata.

Caller-supplied HTMLElement labels retain their identity, input state, and external listeners.
Row destruction detaches these labels so the metadata cache does not retain discarded rows and value cells.
The table mount callback runs once, after the initial table is complete and attached.
This mount occurs after pending initial commits finish, with initialized data and layout.
Core sets its internal ready state to `true` and `status` to `1` before the mount, then calls the `ready` hook.
Core does not render the legend during constructor setup.

## Synchronous updates and structural refresh

Core keeps a render-dirty flag separate from selection invalidation.
The render helper updates only the DOM. It does not evaluate selection, format values, or schedule work.
Cursor updates and explicit `setLegend` calls complete values and selection before the synchronous DOM update.
After initialization, the associated `setLegend` and `setCursor` hooks observe the completed DOM.
During initialization, these hooks can run before the initial mount.
A cursor operation that changes focus and values renders the legend once, after both changes.

Dynamic visibility and focus selection still wait for the existing normal chart commit.
At that commit, core updates the DOM synchronously without a later legend frame.
There is no legend animation-frame scheduler, replacement microtask scheduler, or `legend.rAF` option.

Standalone `addSeries()` and `delSeries()` only mark selection and rendering dirty, for visible and hidden legends alike.
Neither method schedules a frame or forces a new canvas commit.
This intentionally changes the previous behavior for visible legends.
Structural changes inside a `setLegend` hook also remain pending until another refresh.

Before the next refresh, supply data columns that match the changed series array.
For a legend-only refresh, use this sequence:

```js
u.addSeries(newSeries, index);
u.setData(newData, false);
u.setLegend({});
```

This sequence protects selection callbacks from unaligned data and does not force a canvas commit.
Deletion requires the same data alignment before refresh.
A cursor update or a normal commit from `setData(data)` or `redraw()` can also complete pending structural work.

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
They do not measure the effect of removing core animation-frame scheduling.
That removal does not guarantee a performance gain.
Synchronous DOM updates remove the frame delay but do not combine separate operations into one frame.
Browser layout, paint, callback costs, and formatting still require separate measurements.
The local file `node_modules/.cache/uplot-bench/legend-dom-final-n300-i300.json` contains older VM timings, not the results in this table.
