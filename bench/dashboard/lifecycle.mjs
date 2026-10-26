import {WIDTH, HEIGHT, CHARTS, ROWS, SERIES, dashboardData} from './common.mjs';
import {createDashboardLayout, createDashboardHosts} from './layout.mjs';

const OPERATIONS = ['small-init', 'data-update'];
const WARMUPS = 3;
const ROUNDS = 7;
const COLUMNS = 4;
const GRID_ROWS = 5;
const IDLE_MS = 200;

function hasChartSurface(root) {
	if (root.matches?.('canvas, svg')) return true;
	if (root.shadowRoot && hasChartSurface(root.shadowRoot)) return true;
	return Array.from(root.children).some(hasChartSurface);
}

function validateFrames(frames, rows) {
	const arrays = new Set();
	if (frames.length !== CHARTS || new Set(frames).size !== CHARTS)
		throw new Error('Dashboard requires 20 independent frames.');
	for (const frame of frames) {
		if (frame.ys.length !== SERIES.length)
			throw new Error('Dashboard requires five series per frame.');
		for (const values of [frame.x, ...frame.ys]) {
			if (!Array.isArray(values) || values.length !== rows || arrays.has(values) || !values.every(Number.isFinite))
				throw new Error('Dashboard requires independent, finite input arrays with the expected row count.');
			arrays.add(values);
		}
		for (let i = 0; i < rows; i++) {
			const index = rows === 2 ? i * (ROWS - 1) : i;
			if (frame.x[i] !== 1704067200000 + index * 60000)
				throw new Error('Dashboard timestamps must retain the source millisecond time range.');
		}
	}
}

// Kept separate from /bench.mjs so the actual lifecycle can run against a mocked realm.
// Deadlines belong to captureBenchmarkSamples or the parent's sample-boundary watchdog.
export function createDashboardLifecycle({variant, source = null, realm = globalThis}) {
	if (typeof variant !== 'string' || !variant)
		throw new Error('Dashboard requires one selected variant.');
	const idle = variant === 'idle';
	if (!idle) {
		for (const method of ['prepData', 'makeChart', 'updateChart', 'destroyChart', 'validateChart']) {
			if (typeof source?.[method] !== 'function')
				throw new Error(`${variant}: dashboard adapter requires ${method}().`);
		}
	}
	const {document, performance} = realm;
	const dpr = realm.devicePixelRatio;
	const frames = idle ? null : {2: dashboardData(2), [ROWS]: dashboardData(ROWS)};
	if (frames) for (const rows of [2, ROWS]) {
		validateFrames(frames[rows], rows);
		// Validate and protect canonical data before capture/baseline, not during preparation.
		for (const frame of frames[rows]) {
			Object.freeze(frame.x);
			for (const values of frame.ys) Object.freeze(values);
			Object.freeze(frame.ys);
			Object.freeze(frame);
		}
		Object.freeze(frames[rows]);
	}
	const {fixture} = createDashboardLayout(document);
	const waitFrame = () => new Promise(resolve => realm.requestAnimationFrame(resolve));
	const nextFrame = () => new Promise(resolve => realm.requestAnimationFrame(() => resolve(performance.now())));
	const idleWait = () => new Promise(resolve => realm.setTimeout(resolve, IDLE_MS));
	async function settle() {
		await waitFrame();
		await waitFrame();
		await idleWait();
	}
	function checkPage() {
		if (realm.innerWidth !== WIDTH * COLUMNS || realm.innerHeight !== HEIGHT * GRID_ROWS)
			throw new Error(`Expected a 1920x1080 CSS viewport, got ${realm.innerWidth}x${realm.innerHeight}`);
		if (!Number.isFinite(dpr) || dpr <= 0 || realm.devicePixelRatio !== dpr)
			throw new Error('Browser DPR must stay fixed after navigation.');
		if (document.visibilityState !== 'visible')
			throw new Error('The dashboard fixture must be in a visible page.');
	}
	function checkGeometry() {
		if (state.hosts.length !== CHARTS || new Set(state.hosts).size !== CHARTS ||
			new Set(state.hosts.map(host => host.id)).size !== CHARTS || fixture.children.length !== CHARTS)
			throw new Error('Dashboard requires 20 unique hosts.');
		for (const [i, host] of state.hosts.entries()) {
			const rect = host.getBoundingClientRect();
			if (host.parentNode !== fixture || !host.isConnected ||
				Math.abs(rect.left - i % COLUMNS * WIDTH) > 0.01 ||
				Math.abs(rect.top - Math.floor(i / COLUMNS) * HEIGHT) > 0.01 ||
				Math.abs(rect.width - WIDTH) > 0.01 || Math.abs(rect.height - HEIGHT) > 0.01)
				throw new Error(`Dashboard host ${i} must occupy its 480x216 grid cell.`);
			if (idle ? host.children.length !== 0 : !hasChartSurface(host))
				throw new Error(`Dashboard host ${i} has an unexpected chart surface.`);
		}
	}
	function setupHosts() {
		for (const {host, wait} of createDashboardHosts(fixture, state.id)) {
			state.hosts.push(host);
			state.waits.push(wait);
		}
	}
	async function batch(operation) {
		// Each callback catches synchronous throws, so every tile starts before any wait.
		const results = await Promise.allSettled(state.hosts.map(async (host, i) => {
			if (operation === 'small-init') {
				const handle = await source.makeChart(state.inputs[i], host, state.waits[i]);
				state.charts[i] = handle;
				if (handle == null) throw new Error(`${variant}: chart ${i} returned no handle.`);
			}
			else {
				const result = await source.updateChart(state.charts[i], state.inputs[i], host, state.waits[i]);
				if (result !== undefined && result !== state.charts[i])
					throw new Error(`${variant}: updateChart must retain chart identity.`);
			}
		}));
		const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
		if (errors.length) throw new AggregateError(errors, `${variant}: dashboard ${operation} failed: ${errors[0]?.message ?? String(errors[0])}`, {cause: errors[0]});
	}
	function resources(method) {
		return [...new Set(state.charts.flatMap(chart => [...(chart?.[method]?.() ?? [])]))];
	}
	let invoked = false;
	let busy = false;
	let rafMode = false;
	let sampleIndex = 0;
	let state = null;
	// Capture also catches loss for adapters that expose no context getter (including rAF mode).
	fixture.addEventListener('webglcontextlost', () => { if (state) state.contextLost = true; }, true);
	function requireSample(phase) {
		if (!invoked || busy || !state || state.phase !== phase)
			throw new Error(`Sample lifecycle requires an inactive ${phase} sample.`);
	}
	function metadata() {
		return {
			phase: 'chart-population', initProtocol: 'settled-work-v1',
			workload: {protocol: 'dashboard-v1', charts: CHARTS, series: SERIES.length, rows: ROWS,
				columns: COLUMNS, gridRows: GRID_ROWS, width: WIDTH, height: HEIGHT},
			lifecycle: {operations: [...OPERATIONS], initialRows: 2, updateRows: ROWS},
			dpr, dprs: [dpr], variants: [variant], warmups: WARMUPS, rounds: ROUNDS,
			viewport: [WIDTH * COLUMNS, HEIGHT * GRID_ROWS], chartCssSize: [WIDTH, HEIGHT],
			markerPattern: 'benchmark:<id>:start|js-end|end',
			roundConvention: 'Warmups -3..-1; measured rounds 0..6. IDs include warmups in chronological order.',
			source: {demos: idle ? {} : {[variant]: `/bench/dashboard/${variant}.mjs`},
				data: '/bench/dashboard/common.mjs', rows: ROWS, ySeries: SERIES.length, xUnit: 'milliseconds'},
			expectedInstances: {operationWindows: (WARMUPS + ROUNDS) * OPERATIONS.length,
				samples: WARMUPS + ROUNDS, warmupSamples: WARMUPS, measuredSamples: ROUNDS,
				chartCreations: idle ? 0 : CHARTS * (WARMUPS + ROUNDS), measuredChartCreations: idle ? 0 : CHARTS * ROUNDS,
				perDprVariant: {warmup: WARMUPS, measured: ROUNDS}},
			timing: {unit: 'milliseconds',
				dataPrepMs: 'Aggregate preparation of all 20 inputs, outside chart markers. Deep validation is diagnostic-only.',
				jsMs: 'Whole-dashboard readiness, including host setup during small-init and all asynchronous adapter work.',
				windowMs: 'Whole-dashboard readiness, two animation frames, 200ms settling, and graphics completion in trace/memory mode.',
				settling: {animationFrames: 2, idleMs: IDLE_MS, beforeStart: true, afterJsEnd: true}},
			limitations: [
				'Each session initializes 20 charts with two rows, then updates the retained charts to 300 rows and five series.',
				'All tiles start before the batch waits. Timings cover the whole dashboard, not an average tile.',
				'Input preparation is outside chart markers. Host creation is inside small-init. Canonical frames are validated and frozen at fixture load, before baseline.',
				'Deep frame and adapter validation runs only through explicit benchmarkLifecycle.validate() calls in separate diagnostic fixtures, never during capture or preflight.',
				'Capture retains page/grid geometry, distinct-handle and graphics health/completion checks, without deep data verification allocations.',
				'Idle uses the same grid and marker schedule, without charts or data preparation.',
				'Trace/memory checks actual observed WebGL contexts and adapter-exposed WebGPU devices. Lost resources invalidate the sample.',
				'rAF mode measures first post-readiness callback latency, not paint, GPU completion, or presentation.',
				'The parent bounds each operation and destruction. Memory capture ends at post-update live; destruction has no memory polling or forced GC.',
			],
		};
	}
	const benchmarkLifecycle = {
		begin({raf = false} = {}) {
			if (invoked) throw new Error('Benchmark protocols are exclusive. Reload the page for another capture.');
			checkPage();
			invoked = true;
			rafMode = raf;
			const captureId = realm.crypto.randomUUID();
			performance.mark('benchmark:capture:' + captureId);
			realm.console.time = realm.console.timeEnd = () => {};
			return {...metadata(), captureId, env: {userAgent: realm.navigator.userAgent, actualDPR: dpr},
				config: {variants: [variant], dpr, warmups: WARMUPS, rounds: ROUNDS, lifecycle: true, operations: [...OPERATIONS]}};
		},
		async setup(selected, id) {
			if (!invoked || state || busy) throw new Error('Sample setup requires begin() and no active sample.');
			if (selected !== variant) throw new Error(`Unknown variant: ${selected}`);
			if (id !== `sample-${sampleIndex}`) throw new Error(`Expected sample-${sampleIndex}, got ${id}`);
			checkPage();
			sampleIndex++;
			state = {id, hosts: [], waits: [], inputs: null, charts: [], phase: 'setup', operationIndex: -1};
			busy = true;
			try {
				await realm.benchmarkMoveMouse?.(WIDTH * COLUMNS - 1, HEIGHT * GRID_ROWS - 1);
				await settle();
				checkPage();
			}
			finally { busy = false; }
		},
		async prepare(operation = OPERATIONS[state?.operationIndex + 1], id = state?.id) {
			requireSample(state?.operationIndex === -1 ? 'setup' : 'constructed');
			if (operation !== OPERATIONS[state.operationIndex + 1]) throw new Error(`Unexpected lifecycle operation: ${operation}`);
			const expectedId = state.operationIndex < 0 ? state.id : `sample-${sampleIndex}`;
			if (id !== expectedId) throw new Error(`Expected ${expectedId}, got ${id}`);
			if (state.operationIndex >= 0) sampleIndex++;
			Object.assign(state, {id, operation, operationIndex: state.operationIndex + 1, phase: 'preparing', dataPrepMs: 0});
			busy = true;
			try {
				checkPage();
				if (state.hosts.length) checkGeometry();
				if (!rafMode) realm.benchmarkWebGL?.begin();
				state.rows = operation === 'small-init' ? 2 : ROWS;
				if (!idle) {
					const start = performance.now();
					state.inputs = frames[state.rows].map(frame => source.prepData(frame));
					state.dataPrepMs = performance.now() - start;
					if (new Set(state.inputs).size !== CHARTS || state.inputs.some(input => input == null || typeof input?.then === 'function'))
						throw new Error(`${variant}: prepData must return an independent prepared input synchronously for each tile.`);
				}
				await settle();
				checkPage();
				state.phase = 'prepared';
			}
			finally { busy = false; }
		},
		async construct() {
			requireSample('prepared');
			busy = true;
			state.phase = 'constructing';
			try {
				checkPage();
				const prefix = `benchmark:${state.id}:`;
				if (rafMode) await nextFrame();
				const start = performance.mark(prefix + 'start');
				if (state.operation === 'small-init') setupHosts();
				if (!idle) await batch(state.operation);
				const jsEnd = performance.mark(prefix + 'js-end');
				const rafTimes = {};
				if (rafMode) {
					const first = await nextFrame();
					Object.assign(rafTimes, {raf1Ms: first - start.startTime, postJsRaf1Ms: first - jsEnd.startTime});
					await nextFrame();
					await idleWait();
				}
				else {
					for (const gl of resources('getWebGLContexts')) realm.benchmarkWebGL?.track(gl);
					await settle();
				}
				const contexts = rafMode ? [] : resources('getWebGLContexts');
				const devices = rafMode ? [] : resources('getWebGPUDevices');
				for (const gl of contexts) realm.benchmarkWebGL?.track(gl);
				const webgl = !rafMode ? await realm.benchmarkWebGL?.complete({webgl1Finish: true, retainContexts: true}) : undefined;
				const webgpu = !rafMode && (devices.length || variant === 'chartgpu') ? await realm.benchmarkWebGPU?.complete(devices) : undefined;
				const end = performance.mark(prefix + 'end');
				checkPage();
				checkGeometry();
				if (!idle && new Set(state.charts).size !== CHARTS)
					throw new Error('Dashboard requires 20 independent chart handles.');
				if (state.contextLost || resources('getWebGLContexts').some(gl => gl.isContextLost()))
					throw new Error(`${variant}: lost WebGL context.`);
				if (!rafMode && (webgl?.status === 'incomplete' || webgl?.contexts?.some(context => context.status !== 'complete') ||
					contexts.length && (webgl?.status !== 'complete' || (webgl.contexts?.length ?? 0) < contexts.length)))
					throw new Error(`${variant}: WebGL completion not verified: ${JSON.stringify(webgl)}`);
				if (variant === 'chartgpu' && state.charts.some(chart => !chart.getWebGPUDevices?.().length))
					throw new Error('chartgpu: every dashboard handle must expose its actual WebGPU devices.');
				if (!rafMode && (devices.length || variant === 'chartgpu') && (webgpu?.status !== 'complete' ||
					!webgpu.devices?.length || webgpu.devices.length !== devices.length || webgpu.devices.some(device => device.status !== 'complete')))
					throw new Error(`${variant}: WebGPU completion not verified: ${JSON.stringify(webgpu)}`);
				state.phase = 'constructed';
				const jsMs = jsEnd.startTime - start.startTime;
				return {id: state.id, dpr, effectiveDpr: dpr, variant, operation: state.operation, ...rafTimes,
					dataPrepMs: state.dataPrepMs, jsMs, prepAndInitMs: state.dataPrepMs + jsMs,
					windowMs: end.startTime - start.startTime, ...(webgl ? {webgl} : {}), ...(webgpu ? {webgpu} : {})};
			}
			finally { busy = false; }
		},
		// Diagnostic-only: even after the end marker, allocations would pollute capture's memory peak.
		async validate() {
			requireSample('constructed');
			busy = true;
			try {
				if (!idle) {
					validateFrames(frames[state.rows], state.rows);
					for (let i = 0; i < CHARTS; i++) {
						if (await source.validateChart(state.charts[i], state.inputs[i], {rows: state.rows}) === false)
							throw new Error(`${variant}: chart ${i} failed validation.`);
					}
				}
				return true;
			}
			finally { busy = false; }
		},
		async destroy() {
			if (!invoked || busy) throw new Error('Sample destroy requires an inactive sample lifecycle.');
			busy = true;
			try {
				const results = await Promise.allSettled([...new Set(state?.charts ?? [])].filter(chart => chart != null)
					.map(async chart => source.destroyChart(chart)));
				const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
				if (errors.length) throw new AggregateError(errors, `${variant}: dashboard destruction failed: ${errors[0]?.message ?? String(errors[0])}`, {cause: errors[0]});
			}
			finally {
				fixture.replaceChildren();
				state = null;
				try {
					if (!rafMode) realm.benchmarkWebGL?.reset();
					await settle();
				}
				finally { busy = false; }
			}
		},
	};
	async function runBenchmarkTrace({raf = false} = {}) {
		const {config, ...report} = benchmarkLifecycle.begin({raf});
		const samples = [], frameIntervalsMs = [];
		if (raf) {
			let previous = await nextFrame();
			for (let i = 0; i < 16; i++) {
				const now = await nextFrame();
				frameIntervalsMs.push(now - previous);
				previous = now;
			}
		}
		const boundary = phase => realm.benchmarkSampleBoundary?.(JSON.stringify({phase, variant}));
		for (let round = -WARMUPS; round < ROUNDS; round++) {
			const phases = [];
			boundary('start');
			try {
				await benchmarkLifecycle.setup(variant, `sample-${sampleIndex}`);
				for (const operation of OPERATIONS) {
					if (phases.length) { boundary('end'); boundary('start'); }
					await benchmarkLifecycle.prepare(operation, phases.length ? `sample-${sampleIndex}` : state.id);
					phases.push({...await benchmarkLifecycle.construct(), round, warmup: round < 0});
				}
				samples.push({...phases[1], phases});
			}
			finally {
				boundary('end');
				boundary('start');
				try { await benchmarkLifecycle.destroy(); }
				finally { boundary('end'); }
			}
		}
		return {...report, ...config, lifecycle: report.lifecycle, samples,
			raf: {enabled: raf, startAligned: raf, frameIntervalsMs, clock: 'performance.now() at callback entry'}};
	}
	return {benchmarkLifecycle, runBenchmarkTrace};
}
