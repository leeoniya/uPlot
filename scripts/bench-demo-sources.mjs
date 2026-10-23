import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const demos = [
	{file: 'D3.html', id: 'd3', scripts: [['d3', 'dist/d3.min.js']]},
	{file: 'Chart.js4.html', id: 'chartjs', scripts: [
		['chart.js', 'dist/chart.umd.min.js'],
		['@date-fns/cdn', 'cdn.min.js'],
		['chartjs-adapter-date-fns', 'dist/chartjs-adapter-date-fns.min.js'],
	], returns: 'chart'},
	{file: 'ECharts5.html', id: 'echarts', scripts: [['echarts', 'dist/echarts.min.js']], returns: 'myChart'},
	{file: 'Flot.html', id: 'flot', scripts: [
		['jquery', 'dist/jquery.min.js'],
		['flot', 'source/jquery.canvaswrapper.js'],
		['flot', 'source/jquery.colorhelpers.js'],
		['flot', 'source/jquery.flot.js'],
		['flot', 'source/jquery.flot.saturated.js'],
		['flot', 'source/jquery.flot.browser.js'],
		['flot', 'source/jquery.flot.drawSeries.js'],
		['flot', 'source/jquery.flot.uiConstants.js'],
		['flot', 'source/jquery.flot.time.js'],
	], returns: 'plot'},
	{file: 'dygraphs.html', id: 'dygraphs', scripts: [
		['dygraphs', 'dist/dygraph.min.js'],
		['dygraphs', 'dist/dygraph.min.css', 'style'],
	], localScripts: ['fmtDate.js'], returns: 'dyCpuMem'},
];

const moduleFooter = "\nconst wait = document.getElementById('wait');\nexport {makeChart, prepData};\n";

function guard(condition, file, detail) {
	if (!condition)
		throw new Error(`${file}: demo source changed (${detail}); review the benchmark extraction.`);
}

function extractDemo(html, demo) {
	const {file, scripts, localScripts = []} = demo;
	// These are deliberately narrow contracts for the selected demos, not a general HTML parser.
	const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<link\b([^>]*)>/gi)];
	guard(tags.length === scripts.length + localScripts.length + 1, file, 'script/style count');
	const dependencies = scripts.map(([expectedName, expectedPath, type = 'script'], i) => {
		const [, attrs, body, linkAttrs] = tags[i];
		const src = type === 'style' ? /^\s+rel="stylesheet"\s+href="([^"]+)"\s*$/.exec(linkAttrs ?? '') :
			/^\s+src="([^"]+)"\s*$/.exec(attrs ?? '');
		guard(src && (type === 'style' || !body.trim()), file, 'ordered classic scripts and styles');
		const url = src[1];
		const pin = /^https:\/\/(?:cdn|fastly)\.jsdelivr\.net\/npm\/((?:@[\w-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+)\/([\w./-]+)$/.exec(url);
		guard(pin, file, 'explicit stable CDN version and browser build');
		const [, name, version, path] = pin;
		guard(name === expectedName && path === expectedPath, file, 'dependency order or browser build');
		const cacheName = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}-${path.split('/').pop()}`;
		return {name, version, url, route: '/bench/vendor/' + cacheName, cacheName,
			...(type === 'style' ? {type} : {})};
	});
	for (const [i, path] of localScripts.entries()) {
		const [, attrs, body] = tags[scripts.length + i];
		const src = /^\s+src="([^"]+)"\s*$/.exec(attrs ?? '');
		guard(src && src[1] === path && !body.trim(), file, 'ordered local classic scripts');
	}

	const [, attrs, inline] = tags.at(-1);
	guard(attrs !== undefined && !attrs.trim(), file, 'one final inline classic script');
	const boundaries = [...inline.matchAll(/^[\t ]*(?:let|const) wait = document\.getElementById\("wait"\);/gm)];
	guard(boundaries.length === 1, file, 'one wait/auto-fetch boundary');
	const end = boundaries[0].index;
	const source = inline.slice(0, end);
	const autoFetch = inline.slice(end);
	guard(/^\s*(?:let|const) wait = document\.getElementById\("wait"\);\s*wait\.textContent = "Fetching data\.json \(2\.07MB\)\.\.\.\.";\s*fetch\("data\.json"\)\.then\((r|response) => \1\.json\(\)\)\.then\(packed => \{\s*wait\.textContent = "Rendering\.\.\.";\s*(?:let|const) data = prepData\(packed\);\s*setTimeout\(\(\) => makeChart\(data\), 0\);\s*\}\);\s*$/.test(autoFetch), file, 'auto-fetch block');
	for (const signature of ['function makeChart(data)', 'function prepData(packed)'])
		guard(source.split(signature).length === 2, file, signature);
	guard(!/\b(?:fetch|setTimeout)\s*\(/.test(source), file, 'auto-fetch or timer in extracted source');
	if (demo.id === 'd3')
		guard(source.split('const pxRatio = devicePixelRatio;').length === 2, file, 'native devicePixelRatio constant');
	if (demo.returns)
		guard(new RegExp(`\\breturn ${demo.returns};\\s*\\}\\s*$`).test(source), file, 'returned chart instance');
	try {
		// Parse without executing browser code; a moved boundary must not produce a partial function.
		new Script(source + "\nconst wait = document.getElementById('wait');", {filename: file});
	}
	catch (error) {
		guard(false, file, 'extracted JavaScript: ' + error.message);
	}
	return {source: source + moduleFooter, dependencies};
}

/**
 * Read demos from a repository directory file: URL (with a trailing slash).
 * files maps module and local-script routes to source strings. dependencies preserves
 * demo load order; url is the download URL, route is local, and cacheName is a basename.
 * A dependency with type: 'style' needs a stylesheet link; omitted type means script.
 * Load localScripts as classic scripts after dependencies and before the modules.
 * This function does not download dependencies or execute demo code.
 */
export function loadBenchDemoSources(root, variant = null) {
	if (variant !== null && !['uplot', 'idle', ...demos.map(demo => demo.id)].includes(variant))
		throw new Error(`Unknown demo variant: ${variant}`);
	root = new URL(root);
	if (root.protocol !== 'file:' || !root.pathname.endsWith('/') || root.search || root.hash)
		throw new Error('Expected a repository directory file: URL with a trailing slash.');
	const files = new Map();
	const dependencies = [];
	const localScripts = [];
	for (const demo of demos) {
		if (variant !== null && demo.id !== (variant === 'uplot' ? 'd3' : variant))
			continue;
		const html = readFileSync(new URL('bench/' + demo.file, root), 'utf8');
		const extracted = extractDemo(html, demo);
		files.set(`/bench/${demo.id}-source.mjs`, extracted.source);
		// uPlot reuses the D3 demo's prep function, which does not need the D3 library.
				if (variant !== 'uplot')
					dependencies.push(...extracted.dependencies);
		for (const path of demo.localScripts ?? []) {
			const route = '/bench/' + path;
			files.set(route, readFileSync(new URL('bench/' + path, root), 'utf8'));
			localScripts.push(route);
		}
	}
	return {files, dependencies, localScripts};
}
