const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const methodInput = document.querySelector('#method');
const snapInput = document.querySelector('#snap');
const runButton = document.querySelector('#run');
const status = document.querySelector('#status');
const dimensions = document.querySelector('#dimensions');
const resultsBody = document.querySelector('#results');
const palette = [
	['rgba(52, 152, 219, 0.3)', 'rgb(52, 152, 219)'],
	['rgba(231, 76, 60, 0.3)', 'rgb(231, 76, 60)'],
	['rgba(155, 89, 182, 0.3)', 'rgb(155, 89, 182)'],
	['rgba(46, 204, 113, 0.3)', 'rgb(46, 204, 113)'],
	['rgba(241, 196, 15, 0.3)', 'rgb(241, 196, 15)'],
];
const nextFrame = () => new Promise(requestAnimationFrame);
let dpr = window.devicePixelRatio || 1;
let dprQuery;
let revision = 0;
let running = false;
let pending = false;
let preview;
let previewFrame = 0;

function makeCache(ratio) {
	// One transparent device pixel on each side prevents filtering into adjacent atlas cells.
	const size = Math.ceil(8 * ratio) + 2;
	const sprites = palette.map(([fill, stroke]) => {
		const sprite = new OffscreenCanvas(size, size);
		const context = sprite.getContext('2d');
		context.beginPath();
		context.arc(size / 2, size / 2, 3.5 * ratio, 0, Math.PI * 2);
		context.fillStyle = fill;
		context.fill();
		context.lineWidth = ratio;
		context.strokeStyle = stroke;
		context.stroke();
		return sprite;
	});
	const atlas = new OffscreenCanvas(size * palette.length, size);
	const context = atlas.getContext('2d');
	for (let i = 0; i < sprites.length; i++)
		context.drawImage(sprites[i], i * size, 0);
	return { size, sprites, atlas };
}

function seededRandom() {
	let state = 123456789;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

function makeFixture(count, cache, width, height, snap) {
	const random = seededRandom();
	const dots = Array.from({ length: count }, () => {
		const color = Math.floor(random() * palette.length);
		return { atlasX: color * cache.size, sprite: cache.sprites[color] };
	});
	// Reuse a position pool. Both methods receive exactly the same moving frames.
	const frames = Array.from({ length: 16 }, () => {
		const positions = new Float64Array(count * 2);
		for (let i = 0; i < positions.length; i += 2) {
			const x = random() * width - cache.size / 2;
			const y = random() * height - cache.size / 2;
			positions[i] = snap ? Math.round(x) : x;
			positions[i + 1] = snap ? Math.round(y) : y;
		}
		return positions;
	});
	return { cache, dots, frames, width, height };
}

function drawAtlas(context, fixture, positions) {
	const { cache, dots, width, height } = fixture;
	const { atlas, size } = cache;
	context.clearRect(0, 0, width, height);
	for (let i = 0; i < dots.length; i++)
		context.drawImage(atlas, dots[i].atlasX, 0, size, size, positions[i * 2], positions[i * 2 + 1], size, size);
}

function drawSprites(context, fixture, positions) {
	const { dots, width, height } = fixture;
	context.clearRect(0, 0, width, height);
	for (let i = 0; i < dots.length; i++)
		context.drawImage(dots[i].sprite, positions[i * 2], positions[i * 2 + 1]);
}

const methods = { atlas: drawAtlas, sprites: drawSprites };

function drawPreview() {
	methods[methodInput.value](ctx, preview, preview.frames[previewFrame % preview.frames.length]);
}

function resizePreview() {
	if (running)
		return;
	const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
	const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
	if (canvas.width !== width)
		canvas.width = width;
	if (canvas.height !== height)
		canvas.height = height;
	const cache = preview?.ratio === dpr ? preview.cache : makeCache(dpr);
	preview = { ...makeFixture(100, cache, width, height, snapInput.checked), ratio: dpr };
	dimensions.textContent = `Cached DPR: ${dpr} · backing canvas: ${width} × ${height} device pixels`;
	drawPreview();
}

function watchDpr() {
	dprQuery?.removeEventListener('change', refreshDpr);
	dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
	dprQuery.addEventListener('change', refreshDpr);
}

function refreshDpr() {
	const next = window.devicePixelRatio || 1;
	if (next !== dpr) {
		dpr = next;
		revision++;
		watchDpr();
		resizePreview();
	}
}

watchDpr();
window.addEventListener('resize', refreshDpr);
new ResizeObserver(() => {
	revision++;
	resizePreview();
}).observe(canvas);
document.addEventListener('visibilitychange', () => revision++);

canvas.addEventListener('pointermove', () => {
	if (running || pending)
		return;
	pending = true;
	requestAnimationFrame(() => {
		pending = false;
		if (!running) {
			// Keep the interactive preview random, independent of the seeded benchmark pool.
			const positions = preview.frames[0];
			for (let i = 0; i < positions.length; i += 2) {
				const x = Math.random() * preview.width - preview.cache.size / 2;
				const y = Math.random() * preview.height - preview.cache.size / 2;
				positions[i] = snapInput.checked ? Math.round(x) : x;
				positions[i + 1] = snapInput.checked ? Math.round(y) : y;
			}
			previewFrame = 0;
			drawPreview();
		}
	});
});
methodInput.addEventListener('change', drawPreview);
snapInput.addEventListener('change', resizePreview);

function comparePixels(fixture) {
	const images = Object.values(methods).map(draw => {
		const surface = new OffscreenCanvas(fixture.width, fixture.height);
		const context = surface.getContext('2d');
		draw(context, fixture, fixture.frames[0]);
		return context.getImageData(0, 0, fixture.width, fixture.height).data;
	});
	let differentChannels = 0;
	let maxDelta = 0;
	for (let i = 0; i < images[0].length; i++) {
		const delta = Math.abs(images[0][i] - images[1][i]);
		if (delta !== 0) {
			differentChannels++;
			maxDelta = Math.max(maxDelta, delta);
		}
	}
	return { differentChannels, maxDelta };
}

function percentile(values, fraction) {
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function summarize(samples) {
	return {
		medianMs: percentile(samples.cpu, 0.5),
		p95Ms: percentile(samples.cpu, 0.95),
		frameMedianMs: percentile(samples.frames, 0.5),
		frameP95Ms: percentile(samples.frames, 0.95),
		samples,
	};
}

function showResult(row) {
	const tr = document.createElement('tr');
	const pair = (a, b) => `${a.toFixed(3)} / ${b.toFixed(3)}`;
	for (const value of [
		`${row.dpr} / ${row.count.toLocaleString()}`,
		pair(row.atlas.medianMs, row.atlas.p95Ms),
		pair(row.sprites.medianMs, row.sprites.p95Ms),
		row.changePercent == null ? 'Below timer resolution' : `${row.changePercent.toFixed(1)}%`,
		pair(row.atlas.frameMedianMs, row.atlas.frameP95Ms),
		pair(row.sprites.frameMedianMs, row.sprites.frameP95Ms),
		`${row.pixels.differentChannels} channels (max Δ ${row.pixels.maxDelta})`,
	]) {
		const td = document.createElement('td');
		td.textContent = value;
		tr.append(td);
	}
	resultsBody.append(tr);
}

async function runBenchmark() {
	if (running)
		throw Error('A benchmark is already active.');
	if (document.hidden)
		throw Error('The benchmark tab must be visible.');
	running = true;
	for (const control of [runButton, methodInput, snapInput])
		control.disabled = true;
	resultsBody.replaceChildren();
	const startRevision = revision;
	const cssWidth = canvas.clientWidth;
	const cssHeight = canvas.clientHeight;
	const warmups = 30;
	const trials = 6;
	const framesPerTrial = 20;
	const report = {
		userAgent: navigator.userAgent,
		nativeDpr: dpr,
		cssWidth, cssHeight,
		snap: snapInput.checked,
		crossOriginIsolated,
		warmups, trials, framesPerTrial,
		limitations: 'CPU times measure clear/draw submission, not completed GPU work. Frame intervals include refresh limits and scheduling. Positions and caches are precomputed. Pixel readback uses separate canvases. DPR cases change backing resolution, not the display scale.',
		results: [],
	};
	const assertStable = () => {
		if (revision !== startRevision || document.hidden)
			throw Error('The canvas size, DPR, or tab visibility changed. Run the benchmark again.');
	};
	try {
		for (const ratio of [1, 1.25, 2]) {
			canvas.width = Math.round(cssWidth * ratio);
			canvas.height = Math.round(cssHeight * ratio);
			const cache = makeCache(ratio);
			for (const count of [100, 1000, 10000]) {
				assertStable();
				status.textContent = `DPR ${ratio}, ${count.toLocaleString()} dots…`;
				const fixture = makeFixture(count, cache, canvas.width, canvas.height, report.snap);
				const pixels = comparePixels(fixture);
				const samples = { atlas: { cpu: [], frames: [] }, sprites: { cpu: [], frames: [] } };
				async function block(name, length, record, frameOffset = 0) {
					const draw = methods[name];
					let previous = await nextFrame();
					for (let i = 0; i < length; i++) {
						assertStable();
						const positions = fixture.frames[(frameOffset + i) % fixture.frames.length];
						const start = performance.now();
						draw(ctx, fixture, positions);
						const cpuMs = performance.now() - start;
						const next = await nextFrame();
						if (record) {
							samples[name].cpu.push(cpuMs);
							samples[name].frames.push(next - previous);
						}
						previous = next;
					}
				}
				await block('atlas', warmups, false);
				await block('sprites', warmups, false);
				for (let trial = 0; trial < trials; trial++) {
					const order = trial % 2 === 0 ? ['atlas', 'sprites'] : ['sprites', 'atlas'];
					for (const name of order)
						await block(name, framesPerTrial, true, trial * framesPerTrial);
				}
				assertStable();
				const atlas = summarize(samples.atlas);
				const sprites = summarize(samples.sprites);
				const row = {
					dpr: ratio, count, atlas, sprites, pixels,
					changePercent: atlas.medianMs === 0 ? null : (sprites.medianMs / atlas.medianMs - 1) * 100,
				};
				report.results.push(row);
				showResult(row);
			}
		}
		status.textContent = 'Complete. Results are also available in window.spriteBenchmarkReport.';
		window.spriteBenchmarkReport = report;
		return report;
	}
	catch (error) {
		status.textContent = error.message;
		throw error;
	}
	finally {
		running = false;
		for (const control of [runButton, methodInput, snapInput])
			control.disabled = false;
		resizePreview();
	}
}

runButton.addEventListener('click', () => runBenchmark().catch(console.error));
window.runSpriteBenchmark = runBenchmark;
resizePreview();
// Let the initial ResizeObserver delivery finish before an automated run starts.
window.spriteBenchmarkReady = nextFrame().then(nextFrame);
