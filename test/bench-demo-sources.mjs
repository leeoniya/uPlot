import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { loadBenchDemoSources } from '../scripts/bench-demo-sources.mjs';

const root = new URL('../', import.meta.url);
const demos = [['d3', 'D3.html'], ['chartjs', 'Chart.js4.html'], ['echarts', 'ECharts5.html'],
	['flot', 'Flot.html'], ['dygraphs', 'dygraphs.html']];
const footer = "\nconst wait = document.getElementById('wait');\nexport {makeChart, prepData};\n";
const {files, dependencies, localScripts} = loadBenchDemoSources(root);
const packed = [8, 'epoch', 'idl', 'recv', 'send', 'read', 'writ', 'used', 'free',
	10, 75, 2, 3, 4, 25, 75, 0,
	11, 50, 2, 6, 4, 50, 50, 0];

function evaluate(id, extra = {}) {
	const wait = {textContent: 'not started'};
	const calls = [];
	const sandbox = {
		console: {time() {}, timeEnd() {}},
		devicePixelRatio: 2,
		document: {getElementById(name) {
			calls.push(name);
			assert.equal(name, 'wait');
			return wait;
		}},
		fetch() { assert.fail('module must not fetch'); },
		setTimeout() { assert.fail('module must not schedule chart creation'); },
		requestAnimationFrame() { assert.fail('module must not schedule animation'); },
		...extra,
	};
	const source = files.get(`/bench/${id}-source.mjs`);
	const exports = runInNewContext(source.replace('export {makeChart, prepData};', '') +
		'\n({makeChart, prepData, setupCanvas: typeof setupCanvas === "function" ? setupCanvas : null})', sandbox);
	return {exports, sandbox, wait, calls};
}

function withChangedDemo(file, transform, check) {
	const dir = mkdtempSync(join(tmpdir(), 'uplot-bench-demo-sources-'));
	try {
		mkdirSync(join(dir, 'bench'));
		for (const name of [...demos.map(([, name]) => name), 'fmtDate.js'])
			copyFileSync(new URL('bench/' + name, root), join(dir, 'bench', name));
		const path = join(dir, 'bench', file);
		const original = readFileSync(path, 'utf8');
		const changed = transform(original);
		assert.notEqual(changed, original, 'mutation must change the demo');
		writeFileSync(path, changed);
		check(pathToFileURL(dir + '/'));
	}
	finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

describe('benchmark demo sources', () => {
	it('selects only one demo and its dependencies for isolated process runs', () => {
		for (const [id] of demos) {
			const selected = loadBenchDemoSources(root, id);
			assert.deepEqual([...selected.files.keys()], [`/bench/${id}-source.mjs`, ...(id === 'dygraphs' ? ['/bench/fmtDate.js'] : [])]);
			assert.deepEqual(selected.localScripts, id === 'dygraphs' ? ['/bench/fmtDate.js'] : []);
			assert.ok(selected.dependencies.length > 0);
		}
		const uplot = loadBenchDemoSources(root, 'uplot');
		assert.deepEqual([...uplot.files.keys()], ['/bench/d3-source.mjs']);
		assert.deepEqual(uplot.dependencies, []);
		assert.deepEqual(uplot.localScripts, []);
		const idle = loadBenchDemoSources(root, 'idle');
		assert.equal(idle.files.size, 0);
		assert.deepEqual(idle.dependencies, []);
		assert.throws(() => loadBenchDemoSources(root, 'unknown'), /Unknown demo variant/);
	});
	it('returns five verbatim ES modules and the local date formatter', () => {
		assert.ok(files instanceof Map);
		assert.deepEqual([...files.keys()], [...demos.map(([id]) => `/bench/${id}-source.mjs`), '/bench/fmtDate.js']);
		assert.deepEqual(localScripts, ['/bench/fmtDate.js']);
		assert.equal(files.get(localScripts[0]), readFileSync(new URL('bench/fmtDate.js', root), 'utf8'));
		for (const [id, file] of demos) {
			const html = readFileSync(new URL('bench/' + file, root), 'utf8');
			const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
			const boundary = inline.search(/^[\t ]*(?:let|const) wait =/m);
			const source = files.get(`/bench/${id}-source.mjs`);
			assert.equal(source, inline.slice(0, boundary) + footer);
			assert.doesNotMatch(source, /fetch\(|setTimeout\(|Fetching|Rendering\.\.\./);
			execFileSync(process.execPath, ['--input-type=module', '--check'], {input: source});
		}
	});

	it('derives all pinned dependencies from demo URLs in script/style load order', () => {
		assert.deepEqual(dependencies.map(({name, version}) => [name, version]), [
			['d3', '7.9.0'], ['chart.js', '4.6.1'], ['@date-fns/cdn', '4.4.0'],
			['chartjs-adapter-date-fns', '3.0.0'], ['echarts', '6.1.0'],
			['jquery', '3.7.1'], ...Array.from({length: 8}, () => ['flot', '4.2.6']),
			['dygraphs', '2.2.2'], ['dygraphs', '2.2.2'],
		]);
		const urls = demos.flatMap(([, file]) => [...readFileSync(new URL('bench/' + file, root), 'utf8')
			.matchAll(/(?:<script src="|<link rel="stylesheet" href=")(https:[^"]+)"/g)].map(match => match[1]));
		assert.deepEqual(dependencies.map(dep => dep.url), urls);
		assert.equal(new Set(dependencies.map(dep => dep.route)).size, 16);
		assert.equal(new Set(dependencies.map(dep => dep.cacheName)).size, 16);
		for (const dep of dependencies) {
			assert.deepEqual(Object.keys(dep), ['name', 'version', 'url', 'route', 'cacheName',
				...(dep.type === 'style' ? ['type'] : [])]);
			assert.ok(dep.url.includes(`/npm/${dep.name}@${dep.version}/`));
			assert.match(dep.cacheName, dep.type === 'style' ? /^[\w.-]+\.css$/ : /^[\w.-]+\.js$/);
			assert.ok(dep.cacheName.includes(dep.version));
			assert.equal(dep.route, '/bench/vendor/' + dep.cacheName);
		}
		assert.ok(dependencies[2].url.endsWith('/cdn.min.js'));
		assert.ok(dependencies[3].url.endsWith('/dist/chartjs-adapter-date-fns.min.js'));
		assert.doesNotMatch(dependencies[3].url, /bundle/);
		assert.deepEqual(dependencies.filter(dep => dep.type), [dependencies.at(-1)]);
		assert.equal(dependencies.at(-1).type, 'style');
		assert.equal(dependencies.some(dep => dep.name === 'globalize'), false);
		assert.ok(dependencies.filter(dep => dep.name === 'flot').every(dep => dep.url.includes('/source/')));
	});

	it('reads versions afresh from the demos, including cache names and routes', () => {
		withChangedDemo('D3.html', html => html.replace('d3@7.9.0/', 'd3@7.9.1/'), changedRoot => {
			const dep = loadBenchDemoSources(changedRoot).dependencies[0];
			assert.equal(dep.version, '7.9.1');
			assert.ok(dep.url.includes('d3@7.9.1/'));
			assert.ok(dep.cacheName.includes('7.9.1'));
			assert.ok(dep.route.includes('7.9.1'));
		});
	});

	it('reads stylesheet versions and local script contents afresh', () => {
		withChangedDemo('dygraphs.html', html => html.replace('dygraphs@2.2.2/dist/dygraph.min.css', 'dygraphs@2.2.3/dist/dygraph.min.css'), changedRoot => {
			const dep = loadBenchDemoSources(changedRoot).dependencies.at(-1);
			assert.equal(dep.type, 'style');
			assert.equal(dep.version, '2.2.3');
			assert.equal(dep.cacheName, 'dygraphs-2.2.3-dygraph.min.css');
			assert.equal(dep.route, '/bench/vendor/' + dep.cacheName);
		});
		withChangedDemo('fmtDate.js', source => source + '\n// fresh local source\n', changedRoot => {
			assert.equal(loadBenchDemoSources(changedRoot).files.get('/bench/fmtDate.js'),
				files.get('/bench/fmtDate.js') + '\n// fresh local source\n');
		});
	});

	for (const [id] of demos) {
		it(`${id}: defines callable functions without auto-fetching, rendering, or changing wait text`, () => {
			const {exports, calls, wait} = evaluate(id);
			assert.equal(typeof exports.makeChart, 'function');
			assert.equal(typeof exports.prepData, 'function');
			assert.deepEqual(calls, ['wait']);
			assert.equal(wait.textContent, 'not started');
			const data = exports.prepData(packed);
			const expected = id === 'd3' ? [[600000, 660000], [25, 50], [25, 50], [3, 6]] :
				id === 'chartjs' ? [[{x: 600000, y: 25}, {x: 660000, y: 50}],
					[{x: 600000, y: 25}, {x: 660000, y: 50}], [{x: 600000, y: 3}, {x: 660000, y: 6}]] :
				id === 'flot' ? [[[600000, 25], [660000, 50]], [[600000, 25], [660000, 50]], [[600000, 3], [660000, 6]]] :
				id === 'dygraphs' ? [['1970-01-01T00:10:00.000Z', 25, 25, 3], ['1970-01-01T00:11:00.000Z', 50, 50, 6]] :
					[660000, 25, 25, 3, 720000, 50, 50, 6];
			assert.deepEqual(JSON.parse(JSON.stringify(Array.from(data))), expected);
		});
	}

	it('retains D3 devicePixelRatio at evaluation time rather than hardcoding a DPR', () => {
		assert.match(files.get('/bench/d3-source.mjs'), /const pxRatio = devicePixelRatio;/);
		for (const dpr of [1, 1.5, 2]) {
			const {exports, sandbox} = evaluate('d3', {devicePixelRatio: dpr});
			sandbox.devicePixelRatio = 3;
			const scales = [];
			const ctx = {scale: (...args) => scales.push(args)};
			const canvas = {getContext: kind => { assert.equal(kind, '2d'); return ctx; }};
			assert.equal(exports.setupCanvas(canvas), ctx);
			assert.equal(canvas.width, 1920 * dpr);
			assert.equal(canvas.height, 600 * dpr);
			assert.deepEqual(scales, [[dpr, dpr]]);
		}
	});

	for (const [id, method] of [['chartjs', 'destroy'], ['echarts', 'dispose']]) {
		it(`${id}: returns the created instance for ${method} cleanup`, () => {
			let created, configured = false, disposed = false;
			const wait = {};
			const ctx = {};
			const dom = {getContext: () => ctx};
			const instance = {[method]() { disposed = true; }};
			const data = [[], [], []];
			const {exports} = evaluate(id, {
				document: {getElementById: name => name === 'wait' ? wait : dom},
				Chart: function(context, config) {
					assert.equal(context, ctx);
					assert.equal(config.data.datasets[0].data, data[0]);
					assert.equal(config.options.animation, false);
					created = instance;
					return instance;
				},
				echarts: {init(element, theme, options) {
					assert.equal(element, dom);
					assert.equal(theme, null);
					assert.equal(options.width, 1920);
					instance.setOption = (config, opts) => {
						assert.equal(config.dataset.source, data);
						assert.equal(config.animation, false);
						assert.equal(opts.notMerge, true);
						configured = true;
					};
					created = instance;
					return instance;
				}},
			});
			const chart = exports.makeChart(data);
			assert.equal(chart, created);
			assert.equal(chart, instance);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(disposed, false);
			if (id === 'echarts') assert.equal(configured, true);
			chart[method]();
			assert.equal(disposed, true);
		});
	}

	for (const id of ['chartjs', 'echarts']) {
		it(`${id}: assigns CPU/RAM left and TCP right with automatic y ranges`, () => {
			let config;
			const {exports} = evaluate(id, {
				document: {getElementById: () => ({getContext: () => ({})})},
				Chart: function(ctx, options) { config = options; },
				echarts: {init: () => ({setOption(options) { config = options; }})},
			});
			exports.makeChart(exports.prepData(packed));
			let axes;
			if (id === 'chartjs') {
				assert.deepEqual(Object.keys(config.options.scales), ['x', 'y', 'y2']);
				assert.deepEqual(Array.from(config.data.datasets, s => [s.label, s.yAxisID]),
					[['CPU', 'y'], ['RAM', 'y'], ['TCP Out', 'y2']]);
				axes = [config.options.scales.y, config.options.scales.y2];
			}
			else {
				assert.deepEqual(Array.from(config.series, s => [s.name, s.yAxisIndex]),
					[['CPU', 0], ['RAM', 0], ['TCP Out', 1]]);
				axes = Array.from(config.yAxis);
			}
			assert.deepEqual(axes.map(axis => axis.position), ['left', 'right']);
			for (const axis of axes) {
				for (const key of ['min', 'max', 'suggestedMin', 'suggestedMax', 'beginAtZero', 'grace', 'boundaryGap'])
					assert.equal(Object.hasOwn(axis, key), false, `${id}: leave ${key} to native autoranging`);
			}
		});
	}

	it('Flot returns the plot before its deferred overlay hook, without changing options', () => {
		let options, destroyed = false;
		const plot = {destroy() { destroyed = true; }};
		const data = [[], [], []];
		const {exports, wait} = evaluate('flot', {$: {plot(selector, input, config) {
			assert.equal(selector, '#placeholder');
			assert.equal(input, data);
			options = config;
			return plot;
		}}});
		assert.equal(exports.makeChart(data), plot);
		assert.equal(wait.textContent, 'not started');
		assert.deepEqual(Object.keys(options), ['xaxis', 'hooks']);
		assert.deepEqual(JSON.parse(JSON.stringify(options.xaxis)), {mode: 'time', timeBase: 'milliseconds'});
		assert.equal(options.hooks.drawOverlay.length, 1);
		options.hooks.drawOverlay[0]();
		assert.equal(wait.textContent, 'Done!');
		assert.equal(destroyed, false);
		plot.destroy();
		assert.equal(destroyed, true);
	});

	it('Dygraphs returns its instance for destroy and uses the local formatter without changing options', () => {
		const formatter = {};
		runInNewContext(files.get('/bench/fmtDate.js'), {window: formatter});
		assert.equal(typeof formatter.fmtDate, 'function');
		const dom = {}, wait = {};
		let options, destroyed = false;
		const instance = {destroy() { destroyed = true; }};
		const {exports} = evaluate('dygraphs', {
			fmtDate: formatter.fmtDate,
			document: {getElementById: name => name === 'wait' ? wait : dom},
			Dygraph: function(element, data, config) {
				assert.equal(element, dom);
				assert.equal(data, prepared);
				options = config;
				return instance;
			},
		});
		const prepared = exports.prepData(packed);
		assert.equal(Object.prototype.toString.call(prepared[0][0]), '[object Date]');
		assert.equal(+prepared[0][0], 600000);
		assert.equal(exports.makeChart(prepared), instance);
		assert.equal(wait.textContent, 'Done!');
		assert.deepEqual(Object.keys(options), ['width', 'height', 'labels', 'colors', 'axes']);
		assert.equal(options.width, 1920);
		assert.equal(options.height, 600);
		assert.deepEqual(Array.from(options.labels), ['Time', 'CPU', 'RAM', 'TCP Out']);
		assert.deepEqual(Array.from(options.colors), ['rgba(255,0,0,1)', 'rgba(0,0,255,1)', '#297f00']);
		const date = new Date(2026, 9, 22, 13, 5);
		assert.equal(options.axes.x.axisLabelFormatter(date), '10/22/26\n1:05pm');
		assert.equal(options.axes.x.valueFormatter(+date), '10/22/26\n1:05pm');
		assert.equal(options.axes.y.axisLabelFormatter(25), '25%');
		assert.equal(options.axes.y.valueFormatter(25.125), '25.13%');
		assert.equal(options.axes.y2.valueFormatter(6), '6 MB');
		assert.equal(options.axes.y2.independentTicks, true);
		assert.equal(destroyed, false);
		instance.destroy();
		assert.equal(destroyed, true);
	});

	it('passes fractional and high DPRs explicitly to ECharts instead of its minimum-one default', () => {
		for (const dpr of [0.75, 1, 1.5, 2]) {
			let effectiveDpr;
			const {exports} = evaluate('echarts', {
				devicePixelRatio: dpr,
				document: {getElementById: () => ({})},
				echarts: {init(dom, theme, options) {
					effectiveDpr = options.devicePixelRatio;
					return {setOption() {}};
				}},
			});
			exports.makeChart([]);
			assert.equal(effectiveDpr, dpr);
		}
	});

	const mutations = [
		['D3.html', 'missing boundary', html => html.replace('const wait =', 'var wait =')],
		['D3.html', 'duplicate boundary', html => html.replace('const wait =', 'const wait = document.getElementById("wait");\nconst wait =')],
		['D3.html', 'missing makeChart', html => html.replace('function makeChart(data)', 'function renamed(data)')],
		['D3.html', 'missing prepData', html => html.replace('function prepData(packed)', 'function renamed(packed)')],
		['D3.html', 'hardcoded DPR', html => html.replace('const pxRatio = devicePixelRatio;', 'const pxRatio = 1;')],
		['D3.html', 'fetch in source', html => html.replace('const width =', 'fetch("data.json");\nconst width =')],
		['D3.html', 'partial function', html => html.replace('const wait =', 'function unfinished() {\nconst wait =')],
		['D3.html', 'extra inline script', html => html.replace('</body>', '<script>makeChart([]);</script></body>')],
		['D3.html', 'changed auto-fetch', html => html.replace('fetch("data.json")', 'fetch("other.json")')],
		['D3.html', 'code after auto-fetch', html => html.replace(/<\/script>(\s*<\/body>)/, 'makeChart([]);</script>$1')],
		['D3.html', 'unpinned URL', html => html.replace('d3@7.9.0/', 'd3/')],
		['D3.html', 'prerelease URL', html => html.replace('d3@7.9.0/', 'd3@8.0.0-beta.1/')],
		['D3.html', 'async script', html => html.replace('<script src=', '<script async src=')],
		['Chart.js4.html', 'bundled adapter', html => html.replace('/dist/chartjs-adapter-date-fns.min.js', '/dist/chartjs-adapter-date-fns.bundle.min.js')],
		['Chart.js4.html', 'missing date runtime', html => html.replace(/<script src="[^"]*@date-fns[^\n]+/, '')],
		['Chart.js4.html', 'dependency order', html => html.replace(/(<script src="[^"]*chart\.js@[^\n]+)(\s*)(<script src="[^"]*@date-fns[^\n]+)/, '$3$2$1')],
		['Chart.js4.html', 'missing return', html => html.replace('return chart;', '')],
		['ECharts5.html', 'missing return', html => html.replace('return myChart;', '')],
		['Flot.html', 'missing return', html => html.replace('return plot;', '')],
		['Flot.html', 'all-plugin bundle', html => html.replace('/source/jquery.flot.js', '/dist/es5/jquery.flot.js')],
		['Flot.html', 'missing time plugin', html => html.replace(/<script src="[^"]*jquery\.flot\.time\.js"><\/script>/, '')],
		['Flot.html', 'dependency order', html => html.replace('source/jquery.canvaswrapper.js', 'source/jquery.colorhelpers.js')],
		['Flot.html', 'unpinned jQuery', html => html.replace('jquery@3.7.1/', 'jquery/')],
		['Flot.html', 'changed auto-fetch', html => html.replace('fetch("data.json")', 'fetch("other.json")')],
		['dygraphs.html', 'missing return', html => html.replace('return dyCpuMem;', '')],
		['dygraphs.html', 'missing stylesheet', html => html.replace(/<link rel="stylesheet"[^>]+>/, '')],
		['dygraphs.html', 'unpinned stylesheet', html => html.replace('dygraphs@2.2.2/dist/dygraph.min.css', 'dygraphs/dist/dygraph.min.css')],
		['dygraphs.html', 'non-stylesheet link', html => html.replace('rel="stylesheet"', 'rel="preload"')],
		['dygraphs.html', 'extra stylesheet', html => html.replace('</head>', '<link rel="stylesheet" href="extra.css"></head>')],
		['dygraphs.html', 'missing local formatter', html => html.replace('<script src="fmtDate.js"></script>', '')],
		['dygraphs.html', 'remote formatter', html => html.replace('src="fmtDate.js"', 'src="https://example.com/fmtDate.js"')],
		['dygraphs.html', 'formatter traversal', html => html.replace('src="fmtDate.js"', 'src="../fmtDate.js"')],
		['dygraphs.html', 'async formatter', html => html.replace('src="fmtDate.js"', 'async src="fmtDate.js"')],
		['dygraphs.html', 'module formatter', html => html.replace('src="fmtDate.js"', 'type="module" src="fmtDate.js"')],
		['dygraphs.html', 'changed auto-fetch', html => html.replace('fetch("data.json")', 'fetch("other.json")')],
	];
	for (const [file, label, transform] of mutations) {
		it(`rejects ${label} in ${file}`, () => {
			withChangedDemo(file, transform, changedRoot => {
				assert.throws(() => loadBenchDemoSources(changedRoot), error =>
					error.message.startsWith(file + ': demo source changed') && error.message.includes('review the benchmark extraction'));
			});
		});
	}

	it('imports the actual ES modules without fetching or creating charts', () => {
		const urls = demos.map(([id]) => 'data:text/javascript;base64,' + Buffer.from(files.get(`/bench/${id}-source.mjs`)).toString('base64'));
		execFileSync(process.execPath, ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			const wait = {textContent: 'not started'};
			globalThis.document = {getElementById(id) { assert.equal(id, 'wait'); return wait; }};
			globalThis.devicePixelRatio = 2;
			globalThis.fetch = globalThis.setTimeout = globalThis.requestAnimationFrame = () => assert.fail('auto-start');
			for (const url of ${JSON.stringify(urls)}) {
				const demo = await import(url);
				assert.deepEqual(Object.keys(demo), ['makeChart', 'prepData']);
				assert.equal(typeof demo.makeChart, 'function');
				assert.equal(typeof demo.prepData, 'function');
			}
			assert.equal(wait.textContent, 'not started');
		`]);
	});

	it('rejects roots that are not repository directory file URLs', () => {
		for (const invalid of [new URL('https://example.com/'), new URL('?query', root), new URL('#hash', root)])
			assert.throws(() => loadBenchDemoSources(invalid), /repository directory file: URL/);
		assert.throws(() => loadBenchDemoSources(root.href.slice(0, -1)), /trailing slash/);
	});
});
