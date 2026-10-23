// Standalone path sanity-check fixture, not used by benchmarks.mjs; /d3.js must load first.
const WIDTH = 1920;
const HEIGHT = 600;
const PADDING = [10, 70, 30, 55];
const WARMUPS = 3;
const ROUNDS = 7;
const BUILD_BATCH = 5;
const COLORS = ['red', 'blue', 'green'];
const LABELS = ['CPU', 'RAM', 'TCP Out'];
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

async function post(url, value) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(value),
	});
	if (!response.ok)
		throw new Error(`${url}: HTTP ${response.status}`);
}

function prepData(packed) {
	// Keep the field offsets and rounding identical to bench/D3.html.
	const numFields = packed[0];
	packed = packed.slice(numFields + 1);
	const len = packed.length / numFields;
	if (!Number.isInteger(len) || len !== 55550)
		throw new Error(`Expected 55,550 points per series, got ${len}`);
	const data = [Array(len), Array(len), Array(len), Array(len)];
	for (let i = 0, j = 0; i < packed.length; i += numFields, j++) {
		data[0][j] = packed[i] * 60 * 1000;
		data[1][j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		data[2][j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		data[3][j] = packed[i + 3];
	}
	if (!data.every(values => values.every(Number.isFinite)))
		throw new Error('This benchmark requires finite data without gaps.');
	return data;
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Wrappers forward to the native methods. Install them only for untimed counts.
function countCommands(target, run) {
	const counts = {moveTo: 0, lineTo: 0};
	const receivers = new WeakMap();
	let output;
	const saved = new Map();
	try {
		for (const name of Object.keys(counts)) {
			const original = target[name];
			saved.set(name, Object.getOwnPropertyDescriptor(target, name));
			Object.defineProperty(target, name, {
				configurable: true,
				writable: true,
				value: function(...args) {
					counts[name]++;
					let receiver = receivers.get(this);
					if (receiver == null)
						receivers.set(this, receiver = {moveTo: 0, lineTo: 0});
					receiver[name]++;
					return Reflect.apply(original, this, args);
				},
			});
		}
		output = run();
	}
	finally {
		for (const [name, descriptor] of saved) {
			if (descriptor)
				Object.defineProperty(target, name, descriptor);
			else
				delete target[name];
		}
	}
	return receivers.get(output) ?? counts;
}

async function runCase(uPlot, linear, fullLinear, d3, data, dpr) {
	const [xs, cpu, ram, tcp] = data;
	const xScale = d3.scaleTime().domain([xs[0], xs.at(-1)]).range([55, 1850]);
	const pctScale = d3.scaleLinear().domain([
		Math.min(d3.min(cpu), d3.min(ram)),
		Math.max(d3.max(cpu), d3.max(ram)),
	]).nice().range([570, 10]);
	const tcpScale = d3.scaleLinear().domain(d3.extent(tcp)).nice().range([570, 10]);
	const domains = {x: xScale.domain().map(Number), pct: pctScale.domain(), tcp: tcpScale.domain()};
	const host = document.createElement('div');
	document.body.append(host);
	let chart;
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH * dpr;
	canvas.height = HEIGHT * dpr;
	canvas.style.width = `${WIDTH}px`;
	canvas.style.height = `${HEIGHT}px`;
	host.append(canvas);
	const ctx = canvas.getContext('2d');
	if (!ctx)
		throw new Error('Native CanvasRenderingContext2D is unavailable.');

	try {
		chart = new uPlot({
			width: WIDTH,
			height: HEIGHT,
			pxRatio: dpr,
			ms: 1,
			padding: PADDING,
			axes: [{show: false}, {show: false}],
			legend: {show: false},
			cursor: {show: false},
			select: {show: false},
			scales: {
				x: {time: true, auto: false, range: () => domains.x},
				pct: {auto: false, range: () => domains.pct},
				tcp: {auto: false, range: () => domains.tcp},
			},
			series: [{}, ...COLORS.map((stroke, i) => ({
				label: LABELS[i], scale: i === 2 ? 'tcp' : 'pct',
				stroke, width: 1 / dpr, points: {show: false},
			}))],
		}, data, host);
		await yieldTask();

		const bbox = {left: 55 * dpr, top: 10 * dpr, width: 1795 * dpr, height: 560 * dpr};
		for (const key of Object.keys(bbox)) {
			if (chart.bbox[key] !== bbox[key])
				throw new Error(`DPR ${dpr}: unexpected plot ${key}: ${chart.bbox[key]}`);
		}
		for (const [key, domain] of Object.entries(domains)) {
			if (chart.scales[key].min !== domain[0] || chart.scales[key].max !== domain[1])
				throw new Error(`DPR ${dpr}: mismatched ${key} domain`);
		}

		const normalBuilder = linear();
		const rawBuilder = fullLinear();
		const pxRound = value => (Math.round(value * dpr) + 0.5) / dpr;
		const yScales = [pctScale, pctScale, tcpScale];
		const line = d3.line().defined(value => value != null)
			.x((value, i) => pxRound(xScale(xs[i])));

		function buildUPlot(builder, i) {
			const paths = builder(chart, i + 1, 0, xs.length - 1);
			if (!paths?.stroke || paths.clip || paths.band || chart.series[i + 1]._fill != null)
				throw new Error('Expected an unfilled native stroke path without gap/band clips.');
			return paths.stroke;
		}
		function buildD3(i, target) {
			line.context(target).y(value => pxRound(yScales[i](value)));
			line(data[i + 1]);
			return target;
		}
		const variants = [
			{id: 'uplot-decimated', units: 'device', build: i => buildUPlot(normalBuilder, i)},
			{id: 'uplot-full', units: 'device', build: i => buildUPlot(rawBuilder, i)},
			{id: 'd3-path2d-full', units: 'css', build: i => buildD3(i, new Path2D())},
		];
		for (const variant of variants)
			variant.cached = COLORS.map((_, i) => variant.build(i));

		let readbackByte = 0;
		let lastBuilt;
		function readback() {
			const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
			readbackByte ^= image.data[3];
		}
		function draw(units, paint, flush, join = 'round') {
			ctx.save();
			try {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.beginPath();
				ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
				ctx.clip();
				ctx.globalAlpha = 1;
				ctx.globalCompositeOperation = 'source-over';
				ctx.lineCap = 'butt';
				ctx.lineJoin = join;
				ctx.miterLimit = 10;
				ctx.setLineDash([]);
				ctx.lineDashOffset = 0;
				ctx.lineWidth = units === 'css' ? 1 / dpr : 1;
				if (units === 'css')
					ctx.scale(dpr, dpr);
				else
					ctx.translate(0.5, 0.5);
				paint();
			}
			finally {
				ctx.restore();
			}
			if (flush)
				readback();
		}
		function paintCached(variant) {
			for (let i = 0; i < COLORS.length; i++) {
				ctx.strokeStyle = COLORS[i];
				ctx.stroke(variant.cached[i]);
			}
		}
		function paintFresh(variant) {
			for (let i = 0; i < COLORS.length; i++) {
				const path = variant.build(i);
				ctx.strokeStyle = COLORS[i];
				ctx.stroke(path);
			}
		}
		function paintImmediate() {
			for (let i = 0; i < COLORS.length; i++) {
				ctx.beginPath();
				buildD3(i, ctx);
				ctx.strokeStyle = COLORS[i];
				ctx.stroke();
			}
		}

		const jobs = [];
		function add(variant, phase, batch, run, drawing = false) {
			jobs.push({id: `${variant}/${phase}`, variant, phase, batch, run, drawing, samplesMs: []});
		}
		for (const variant of variants) {
			add(variant.id, 'path2d-build', BUILD_BATCH, () => {
				lastBuilt = COLORS.map((_, i) => variant.build(i));
			});
			for (const flush of [false, true]) {
				add(variant.id, flush ? 'cached-stroke-readback' : 'cached-stroke-submit', 1,
					() => draw(variant.units, () => paintCached(variant), flush), true);
				add(variant.id, flush ? 'build-stroke-readback' : 'build-stroke-submit', 1,
					() => draw(variant.units, () => paintFresh(variant), flush), true);
			}
		}
		for (const [id, join] of [['d3-immediate-full', 'round'], ['d3-demo-miter-full', 'miter']]) {
			for (const flush of [false, true]) {
				add(id, flush ? 'build-stroke-readback' : 'build-stroke-submit', 1,
					() => draw('css', paintImmediate, flush, join), true);
			}
		}
		add('baseline', 'clear-readback', 1, () => draw('device', () => {}, true), true);

		const sampleOrder = [];
		for (let round = -WARMUPS; round < ROUNDS; round++) {
			// Rotate the first job as well as reversing traversal to spread order effects.
			const turn = round + WARMUPS;
			const offset = turn % jobs.length;
			const ordered = [...jobs.slice(offset), ...jobs.slice(0, offset)];
			if (turn % 2)
				ordered.reverse();
			if (round >= 0)
				sampleOrder.push(ordered.map(job => job.id));
			for (const job of ordered) {
				await yieldTask();
				// Drain prior submissions outside the timer, including before submission-only tests.
				if (job.drawing)
					readback();
				const start = performance.now();
				for (let n = 0; n < job.batch; n++)
					job.run();
				const elapsed = performance.now() - start;
				if (round >= 0)
					job.samplesMs.push(elapsed / job.batch);
				if (job.drawing)
					readback();
			}
		}

		// Verify actual raster output outside the measured samples; decimation is approximate.
		const rasterChecks = {};
		for (const variant of variants) {
			draw(variant.units, () => paintCached(variant), false);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			let nonzeroAlphaPixels = 0;
			for (let i = 3; i < pixels.length; i += 4)
				nonzeroAlphaPixels += pixels[i] > 0;
			if (nonzeroAlphaPixels === 0)
				throw new Error(`Empty raster output for ${variant.id}`);
			rasterChecks[variant.id] = {nonzeroAlphaPixels};
		}

		const commandCounts = {};
		for (const variant of [...variants, {id: 'd3-immediate-full', build: i => {
			ctx.beginPath();
			return buildD3(i, ctx);
		}}]) {
			const target = variant.id === 'd3-immediate-full' ? ctx : Path2D.prototype;
			const series = LABELS.map((label, i) => ({
				label, ...countCommands(target, () => variant.build(i)),
			}));
			commandCounts[variant.id] = {
				series,
				total: {
					moveTo: series.reduce((sum, s) => sum + s.moveTo, 0),
					lineTo: series.reduce((sum, s) => sum + s.lineTo, 0),
				},
			};
		}
		// Join style changes rasterization, not the immediate generator's path commands.
		commandCounts['d3-demo-miter-full'] = commandCounts['d3-immediate-full'];
		if (commandCounts['uplot-full'].total.lineTo !== xs.length * 3 ||
			commandCounts['uplot-decimated'].total.lineTo >= commandCounts['uplot-full'].total.lineTo)
			throw new Error('Command counts do not confirm full-resolution and decimated paths.');

		const measurements = jobs.map(({id, variant, phase, batch, samplesMs}) => ({
			id, variant, phase, batch, samplesMs, medianMs: median(samplesMs),
		}));
		const ratios = {};
		for (const phase of ['path2d-build', 'cached-stroke-submit', 'cached-stroke-readback',
			'build-stroke-submit', 'build-stroke-readback']) {
			const normal = measurements.find(m => m.variant === 'uplot-decimated' && m.phase === phase).medianMs;
			const raw = measurements.find(m => m.variant === 'uplot-full' && m.phase === phase).medianMs;
			ratios[phase] = {fullOverDecimated: normal > 0 ? raw / normal : null};
		}
		return {
			dpr, cssSize: [WIDTH, HEIGHT], canvasSize: [canvas.width, canvas.height],
			plotBoxDevicePixels: bbox, domains, pointsPerSeries: xs.length, seriesCount: 3,
			decimationThresholdPoints: bbox.width * 4,
			contextAttributes: ctx.getContextAttributes?.() ?? null,
			measurements, ratios, commandCounts, sampleOrder,
			checks: {matchingDomainsAndPlotBox: true, decimationConfirmed: true, rasterChecks,
				nativePaths: lastBuilt.every(path => path instanceof Path2D), readbackByte},
		};
	}
	finally {
		chart?.destroy();
		host.remove();
		canvas.width = canvas.height = 0;
	}
}

try {
	const started = performance.now();
	// Dynamic imports let module-load failures reach the runner's error endpoint.
	const [{default: uPlot}, {linear}, {linear: fullLinear}] = await Promise.all([
		import('/src/uPlot.js'),
		import('/src/paths/linear.js'),
		import('/src/paths/linear-full.js'),
	]);
	const d3 = globalThis.d3;
	if (!d3?.line || typeof Path2D !== 'function')
		throw new Error('Load /d3.js before this module; native Path2D is required.');
	const response = await fetch('/bench/data.json');
	if (!response.ok)
		throw new Error(`Data fetch: HTTP ${response.status}`);
	const data = prepData(await response.json());
	const cases = [];
	for (const dpr of [1, 2])
		cases.push(await runCase(uPlot, linear, fullLinear, d3, data, dpr));
	await post('/result', {
		userAgent: navigator.userAgent,
		hardwareConcurrency: navigator.hardwareConcurrency,
		actualDevicePixelRatio: devicePixelRatio,
		d3Version: d3.version,
		elapsedMs: performance.now() - started,
		warmups: WARMUPS, rounds: ROUNDS, buildBatch: BUILD_BATCH,
		timingUnit: 'milliseconds per operation over all three series',
		source: '/src/uPlot.js; linear-full.js is linear.js with only decimate forced false',
		cases,
		limitations: [
			'DPR 1 and 2 are explicit canvas/chart pixel ratios, not changes to the browser display DPR.',
			'This isolates series paths and drawing, not chart creation, axes, layout, interaction, data preparation, or frame rate.',
			'Path construction uses fresh native Path2D objects on one existing chart. Cached-stroke phases repeatedly reuse the same three paths and can benefit from browser path caches.',
			'Path2D build-stroke phases build and stroke all three fresh paths inside each timed operation. The primary rebuild comparison is build-stroke-readback, not a sum of independent build and cached-stroke medians.',
			'Submission timings include clear, clip, stroke state, and stroke calls but need not include deferred rasterization. Untimed readbacks drain work before and after drawing samples.',
			'Readback timings include a full-canvas getImageData allocation/copy and force rendering. The clear-readback baseline is reported separately, never subtracted.',
			'Repeated readback can affect the browser canvas backend. All drawing variants share one default native 2D context per DPR; willReadFrequently is not requested.',
			'D3 immediate mode follows the demo line generator, time/linear scales, rounding, and series order. All variants use the exact plot clip and butt caps. Controlled variants use round joins; d3-demo-miter-full uses the canvas default miter join and miter limit 10 for the faithful demo series reference. Join state is set inside each timed drawing operation.',
			'd3-demo-miter-full shares command counts with d3-immediate-full because only the stroke join differs.',
			'uPlot paths use integer device coordinates with a half-device-pixel translation. D3 paths use the demo CSS-coordinate rounding and a DPR transform. All strokes are one device pixel wide.',
			'D3 is full resolution, not a decimation implementation. Its Path2D build phase is an intermediate comparison, not the immediate-mode demo rendering path.',
			'Command counts are separate untimed native calls on the returned stroke paths, with restored wrappers. uPlot begins paths with lineTo; counts are API calls, not exact visible segment counts. Construction timings retain the stock builder overhead, including its unused fill-path clone.',
			'Fixed rotated/reversed order reduces order effects but does not eliminate JIT, garbage collection, timer quantization, scheduling, or machine-load noise. Ratios are ratios of medians.',
		],
	});
}
catch (error) {
	console.error(error);
	await post('/result', {error: `${error.message ?? error}\n${error.stack ?? ''}`});
}
