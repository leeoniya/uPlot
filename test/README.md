# Demo regression tests

The demo tests render uPlot with a deterministic random-number generator. They
store the DOM and recorded canvas commands in `test/demos/<demo>/<group>-<step>.json`.

## Validate snapshots

```sh
npm test
```

This command validates the snapshots and reports code coverage. If canvas
commands differ, it also writes a self-contained visual comparison to
`test/output/<demo>/<group>-<step>.html`. Use the button in the report to
toggle between the expected and actual renderings.

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
