import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {cachedChromeBinary} from '../../scripts/chrome-headless-shell.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';

// TEST_SCICHART_REDUCTION_BROWSER=1 node --test --test-isolation=none test/integration/scichart-reduction-browser.mjs
// Cache only. No downloads, screenshots, traces, license patches, or benchmark budget changes.
const root = new URL('../../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const renderMs = 5000, totalMs = 120000;
const vendorFiles = ['scichart-6.0.14-index.min.js', 'scichart-6.0.14-_wasm-scichart.wasm', 'scichart-6.0.14-_wasm-scichart-nosimd.wasm'];

// These pure functions also run in the page. Coordinates are copied from the native
// calculator, in physical pixels; no retained WASM objects cross a render boundary.
function drawSlice(size, resampled, range, clip = true) {
	let start = 0, count = size;
	if (clip && !resampled && range && range.max - range.min >= 0) {
		const length = range.max - range.min + 1;
		if (length < count) start = range.min;
		count = Math.min(length, count);
	}
	return {start, count};
}

function exactComparison(a, b) {
	const same = (x, y) => x === y || Number.isNaN(x) && Number.isNaN(y);
	const result = {lengths: [a.x.length, b.x.length], xyMismatches: 0, indexMismatches: 0, exemplars: []};
	for (let i = 0; i < Math.max(a.x.length, b.x.length); i++) {
		const xy = i < a.x.length && i < b.x.length && same(a.x[i], b.x[i]) && same(a.y[i], b.y[i]);
		if (!xy) {
			result.xyMismatches++;
			if (result.exemplars.length < 3) result.exemplars.push({position: i, a: [a.x[i], a.y[i]], b: [b.x[i], b.y[i]]});
		}
		if (i >= a.indexes.length || i >= b.indexes.length || !same(a.indexes[i], b.indexes[i])) result.indexMismatches++;
	}
	result.xyEqual = result.xyMismatches === 0;
	result.indexesEqual = a.indexes.length === b.indexes.length && result.indexMismatches === 0;
	return result;
}

function analyze(input, output) {
	const summarize = points => {
		let min = Infinity, max = -Infinity, gapMarkers = 0, gapRuns = 0, wasGap = false;
		for (const y of points.y) {
			const gap = !Number.isFinite(y);
			if (gap) { gapMarkers++; if (!wasGap) gapRuns++; }
			else { min = Math.min(min, y); max = Math.max(max, y); }
			wasGap = gap;
		}
		return {count: points.x.length, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null, gapMarkers, gapRuns};
	};
	const before = summarize(input), after = summarize(output);
	const locations = new Map();
	for (let i = 0; i < output.y.length; i++) {
		const y = output.y[i];
		if (!Number.isFinite(y)) continue;
		if (!locations.has(y)) locations.set(y, []);
		locations.get(y).push(output.px[i]);
	}
	for (const list of locations.values()) list.sort((a, b) => a - b);
	const distance = (y, px) => {
		const list = locations.get(y);
		if (!list) return Infinity;
		let lo = 0, hi = list.length;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid] < px) lo = mid + 1; else hi = mid; }
		return Math.min(Math.abs((list[lo] ?? Infinity) - px), Math.abs((list[lo - 1] ?? Infinity) - px));
	};
	const outputAtX = new Map();
	for (let i = 0; i < output.x.length; i++) {
		if (!outputAtX.has(output.x[i])) outputAtX.set(output.x[i], new Set());
		outputAtX.get(output.x[i]).add(output.y[i]);
	}
	const spikes = {count: 0, missingExactLocation: 0, missingWithinOnePixel: 0, exemplars: []};
	for (let i = 1; i < input.y.length - 1; i++) {
		const y = input.y[i], left = input.y[i - 1], right = input.y[i + 1];
		// Strict local extrema, not plateau interiors or a requirement to retain every oscillation.
		if (!Number.isFinite(y) || !Number.isFinite(left) || !Number.isFinite(right) ||
			!(y > left && y > right || y < left && y < right)) continue;
		spikes.count++;
		const delta = distance(y, input.px[i]);
		if (!outputAtX.get(input.x[i])?.has(y)) spikes.missingExactLocation++;
		if (delta > 1 + 1e-7) {
			spikes.missingWithinOnePixel++;
			if (spikes.exemplars.length < 3) spikes.exemplars.push({index: i, x: input.x[i], y, pixel: input.px[i], nearestSameValuePixels: Number.isFinite(delta) ? delta : null});
		}
	}
	const buckets = points => {
		const map = new Map();
		for (let i = 0; i < points.y.length; i++) {
			if (!Number.isFinite(points.y[i]) || !Number.isFinite(points.px[i])) continue;
			const key = Math.floor(points.px[i]);
			const entry = map.get(key) ?? {min: Infinity, max: -Infinity};
			entry.min = Math.min(entry.min, points.y[i]); entry.max = Math.max(entry.max, points.y[i]);
			map.set(key, entry);
		}
		return map;
	};
	const inputBuckets = buckets(input), outputBuckets = buckets(output);
	const envelope = {inputBuckets: inputBuckets.size, outputBuckets: outputBuckets.size, strictDeficitBuckets: 0, neighborDeficitBuckets: 0, strictExemplars: [], exemplars: []};
	for (const [pixel, expected] of inputBuckets) {
		const deficit = actual => !actual || actual.min > expected.min + 1e-9 || actual.max < expected.max - 1e-9;
		if (deficit(outputBuckets.get(pixel))) {
			envelope.strictDeficitBuckets++;
			if (envelope.strictExemplars.length < 3) envelope.strictExemplars.push({pixel, expected, actual: outputBuckets.get(pixel) ?? null});
		}
		const nearby = {min: Infinity, max: -Infinity};
		for (let p = pixel - 1; p <= pixel + 1; p++) {
			const actual = outputBuckets.get(p);
			if (actual) { nearby.min = Math.min(nearby.min, actual.min); nearby.max = Math.max(nearby.max, actual.max); }
		}
		if (deficit(nearby)) {
			envelope.neighborDeficitBuckets++;
			if (envelope.exemplars.length < 3) envelope.exemplars.push({pixel, expected, nearby});
		}
	}
	const endpoint = i => {
		const j = output.x.findIndex((x, j) => x === input.x[i] && (output.y[j] === input.y[i] || Number.isNaN(output.y[j]) && Number.isNaN(input.y[i])));
		const delta = distance(input.y[i], input.px[i]);
		return {x: input.x[i], y: input.y[i], retained: j !== -1,
			nearestSameValuePixels: Number.isFinite(delta) ? delta : null};
	};
	return {input: before, output: after, extremaLost: {min: after.min !== before.min, max: after.max !== before.max},
		endpoints: [endpoint(0), endpoint(input.x.length - 1)],
		outputEdges: [0, output.x.length - 1].map(i => ({x: output.x[i], y: output.y[i], pixel: output.px[i]})),
		edgeCoveragePixels: {start: output.px[0] - input.px[0], end: input.px.at(-1) - output.px.at(-1)}, spikes, envelope,
		gapRunsLost: Math.max(0, before.gapRuns - after.gapRuns)};
}

// Installed once, without changing any SciChart prototypes or renderer internals.
async function installDiagnostic() {
	const adapter = await import('/bench/scichart.mjs');
	const {accuracyCases} = await import('/demos/reduction-accuracy.js');
	const packed = await (await fetch('/bench/data.json')).json();
	const data = adapter.prepData(packed);
	if (data.x.length !== 55550) throw new Error(`Expected full 55550-row benchmark, got ${data.x.length}`);
	globalThis.benchmarkSciChartOptions = {wasmUrl: '/assets/scichart-6.0.14-_wasm-scichart.wasm', wasmNoSimdUrl: '/assets/scichart-6.0.14-_wasm-scichart-nosimd.wasm', timeoutMs: 5000};
	const S = globalThis.SciChart;
	const cases = new Map(accuracyCases.map(item => [item.id, item.data]));
	for (const shift of [0, 1, 4, 16]) {
		const x = Array.from({length: 10002}, (_, i) => i), y = x.map(() => 0);
		y[shift] = 100; y[shift + 5] = -100; y[x.length - 1 - shift] = 100; y[x.length - 6 - shift] = -100;
		cases.set(`edge-shift-${shift}`, [x, y]);
	}
	let chart, host, inputs, snapshots;
	const license = surface => {
		const {SCRTCredentials, SCRTLicenseType} = surface.getLicenseContext();
		const type = SCRTCredentials.GetLicenseType();
		if (![SCRTLicenseType.LICENSE_TYPE_FULL, SCRTLicenseType.LICENSE_TYPE_TRIAL, SCRTLicenseType.LICENSE_TYPE_COMMUNITY].includes(type)) {
			const name = Object.keys(SCRTLicenseType).find(key => SCRTLicenseType[key] === type) ?? 'UNKNOWN';
			throw new Error(`SciChart license not ready (${name})`);
		}
		return Object.keys(SCRTLicenseType).find(key => SCRTLicenseType[key] === type);
	};
	const render = action => new Promise((resolve, reject) => {
		const cleanup = () => { clearTimeout(timer); chart.renderInstructionsCompleted.unsubscribe(done); chart.renderError.unsubscribe(failed); };
		const failed = error => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
		const done = invalidated => {
			try {
				license(chart);
				if (!invalidated && !chart.isInvalidated && !chart.isRunningAnimation) { cleanup(); resolve(); }
			}
			catch (error) { failed(error); }
		};
		const timer = setTimeout(() => failed(new Error('Diagnostic render timed out')), 5000);
		chart.renderInstructionsCompleted.subscribe(done); chart.renderError.subscribe(failed);
		try { action(); } catch (error) { failed(error); }
	});
	const dispose = () => {
		if (chart) adapter.destroyChart(chart);
		chart = undefined; host?.remove(); host = undefined; inputs = undefined; snapshots = undefined;
	};
	const initialize = async (id, width) => {
		dispose();
		host = document.createElement('div'); host.style.cssText = `width:${width}px;height:${id === 'bench' ? 600 : 250}px`;
		document.body.append(host); snapshots = {};
		let flags;
		try {
			if (id === 'bench') {
				inputs = ['cpu', 'ram', 'tcp'].map(name => ({name, x: Array.from(data.x), y: Array.from(data[name])}));
				chart = await adapter.makeChart(data, host);
				flags = {isSorted: true, dataEvenlySpacedInX: true, containsNaN: false};
			}
			else {
				const [xs, ys] = cases.get(id);
				const x = Array.from(xs), y = Array.from(ys, value => value === null ? NaN : value);
				const step = x[1] - x[0];
				flags = {isSorted: x.every((v, i) => i === 0 || v >= x[i - 1]),
					dataEvenlySpacedInX: x.every((v, i) => i === 0 || Math.abs(v - x[i - 1] - step) < 1e-10),
					containsNaN: y.some(v => !Number.isFinite(v))};
				inputs = [{name: id, x, y}];
				const {sciChartSurface, wasmContext} = await S.SciChartSurface.createSingle(host, {theme: new S.SciChartJSLightTheme(), createSuspended: true});
				chart = sciChartSurface;
				license(chart);
				chart.xAxes.add(new S.NumericAxis(wasmContext, {visibleRange: new S.NumberRange(x[0], x.at(-1))}));
				chart.yAxes.add(new S.NumericAxis(wasmContext, {visibleRange: new S.NumberRange(-120, 120)}));
				const series = new S.XyDataSeries(wasmContext, {...flags, xValues: x, yValues: y});
				try { chart.renderableSeries.add(new S.FastLineRenderableSeries(wasmContext, {dataSeries: series, stroke: '#0066cc', strokeThickness: 1})); }
				catch (error) { series.delete(); throw error; }
				await render(() => chart.resumeUpdates({invalidateOnResume: true}));
			}
			const lines = chart.renderableSeries.asArray();
			if (lines.some(line => line.resamplingMode !== S.EResamplingMode.Auto)) throw new Error('Initial mode is not native Auto');
			return {id, width, height: host.clientHeight, dpr: devicePixelRatio, flags, license: license(chart),
				defaults: lines.map(line => ({mode: line.resamplingMode, precision: line.resamplingPrecision, drawNaNAs: line.drawNaNAs, enableDrawingOptimisations: line.enableDrawingOptimisations})),
				canvas: [...host.querySelectorAll('canvas')].map(canvas => ({width: canvas.width, height: canvas.height}))};
		}
		catch (error) { dispose(); throw error; }
	};
	const capture = async mode => {
		const lines = chart.renderableSeries.asArray();
		if (mode !== 'Auto') await render(() => { for (const line of lines) line.resamplingMode = S.EResamplingMode[mode]; chart.invalidateElement(); });
		license(chart);
		const results = lines.map((line, index) => {
			const rpd = line.getCurrentRenderPassData(), ps = rpd?.pointSeries;
			if (!ps) throw new Error('No current render-pass point series');
			const copy = vector => Array.from({length: vector.size()}, (_, i) => vector.get(i));
			// Borrowed vectors and coordinate calculators belong to SciChart. Never delete them.
			const x = copy(ps.xValues), y = copy(ps.yValues), indexes = copy(ps.indexes);
			if (x.length !== y.length || indexes.length !== x.length) throw new Error('Render-pass vector lengths differ');
			const range = rpd.indexRange ? {min: rpd.indexRange.min, max: rpd.indexRange.max} : null;
			const {start, count} = drawSlice(x.length, ps.resampled, range, line.xAxis.clipToXRange !== false);
			const calculator = rpd.xCoordinateCalculator;
			const output = {x: x.slice(start, start + count), y: y.slice(start, start + count), indexes: indexes.slice(start, start + count)};
			output.px = output.x.map(v => calculator.getCoordinate(v));
			const input = {...inputs[index], px: inputs[index].x.map(v => calculator.getCoordinate(v))};
			const metadata = {resampled: ps.resampled, count: ps.count, vectorSize: x.length, indexRange: range, drawStart: start, drawCount: count,
				coordinate: {viewportDimension: calculator.viewportDimension, visibleMin: calculator.visibleMin, visibleMax: calculator.visibleMax},
				plotRect: {x: chart.seriesViewRect.x, y: chart.seriesViewRect.y, width: chart.seriesViewRect.width, height: chart.seriesViewRect.height}};
			return {output, summary: {name: input.name, mode, ...metadata, ...analyze(input, output)}};
		});
		snapshots[mode] = results.map(result => result.output);
		const summaries = results.map(result => result.summary);
		if (mode === 'MinMax') summaries.forEach((summary, i) => { summary.autoComparison = exactComparison(snapshots.Auto[i], snapshots.MinMax[i]); });
		if (mode === 'None') summaries.forEach((summary, i) => {
			summary.autoComparison = exactComparison(snapshots.Auto[i], snapshots.None[i]);
			summary.inputComparison = exactComparison({...inputs[i], indexes: inputs[i].x.map((_, j) => j)}, snapshots.None[i]);
		});
		return summaries;
	};
	globalThis.scichartDiagnostic = {initialize, capture, dispose};
	return {caseIds: [...cases.keys()], enum: S.EResamplingMode};
}

describe('SciChart reduction diagnostic analysis', () => {
	const points = (x, y = x) => ({x, y, px: x, indexes: x.map((_, i) => i)});
	it('uses the drawing-provider clipping rule only for unresampled vectors', () => {
		assert.deepEqual(drawSlice(10, false, {min: 3, max: 6}), {start: 3, count: 4});
		assert.deepEqual(drawSlice(10, true, {min: 3, max: 6}), {start: 0, count: 10});
		assert.deepEqual(drawSlice(10, false, {min: 3, max: 6}, false), {start: 0, count: 10});
	});
	it('compares x/y and indexes independently, treating NaN as an equal gap', () => {
		const a = points([0, 1], [NaN, 100]), b = {...a, indexes: [1, 0]};
		assert.equal(exactComparison(a, b).xyEqual, true);
		assert.equal(exactComparison(a, b).indexesEqual, false);
		assert.equal(exactComparison(a, points([0], [NaN])).xyMismatches, 1);
	});
	it('does not confuse a bucket boundary with missing spike amplitude', () => {
		const input = points([0, 0.99, 3], [0, 100, 0]), output = points([0, 1.01, 3], [0, 100, 0]);
		const result = analyze(input, output);
		assert.equal(result.envelope.strictDeficitBuckets, 1);
		assert.equal(result.envelope.neighborDeficitBuckets, 0);
		assert.equal(result.spikes.missingExactLocation, 1);
		assert.equal(result.spikes.missingWithinOnePixel, 0);
	});
	it('detects a missing isolated spike, endpoint, and gap run', () => {
		const result = analyze(points([0, 2, 4, 6, 8], [0, 100, 0, NaN, 0]), points([0, 4], [0, 0]));
		assert.equal(result.extremaLost.max, true);
		assert.equal(result.spikes.missingWithinOnePixel, 1);
		assert.equal(result.gapRunsLost, 1);
		assert.equal(result.endpoints[1].retained, false);
	});
	it('does not require retaining every plateau sample', () => {
		const result = analyze(points([0, 1, 2, 3, 4], [0, 100, 100, 100, 0]), points([0, 2, 4], [0, 100, 0]));
		assert.equal(result.spikes.count, 0);
		assert.deepEqual(result.extremaLost, {min: false, max: false});
	});
});

(process.env.TEST_SCICHART_REDUCTION_BROWSER === '1' ? describe : describe.skip)('SciChart cached-browser reduction diagnostic', function() {
	it('compares native Auto, MinMax and None without changing native budgets', {timeout: totalMs + 10000}, async function(t) {
		const binary = await cachedChromeBinary();
		if (!binary) return t.skip('No cached Chrome executable. Run npm run bench -- --install-only or set CHROME_BIN; this test never installs a browser.');
		try {
			await access(binary, constants.X_OK);
			for (const name of vendorFiles) await access(join(cache, name), constants.R_OK);
		}
		catch (error) { console.log(`SciChart diagnostic skipped: cached Chrome/assets unavailable (${error.code}); nothing will be installed.`); return t.skip(); }
		let browser, client, server, profile, watchdog, stepTimer;
		let phase = 'setup', log = '', runError;
		const started = Date.now();
		const report = {schema: 1, status: 'running', config: {vendor: 'SciChart 6.0.14',
			renderMs, totalMs, benchmarkRows: 55550, benchmarkSeries: 3, widths: [580, 1920], dprs: [1, 2],
			modes: ['Auto', 'MinMax', 'None'], license: 'public community startup; adapter licenseReady unchanged',
			budgets: 'native resampling defaults; no precision/threshold overrides',
			measurement: 'copied public getCurrentRenderPassData().pointSeries vectors; not screenshots',
			envelope: 'sample-vertex min/max per floor(native xCoordinateCalculator.getCoordinate(x)) physical pixel; also +/-1 bucket tolerance; not rasterized segment coverage',
			interpretation: 'Different polylines, plateau shape, and dense local oscillation omissions alone do not prove lossy min/max. Gap-marker counts do not prove visible gap preservation. Auto/MinMax equality is evidence only for this matrix.'},
			provenance: [], cases: [], exceptions: [], networkFailures: []};
		let rejectFailure;
		const failure = new Promise((_, reject) => { rejectFailure = reject; }); failure.catch(() => {});
		const stop = error => { rejectFailure(error); try { killBenchmarkBrowser(browser); } catch {} };
		const interrupted = () => stop(new Error('Diagnostic interrupted'));
		process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
		const run = async () => {
			for (const path of [...vendorFiles.map(name => '.cache/benchmarks/' + name), 'bench/scichart.mjs', 'bench/data.json',
				'demos/reduction-accuracy.js', 'demos/decimation-libs.js', 'demos/decimation.js', 'test/integration/scichart-reduction-browser.mjs']) {
				const bytes = await readFile(new URL(path, root));
				report.provenance.push({path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
			}
			const source = await readFile(join(cache, vendorFiles[0]), 'utf8');
			const evidence = ['case n.EResamplingMode.Auto:return this.wasmContext.ResamplingMode.Auto',
				'getCurrentRenderPassData(){return this.currentRenderPassData}', 'getStartAndCount(e,t){', 'a.SetXValues(i),a.SetYValues(r)'];
			report.sourceEvidence = evidence.map(text => ({text, found: source.includes(text)}));
			assert.ok(report.sourceEvidence.every(item => item.found), 'Pinned vendor source hooks changed');
			const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm'};
			server = createServer(async (request, response) => {
				try {
					const path = new URL(request.url, 'http://localhost').pathname;
					if (path === '/') {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><script src="/assets/' + vendorFiles[0] + '"></script>'); return;
					}
					let file;
					if (path.startsWith('/assets/') && vendorFiles.includes(path.slice(8))) file = join(cache, path.slice(8));
					else if (/^\/(bench|demos)\/[a-zA-Z0-9_./-]+\.(m?js|json)$/.test(path) && !path.includes('..')) file = new URL(path.slice(1), root);
					else { response.writeHead(404).end(); return; }
					const bytes = await readFile(file);
					response.setHeader('Content-Type', mime[extname(path)]); response.end(bytes);
				}
				catch { response.writeHead(404).end(); }
			});
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			profile = await mkdtemp(join(cache, 'scichart-reduction-'));
			phase = 'launch cached Chrome';
			const args = ['--enable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
				'--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-gpu-shader-disk-cache', '--disk-cache-size=1',
				'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'];
			report.config.chromeFlags = args.filter(arg => !arg.startsWith('--user-data-dir='));
			browser = spawn(binary, args, {stdio: ['ignore', 'ignore', 'pipe']});
			browser.once('error', rejectFailure);
			browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal})`)));
			browser.stderr.on('data', chunk => { log = (log + chunk).slice(-3000); });
			let port;
			for (let i = 0; i < 100; i++) {
				try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
				catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
			}
			assert.ok(port, 'Chrome startup failed');
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(renderMs)})).json();
			const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
			client = new CDP(socket, renderMs + 500);
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('CDP connection timed out')), renderMs);
				socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
				socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, {once: true});
			});
			socket.addEventListener('message', event => {
				const {method, params} = JSON.parse(event.data);
				if (method === 'Runtime.exceptionThrown' && report.exceptions.length < 10) report.exceptions.push(params.exceptionDetails.text);
				if (method === 'Network.loadingFailed' && report.networkFailures.length < 10) report.networkFailures.push({type: params.type, error: params.errorText});
			});
			await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Network.enable');
			report.browser = await client.send('Browser.getVersion');

			const evaluate = async expression => {
				const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
				if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
				return result.result.value;
			};
			const step = async (label, expression) => {
				phase = label;
				stepTimer = setTimeout(() => stop(new Error(`External 5000ms watchdog: ${label}`)), renderMs);
				const start = Date.now();
				try { return await evaluate(expression); }
				finally { clearTimeout(stepTimer); report.maxStepMs = Math.max(report.maxStepMs ?? 0, Date.now() - start); }
			};
			for (const dpr of [1, 2]) {
				await client.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: dpr, mobile: false});
				// SciChart caches DPI. Load a fresh document after emulation, before vendor startup.
				phase = `DPR${dpr}/navigation`;
				const loaded = client.wait('Page.loadEventFired'); loaded.catch(() => {});
				await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/?dpr=${dpr}`}); await loaded;
				const setup = await step(`DPR${dpr}/import modules`, `globalThis.drawSlice = ${drawSlice}; globalThis.exactComparison = ${exactComparison}; globalThis.analyze = ${analyze}; (${installDiagnostic})()`);
				report.config.nativeModes = setup.enum;
				const matrix = [{id: 'bench', width: 1920}, ...[580, 1920].flatMap(width => setup.caseIds.map(id => ({id, width})))];
				for (const {id, width} of matrix) {
					const row = {id, width, dpr, status: 'initializing', modes: {}}; report.cases.push(row);
					row.configuration = await step(`${id}/${width}/DPR${dpr}/initialize`, `scichartDiagnostic.initialize(${JSON.stringify(id)}, ${width})`);
					assert.equal(row.configuration.dpr, dpr);
					assert.ok(row.configuration.canvas.length > 0 && row.configuration.canvas.every(canvas =>
						canvas.width === width * dpr && canvas.height === row.configuration.height * dpr), 'Backing canvas must match requested DPR');
					for (const mode of ['Auto', 'MinMax', 'None']) {
						row.modes[mode] = await step(`${id}/${width}/DPR${dpr}/${mode}`, `scichartDiagnostic.capture(${JSON.stringify(mode)})`);
					}
					row.status = 'complete';
					console.log(`SciChart ${id} ${width} DPR${dpr}: Auto ${row.modes.Auto.map(s => s.drawCount).join('/')} points; MinMax xy equal ${row.modes.MinMax.every(s => s.autoComparison.xyEqual)}`);
					await step(`${id}/dispose`, 'scichartDiagnostic.dispose()');
				}
			}
			report.status = 'complete';
		};
		try {
			watchdog = setTimeout(() => stop(new Error(`External total 120000ms watchdog: ${phase}`)), totalMs);
			await Promise.race([run(), failure]);
		}
		catch (error) {
			runError = error;
			report.status = /license/i.test(error.message) ? 'license-blocked' : /watchdog|timed out/i.test(error.message) ? 'render-timeout' : /initialize|Auto|MinMax|None/.test(phase) ? 'render-or-inspection-error' : 'setup-error';
			report.failure = {phase, message: error.message.slice(0, 2000)};
			const row = report.cases.at(-1); if (row && row.status !== 'complete') row.status = report.status;
			console.error(report.status, report.failure, log);
		}
		finally {
			clearTimeout(watchdog); clearTimeout(stepTimer);
			process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
			client?.close();
			try { killBenchmarkBrowser(browser); }
			catch (error) { report.cleanupError = error.message; }
			if (browser && browser.exitCode === null && browser.signalCode === null)
				await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
			server?.closeAllConnections();
			if (server?.listening) await new Promise(resolve => server.close(resolve));
			if (profile) await rm(profile, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
			report.elapsedMs = Date.now() - started;
			const complete = report.cases.filter(row => row.status === 'complete');
			const summaries = complete.flatMap(row => row.modes.Auto);
			report.totals = {completedCases: complete.length, autoSeries: summaries.length,
				autoMinMaxXYDifferent: complete.flatMap(row => row.modes.MinMax).filter(s => !s.autoComparison.xyEqual).length,
				autoMinMaxIndexesDifferent: complete.flatMap(row => row.modes.MinMax).filter(s => !s.autoComparison.indexesEqual).length,
				autoExtremaLossSeries: summaries.filter(s => s.extremaLost.min || s.extremaLost.max).length,
				autoMissingEndpointSeries: summaries.filter(s => s.endpoints.some(e => !e.retained)).length,
				autoGapRunLossSeries: summaries.filter(s => s.gapRunsLost > 0).length,
				adversarialMissingSpikesExactLocation: complete.filter(row => row.id !== 'bench').flatMap(row => row.modes.Auto).reduce((sum, s) => sum + s.spikes.missingExactLocation, 0),
				adversarialMissingSpikesWithinOnePixel: complete.filter(row => row.id !== 'bench').flatMap(row => row.modes.Auto).reduce((sum, s) => sum + s.spikes.missingWithinOnePixel, 0),
				strictEnvelopeDeficitBuckets: summaries.reduce((sum, s) => sum + s.envelope.strictDeficitBuckets, 0),
				neighborEnvelopeDeficitBuckets: summaries.reduce((sum, s) => sum + s.envelope.neighborDeficitBuckets, 0),
				maxEdgeCoverageGapPixels: summaries.length ? Math.max(...summaries.flatMap(s => Object.values(s.edgeCoveragePixels))) : null,
				noneInputDifferent: complete.flatMap(row => row.modes.None).filter(s => !s.inputComparison.xyEqual).length};
			const t = report.totals;
			const supported = report.status === 'complete' && t.completedCases === 42 && !report.cleanupError && !report.exceptions.length &&
				[t.autoMinMaxXYDifferent, t.autoMinMaxIndexesDifferent, t.autoExtremaLossSeries, t.autoGapRunLossSeries,
					t.adversarialMissingSpikesExactLocation, t.neighborEnvelopeDeficitBuckets, t.noneInputDifferent].every(n => n === 0) && t.maxEdgeCoverageGapPixels <= 1;
			report.recommendation = {lossyForTestedBenchmark: supported ? false : null,
				sampling: supported ? 'Auto (observed MinMax-equivalent)' : 'Auto; review incomplete or discrepant evidence',
				scope: 'Pinned 6.0.14 workload and tested dimensions, using the existing min/max classification convention; not a promise that Auto always chooses MinMax.',
				caveats: 'Not point-for-point or raster equivalence. Exact final vertices and dense local oscillations can be omitted. One-pixel envelope tolerance allows bucket boundaries. Retained NaN runs do not prove visible gaps.'};
			await writeFile(join(cache, 'scichart-reduction-report.json'), JSON.stringify(report) + '\n');
			console.log('SciChart diagnostic:', JSON.stringify({status: report.status, elapsedMs: report.elapsedMs, ...report.totals}));
		}
		if (runError) throw runError;
		assert.equal(report.status, 'complete');
		assert.equal(report.totals.completedCases, 42);
				assert.equal(report.totals.autoMinMaxXYDifferent, 0, 'Auto differs from explicit MinMax');
				assert.equal(report.totals.autoMinMaxIndexesDifferent, 0, 'Auto and MinMax select different source indexes');
				assert.equal(report.totals.autoExtremaLossSeries, 0, 'Auto loses global extrema');
				assert.equal(report.totals.adversarialMissingSpikesExactLocation, 0, 'Auto drops or moves an adversarial spike');
				assert.equal(report.totals.neighborEnvelopeDeficitBuckets, 0, 'Auto loses pixel-neighborhood extrema');
				assert.equal(report.recommendation.lossyForTestedBenchmark, false, 'Evidence no longer supports the benchmark minmax exemption');
		assert.equal(report.totals.noneInputDifferent, 0, 'None control differs from the full visible input');
		assert.equal(report.cleanupError, undefined);
		assert.deepEqual(report.exceptions, []);
	});
});
