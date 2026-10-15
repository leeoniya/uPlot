import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

// Pinned source files: bars.ts, quadtree.ts, distribute.ts, utils.ts, uplot-utils.ts.
// Usage: bun --smol grafana-bar-chart-replacement.mjs INPUT_DIR OUTPUT_DIR UPLOT_ROOT
const input = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const project = resolve(process.argv[4]);
const shared = readFileSync(join(input, 'uplot-utils.ts'), 'utf8').split('\n');
if (!shared[69].includes('getStackingBands') || !shared[161].includes('preparePlotData2') || !shared[349].includes('getStackDirection')) {
  throw new Error('Unexpected Grafana source revision');
}
// Original declarations, without unrelated midpoint, legend, or logging code.
const stackSlice = [shared.slice(0, 25), shared.slice(51, 292), shared.slice(349, 403)].flat().join('\n');
const results = [];
for (const scope of ['legacy-bars', 'legacy-stack-helpers', 'legacy-bars-and-stack', 'plugin-current']) {
  const entry = scope === 'legacy-bars' ? "export { getConfig } from './bars';"
    : scope === 'legacy-stack-helpers' ? "export { getStackingBands, getStackingGroups, preparePlotData2 } from './stack-slice';"
    : scope === 'legacy-bars-and-stack' ? "export { getConfig } from './bars'; export { getStackingBands, getStackingGroups, preparePlotData2 } from './stack-slice';"
    : `export { barChartPlugin } from ${JSON.stringify(join(project, 'demos/lib/barChartPlugin.js'))};`;
  const loaded = new Set();
  const build = await Bun.build({
    entrypoints: ['measurement-entry'], target: 'browser', format: 'esm', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'replacement-scope', setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === 'measurement-entry') return { path: args.path, namespace: 'measurement' };
        if (args.path.endsWith('uPlot.js')) return { path: 'uplot', external: true };
        if (args.path === './stack-slice') return { path: args.path, namespace: 'measurement' };
        if (['./bars', './quadtree', './distribute'].includes(args.path)) return { path: join(input, args.path + '.ts') };
        if (scope === 'plugin-current') return undefined;
        return { path: args.path, external: true };
      });
      build.onResolve({ filter: /.*/, namespace: 'measurement' }, (args) => {
        if (args.path === './bars') return { path: join(input, 'bars.ts') };
        if (args.path === './stack-slice') return { path: args.path, namespace: 'measurement' };
        if (args.path.startsWith('/')) return { path: args.path };
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /.*/, namespace: 'measurement' }, (args) => ({
        contents: args.path === 'measurement-entry' ? entry : stackSlice,
        loader: 'ts', resolveDir: input,
      }));
      build.onLoad({ filter: /\.[jt]s$/ }, (args) => {
        loaded.add(args.path.startsWith(input) ? args.path.slice(input.length + 1) : args.path.slice(project.length + 1));
        let contents = readFileSync(args.path, 'utf8');
        if (scope === 'legacy-bars-and-stack' && args.path === join(input, 'bars.ts')) {
          const original = "import { timeUnitSize, type StackingGroup, preparePlotData2 } from '@grafana/ui/internal';";
          if (!contents.includes(original)) throw new Error('Unexpected bars import');
          contents = contents.replace(original, "import { timeUnitSize } from '@grafana/ui/internal'; import { preparePlotData2, type StackingGroup } from './stack-slice';");
        }
        return { contents, loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }],
  });
  if (!build.success) throw new AggregateError(build.logs, scope);
  const bytes = Buffer.from(await build.outputs[0].arrayBuffer());
  const scan = new Bun.Transpiler({ loader: 'js' }).scan(bytes.toString());
  const result = {
    scope, minified: bytes.length,
    gzip9: gzipSync(bytes, { level: 9 }).length,
    brotli11: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    loadedFiles: [...loaded].sort(),
    externals: [...new Set(scan.imports.map(x => x.path))].sort(),
  };
  await Bun.write(join(output, scope + '.min.js'), bytes);
  results.push(result);
  console.log(JSON.stringify(result));
}
const sourceCounts = {};
for (const path of ['bars.ts', 'quadtree.ts', 'distribute.ts', 'utils.ts']) {
  const lines = readFileSync(join(input, path), 'utf8').trimEnd().split('\n');
  sourceCounts[path] = { lines: lines.length, nonblank: lines.filter(x => x.trim()).length };
}
sourceCounts['stack-slice'] = { lines: stackSlice.split('\n').length, nonblank: stackSlice.split('\n').filter(x => x.trim()).length };
for (const path of ['barChartPlugin.js', 'barHover.js', 'barValues.js', 'distr.js']) {
  const lines = readFileSync(join(project, 'demos/lib', path), 'utf8').trimEnd().split('\n');
  sourceCounts[path] = { lines: lines.length, nonblank: lines.filter(x => x.trim()).length };
}
await Bun.write(join(output, 'results.json'), JSON.stringify({ bun: Bun.version, grafanaCommit: '891f7973f81c6e4e0a24bed3120cca3b3cc93ebc', sourceCounts, results }, null, 2) + '\n');
console.log(JSON.stringify(sourceCounts));
