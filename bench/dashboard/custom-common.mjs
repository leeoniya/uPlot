import {WIDTH, HEIGHT, SERIES} from './common.mjs';

let nextId = 0;
export const done = wait => { if (wait) wait.textContent = 'Done!'; };
export const pixelRatio = () => globalThis.devicePixelRatio || 1;

export function handle(host, name, legend = true) {
	const element = host.ownerDocument.createElement('div');
	do { element.id = `dashboard-custom-${++nextId}`; } while (host.ownerDocument.getElementById(element.id));
	Object.assign(element.style, {position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT}px`, overflow: 'hidden'});
	host.append(element);
	const chart = {name, element, destroyed: false, error: null, cleanups: []};
	let rejectFailure;
	chart.failure = new Promise((_, reject) => { rejectFailure = reject; });
	chart.failure.catch(() => {});
	chart.fail = error => {
		if (!chart.error) {
			chart.error = error instanceof Error ? error : new Error(String(error));
			rejectFailure(chart.error);
		}
	};
	if (legend) {
		const key = host.ownerDocument.createElement('div');
		Object.assign(key.style, {height: '24px', display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', font: '11px Arial, sans-serif'});
		for (const {label, color} of SERIES) {
			const entry = host.ownerDocument.createElement('span');
			entry.textContent = label;
			entry.style.color = color;
			key.append(entry);
		}
		element.append(key);
	}
	const plot = chart.plot = host.ownerDocument.createElement('div');
	Object.assign(plot.style, {position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT - (legend ? 24 : 0)}px`});
	plot.id = `${element.id}-plot`;
	element.append(plot);
	return chart;
}

export function live(chart) {
	if (chart.error) throw chart.error;
	if (chart.destroyed) throw new Error(`${chart.name}: chart is disposed.`);
	for (const gl of chart.getWebGLContexts?.() ?? []) checkGL(gl, chart.name);
}

export function checkGL(gl, name) {
	if (!gl || gl.isContextLost())
		throw new Error(`${name}: WebGL context unavailable or lost; the dashboard may exceed the browser context limit.`);
	const error = gl.getError();
	if (error !== gl.NO_ERROR) throw new Error(`${name}: WebGL error ${error}.`);
}

export function trackGL(chart, gl, canvas, owned = false) {
	chart.context = gl;
	chart.getWebGLContexts = () => chart.destroyed ? [] : [gl];
	const lost = () => chart.fail(new Error(`${chart.name}: WebGL context lost; the dashboard may exceed the browser context limit.`));
	canvas.addEventListener('webglcontextlost', lost);
	chart.cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));
	if (owned) chart.cleanups.push(() => gl.getExtension('WEBGL_lose_context')?.loseContext());
	checkGL(gl, chart.name);
}

// Register native events before action; every exit removes subscriptions and the timer.
// The event certifies native readiness only. Shared completion fences GPU resources.
export async function ready(chart, subscribe, action, timeoutMs = 30000) {
	live(chart);
	let cleanup = () => {}, timer;
	try {
		await Promise.race([chart.failure, new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`${chart.name}: native render readiness timed out; check graphics and licensing diagnostics.`)), timeoutMs);
			cleanup = subscribe(resolve, reject);
			action();
		})]);
		live(chart);
	}
	catch (error) { chart.fail(error); throw error; }
	finally { clearTimeout(timer); cleanup(); }
}

export function destroy(chart, disposers = []) {
	if (chart.destroyed) return;
	chart.destroyed = true;
	chart.fail(new Error(`${chart.name}: disposed before completion.`));
	const errors = [];
	for (const dispose of [...disposers, ...chart.cleanups, () => chart.element.remove()]) {
		try { dispose(); } catch (error) { errors.push(error); }
	}
	chart.cleanups.length = 0;
	if (errors.length) throw new AggregateError(errors, `${chart.name}: cleanup failed.`, {cause: errors[0]});
}

export function failedCreation(chart, error, dispose) {
	try { dispose(chart); }
	catch (cleanupError) { throw new AggregateError([error, cleanupError], `${chart.name}: initialization and cleanup failed.`, {cause: error}); }
	throw error;
}

export function countSeries(series, rows, count) {
	if (series.length !== SERIES.length || series.some((s, i) => count(s, i) !== rows))
		throw new Error(`Dashboard native data must contain five series of ${rows} points.`);
}

export function valuesEqual(length, x, y, expectedX, expectedY) {
	if (length !== expectedX.length || length !== expectedY.length)
		throw new Error('Dashboard native data length differs from input.');
	for (let i = 0; i < length; i++) {
		if (x(i) !== expectedX[i] || y(i) !== expectedY[i])
			throw new Error(`Dashboard native data differs from input at row ${i}.`);
	}
}
