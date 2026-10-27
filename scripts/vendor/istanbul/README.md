# ESTree instrumenter

This directory contains the source instrumenter.
It uses Meriyah for parsing, Astring for code generation, and the Jridgewell source-map libraries.


## Provenance

This code derives from the `istanbul-lib-instrument@6.0.3` npm package.
Upstream repository: <https://github.com/istanbuljs/istanbuljs/tree/master/packages/istanbul-lib-instrument>.

The upstream BSD-3-Clause license remains in `LICENSE`.

- `source-coverage.cjs` is an unchanged copy of upstream `src/source-coverage.js`, with a `.cjs` extension.
- `index.mjs` adapts the rules from `visitor.js`, `instrumenter.js`, `read-coverage.js`, and `constants.js` to ESTree.
- `backend.mjs` implements parsing and code generation.

The instrumenter retains the Istanbul coverage schema, helper naming, metadata hashes, counter allocation, and anonymous-function naming.
It uses `istanbul-lib-coverage` for coverage data.

## Use

Run either command from the project root:

```sh
npm test
bun run test
```

Both runtimes use the existing loader, disk cache, per-process coverage output, and terminal reporter.
Node writes coverage to `.nyc_output`. Bun writes coverage to `.nyc_output/bun`.
Cache namespaces include both lockfiles, the vendored implementation, and the coverage loader code.
Cache entries depend on the filename, source contents, and instrumentation configuration.

## Supported scope and limits

This instrumenter supports the project's JavaScript coverage requirements, not the complete upstream package API.
It exposes `createInstrumenter()`, `instrumentSync()`, `instrument()`, `lastFileCoverage()`, and `lastSourceMap()`.


Supported behavior includes functions, classes, defaults, branches, loops, ignore directives, custom coverage globals, repeat instrumentation, and generated source maps.
The instrumenter can compose an explicit input source map with the generated map.

The following configuration values cause explicit errors:

- `reportLogic: true`
- Nonempty `parserPlugins` or `generatorOpts`
- `preserveComments: true`

The instrumenter does not support TypeScript, JSX, or Babel plugin transforms.
Comments supply ignore directives, but the generator does not retain ordinary comments.
`compact: true` removes indentation but keeps line breaks.
The instrumenter does not automatically load an input map from a source-map comment.
Callers must supply `inputSourceMap` explicitly.

The optional-chain tests require agreement with the original program.
The current corpus does not establish compatibility with every valid JavaScript program or every upstream ignore-comment placement.

## Validation and benchmarks

Run the focused tests:

```sh
node --max-old-space-size=384 --test --test-isolation=none test/tooling/instrument-estree.mjs test/tooling/instrument-estree-chains.mjs test/tooling/instrument-estree-metadata.mjs test/tooling/instrument-source.mjs test/tooling/register-hooks.mjs
bun test ./test/tooling/instrument-estree.mjs ./test/tooling/instrument-estree-chains.mjs ./test/tooling/instrument-estree-metadata.mjs ./test/tooling/instrument-source.mjs ./test/tooling/register-hooks.mjs
```

Run benchmarks separately, with no concurrent test suite or other heavy operation:

```sh
node scripts/bench-instrument.mjs
bun scripts/bench-instrument.mjs
```

The benchmark measures only the vendored ESTree instrumenter on the configured 30-file corpus.
Before timing, it verifies identical code, complete coverage metadata, and source maps from reused and new instrumenter instances.
It also verifies that cache output matches direct output and that cache hits do not rewrite entries.
These checks establish internal consistency, not independent upstream parity, runtime semantics, or source-map accuracy.

The benchmark measures cold imports and instrumentation, cold process wall time, warm uncached instrumentation, new instrumenter instances, and warm disk-cache reads.
Source maps are enabled. Results include output sizes and fingerprints of the corpus, vendored code, lockfiles, and installed instrumentation dependencies.
Results and worker logs remain under `.cache/bench-instrument/`.

Workers run sequentially. Node processes use a 384-MiB heap limit.
Bun uses `--smol`, which reduces memory use but is not a hard limit.
Workers have 30-second time limits, and the coordinator has a 180-second time limit.
A failed or interrupted run is not a valid benchmark result.

## Maintenance

Retain `LICENSE` and the source provenance when you change the vendored code.
Before an upstream update, compare its visitor rules and coverage schema with this implementation.
Add a regression fixture for each intentional semantic difference or newly supported configuration value.
