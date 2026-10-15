import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

// Usage: bun --smol measure.mjs /path/to/extracted/grafana /path/to/output [/path/to/uplot]
const root = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const ui = 'packages/grafana-ui/src/';
const panel = 'public/app/plugins/panel/barchart/';
const schema = 'packages/grafana-schema/src/';
const entry = join(root, panel, 'BarChartPanel.tsx');

function sourcePath(path) {
  for (const suffix of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) {
    const candidate = path + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Missing selected source: ${path}`);
}

const chartPaths = [
  `${ui}components/uPlot/config/`,
  `${ui}components/uPlot/Plot.tsx`,
  `${ui}components/uPlot/utils.ts`,
  `${ui}components/uPlot/internal.ts`,
  `${ui}components/uPlot/types.ts`,
  `${ui}utils/measureText.ts`,
  `${ui}utils/debug.ts`,
  `${ui}utils/logger.ts`,
  `${ui}components/DateTimePickers/TimeZonePicker/timeZoneUtils.ts`,
  'public/app/plugins/panel/timeseries/utils.ts',
];
const visualPaths = [
  `${ui}components/uPlot/plugins/TooltipPlugin2.tsx`,
  `${ui}components/uPlot/plugins/CloseButton.tsx`,
  `${ui}components/VizTooltip/`,
  `${ui}components/VizLegend/`,
  `${ui}components/VizLayout/`,
  `${ui}components/Table/types.ts`,
  'public/app/plugins/panel/timeseries/TimeSeriesTooltip.tsx',
  'public/app/plugins/panel/status-history/utils.ts',
  'public/app/core/components/TimelineChart/utils.ts',
];

// Read the real public export declarations, rather than substitute implementations.
function namedExports(file) {
  const result = new Map();
  const text = readFileSync(join(root, file), 'utf8');
  for (const match of text.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const item of match[1].split(',')) {
      const spec = item.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const [original, alias = original] = spec.split(/\s+as\s+/);
      if (!/^\w+$/.test(original) || !/^\w+$/.test(alias)) continue;
      const target = match[2].startsWith('.')
        ? resolve(root, dirname(file), match[2])
        : match[2];
      result.set(alias, { original, target });
    }
  }
  return result;
}
const exportsByPackage = {
  '@grafana/ui': namedExports(`${ui}index.ts`),
  '@grafana/ui/internal': namedExports(`${ui}internal/index.ts`),
};

const results = [];
async function record(name, built, loaded) {
  if (!built.success) throw new AggregateError(built.logs, `Build failed: ${name}`);
  const artifact = built.outputs.find((item) => item.kind === 'entry-point');
  if (!artifact || built.outputs.length !== 1) throw new Error('Expected one JS output');
  const bytes = Buffer.from(await artifact.arrayBuffer());
  const scan = new Bun.Transpiler({ loader: 'js', target: 'browser' }).scan(bytes.toString());
  const expected = name === 'uplot-plugin-current' ? 'barChartPlugin' : 'BarChartPanel';
  if (!scan.exports.includes(expected)) throw new Error('Entry export was removed');
  const result = {
    scope: name,
    minified: bytes.length,
    gzip9: gzipSync(bytes, { level: 9 }).length,
    brotli11: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    // Loaded files are a conservative graph, not per-file retained-byte attribution.
    loadedSources: [...loaded].sort(),
    retainedExternals: [...new Set(scan.imports.map((item) => item.path))].sort(),
  };
  await Bun.write(join(output, `${name}.min.js`), bytes);
  results.push(result);
  console.log(JSON.stringify({ ...result, loadedSources: result.loadedSources.length }));
}
const options = {
  target: 'browser', format: 'esm', minify: true, sourcemap: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};
for (const level of [0, 1, 2]) {
  const name = ['panel-local', 'with-chart-support', 'with-visualization-ui'][level];
  const selected = [panel, ...(level > 0 ? [schema, ...chartPaths] : []), ...(level > 1 ? visualPaths : [])];
  const allowed = (path) => selected.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix);
  const loaded = new Set();
  const variants = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];
  const selectedSource = (absolute) => {
    if (!variants.some((suffix) => allowed(relative(root, absolute) + suffix))) return null;
    const resolved = sourcePath(absolute);
    return allowed(relative(root, resolved)) ? resolved : null;
  };
  const built = await Bun.build({
    ...options,
    entrypoints: [entry],
    plugins: [{
      name: 'explicit-source-boundary',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (level > 0 && args.path === '@grafana/schema') {
            return { path: sourcePath(join(root, schema, 'index')) };
          }
          let absolute;
          if (args.path.startsWith('/')) absolute = args.path;
          else if (args.path.startsWith('.')) absolute = resolve(args.resolveDir || dirname(args.importer), args.path);
          else if (args.path.startsWith('app/')) absolute = join(root, 'public', args.path);
          else return { path: args.path, external: true };
          const path = selectedSource(absolute);
          return path ? { path } : { path: `grafana-source/${relative(root, absolute)}`, external: true };
        });
        build.onLoad({ filter: /\.[jt]sx?$/ }, (args) => {
          loaded.add(relative(root, args.path));
          let contents = readFileSync(args.path, 'utf8');
          if (level > 0) {
            // Rewrite named UI imports to their verified source exports. Leave
            // framework imports external. Avoid traversing the entire UI barrel.
            contents = contents.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])(@grafana\/ui(?:\/internal)?)\2\s*;?/g,
              (statement, items, quote, pkg) => {
                const groups = new Map();
                for (const item of items.split(',')) {
                  const spec = item.trim();
                  if (!spec || spec.startsWith('type ')) continue;
                  const [imported, local = imported] = spec.split(/\s+as\s+/);
                  const exp = exportsByPackage[pkg].get(imported);
                  if (!exp) throw new Error(`Unmapped UI import: ${pkg} ${imported}`);
                  let target = pkg;
                  let symbol = imported;
                  if (exp.target === '@grafana/schema') {
                    target = exp.target;
                    symbol = exp.original;
                  } else if (exp.target.startsWith('/')) {
                    const path = selectedSource(exp.target);
                    if (path) { target = path; symbol = exp.original; }
                  }
                  if (!groups.has(target)) groups.set(target, []);
                  groups.get(target).push(symbol === local ? symbol : `${symbol} as ${local}`);
                }
                return [...groups].map(([path, names]) => `import { ${names.join(', ')} } from ${JSON.stringify(path)};`).join('\n');
              });
          }
          return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts' };
        });
      },
    }],
  });
  await record(name, built, loaded);
}

if (process.argv[4]) {
  const uplotRoot = resolve(process.argv[4]);
  const loaded = new Set();
  const built = await Bun.build({
    ...options,
    entrypoints: [join(uplotRoot, 'demos/lib/barChartPlugin.js')],
    plugins: [{ name: 'external-uplot-core', setup(build) {
      build.onResolve({ filter: /uPlot\.js$/ }, () => ({ path: 'uplot', external: true }));
      build.onLoad({ filter: /\.js$/ }, (args) => { loaded.add(relative(uplotRoot, args.path)); });
    } }],
  });
  await record('uplot-plugin-current', built, loaded);
}
await Bun.write(join(output, 'results.json'), JSON.stringify({ bun: Bun.version, results }, null, 2) + '\n');
