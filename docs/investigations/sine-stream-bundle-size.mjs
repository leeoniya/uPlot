import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync, brotliCompressSync, constants} from 'node:zlib';
import {rolldown} from 'rolldown';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, '.cache/sine-stream-size');
mkdirSync(dir, {recursive: true});
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path));
const hash = data => createHash('sha256').update(data).digest('hex');
const sizes = data => ({
	bytes: Buffer.byteLength(data),
	gzip9: gzipSync(data, {level: 9}).length,
	brotli11: brotliCompressSync(data, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length,
	sha256: hash(data),
});
const expected = {
	d3: '7.9.0',
	'chart.js': '4.6.1',
	'chartjs-adapter-date-fns': '3.0.0',
	'date-fns': '2.19.0',
	echarts: '6.1.0',
};
for (const [name, version] of Object.entries(expected))
	assert.equal(json(`.cache/sine-stream-size/node_modules/${name}/package.json`).version, version, name);
const rolldownVersion = json('node_modules/rolldown/package.json').version;
assert.equal(rolldownVersion, '1.2.15');
const lock = json('.cache/sine-stream-size/package-lock.json');
const results = {
	measuredAt: new Date().toISOString(),
	runtime: {node: process.version, zlib: process.versions.zlib, brotli: process.versions.brotli},
	versions: {...expected, rolldown: rolldownVersion, uplot: json('package.json').version},
	dependencies: Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path).map(([path, pkg]) => [path, pkg.version])),
	configuration: {
		platform: 'browser', libraryFormat: 'es', demoFormat: 'iife', minify: true,
		define: {'process.env.NODE_ENV': '"production"'}, treeShaking: 'default',
		sourcemap: false, gzipLevel: 9, brotliQuality: 11,
	},
	inputs: {}, distributions: {}, builds: {},
};
function demo(path, expectedURLs) {
	const data = read(path);
	const html = data.toString();
	const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
	const urls = scripts.flatMap(m => [...m[1].matchAll(/\bsrc="([^"]+)"/g)].map(m => m[1]));
	assert.deepEqual(urls, expectedURLs, `${path}: update the measurement for changed dependencies`);
	results.inputs[path] = {sha256: hash(data), scripts: urls};
	return scripts.filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n');
}
const d3JS = demo('bench/D3-sine-stream.html', ['https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js']);
const chartJS = demo('bench/Chart.js4-sine-stream.html', [
	'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js',
	'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0',
]);
const echartsJS = demo('bench/ECharts5-sine-stream.html', ['https://fastly.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js']);
const uplotJS = demo('demos/sine-stream.html', ['../dist/uPlot.iife.js']);
assert.match(echartsJS, /containLabel:\s*false/);
assert.match(echartsJS, /outerBoundsMode:\s*"none"/);
for (const [name, path] of Object.entries({
	d3: '.cache/sine-stream-size/node_modules/d3/dist/d3.min.js',
	chartjs: '.cache/sine-stream-size/node_modules/chart.js/dist/chart.umd.min.js',
	chartjsAdapter: '.cache/sine-stream-size/node_modules/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js',
	echarts: '.cache/sine-stream-size/node_modules/echarts/dist/echarts.min.js',
	uplotMinified: 'dist/uPlot.iife.min.js',
	uplotLoadedUnminified: 'dist/uPlot.iife.js',
	uplotCSS: 'dist/uPlot.min.css',
})) results.distributions[name] = {path, ...sizes(read(path))};
results.distributions.chartjsTotal = Object.fromEntries(['bytes', 'gzip9', 'brotli11'].map(key => [key,
	results.distributions.chartjs[key] + results.distributions.chartjsAdapter[key],
]));
results.inputs['dist/uPlot.esm.js'] = {sha256: hash(read('dist/uPlot.esm.js'))};

const d3Exports = `export {select, pointer} from 'd3-selection';
export {scaleTime, scaleLinear} from 'd3-scale';
export {line, area} from 'd3-shape';
export {timeHour} from 'd3-time';
export {bisectCenter} from 'd3-array';\n`;
const d3Names = [...new Set([...d3JS.matchAll(/\bd3\.(\w+)/g)].map(m => m[1]))];
assert.deepEqual(d3Names.toSorted(), ['select', 'pointer', 'scaleTime', 'scaleLinear', 'line', 'area', 'timeHour', 'bisectCenter'].toSorted());
const chartComponents = ['LineController', 'LineElement', 'PointElement', 'TimeScale', 'LinearScale', 'Filler', 'Legend', 'Tooltip'];
const chartImports = `import {Chart, ${chartComponents.join(', ')}} from 'chart.js';
import 'chartjs-adapter-date-fns';
Chart.register(${chartComponents.join(', ')});\n`;
const echartsExports = `import {init, use} from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent, TooltipComponent, LegendComponent, DatasetComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
use([LineChart, GridComponent, TooltipComponent, LegendComponent, DatasetComponent, CanvasRenderer]);
export {init};\n`;
writeFileSync(resolve(dir, 'd3-subset.js'), d3Exports);
writeFileSync(resolve(dir, 'echarts-subset.js'), echartsExports);
const entries = [
	['d3UmbrellaLibrary', `export {${d3Names.join(',')}} from 'd3';`, 'es'],
	['d3Library', d3Exports, 'es'],
	['d3Demo', `import * as d3 from './d3-subset.js';\n${d3JS}`, 'iife'],
	['chartjsLibrary', chartImports + 'export {Chart};\n', 'es'],
	['chartjsDemo', chartImports + chartJS, 'iife'],
	['echartsLibrary', echartsExports, 'es'],
	['echartsDemo', `import * as echarts from './echarts-subset.js';\n${echartsJS}`, 'iife'],
	['uplotLibrary', `export {default} from '../../dist/uPlot.esm.js';\n`, 'es'],
	['uplotDemo', `import uPlot from '../../dist/uPlot.esm.js';\n${uplotJS}`, 'iife'],
];
for (const [name, source, format] of entries) {
	const input = resolve(dir, `${name}.js`);
	writeFileSync(input, source);
	const warnings = [];
	const bundle = await rolldown({
		input, platform: 'browser',
		transform: {define: {'process.env.NODE_ENV': JSON.stringify('production')}},
		onwarn(warning) { warnings.push({code: warning.code, message: warning.message}); },
	});
	try {
		const {output} = await bundle.generate({format, minify: true, sourcemap: false});
		assert.equal(output.length, 1);
		const chunk = output[0];
		assert.equal(chunk.type, 'chunk');
		assert.deepEqual(chunk.imports, []);
		assert.deepEqual(chunk.dynamicImports, []);
		assert.deepEqual(warnings, [], name);
		const file = resolve(dir, `${name}.min.js`);
		writeFileSync(file, chunk.code);
		results.builds[name] = {file: relative(root, file), format, warnings, ...sizes(chunk.code)};
	} finally {
		await bundle.close();
	}
}
writeFileSync(resolve(root, 'docs/investigations/sine-stream-bundle-size-results.json'), JSON.stringify(results, null, 2) + '\n');
console.table(Object.entries(results.distributions).map(([name, {bytes, gzip9, brotli11}]) => ({name, bytes, gzip9, brotli11})));
console.table(Object.entries(results.builds).map(([name, {bytes, gzip9, brotli11}]) => ({name, bytes, gzip9, brotli11})));
