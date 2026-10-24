import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

export const demos = [['uplot', 'uPlot.html'], ['d3', 'D3.html'], ['chartjs', 'Chart.js4.html'],
	['echarts', 'ECharts5.html'], ['flot', 'Flot.html'], ['dygraphs', 'dygraphs.html']];

export function checkModuleSyntax(source) {
	// Bun's --check checks the project rather than parsing stdin like Node.
	if (process.versions.bun)
		new globalThis.Bun.Transpiler({loader: 'js'}).transformSync(source);
	else
		execFileSync(process.execPath, ['--input-type=module', '--check'], {input: source, stdio: 'pipe'});
}

export function evaluate(files, id, extra = {}) {
	const wait = {textContent: 'not started'};
	const calls = [];
	const sandbox = {
		console: {time() {}, timeEnd() {}},
		devicePixelRatio: 2,
		document: {getElementById(name) {
			calls.push(name);
			assert.fail('demo modules must use the explicit host and wait, not document lookup');
		}},
		fetch() { assert.fail('module must not fetch'); },
		setTimeout() { assert.fail('module must not schedule chart creation'); },
		requestAnimationFrame() { assert.fail('module must not schedule animation'); },
		...extra,
	};
	const source = files.get(`/bench/${id}.mjs`);
	assert.equal(typeof source, 'string', `missing /bench/${id}.mjs`);
	assert.match(source, /export \{makeChart, prepData\};\s*$/);
	const exports = runInNewContext(source.replace(/^export \{(?:makeChart, prepData|makeChartWithOptions)\};\s*$/gm, '') +
		'\n({makeChart, prepData, setupCanvas: typeof setupCanvas === "function" ? setupCanvas : null})', sandbox);
	return {exports, sandbox, wait, calls};
}
