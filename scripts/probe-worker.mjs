import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function createProbeWorker({ cwd, helper, env = process.env, startupTimeout = 5000, shutdownTimeout = 5000 }) {
	let worker;
	let busy = false;
	let stopped = false;

	function start() {
		const args = [];
		if (process.versions.bun) {
			// Bun does not inherit the parent's --preload flag through NODE_OPTIONS.
			if (env.UPLOT_COVERAGE_DIR != null)
				args.push('--preload', fileURLToPath(new URL('./register-hooks.mjs', import.meta.url)));
		}
		else
			args.push('--max-old-space-size=128');
		args.push(helper);
		const posix = process.platform != 'win32';
		// exec preserves the child PID for SIGKILL; disable core dumps before starting Node.
		const child = spawn(posix ? 'sh' : process.execPath, posix
			? ['-c', 'ulimit -c 0 && exec "$@"', 'probe-worker', process.execPath, ...args]
			: args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
		const state = { child, output: '', pending: null, exit: null, stopping: false };

		function fail(message, code = 'EWORKER') {
			const error = new Error(message + (state.output ? '\n' + state.output.slice(-2000) : ''));
			error.code = code;
			state.pending?.reject(error);
		}

		state.wait = (type, name, timeout) => new Promise((resolve, reject) => {
			const phase = type == 'ready' ? 'startup' : `probe ${name}: execution`;
			const timer = setTimeout(() => {
				fail(`${phase} timeout (${timeout}ms)`, 'ETIMEDOUT');
				child.kill('SIGKILL');
			}, timeout);
			state.pending = {
				type, name,
				resolve(value) { clearTimeout(timer); state.pending = null; resolve(value); },
				reject(error) { clearTimeout(timer); state.pending = null; reject(error); },
			};
			if (state.exit)
				fail(`${phase}: worker already exited (status=${state.exit.status}, signal=${state.exit.signal})`);
		});

		state.send = message => {
			child.send(message, error => {
				if (error) {
					fail(`worker IPC error: ${error.message}`);
					child.kill('SIGKILL');
				}
			});
		};

		state.ready = state.wait('ready', null, startupTimeout);
		state.closed = new Promise(resolve => {
			child.on('close', (status, signal) => {
				state.exit = { status, signal };
				fail(`worker exited during ${state.pending?.name ?? 'startup'} (status=${status}, signal=${signal})`);
				resolve();
			});
		});
		child.on('error', error => { fail(`worker process error: ${error.message}`); });
		child.on('message', message => {
			const pending = state.pending;
			if (!pending || message?.type != pending.type || pending.type == 'result' && (message.name != pending.name || typeof message.ok != 'boolean')) {
				fail('unexpected worker message: ' + JSON.stringify(message));
				child.kill('SIGKILL');
			}
			else if (message.type == 'result' && !message.ok)
				fail(`probe ${message.name}: ${message.error}`, 'EPROBE');
			else
				pending.resolve(message.value);
		});
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding('utf8');
			stream.on('data', chunk => { state.output = (state.output + chunk).slice(-16 * 1024); });
		}
		return state;
	}

	async function stop(state, force = false) {
		if (!state.exit && !state.stopping) {
			state.stopping = true;
			if (force)
				state.child.kill('SIGKILL');
			else
				state.send({ type: 'stop' });
		}
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			state.child.kill('SIGKILL');
		}, shutdownTimeout);
		try { await state.closed; }
		finally { clearTimeout(timer); }
		if (timedOut)
			throw new Error(`worker shutdown timeout (${shutdownTimeout}ms)`);
		if (!force && (state.exit.status != 0 || state.exit.signal != null))
			throw new Error(`worker shutdown failed (status=${state.exit.status}, signal=${state.exit.signal})\n${state.output.slice(-2000)}`);
	}

	return {
		async run(name, timeout = 5000) {
			if (stopped)
				throw new Error('probe worker is closed');
			if (busy)
				throw new Error('probe worker only supports sequential requests');
			busy = true;
			const state = worker ??= start();
			try {
				await state.ready;
				state.output = '';
				const result = state.wait('result', name, timeout);
				state.send({ type: 'run', name });
				return await result;
			}
			catch (error) {
				// Assertion failures can exit cleanly and flush coverage. Hangs and crashes cannot.
				try { await stop(state, error.code != 'EPROBE'); }
				catch (shutdownError) { error.message += '\n' + shutdownError.message; }
				worker = null;
				throw error;
			}
			finally { busy = false; }
		},
		async close() {
			stopped = true;
			if (worker) {
				const state = worker;
				worker = null;
				await stop(state, busy);
			}
		},
	};
}

export function serveProbes(probes) {
	if (!process.send)
		throw new Error('Probe helpers require an IPC parent');
	let busy = false;
	process.on('disconnect', () => { process.exit(1); });
	process.on('message', async message => {
		if (message?.type == 'stop' && !busy)
			process.exit(0);
		if (message?.type != 'run' || busy) {
			console.error('Unexpected probe request');
			process.exit(1);
		}
		busy = true;
		let result;
		try {
			if (!Object.hasOwn(probes, message.name))
				throw new Error('Unknown probe: ' + message.name);
			const value = await probes[message.name]();
			result = { type: 'result', name: message.name, ok: true, value };
		}
		catch (error) {
			result = { type: 'result', name: message.name, ok: false, error: String(error.stack ?? error).slice(0, 2000) };
		}
		busy = false;
		process.send(result, error => { if (error) process.exit(1); });
	});
	process.send({ type: 'ready' });
}
