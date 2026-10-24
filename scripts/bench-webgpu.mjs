// Inject with toString(); this factory has no module dependencies or GPU probes.
export function createWebGPUCapture(realm = globalThis) {
	// Pending promises cannot be unsubscribed. Their callbacks retain only a cleared
	// slot after completion, never the sample, devices, or batch completion closure.
	function observe(promise, slot, success, failure) {
		promise.then(value => slot.notify?.(success, value), error => slot.notify?.(failure, error));
	}

	function errorListener(slot) {
		return event => slot.notify?.('uncaptured-error', event.error);
	}

	return {
		async complete(devices = [], {timeoutMs = 1000} = {}) {
			if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
				throw new TypeError('WebGPU timeout must be positive and finite.');
			const start = realm.performance.now();
			const entries = [...new Set(devices)].map((device, index) => ({device, slot: {notify: null}, onError: null,
				result: {index, method: 'queue.onSubmittedWorkDone', status: 'pending'}}));
			let timer;
			let finish;
			const done = new Promise(resolve => { finish = resolve; });
			const update = (entry, status, detail) => {
				if (entry.result.status !== 'pending' && status === 'complete') return;
				entry.result.status = status;
				entry.result.waitMs = realm.performance.now() - start;
				if (status !== 'complete' && detail != null)
					entry.result.error = String(detail.message ?? detail);
				if (status !== 'complete' || entries.every(entry => entry.result.status === 'complete'))
					finish();
			};
			try {
				if (entries.length) {
					timer = realm.setTimeout(() => {
						for (const entry of entries)
							if (entry.result.status === 'pending') update(entry, 'timeout');
					}, timeoutMs);
					// Register loss/error handlers and fence every actual device before awaiting.
					for (const entry of entries) {
						const {device, slot} = entry;
						slot.notify = (status, detail) => update(entry, status, detail);
						try {
							if (typeof device?.queue?.onSubmittedWorkDone !== 'function' ||
								typeof device.lost?.then !== 'function' ||
								typeof device.addEventListener !== 'function' || typeof device.removeEventListener !== 'function') {
								update(entry, 'invalid-device');
								continue;
							}
							entry.onError = errorListener(slot);
							device.addEventListener('uncapturederror', entry.onError);
							observe(device.lost, slot, 'device-lost', 'device-lost');
							const work = device.queue.onSubmittedWorkDone();
							if (typeof work?.then !== 'function') update(entry, 'queue-error');
							else observe(work, slot, 'complete', 'queue-error');
						}
						catch (error) { update(entry, 'queue-error', error); }
					}
					await done;
				}
				for (const entry of entries)
					if (entry.result.status === 'pending') update(entry, 'not-completed');
				return {
					status: entries.length === 0 ? 'not-observed'
						: entries.every(entry => entry.result.status === 'complete') ? 'complete' : 'incomplete',
					waitMs: realm.performance.now() - start, timeoutMs,
					devices: entries.map(entry => entry.result),
					coverage: 'Only actual devices explicitly returned by the chart adapter. No probes or device requests.',
					completion: 'Prior queue submissions only; not later draws, presentation, GPU execution time, or proof of hardware acceleration.',
					timing: 'Elapsed completion wait after settling, outside init and inside the trace/memory chart window.',
				};
			}
			finally {
				realm.clearTimeout(timer);
				for (const entry of entries) entry.slot.notify = null;
				let cleanupError;
				for (const entry of entries) {
					try {
						if (entry.onError) entry.device.removeEventListener('uncapturederror', entry.onError);
					}
					catch (error) { cleanupError ??= error; }
					finally { entry.device = entry.onError = null; }
				}
				if (cleanupError) throw cleanupError;
			}
		},
	};
}
