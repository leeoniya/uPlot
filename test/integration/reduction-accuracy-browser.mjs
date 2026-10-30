import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, isAbsolute, join, relative, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {CDP} from '../../scripts/profile-manual.mjs';
import {cachedChromeBinary} from '../../scripts/chrome-headless-shell.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';

// TEST_REDUCTION_BROWSER=1 node --test --test-isolation=none test/integration/reduction-accuracy-browser.mjs
// Cache-only: never call chromeBinary(), which can download a missing browser.
const rootURL = new URL('../../', import.meta.url);
const root = fileURLToPath(rootURL);
const cache = join(root, '.cache/benchmarks');
const ids = ['echarts', 'chartjs', 'apexcharts', 'amcharts', 'devextreme', 'anychart', 'fusiontime'];
const totalMs = 110000;
const renderMs = 15000;
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm'};

function within(parent, path) {
	const name = relative(parent, path);
	return name !== '..' && !name.startsWith('../') && !isAbsolute(name);
}

async function repositoryServer() {
	const directory = await realpath(root);
	const server = createServer(async (request, response) => {
		try {
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405).end();
				return;
			}
			const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
			if (pathname === '/__reduction_test__') {
				response.writeHead(200, {'Content-Type': 'text/html'});
				response.end('<!doctype html><meta charset="utf-8"><title>Reduction regression</title>');
				return;
			}
			const candidate = resolve(directory, '.' + pathname);
			if (!within(directory, candidate)) {
				response.writeHead(403).end();
				return;
			}
			// Check symlinks as well as decoded traversal before serving repository files.
			const path = await realpath(candidate);
			if (!within(directory, path)) {
				response.writeHead(403).end();
				return;
			}
			if (!(await stat(path)).isFile()) {
				response.writeHead(404).end();
				return;
			}
			const body = request.method === 'HEAD' ? null : await readFile(path);
			response.writeHead(200, {'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
			response.end(body);
		}
		catch (error) {
			response.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
		}
	});
	server.requestTimeout = 5000;
	server.headersTimeout = 5000;
	await new Promise((done, fail) => {
		server.once('error', fail);
		server.listen(0, '127.0.0.1', done);
	});
	return server;
}

// Executed in Chrome, not the test runner's DOM shim.
async function preparePage(expectedIds) {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const demo = await import('/demos/reduction-accuracy.js');
	const {loadDependency} = await import('/bench/demo.mjs');
	const {demoDependencies} = await import('/bench/demo-dependencies.mjs');
	check(typeof loadDependency === 'function', 'bench/demo.mjs must export loadDependency');
	check(typeof demo.summarizePoints === 'function', 'Missing summarizePoints export');
	check(Array.isArray(demo.accuracyCases) && demo.accuracyCases.length === 6, 'Expected six accuracy cases');
	const caseIds = demo.accuracyCases.map(item => item.id);
	check(new Set(caseIds).size === 6 && caseIds.includes('opposite') && caseIds.includes('gap'), 'Missing or duplicate accuracy cases');
	for (const item of demo.accuracyCases) {
		check(typeof item.id === 'string' && typeof item.label === 'string' && typeof item.description === 'string', 'Invalid accuracy case metadata');
		check(item.data?.length === 2 && item.data[0].length > 0 && item.data[0].length === item.data[1].length, `${item.id}: invalid aligned input`);
		check(item.detail?.length === 2 && item.detail[0] < item.detail[1], `${item.id}: invalid detail range`);
	}
	const gapSummary = demo.summarizePoints([[0, null], [1, NaN], [2, -100], [3, 100]]);
	check(JSON.stringify(gapSummary) === JSON.stringify({count: 4, min: -100, max: 100, positive: 1, negative: 1, gaps: 2}), 'summarizePoints must count null/NaN as gaps, not zero');
	const matrix = [];
	for (const id of expectedIds) {
		const library = demo.libraries?.[id];
		check(library && typeof library.render === 'function' && typeof library.label === 'string' && typeof library.note === 'string', `${id}: invalid library contract`);
		check(Array.isArray(library.modes) && library.modes.length > 0, `${id}: missing modes`);
		check(new Set(library.modes.map(mode => mode.value)).size === library.modes.length, `${id}: duplicate modes`);
		for (const mode of library.modes) {
			check(typeof mode.value === 'string' && typeof mode.label === 'string', `${id}: invalid mode`);
			matrix.push({id, mode: mode.value});
		}
	}
	check(matrix.length === 20, 'Expected 20 library/mode combinations');
	globalThis.reductionTest = {demo, loadDependency, demoDependencies, check};
	return {matrix, caseIds};
}

async function loadLibrary(id) {
	const {loadDependency, demoDependencies} = globalThis.reductionTest;
	for (const dependency of demoDependencies[id])
		await loadDependency(dependency);
}

async function renderCase(id, mode, caseId, timeoutMs) {
	const {demo, check} = globalThis.reductionTest;
	const fixture = demo.accuracyCases.find(item => item.id === caseId);
	const data = fixture.data;
	const isGap = y => y === null || Number.isNaN(y);
	const snapshot = structuredClone(data);
	const unchanged = () => {
		check(data.length === snapshot.length, `${id}/${mode}: changed input columns`);
		for (let column = 0; column < snapshot.length; column++) {
			check(data[column].length === snapshot[column].length, `${id}/${mode}: changed input length`);
			for (let i = 0; i < snapshot[column].length; i++)
				check(Object.is(data[column][i], snapshot[column][i]), `${id}/${mode}: mutated input [${column}][${i}]`);
		}
	};
	const summarize = points => {
		let min = Infinity, max = -Infinity, gaps = 0, positive = 0, negative = 0;
		for (let i = 0; i < points.length; i++) {
			const point = points[i];
			check(point?.length === 2 && Number.isFinite(point[0]), `${id}/${mode}/${caseId}: invalid x at point ${i}`);
			const y = point[1];
			check(Number.isFinite(y) || (caseId === 'gap' && isGap(y)), `${id}/${mode}/${caseId}: invalid y at point ${i}: ${y}`);
			if (isGap(y)) { gaps++; continue; }
			min = Math.min(min, y);
			max = Math.max(max, y);
			if (y === 100) positive++;
			if (y === -100) negative++;
		}
		return {count: points.length, min: min === Infinity ? null : min, max: max === -Infinity ? null : max, positive, negative, gaps};
	};
	const original = Array.from(data[0], (x, i) => [x, data[1][i]]);
	const input = summarize(original);
	const host = document.createElement('div');
	host.style.cssText = 'width:580px;height:250px';
	document.body.append(host);
	let handle, timer, ingestion;
	try {
		let rendering;
		if (id === 'fusiontime') {
			const prototype = globalThis.FusionCharts.DataStore.prototype;
			const descriptor = Object.getOwnPropertyDescriptor(prototype, 'createDataTable');
			const createDataTable = prototype.createDataTable;
			check(typeof createDataTable === 'function', 'FusionTime: missing DataStore.createDataTable');
			let calls = 0;
			try {
				prototype.createDataTable = function(...args) {
					calls++;
					const epoch = Date.UTC(2024, 0, 1);
					const expected = snapshot[0].map(x => epoch + Math.round(x * 60000));
					check(args[0]?.length === expected.length, `FusionTime/${caseId}: incorrect source row count`);
					for (let i = 0; i < expected.length; i++) {
						check((expected[i] - epoch) / 60000 === snapshot[0][i], `FusionTime/${caseId}: fixture x is not on the shared millisecond grid at ${i}`);
						check(Number.isSafeInteger(args[0][i][0]) && args[0][i][0] === expected[i], `FusionTime/${caseId}: invalid encoded timestamp at ${i}: ${args[0][i][0]}`);
						check(Object.is(args[0][i][1], snapshot[1][i]), `FusionTime/${caseId}: changed source value at ${i}`);
					}
					const table = createDataTable.apply(this, args);
					const ingested = table.getData().data;
					check(Array.isArray(ingested) && ingested.length === expected.length, `FusionTime/${caseId}: incorrect ingested row count`);
					let minTimestamp = Infinity, maxTimestamp = -Infinity;
					for (let i = 0; i < ingested.length; i++) {
						const [timestamp, value] = ingested[i];
						check(Number.isSafeInteger(timestamp) && timestamp !== 0, `FusionTime/${caseId}: invalid ingested timestamp at ${i}: ${timestamp}`);
						check(timestamp === expected[i], `FusionTime/${caseId}: timestamp encoding/parsing error at ${i}: expected ${expected[i]}, got ${timestamp}`);
						check(Object.is(value, snapshot[1][i]), `FusionTime/${caseId}: ingested value mismatch at ${i}: expected ${snapshot[1][i]}, got ${value}`);
						minTimestamp = Math.min(minTimestamp, timestamp);
						maxTimestamp = Math.max(maxTimestamp, timestamp);
					}
					check(minTimestamp === Math.min(...expected) && maxTimestamp === Math.max(...expected), `FusionTime/${caseId}: ingested range mismatch`);
					ingestion = {count: ingested.length, minTimestamp, maxTimestamp, zeroTimestamps: 0, valuesMatch: true};
					return table;
				};
				// Inspect the parsed table during construction, never substitute input for processed output.
				rendering = demo.libraries[id].render(host, data, mode);
			}
			finally {
				if (descriptor) Object.defineProperty(prototype, 'createDataTable', descriptor);
				else delete prototype.createDataTable;
			}
			// Await rejection first if the inspection threw inside the async adapter.
			rendering = Promise.resolve(rendering).then(result => {
				handle = result;
				check(calls === 1 && ingestion, `FusionTime/${caseId}: expected one inspected data table, got ${calls}`);
				check(prototype.createDataTable === createDataTable, 'FusionTime: DataStore wrapper was not restored');
				return result;
			});
		}
		else rendering = demo.libraries[id].render(host, data, mode);
		handle = await Promise.race([
			rendering,
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${id}/${mode}: render exceeded ${timeoutMs}ms`)), timeoutMs); }),
		]);
		clearTimeout(timer);
		unchanged();
		check(typeof handle?.destroy === 'function', `${id}/${mode}: missing destroy`);
		check(host.querySelector('canvas, svg'), `${id}/${mode}: no native chart surface`);
		if (handle.points === null) {
			check(typeof handle.note === 'string' && handle.note.length > 0, `${id}/${mode}: unavailable points need an explanation`);
			check(mode !== 'raw' || id === 'fusiontime', `${id}/${mode}: raw points unavailable`);
			return {id, mode, caseId, input: original.length, inputSummary: input, points: null, note: handle.note, ...(ingestion ? {ingestion} : {})};
		}
		const points = handle.points;
		check(Array.isArray(points) && points.length > 0 && points.length <= original.length, `${id}/${mode}: invalid processed count ${points?.length}/${original.length}`);
		const output = summarize(points);
		const summary = demo.summarizePoints(points);
		for (const key of Object.keys(output))
			check(summary?.[key] === output[key], `${id}/${mode}/${caseId}: incorrect summary ${key}`);
		let rawMismatch = null;
		if (mode === 'raw' && id !== 'fusiontime') {
			const mismatches = [];
			for (const key of ['count', 'min', 'max', 'gaps'])
				if (output[key] !== input[key]) mismatches.push(`${key}: expected ${input[key]}, got ${output[key]}`);
			if (caseId === 'gap') {
				const expectedXs = original.filter(point => isGap(point[1])).map(point => point[0]);
				const actualXs = points.filter(point => isGap(point[1])).map(point => point[0]);
				if (JSON.stringify(actualXs) !== JSON.stringify(expectedXs)) mismatches.push('gap positions changed');
			}
			// Report native null-to-zero behavior explicitly, after the complete matrix and UI checks.
			if (mismatches.length) rawMismatch = mismatches.join('; ');
		}
		// Loss is an observation, not a requirement: native algorithms can retain both extrema.
		return {id, mode, caseId, input: original.length, inputSummary: input, points: points.length,
			minLoss: output.min === null || input.min === null ? null : output.min - input.min,
			maxLoss: output.max === null || input.max === null ? null : input.max - output.max,
			gapLoss: input.gaps - output.gaps, summary, rawMismatch};
	}
	finally {
		clearTimeout(timer);
		try { await handle?.destroy(); }
		finally { host.remove(); unchanged(); }
	}
}

async function readyUI(selector = null, value = null) {
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const status = document.querySelector('#status');
	if (selector) {
		const select = document.querySelector(selector);
		check(select && !select.disabled && status?.dataset.state === 'ready', `${selector}: control is not ready`);
		check([...select.options].some(option => option.value === value), `${selector}: missing option ${value}`);
		check(select.value !== value, `${selector}: selection must change`);
		select.value = value;
		select.dispatchEvent(new Event('change', {bubbles: true}));
		check(status.dataset.state === 'loading', `${selector}: change did not start rendering`);
	}
	await new Promise((resolve, reject) => {
		const start = performance.now();
		function poll() {
			if (status?.dataset.state === 'error') return reject(new Error(status.textContent));
			if (status?.dataset.state === 'ready') return resolve();
			if (performance.now() - start > 14000) return reject(new Error('UI did not become ready'));
			setTimeout(poll, 50);
		}
		poll();
	});
	const {libraries, accuracyCases, summarizePoints} = await import('/demos/reduction-accuracy.js');
	const library = document.querySelector('#library'), mode = document.querySelector('#mode'), dataset = document.querySelector('#dataset');
	check([library, mode, dataset].every(select => !select.disabled), 'Controls stayed disabled');
	const selectedLibrary = libraries[library.value], fixture = accuracyCases.find(item => item.id === dataset.value);
	check(JSON.stringify([...mode.options].map(option => option.value)) === JSON.stringify(selectedLibrary.modes.map(item => item.value)), 'Library change did not update modes');
	check(document.querySelector('#case-description').textContent === fixture.description, 'Dataset description is stale');
	check(document.querySelector('#vendor-title').textContent.includes(selectedLibrary.label) && document.querySelector('#vendor-title').textContent.includes(mode.selectedOptions[0].textContent), 'Vendor title is stale');
	check(document.querySelector('#reference-chart canvas') && document.querySelector('#vendor-chart canvas, #vendor-chart svg'), 'Missing UI chart surfaces');
	const reference = document.querySelector('#reference-output').textContent;
	const vendor = document.querySelector('#vendor-output').textContent;
	const input = summarizePoints(fixture.data[0].map((x, i) => [x, fixture.data[1][i]]));
	check(reference.includes(`gap markers: ${input.gaps}`) && vendor.startsWith('Processed:'), 'Missing or stale UI readouts');
	await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	return {library: library.value, mode: mode.value, dataset: dataset.value, reference, vendor,
		libraries: [...library.options].map(option => option.value), datasets: [...dataset.options].map(option => option.value)};
}

(process.env.TEST_REDUCTION_BROWSER === '1' ? describe : describe.skip)('reduction accuracy: cached Headless Shell', function() {

	it('renders all six fixtures in every mode and exercises the mounted dropdowns', {timeout: 120000}, async () => {
		let server, browser, client, profile, watchdog;
		let log = '', phase = 'checking prerequisites', runError = null;
		const failures = [], blocked = new Set(), rows = [];
		let rejectFailure;
		const failure = new Promise((_, reject) => { rejectFailure = reject; });
		failure.catch(() => {});
		const interrupted = () => rejectFailure(new Error('Reduction browser test interrupted'));
		process.once('SIGINT', interrupted);
		process.once('SIGTERM', interrupted);
		const run = async () => {
			for (const path of ['demos/reduction-accuracy.html', 'demos/reduction-accuracy.js'])
				await access(join(root, path));
			const binary = await cachedChromeBinary();
			assert.ok(binary, 'No cached Chrome executable. Run npm run bench -- --install-only or set CHROME_BIN; this test never installs a browser.');
			await access(binary, constants.X_OK);
			const assets = new Map();
			const cacheRoot = await realpath(cache);
			for (const id of ids) {
				// Reuse the benchmark's dependencyUrl and cacheName calculation verbatim.
				for (const dependency of loadBenchDemoSources(rootURL, id).dependencies) {
					const path = await realpath(join(cache, dependency.cacheName));
					assert.ok(within(cacheRoot, path), `Vendor asset escapes benchmark cache: ${path}`);
					assets.set(dependency.url, {body: (await readFile(path)).toString('base64'), type: mime[extname(path)] ?? 'text/javascript'});
				}
			}
			server = await repositoryServer();
			const origin = `http://127.0.0.1:${server.address().port}`;
			profile = await mkdtemp(join(cache, 'reduction-browser-'));
			phase = 'starting Chrome';
			browser = spawn(binary, ['--no-sandbox', '--headless', '--disable-gpu', '--disable-dev-shm-usage',
				'--no-first-run', '--no-default-browser-check', '--disable-background-networking',
				'--disable-component-update', '--disable-sync', '--disable-extensions',
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
				'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
				'--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
			browser.on('error', rejectFailure);
			browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal}): ${log}`)));
			browser.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
			let port;
			for (let i = 0; i < 100; i++) {
				try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
				catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
			}
			assert.ok(port, `Chrome did not start: ${log}`);
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(5000)})).json();
			const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
			client = new CDP(socket, renderMs);
			await new Promise((done, fail) => {
				const timer = setTimeout(() => fail(new Error('CDP connection timed out')), 5000);
				socket.addEventListener('open', () => { clearTimeout(timer); done(); }, {once: true});
				socket.addEventListener('error', () => { clearTimeout(timer); fail(new Error('CDP connection failed')); }, {once: true});
			});
			const actualVersion = await client.send('Browser.getVersion');
			console.log('Reduction browser:', actualVersion.product);
			socket.addEventListener('message', event => {
				const {method, params} = JSON.parse(event.data);
				if (method === 'Runtime.exceptionThrown')
					failures.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
				if (method !== 'Fetch.requestPaused') return;
				const {requestId, request} = params;
				const asset = assets.get(request.url);
				let pending;
				if (asset)
					pending = client.send('Fetch.fulfillRequest', {requestId, responseCode: 200, body: asset.body,
						responseHeaders: [{name: 'Content-Type', value: asset.type}, {name: 'Access-Control-Allow-Origin', value: '*'}]});
				else if (new URL(request.url).origin === origin)
					pending = client.send('Fetch.continueRequest', {requestId});
				else {
					blocked.add(request.url);
					pending = client.send('Fetch.failRequest', {requestId, errorReason: 'BlockedByClient'});
				}
				pending.catch(rejectFailure);
			});
			await client.send('Page.enable');
			await client.send('Runtime.enable');
			await client.send('Fetch.enable', {patterns: [{urlPattern: '*'}]});
			const evaluate = async expression => {
				const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
				assert.ok(!result.exceptionDetails, `${phase}: ${result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text}`);
				return result.result.value;
			};
			const call = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
			const navigate = async path => {
				const loaded = client.wait('Page.loadEventFired');
				loaded.catch(() => {});
				const result = await client.send('Page.navigate', {url: origin + path});
				assert.ok(!result.errorText, result.errorText);
				await loaded;
			};
			await navigate('/__reduction_test__');
			phase = 'checking module exports';
			const {matrix, caseIds} = await call(preparePage, ids);
			phase = 'checking mounted HTML';
			await navigate('/demos/reduction-accuracy.html?library=echarts&dataset=opposite&mode=lttb');
			const ui = await call(readyUI);
			assert.deepEqual([...ui.libraries].sort(), [...ids].sort());
			assert.deepEqual([...ui.datasets].sort(), [...caseIds].sort());
			const disclosure = await call(() => {
				const details = document.querySelector('#developer-details');
				const canvases = [...details.querySelectorAll('canvas')];
				const before = canvases.map(canvas => canvas.toDataURL());
				const states = [details.open];
				details.querySelector('summary').click();
				states.push(details.open);
				details.querySelector('summary').click();
				states.push(details.open);
				return {states, canvases: canvases.length, unchanged: canvases.every((canvas, i) => canvas.toDataURL() === before[i])};
			});
			assert.deepEqual(disclosure, {states: [false, true, false], canvases: 2, unchanged: true});
			const screenshot = async name => {
				const {cssContentSize} = await client.send('Page.getLayoutMetrics');
				const {data} = await client.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true,
					clip: {x: 0, y: 0, width: 1280, height: Math.min(2000, Math.ceil(cssContentSize.height)), scale: 1}});
				const path = join(cache, `reduction-accuracy-${name}.png`);
				await writeFile(path, Buffer.from(data, 'base64'));
				console.log('UI screenshot:', relative(root, path));
			};
			assert.equal(ui.dataset, 'opposite');
			await screenshot('opposite');
			phase = 'UI library dropdown: Chart.js';
			const switched = await call(readyUI, '#library', 'chartjs');
			assert.equal(switched.library, 'chartjs');
			phase = 'UI dataset dropdown: gap';
			const gap = await call(readyUI, '#dataset', 'gap');
			assert.equal(gap.dataset, 'gap');
			phase = 'UI mode dropdown: raw';
			const raw = await call(readyUI, '#mode', 'raw');
			assert.equal(raw.mode, 'raw');
			assert.match(raw.vendor, /min 40 · max 40/);
			assert.match(raw.vendor, /gap markers: 6/);
			console.log('UI dropdown result:', JSON.stringify(raw));
			await screenshot('gap');
			phase = 'DPR 2 default opposite UI';
			try {
				await client.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 2, mobile: false});
				await navigate('/demos/reduction-accuracy.html');
				const dpr2 = await call(readyUI);
				assert.equal(dpr2.library, 'echarts');
				assert.equal(dpr2.dataset, 'opposite');
				assert.equal(dpr2.mode, 'lttb');
				const pixels = await evaluate(`({dpr: devicePixelRatio, status: document.querySelector('#status').textContent,
					canvases: [...document.querySelectorAll('#reference-chart canvas, #vendor-chart canvas')].map(canvas => ({
						width: canvas.width, cssWidth: canvas.getBoundingClientRect().width,
						height: canvas.height, cssHeight: canvas.getBoundingClientRect().height}))})`);
				assert.equal(pixels.dpr, 2);
				assert.match(pixels.status, /DPR 2/);
				assert.ok(pixels.canvases.length >= 2);
				for (const canvas of pixels.canvases) {
					assert.ok(canvas.cssWidth > 0 && canvas.cssHeight > 0);
					assert.ok(Math.abs(canvas.width - canvas.cssWidth * 2) <= 1 && Math.abs(canvas.height - canvas.cssHeight * 2) <= 1, 'DPR 2 chart backing store must match CSS size');
				}
				console.log('DPR 2 default opposite UI:', JSON.stringify({vendor: dpr2.vendor, ...pixels}));
			}
			finally { await client.send('Emulation.clearDeviceMetricsOverride'); }
			await navigate('/__reduction_test__');
			assert.equal(await evaluate('devicePixelRatio'), 1, 'Matrix must run at DPR 1');
			await call(preparePage, ids);
			const orderedCases = caseIds;
			for (const id of ids) {
				phase = `${id}: loading cached dependencies`;
				await call(loadLibrary, id);
				for (const {mode} of matrix.filter(item => item.id === id)) {
					for (const caseId of orderedCases) {
						phase = `${id}/${mode} on ${caseId}`;
						const row = await call(renderCase, id, mode, caseId, renderMs);
						rows.push(row);
						console.log(JSON.stringify(row));
						if (row.rawMismatch) console.error(`RAW MISMATCH ${phase}: ${row.rawMismatch}`);
					}
				}
			}
			assert.equal(rows.length, matrix.length * caseIds.length);
			phase = 'checking collected raw-mode results';
			assert.deepEqual(failures, [], 'Uncaught browser exceptions');
			assert.deepEqual(rows.filter(row => row.rawMismatch).map(({id, mode, caseId, rawMismatch}) => ({id, mode, caseId, rawMismatch})), [], 'Raw modes changed counts, extrema, or gaps');
		};
		try {
			watchdog = setTimeout(() => rejectFailure(new Error(`Exceeded ${totalMs}ms during ${phase}`)), totalMs);
			await Promise.race([run(), failure]);
		}
		catch (error) {
			error.message = `${phase}: ${error.message}${failures.length ? '\nBrowser exceptions: ' + failures.join('\n') : ''}`;
			runError = error.message;
			throw error;
		}
		finally {
			clearTimeout(watchdog);
			process.removeListener('SIGINT', interrupted);
			process.removeListener('SIGTERM', interrupted);
			client?.close();
			try {
				if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
					let timer;
					const exited = new Promise(done => {
						browser.once('exit', done);
						timer = setTimeout(done, 3000);
					});
					try { killBenchmarkBrowser(browser); await exited; }
					finally { clearTimeout(timer); }
				}
			}
			finally {
				if (server) {
					server.closeAllConnections();
					await new Promise(done => server.close(done));
				}
				if (profile) await rm(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
			}
			if (rows.length) {
				await writeFile(join(cache, 'reduction-accuracy-browser-results.json'), JSON.stringify({error: runError, rows, failures, blocked: [...blocked]}, null, 2));
				console.log(`Saved ${rows.length} results to .cache/benchmarks/reduction-accuracy-browser-results.json`);
			}
			if (blocked.size) console.log('Blocked external requests (cache-only validation; production UI is unchanged):', [...blocked]);
		}
	});
});
