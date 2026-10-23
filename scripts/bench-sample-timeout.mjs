export const SAMPLE_TIMEOUT_MS = 5000;
export const SAMPLE_TIMEOUT_EXIT_CODE = 124;

export function createSampleWatchdog(onTimeout, {timeoutMs = SAMPLE_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
	if (typeof onTimeout !== 'function')
		throw new TypeError('onTimeout must be a function');
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
		throw new TypeError('timeoutMs must be positive and finite');

	let controller;
	let timer;
	return {
		start(variant) {
			if (controller)
				throw new Error('Sample watchdog is already active');
			const active = controller = new AbortController();
			timer = setTimer(() => {
				if (controller !== active || active.signal.aborted)
					return;
				const error = Object.assign(new Error(`${variant}: timed out after ${timeoutMs / 1000}s`), {
					code: 'BENCHMARK_SAMPLE_TIMEOUT', variant, timeoutMs,
				});
				active.abort(error);
				// Browser termination must not wait for pending operations or replace the timeout.
				try {
					Promise.resolve(onTimeout(error)).catch(() => {});
				}
				catch {}
			}, timeoutMs);
			return active.signal;
		},
		stop() {
			clearTimer(timer);
			timer = undefined;
			controller = undefined;
		},
	};
}

export function abortable(operation, signal) {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, {once: true});
		try {
			Promise.resolve(operation()).then(value => {
				cleanup();
				resolve(value);
			}, error => {
				cleanup();
				reject(error);
			});
		}
		catch (error) {
			cleanup();
			reject(error);
		}
	});
}
