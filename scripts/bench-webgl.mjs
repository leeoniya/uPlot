// Install before library scripts. Call begin() before sample preparation, then complete()
// after library readiness and settling, after js-end but BEFORE the sample end marker.
// Register reused contexts with track(gl) if the library does not call getContext again.
// This observes context acquisition, not draw calls. No readbacks or GPU timer queries.
// complete({webgl1Finish: true}) opts into blocking WebGL1 finish(); the default is false.
// Keep completion outside measured init and inside the chart window, never in rAF-only runs.
// Thread-wall totals include finish waits, fence submission/polling, and context-info queries.
// timeoutMs limits the fence polling budget; it cannot interrupt a blocking GL call.
export function createWebGLCapture(realm = globalThis) {
	const patches = [];
	const contexts = new Map();
	let active = false;
	let pending = false;
	let disposed = false;

	function track(gl, type = typeof gl?.fenceSync === 'function' ? 'webgl2' : 'webgl') {
		if (active && gl && ['webgl', 'experimental-webgl', 'webgl2'].includes(type) && !contexts.has(gl))
			contexts.set(gl, {index: contexts.size, type});
		return gl;
	}

	function restore() {
		for (const {prototype, descriptor, wrapper} of patches) {
			// Do not overwrite a wrapper installed by the application after ours.
			if (prototype.getContext === wrapper)
				Object.defineProperty(prototype, 'getContext', descriptor);
		}
	}

	try {
		for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
			const prototype = realm[name]?.prototype;
			const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'getContext');
			if (!descriptor || typeof descriptor.value !== 'function')
				continue;
			const original = descriptor.value;
			function wrapper(...args) {
				return track(Reflect.apply(original, this, args), args[0]);
			}
			Object.defineProperty(prototype, 'getContext', {...descriptor, value: wrapper});
			patches.push({name, prototype, descriptor, wrapper});
		}
	}
	catch (error) {
		restore();
		throw error;
	}

	function contextInfo(gl) {
		const info = {renderer: null, version: null, unmaskedRenderer: null};
		const read = parameter => {
			try {
				const value = gl.getParameter(parameter);
				return typeof value === 'string' ? value : null;
			}
			catch { return null; }
		};
		try {
			if (!gl.isContextLost()) {
				info.renderer = read(gl.RENDERER);
				info.version = read(gl.VERSION);
				const debug = gl.getExtension?.('WEBGL_debug_renderer_info');
				if (debug)
					info.unmaskedRenderer = read(debug.UNMASKED_RENDERER_WEBGL);
			}
		}
		catch { /* Optional context metadata must not invalidate completion evidence. */ }
		return info;
	}

	return {
		begin() {
			if (disposed || active || pending)
				throw new Error('WebGL capture requires an inactive, installed observer.');
			active = true;
		},
		track,
		reinstall() {
			if (disposed || active || pending || contexts.size)
				throw new Error('WebGL observer reinstallation requires an inactive, empty capture.');
			// A vendor can wrap getContext during runtime setup. Keep its wrapper,
			// retire this observer, and observe the contexts returned by that wrapper.
			this.dispose();
			return createWebGLCapture(realm);
		},
		reset() {
			if (pending)
				throw new Error('Cannot reset WebGL capture while fences are pending.');
			contexts.clear();
			active = false;
		},
		dispose() {
			this.reset();
			restore();
			disposed = true;
		},
		async complete({timeoutMs = 5000, pollIntervalMs = 4, webgl1Finish = false, retainContexts = false} = {}) {
			if (disposed || !active || pending)
				throw new Error('WebGL completion requires an active sample without pending fences.');
			if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0)
				throw new TypeError('WebGL timeout and poll interval must be positive and finite.');
			if (typeof webgl1Finish !== 'boolean')
				throw new TypeError('webgl1Finish must be a boolean.');
			pending = true;
			const start = realm.performance.now();
			const deadline = start + timeoutMs;
			const entries = [...contexts].map(([gl, info]) => ({gl, sync: null, result: {...info,
								method: info.type === 'webgl2' ? 'fence' : webgl1Finish ? 'finish' : null, status: 'pending'}}));
			const finish = (entry, status) => {
				entry.result.status = status;
				entry.result.waitMs = realm.performance.now() - start;
			};
			try {
				// Submit every WebGL2 fence before blocking on WebGL1 or polling any fence.
				for (const entry of entries) {
					const {gl, result} = entry;
					try {
						if (gl.isContextLost())
							finish(entry, 'context-lost');
						else if (result.method === null)
							finish(entry, 'unsupported-webgl1');
						else if (result.method === 'fence') {
							entry.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
							if (entry.sync === null)
								finish(entry, 'fence-failed');
							else
								gl.flush();
						}
					}
					catch {
						finish(entry, result.method === 'finish' ? 'finish-error' : 'fence-error');
					}
				}
				for (const entry of entries) {
					if (entry.result.method !== 'finish' || entry.result.status !== 'pending')
						continue;
					const {gl, result} = entry;
					try {
						if (gl.isContextLost()) {
							finish(entry, 'context-lost');
							continue;
						}
						const blockingStart = realm.performance.now();
						try { gl.finish(); }
						finally { result.blockingMs = realm.performance.now() - blockingStart; }
						finish(entry, gl.isContextLost() ? 'context-lost' : 'complete');
					}
					catch {
						finish(entry, 'finish-error');
					}
				}
				while (entries.some(entry => entry.result.status === 'pending')) {
					// Yield a task, not just a microtask: WebGL sync status needs browser progress.
					await new Promise(resolve => realm.setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - realm.performance.now()))));
					for (const entry of entries) {
						if (entry.result.status !== 'pending')
							continue;
						const {gl, sync} = entry;
						try {
							if (gl.isContextLost())
								finish(entry, 'context-lost');
							else if (realm.performance.now() >= deadline)
								finish(entry, 'timeout');
							else {
								const status = gl.clientWaitSync(sync, 0, 0);
								if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED)
									finish(entry, 'complete');
								else if (status !== gl.TIMEOUT_EXPIRED)
									finish(entry, 'wait-failed');
							}
						}
						catch {
							finish(entry, 'wait-error');
						}
					}
				}
				// Query strings once, after completion checks, not during init or per draw.
				const results = entries.map(entry => ({...entry.result, contextInfo: contextInfo(entry.gl)}));
				for (const info of contexts.values()) {
					if (info.index >= entries.length)
						results.push({...info, method: null, status: 'not-fenced'});
				}
				const observerIntact = patches.every(({prototype, wrapper}) => prototype.getContext === wrapper);
				return {
					status: !observerIntact ? 'incomplete' : results.length === 0 ? 'not-observed'
						: results.every(result => result.status === 'complete') ? 'complete' : 'incomplete',
					waitMs: realm.performance.now() - start,
					timeoutMs, pollIntervalMs, webgl1Finish, contexts: results,
					coverage: {getContext: patches.map(patch => patch.name), observerIntact,
						scope: retainContexts
							? 'Current realm acquisitions since session reset plus explicit track() calls. Contexts remain tracked for subsequent operations. Workers and other realms require their own observer.'
							: 'Current realm acquisitions during this sample plus explicit track() calls. Workers and other realms require their own observer.'},
					completion: 'Only commands submitted before each fence or finish call. Not later draws, compositor presentation, GPU busy time, or proof of hardware acceleration.',
					timing: 'waitMs is elapsed validation latency from batch start, not GPU execution time. Context waitMs ends at its completion check; batch waitMs also includes context-info queries. blockingMs measures the finish call wall duration.',
					methods: {
						fence: 'WebGL2 fenceSync and flush, followed by timer-based zero-timeout clientWaitSync polling. Submission and polling add overhead and can change scheduling.',
						finish: 'Opt-in WebGL1 finish blocks the calling thread until prior commands complete. timeoutMs cannot interrupt finish or other blocking GL calls; the caller needs an external browser watchdog.',
					},
					overhead: 'Run after library readiness and settling, outside measured init but inside the chart window. Trace thread-wall totals include blocking finish waits, fence submission/polling, and context-info queries. These totals are not CPU-active time or GPU busy time.',
					contextInfo: 'Raw GL renderer/version strings and optional WEBGL_debug_renderer_info renderer, queried at completion. Null means unavailable. Strings can be masked and do not establish hardware acceleration.',
				};
			}
			finally {
				for (const {gl, sync} of entries) {
					if (sync !== null) {
						try { gl.deleteSync(sync); }
						catch { /* A lost context must not prevent the other syncs from being deleted. */ }
					}
				}
				if (!retainContexts)
					contexts.clear();
				active = pending = false;
			}
		},
	};
}
