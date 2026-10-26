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
	globalThis.benchmarkMoveMouse = (x, y) => new Promise((resolve, reject) => {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			reject(new Error('Mouse coordinates must be finite.'));
			return;
		}
		const id = ++serial;
		pending.set(id, {resolve, reject});
		try { globalThis.benchmarkMouseInput(JSON.stringify({id, x, y})); }
		catch (error) { pending.delete(id); reject(error); }
	});
}

export async function installBenchmarkMouseInput(page) {
	let stopped = false;
	const listener = event => {
		let message;
		try { message = JSON.parse(event.data); }
		catch { return; }
		if (stopped || message.method !== 'Runtime.bindingCalled' || message.params.name !== 'benchmarkMouseInput') return;
		const {executionContextId, payload} = message.params;
		void (async () => {
			let id;
			let error;
			try {
				const request = JSON.parse(payload);
				id = request.id;
				if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(request.x) || !Number.isFinite(request.y))
					throw new Error('Invalid benchmark mouse input.');
				await page.send('Input.dispatchMouseEvent', {
					type: 'mouseMoved', x: request.x, y: request.y, button: 'none', buttons: 0, pointerType: 'mouse',
				});
			}
			catch (cause) { error = cause.message ?? String(cause); }
			if (!stopped && Number.isSafeInteger(id)) {
				await page.send('Runtime.evaluate', {
					contextId: executionContextId,
					expression: `globalThis.benchmarkMouseAck(${id}, ${JSON.stringify(error ?? null)})`,
				}).catch(() => {}); // Navigation/timeout discards the page and its pending requests.
			}
		})();
	};
	page.socket.addEventListener('message', listener);
	try {
		await page.send('Runtime.addBinding', {name: 'benchmarkMouseInput'});
		await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `(${browserMouseInput.toString()})()`});
	}
	catch (error) {
		page.socket.removeEventListener('message', listener);
		throw error;
	}
	return () => {
		stopped = true;
		page.socket.removeEventListener('message', listener);
	};
}
