import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {demoDependencies} from '../../bench/demo-dependencies.mjs';

const ids = ['apexcharts', 'apexcharts-sampled', 'amcharts', 'amcharts-sampled', 'anychart', 'anychart-sampled',
	'devextreme', 'devextreme-sampled', 'fusiontime', 'fusiontime-sampled', 'agcharts', 'syncfusion'];
const root = new URL('../../', import.meta.url);

// Opt in; use only existing pinned bundles and an existing browser. Never download.
(process.env.BENCH_LIFECYCLE_MANAGED_BROWSER ? describe : describe.skip)('bench-lifecycle-managed: cached browser', function() {
	let server, browser, client, profile;
	const assets = new Map();
	const scripts = {};
	before(async () => {
		for (const id of ids) {
			scripts[id] = [];
			for (const dependency of demoDependencies[id]) {
				const name = `${dependency.name}-${dependency.version}-${dependency.path}`.replace(/[@/]/g, match => match === '@' ? '' : '-');
				const url = '/vendor/' + name;
				assets.set(url, new URL('.cache/benchmarks/' + name, root));
				scripts[id].push(url);
			}
		}
		for (const path of assets.values()) await access(path);
		server = createServer(async (request, response) => {
			try {
				const path = new URL(request.url, 'http://localhost').pathname;
				if (path === '/') {
					response.setHeader('Content-Type', 'text/html');
					response.end('<!doctype html><div id="chart" style="width:1920px;height:600px"></div>');
					return;
				}
				const file = assets.get(path) ?? (path === '/bench/data.json' || /^\/bench\/[a-z-]+\.mjs$/.test(path) ? new URL(path.slice(1), root) : null);
				if (!file) { response.writeHead(404); response.end(); return; }
				response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(await readFile(file));
			}
			catch (error) { response.writeHead(500); response.end(error.message); }
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		profile = await mkdtemp(join(process.env.BENCH_LIFECYCLE_MANAGED_TMP ?? tmpdir(), 'bench-lifecycle-managed-'));
		browser = spawn(process.env.BENCH_LIFECYCLE_MANAGED_BROWSER, [
			'--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0',
						'--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
			'--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank',
		], {stdio: 'ignore'});
		let port;
		for (let i = 0; i < 200; i++) {
			try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
			catch { await delay(50); }
		}
		assert.ok(port, 'Chrome did not start');
		const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
		client = new CDP(socket, 35000);
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, {once: true});
			socket.addEventListener('error', reject, {once: true});
		});
		await client.send('Page.enable');
	}, {timeout: 90000});
	after(async () => {
		client?.close();
		if (browser && browser.exitCode === null) {
			const closed = new Promise(resolve => browser.once('exit', resolve));
			browser.kill('SIGKILL');
			await closed;
		}
		if (server) await new Promise(resolve => server.close(resolve));
		if (profile) await rm(profile, {recursive: true, force: true});
	}, {timeout: 90000});

	for (const id of ids) {
		it(`${id}: two-row init, full replacement, native readiness, retained identity, and teardown`, {timeout: 90000}, async () => {
			const loaded = client.wait('Page.loadEventFired');
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			await loaded;
			const harness = await readFile(new URL('scripts/benchmarks-trace-browser.mjs', root), 'utf8');
			const validation = harness.slice(harness.indexOf('function hasChartSurface('), harness.indexOf('\n}', harness.indexOf('function validateChart(')) + 2);
			const result = await client.send('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `
				(async () => {
					const id = ${JSON.stringify(id)};
					for (const url of ${JSON.stringify(scripts[id])}) await new Promise((resolve, reject) => {
						const script = document.createElement('script');
						script.src = url; script.onload = resolve; script.onerror = () => reject(new Error(url));
						document.head.append(script);
					});
					const adapter = await import('/bench/' + id + '.mjs');
					const {smallLifecycleData} = await import('/bench/lifecycle-data.mjs');
					const packed = await (await fetch('/bench/data.json')).json();
					const host = document.getElementById('chart');
					const wait = {textContent: 'Rendering...'};
					const check = (condition, message) => { if (!condition) throw new Error(message); };
					const sources = {[id]: adapter}, ROWS = 55550, WIDTH = 1920, HEIGHT = 600, dpr = devicePixelRatio;
					${validation}
					const bounded = (promise, phase) => {
						let timer;
						return Promise.race([promise, new Promise((_, reject) => {
							timer = setTimeout(() => reject(new Error(phase + ' timed out')), 20000);
						})]).finally(() => clearTimeout(timer));
					};
					let chart;
					try {
						const small = adapter.prepData(smallLifecycleData(packed));
						chart = await bounded((adapter.makeLifecycleChart ?? adapter.makeChart)(small, host, wait), 'small-init');
						const native = chart.chart ?? chart;
						const canvases = [...host.querySelectorAll('canvas')];
						const report = {initialRows: 2, canvases: canvases.length, updates: []};
						const rows = () => {
							if (id.startsWith('apexcharts')) return chart.getState().series.map(s => s.length);
							if (id.startsWith('amcharts')) return chart.container.children.getIndex(0).series.values.map(s => s.data.length);
							if (id.startsWith('devextreme')) return chart.getAllSeries().map(s => s.getAllPoints().length);
							if (id === 'syncfusion') return chart.series.map(s => s.points.length);
							if (id === 'agcharts') return [chart.getOptions().data.length];
							if (id.startsWith('anychart')) return chart.mappings.map(mapping => {
								const selectable = mapping.createSelectable();
								selectable.selectAll(); return selectable.getIterator().getRowsCount();
							});
							return [chart.store.getDataTable().count()];
						};
						check(rows().every(count => count === 2), 'initial row counts: ' + rows());
						check(wait.textContent === 'Done!', 'initial readiness not reported');
						const settings = () => {
							if (id.startsWith('apexcharts')) return chart.getState().config.chart.dataReducer;
							if (id.startsWith('amcharts')) {
								const xy = chart.container.children.getIndex(0);
								return [xy.xAxes.getIndex(0).get('groupData'), xy.series.values.map(s => s.get('minDistance'))];
							}
							if (id.startsWith('anychart')) return [chart.chart.grouping().enabled(), chart.chart.scrollerGrouping().enabled()];
							if (id.startsWith('devextreme')) return chart.option('commonSeriesSettings').aggregation;
							if (id.startsWith('fusiontime')) return chart.getJSONData().xAxis;
							return null;
						};
						const sampling = JSON.stringify(settings());
						const verifyData = input => {
							let actual;
							if (id.startsWith('apexcharts')) {
								const state = chart.getState();
								for (let s = 0; s < 3; s++) {
									const expected = new Map(input[s]);
									check(state.series[s].every((y, i) => y === expected.get(state.seriesX[s][i])), 'stale ApexCharts rendered values');
								}
								return;
							}
							if (id.startsWith('amcharts')) {
								for (const series of chart.container.children.getIndex(0).series.values)
									check(JSON.stringify(series.data.values) === JSON.stringify(input), 'stale amCharts source');
								return;
							}
							if (id.startsWith('anychart')) {
								chart.mappings.forEach((mapping, s) => {
									const selectable = mapping.createSelectable();
									selectable.selectAll();
									const iterator = selectable.getIterator();
									let i = 0;
									while (iterator.advance()) {
										check(iterator.getKey() === input[i][0] && iterator.get('value') === input[i][s + 1], 'stale AnyStock source');
										i++;
									}
									check(i === input.length, 'AnyStock appended instead of replacing');
								});
								return;
							}
							if (id.startsWith('devextreme')) actual = chart.option('dataSource');
							if (id === 'agcharts') actual = chart.getOptions().data;
							if (id.startsWith('fusiontime')) {
								check(chart.getJSONData().data === chart.store.getDataTable(), 'FusionTime rebound to a different table');
								actual = chart.store.getDataTable().getData().data.map(row => row.slice(0, 4));
							}
							if (id === 'syncfusion') {
								chart.series.forEach((series, s) => {
									check(series.points.length === input.length, 'Syncfusion appended instead of replacing');
									check(series.points.every((p, i) => p.xValue === +input[i].time && p.yValue === input[i][['cpu', 'ram', 'tcp'][s]]), 'stale Syncfusion rendered values');
								});
								return;
							}
							check(JSON.stringify(actual) === JSON.stringify(input), 'stale or appended native data');
						};
						for (let revision = 0; revision < 2; revision++) {
							const changed = packed.slice();
							if (revision) for (let i = changed[0] + 1; i < changed.length; i += changed[0]) {
								changed[i] += 100000; changed[i + 1] *= 0.5; changed[i + 3] += 25;
							}
							const input = adapter.prepData(changed);
							const before = JSON.stringify(input);
							wait.textContent = 'Updating...';
							const replacement = await bounded(adapter.updateChart(chart, input, host, wait), 'update');
							check(replacement === undefined, 'update returned a replacement handle');
							check((chart.chart ?? chart) === native, 'native chart replaced');
							check(JSON.stringify(input) === before, 'input mutated');
							check(wait.textContent === 'Done!', 'readiness not reported');
							validateChart({variant: id, chart, host, input});
							verifyData(input);
							check(JSON.stringify(settings()) === sampling, 'sampling configuration changed');
							report.updates.push({rows: rows(), retainedCanvas: canvases.every(canvas => host.contains(canvas))});
						}
						return report;
					}
					finally { if (chart) adapter.destroyChart(chart); }
				})()
			`});
			assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
			console.log(id, JSON.stringify(result.result.value));
			assert.equal(result.result.value.updates.length, 2);
			for (const update of result.result.value.updates) {
				assert.ok(update.rows.every(count => count > 0 && count <= 55550));
				// These pinned native APIs replace their canvas, not their chart instance.
				assert.equal(update.retainedCanvas, !id.startsWith('apexcharts') && id !== 'syncfusion');
			}
		});
	}
});
