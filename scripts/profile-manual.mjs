import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const stackCategory = 'disabled-by-default-devtools.timeline.stack';

export function traceConfig(stacks = false) {
	return {
		recordMode: 'recordUntilFull',
		traceBufferSizeInKb: 64 * 1024,
		includedCategories: [
			'blink.console',
			'blink.user_timing',
			'loading',
			'devtools.timeline',
			'disabled-by-default-devtools.target-rundown',
			'disabled-by-default-devtools.timeline.frame',
			'disabled-by-default-devtools.timeline',
			'disabled-by-default-devtools.v8-source-rundown-sources',
			'disabled-by-default-devtools.v8-source-rundown',
			'disabled-by-default-v8.inspector',
			'disabled-by-default-v8.cpu_profiler',
			'disabled-by-default-v8.cpu_profiler.hires',
			'v8.execute',
			'v8',
			'cppgc',
			'navigation',
			'rail',
			...(stacks ? [stackCategory] : []),
		],
		excludedCategories: stacks ? [] : [stackCategory],
	};
}

export class CDP {
	constructor(socket, timeout = 30000) {
		this.socket = socket;
		this.timeout = timeout;
		this.pending = new Map();
		this.nextId = 0;
		this.closed = false;
		socket.addEventListener('message', event => {
			try {
				const message = JSON.parse(event.data);
				const waiter = this.pending.get(message.id ?? message.method);
				if (waiter) {
					if (message.error)
						waiter.reject(new Error(`${waiter.label}: ${message.error.message}`));
					else
						waiter.resolve(message.id == null ? message.params : message.result);
				}
			}
			catch (error) {
				this.fail(error);
			}
		});
		socket.addEventListener('close', () => this.fail(new Error('Chrome disconnected.')));
		socket.addEventListener('error', () => this.fail(new Error('Chrome WebSocket error.')));
	}

	wait(key, label = key) {
		if (this.closed)
			return Promise.reject(new Error('Chrome connection is closed.'));

		return new Promise((resolve, reject) => {
			const finish = (callback, value) => {
				clearTimeout(timer);
				this.pending.delete(key);
				callback(value);
			};
			const timer = setTimeout(() => finish(reject, new Error(`${label} timed out.`)), this.timeout);
			this.pending.set(key, {
				label,
				resolve: value => finish(resolve, value),
				reject: error => finish(reject, error),
			});
		});
	}

	send(method, params = {}) {
		const id = ++this.nextId;
		const result = this.wait(id, method);
		if (!this.closed) {
			try {
				this.socket.send(JSON.stringify({ id, method, params }));
			}
			catch (error) {
				this.fail(error);
			}
		}
		return result;
	}

	fail(error) {
		this.closed = true;
		for (const waiter of this.pending.values())
			waiter.reject(error);
	}

	close() {
		this.fail(new Error('Chrome connection is closed.'));
		this.socket.close();
	}
}

async function connect(endpoint) {
	const url = new URL(endpoint);
	if (url.protocol != 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
		throw new Error('Use a loopback HTTP endpoint. Use an SSH tunnel for a remote browser.');

	let version;
	try {
		const response = await fetch(new URL('/json/version', url), { signal: AbortSignal.timeout(5000) });
		if (!response.ok)
			throw new Error(`HTTP ${response.status}`);
		version = await response.json();
	}
	catch (error) {
		throw new Error(`Cannot reach Chrome at ${url.origin}. Launch Chrome with remote debugging. ${error.message}`);
	}
	if (!version.webSocketDebuggerUrl)
		throw new Error('Chrome did not return a browser WebSocket URL.');

	// Keep the supplied loopback address, including an SSH tunnel's local port.
	const wsUrl = new URL(version.webSocketDebuggerUrl);
	wsUrl.host = url.host;
	const socket = new WebSocket(wsUrl);
	const client = new CDP(socket);
	try {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => finish(new Error('Chrome connection timed out.')), 10000);
			const opened = () => finish();
			const failed = () => finish(new Error('Cannot open the Chrome WebSocket.'));
			function finish(error) {
				clearTimeout(timer);
				socket.removeEventListener('open', opened);
				socket.removeEventListener('error', failed);
				socket.removeEventListener('close', failed);
				error ? reject(error) : resolve();
			}
			socket.addEventListener('open', opened);
			socket.addEventListener('error', failed);
			socket.addEventListener('close', failed);
		});
		console.log(`Connected: ${version.Browser}`);
		return client;
	}
	catch (error) {
		client.close();
		throw error;
	}
}

export async function saveTrace(client, handle, file) {
	let bytes = 0;
	try {
		for (;;) {
			const chunk = await client.send('IO.read', { handle, size: 1024 * 1024 });
			const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
			// FileHandle.write can write fewer bytes than requested.
			let offset = 0;
			while (offset < data.length) {
				const { bytesWritten } = await file.write(data, offset, data.length - offset);
				if (bytesWritten == 0)
					throw new Error('Cannot write the trace file.');
				offset += bytesWritten;
			}
			bytes += data.length;
			if (chunk.eof)
				return bytes;
		}
	}
	finally {
		await client.send('IO.close', { handle });
	}
}

export async function stopTrace(client, file) {
	// Subscribe before ending: tracingComplete can arrive before the command response.
	const [result] = await Promise.all([
		client.wait('Tracing.tracingComplete'),
		client.send('Tracing.end'),
	]);
	if (!result.stream)
		throw new Error('Chrome did not return a trace stream.');
	const bytes = await saveTrace(client, result.stream, file);
	return { bytes, dataLoss: !!result.dataLossOccurred };
}

async function main() {
	const { values } = parseArgs({ options: {
		endpoint: { type: 'string', default: 'http://127.0.0.1:9222' },
		output: { type: 'string' },
		stacks: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) {
		console.log(`Usage: node scripts/profile-manual.mjs [--endpoint URL] [--output FILE] [--stacks]

Connect to visible Chrome at http://127.0.0.1:9222 by default.
Enter starts recording. Enter stops recording and saves a Performance trace.
Ctrl+C cancels before recording, or stops and saves during recording.
CPU samples stay enabled. --stacks also enables timeline event stacks for comparison.
Close DevTools during collection. Keep recordings short (64 MiB trace buffer).
Existing output files are never overwritten. No packages or browsers are installed.
See docs/manual-profile.md for browser setup, trace import, and cleanup.`);
		return;
	}
	if (!process.stdin.isTTY)
		throw new Error('Run this recorder in an interactive terminal.');

	const output = resolve(values.output ?? `manual-profile-${new Date().toISOString().replaceAll(':', '-')}.json`);
	const client = await connect(values.endpoint);
	const input = createInterface({ input: process.stdin, output: process.stdout });
	const lines = input[Symbol.asyncIterator]();
	const interrupt = () => input.close();
	input.on('SIGINT', interrupt);
	process.on('SIGINT', interrupt);
	let file;
	let saved = false;
	let recording = false;
	try {
		console.log(`Event stacks: ${values.stacks ? 'ON' : 'OFF'}. CPU samples: ON.`);
		console.log('Close DevTools and other tabs. Prepare the page, then press Enter to start.');
		if ((await lines.next()).done)
			return;

		file = await open(output, 'wx');
		await client.send('Tracing.start', {
			transferMode: 'ReturnAsStream',
			streamFormat: 'json',
			traceConfig: traceConfig(values.stacks),
		});
		recording = true;
		console.log('Recording. Use the page normally. Press Enter or Ctrl+C to stop and save.');
		await lines.next();
		console.log('Saving trace...');
		const result = await stopTrace(client, file);
		recording = false;
		await file.close();
		saved = true;
		console.log(`Saved ${(result.bytes / 1024 / 1024).toFixed(2)} MiB: ${output}`);
		if (result.dataLoss)
			console.warn('WARNING: Chrome lost trace data. Repeat with a shorter recording.');
		console.log('Load this file in DevTools > Performance. The browser remains open.');
	}
	finally {
		input.close();
		process.removeListener('SIGINT', interrupt);
		if (recording)
			await client.send('Tracing.end').catch(() => {});
		client.close();
		if (file && !saved) {
			await file.close().catch(() => {});
			await unlink(output);
		}
	}
}

if (process.argv[1] && import.meta.url == pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
