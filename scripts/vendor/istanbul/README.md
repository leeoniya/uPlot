# Experimental ESTree instrumenter

This directory contains an experimental port of `istanbul-lib-instrument` 6.0.3.
The default test backend still uses the upstream package and Babel.
The port uses Meriyah 7.4.1, Astring 1.9.0, and the Jridgewell source-map libraries.
It does not load Babel or the upstream instrumenter.

## Provenance

Upstream repository: <https://github.com/istanbuljs/istanbuljs/tree/master/packages/istanbul-lib-instrument>.
The source copy came from the `istanbul-lib-instrument@6.0.3` npm package, whose integrity is recorded in the root lockfile.
The upstream BSD-3-Clause license is in `LICENSE`.

- `source-coverage.cjs` is an unchanged copy of upstream `src/source-coverage.js`, with a `.cjs` extension.
- `index.mjs` adapts the rules from `visitor.js`, `instrumenter.js`, `read-coverage.js`, and `constants.js` to ESTree.
- `backend.mjs` implements parsing and code generation without a Babel API compatibility layer.

The port retains the upstream coverage schema, helper naming, metadata hashes, counter allocation, and anonymous-function naming.
It uses the existing `istanbul-lib-coverage` package for coverage data.

## Use

Run either command from the project root:

```sh
UPLOT_INSTRUMENTER=estree npm test
UPLOT_INSTRUMENTER=estree bun run test
```

`UPLOT_INSTRUMENTER=istanbul` selects the reference backend. An unset variable also selects the reference backend.
The selected backend uses the existing loader, disk cache, per-process coverage output, and terminal reporter.
ESTree output is separate: `.cache/coverage-estree/node/` or `.cache/coverage-estree/bun/`.
Cache namespaces include the backend and the vendored implementation files. Cache keys also distinguish backends in explicitly shared directories.

## Supported scope and limits

This is a project-specific JavaScript prototype, not a general replacement for Babel or the complete upstream package API.
It exposes `createInstrumenter()`, `instrumentSync()`, `instrument()`, `lastFileCoverage()`, and `lastSourceMap()`.
It does not expose the Babel-specific `programVisitor()` API.

Supported behavior includes functions, classes, defaults, branches, loops, ignore directives, custom coverage globals, repeat instrumentation, and generated source maps.
An explicit input source map can be composed with the generated map.
Counter maps and execution behavior have differential tests against the installed upstream instrumenter.

The following options fail explicitly:

- `reportLogic: true`
- Nonempty `parserPlugins` or `generatorOpts`
- `preserveComments: true`

TypeScript, JSX, and Babel plugin transforms are outside this prototype.
Comments supply ignore directives, but the generator does not retain ordinary comments.
`compact: true` removes indentation but keeps line breaks. Generated formatting is not byte-compatible with Babel.
The port does not automatically load an input map from a source-map comment. Callers must supply `inputSourceMap` explicitly.

The optional-chain tests require agreement with the original program.
They record an upstream generator defect for optional-chain template tags instead of reproducing that defect.
Passing the current corpus does not establish compatibility with every valid JavaScript program or every upstream ignore-comment placement.

## Validation and benchmarks

Run the focused tests:

```sh
node --max-old-space-size=256 --test --test-isolation=none test/tooling/instrument-estree.mjs test/tooling/instrument-estree-chains.mjs test/tooling/instrument-source.mjs test/tooling/register-hooks.mjs
bun test ./test/tooling/instrument-estree.mjs ./test/tooling/instrument-estree-chains.mjs ./test/tooling/instrument-source.mjs ./test/tooling/register-hooks.mjs
```

Run benchmarks separately, with no concurrent test suite:

```sh
node scripts/bench-instrument.mjs
bun scripts/bench-instrument.mjs
```

The benchmark checks complete coverage metadata for the configured 30-file corpus before timing either backend.
It measures fresh processes, warm uncached instrumentation, new instrumenter instances, and warm disk-cache reads.
Source maps are enabled. The benchmark records output sizes and source fingerprints under `.cache/bench-instrument/`.
Node processes use a 384-MiB heap limit. Bun uses `--smol`, which reduces memory use but is not a hard limit.
Workers have 30-second time limits, and the coordinator has a 180-second time limit.
A failed or interrupted run is not a valid benchmark result.

The parser investigation compared Acorn, Meriyah, Oxc, and Babel on the same corpus.
Meriyah beat Acorn with locations and comments enabled on both runtimes.
Oxc's AST transfer and location normalization offset much of its parser speed in this JavaScript pipeline.
These parser results are not full-instrumentation or full-test-suite speedups.

## Prototype results

Measured on the configured 30-file corpus, with source maps enabled, Node 26.12.1, and Bun 1.4.4.
Times are medians in milliseconds per complete corpus, not per file.

| Runtime and mode | Upstream Istanbul | ESTree | Ratio |
| --- | ---: | ---: | ---: |
| Node, cold import and instrumentation | 3,429.72 | 1,391.22 | 2.47x |
| Node, warm uncached instrumentation | 2,558.61 | 908.19 | 2.82x |
| Node, warm disk cache | 9.30 | 8.14 | 1.14x |
| Bun, cold import and instrumentation | 3,070.74 | 1,183.14 | 2.60x |
| Bun, warm uncached instrumentation | 2,084.99 | 1,158.37 | 1.80x |
| Bun, warm disk cache | 7.94 | 6.34 | 1.25x |

The normal suite passed with ESTree on both runtimes: 3,926 passes on Node and 3,925 on Bun, with 44 skips each.
The 271 focused tests also passed on each runtime.
The real-suite reports had identical coverage maps and covered/uncovered classifications for all 29 loaded files.
Full-suite invocation counts differed. Exact invocation-count parity is tested with deterministic fixtures, not claimed for the full suite.
The complete `test:all` suite was not run for this prototype.

Removing the reference instrumenter can reduce the installed dependency tree from 64 to 29 package instances.
The estimated package-content saving is 8.9 MiB, before the small vendored-code cost.
The prototype retains the reference instrumenter, so these savings are potential rather than current.

## Maintenance

Keep the upstream instrumenter installed as a differential-test reference while this port is experimental.
Before an upstream update, compare its visitor rules and coverage schema with this port.
Add a regression fixture for each intentional semantic difference or newly supported option.
Do not remove Babel dependencies until the supported scope and maintenance cost are acceptable.
