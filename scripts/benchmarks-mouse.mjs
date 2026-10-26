import {setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout} from 'node:timers';
import {performance} from 'node:perf_hooks';

// Installed before the fixture. CDP supplies trusted browser mouse input, not
// synthetic dispatchEvent calls or direct tooltip APIs.
export function browserMouseInput() {
	let serial = 0;
	const pending = new Map();
	globalThis.benchmarkMouseAck = (id, error) => {
		const request = pending.get(id);
		if (!request) return;
		pending.delete(id);
		error ? request.reject(new Error(error)) : request.resolve();
	};
	const send = (data, resolve, reject) => {
		const id = ++serial;
		pending.set(id, {resolve, reject});
		try { globalThis.benchmarkMouseInput(JSON.stringify({id, ...data})); }
		catch (error) { pending.delete(id); reject(error); }
	};
	globalThis.benchmarkMoveMouse = (x, y) => new Promise((resolve, reject) => {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			reject(new Error('Mouse coordinates must be finite.'));
			return;
		}
		send({x, y}, resolve, reject);
	});
	globalThis.benchmarkMoveMouseBatch = targets => new Promise((resolve, reject) => {
		if (!Array.isArray(targets) || targets.length !== 10)
			throw new Error('Mouse batch must contain exactly 10 targets.');
		const coordinates = [];
		for (let i = 0; i < 10; i++) {
			const {x, y} = targets[i] ?? {};
			if (!Number.isFinite(x) || !Number.isFinite(y))
				throw new Error('Mouse coordinates must be finite.');
			coordinates.push({x, y});
		}
		send({targets: coordinates, intervalMs: 50}, resolve, reject);
	});
}

export async function installBenchmarkMouseInput(page, {setTimeout = nodeSetTimeout, clearTimeout = nodeClearTimeout, now = () => performance.now()} = {}) {
	let stopped = false;
	const active = new Set();
	const cancel = job => {
		job.cancelled = true;
		job.wake?.();
		active.delete(job);
	};
	const wait = job => new Promise(resolve => {
		const deadline = now() + 50;
		let timer;
		const check = () => {
			const remaining = deadline - now();
			// Node timers can fire early; only the monotonic deadline ends the wait.
			if (remaining > 0) timer = setTimeout(check, Math.ceil(remaining));
			else { job.wake = null; resolve(); }
		};
		job.wake = () => { clearTimeout(timer); job.wake = null; resolve(); };
		check();
	});
	const listener = event => {
		let message;
		try { message = JSON.parse(event.data); }
		catch { return; }
		if (stopped || !message) return;
		const {method, params} = message;
		if (method === 'Runtime.executionContextDestroyed' || method === 'Runtime.executionContextsCleared' || method === 'Page.frameNavigated') {
			// Input is page-wide: never continue old coordinates in a new document.
			for (const job of active)
				if (method !== 'Runtime.executionContextDestroyed' || job.contextId === params?.executionContextId)
					cancel(job);
			return;
		}
		if (method !== 'Runtime.bindingCalled' || params?.name !== 'benchmarkMouseInput') return;
		const {executionContextId, payload} = params;
		const job = {contextId: executionContextId, cancelled: false, wake: null};
		active.add(job);
		void (async () => {
			let id;
			let error;
			try {
				const request = JSON.parse(payload);
				id = request.id;
				const batch = 'targets' in request;
				const targets = batch ? request.targets : [request];
				if (!Number.isSafeInteger(id) || id <= 0 ||
					(batch && (!Array.isArray(targets) || targets.length !== 10 || request.intervalMs !== 50)) ||
					!targets.every(target => target && Number.isFinite(target.x) && Number.isFinite(target.y)))
					throw new Error('Invalid benchmark mouse input.');
				for (let i = 0; i < targets.length; i++) {
					if (job.cancelled) break;
					const {x, y} = targets[i];
					await page.send('Input.dispatchMouseEvent', {
						type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse',
					});
					if (job.cancelled) break;
					if (batch && i < targets.length - 1) await wait(job);
				}
			}
			catch (cause) { error = String(cause?.message ?? cause); }
			try {
				if (!job.cancelled && Number.isSafeInteger(id)) {
					await page.send('Runtime.evaluate', {
						contextId: executionContextId,
						expression: `globalThis.benchmarkMouseAck(${id}, ${JSON.stringify(error ?? null)})`,
					});
				}
			}
			catch {} // Navigation/timeout discards the page and its pending requests.
			finally { active.delete(job); }
		})();
	};
	const stop = () => {
		stopped = true;
		page.socket.removeEventListener('message', listener);
		for (const job of active) cancel(job);
	};
	page.socket.addEventListener('message', listener);
	try {
		await page.send('Runtime.addBinding', {name: 'benchmarkMouseInput'});
		await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `(${browserMouseInput.toString()})()`});
	}
	catch (error) {
		stop();
		throw error;
	}
	return stop;
}
