import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDP, saveTrace, stopTrace, traceConfig } from '../../scripts/profile-manual.mjs';

class FakeSocket extends EventTarget {
	sent = [];

	send(text) {
		assert.equal(typeof text, 'string');
		const message = JSON.parse(text);
		this.sent.push(message);
		this.onSend?.(message);
	}

	message(message) {
		const event = new Event('message');
		event.data = JSON.stringify(message);
		this.dispatchEvent(event);
	}

	close() {
		this.dispatchEvent(new Event('close'));
	}
}

function memoryFile(maxWrite = Infinity) {
	return {
		chunks: [],
		writes: [],
		async write(buffer, offset, length) {
			assert.ok(Buffer.isBuffer(buffer));
			assert.ok(offset >= 0 && length > 0 && offset + length <= buffer.length);
			const bytesWritten = Math.min(length, maxWrite);
			this.writes.push({ offset, length, bytesWritten });
			this.chunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
			return { bytesWritten };
		},
	};
}

function streamClient(chunks, closeError) {
	return {
		calls: [],
		async send(method, params) {
			this.calls.push({ method, params });
			if (method == 'IO.close') {
				if (closeError)
					throw closeError;
				return {};
			}
			assert.equal(method, 'IO.read');
			assert.ok(chunks.length > 0, 'unexpected extra stream read');
			const chunk = chunks.shift();
			if (chunk instanceof Error)
				throw chunk;
			return chunk;
		},
	};
}

function assertStreamCalls(client, reads) {
	assert.deepEqual(client.calls, [
		...Array.from({ length: reads }, () => ({
			method: 'IO.read', params: { handle: 'trace-stream', size: 1024 * 1024 },
		})),
		{ method: 'IO.close', params: { handle: 'trace-stream' } },
	]);
}

describe('manual profiler', () => {
	describe('traceConfig', () => {
		const stackCategory = 'disabled-by-default-devtools.timeline.stack';
		const cpuCategories = [
			'disabled-by-default-v8.cpu_profiler',
			'disabled-by-default-v8.cpu_profiler.hires',
		];

		it('retains CPU samples but explicitly excludes timeline stacks by default', () => {
			const config = traceConfig();
			for (const category of cpuCategories) {
				assert.ok(config.includedCategories.includes(category));
				assert.ok(!config.excludedCategories.includes(category));
			}
			assert.ok(!config.includedCategories.includes(stackCategory));
			assert.ok(config.excludedCategories.includes(stackCategory));
			assert.deepEqual(config, traceConfig(false));
		});

		it('adds timeline stacks for --stacks without removing CPU or other categories', () => {
			const normal = traceConfig();
			const stacks = traceConfig(true);
			assert.deepEqual(stacks.includedCategories, [...normal.includedCategories, stackCategory]);
			assert.ok(!stacks.excludedCategories.includes(stackCategory));
		});

		it('bounds both recording modes to a 64 MiB buffer', () => {
			for (const stacks of [false, true]) {
				const config = traceConfig(stacks);
				assert.equal(config.recordMode, 'recordUntilFull');
				assert.equal(config.traceBufferSizeInKb, 64 * 1024);
			}
		});
	});

	describe('CDP and stopTrace', () => {
		let socket;
		let client;

		beforeEach(() => {
			socket = new FakeSocket();
			client = new CDP(socket, 500);
		});

		afterEach(() => client.close());

		it('matches out-of-order responses by unique command ID', async () => {
			const first = client.send('First', { value: 1 });
			const second = client.send('Second');
			const [a, b] = socket.sent;
			assert.notEqual(a.id, b.id);
			assert.deepEqual(a, { id: a.id, method: 'First', params: { value: 1 } });
			assert.deepEqual(b, { id: b.id, method: 'Second', params: {} });
			socket.message({ id: b.id, result: { value: 2 } });
			socket.message({ id: a.id, result: { value: 1 } });
			assert.deepEqual(await Promise.all([first, second]), [{ value: 1 }, { value: 2 }]);
			assert.equal(client.pending.size, 0);
		});

		it('reports protocol errors with the method name without failing other commands', async () => {
			const failed = assert.rejects(client.send('Bad.command'), /Bad\.command: Unsupported/);
			const good = client.send('Good.command');
			socket.message({ id: socket.sent[0].id, error: { code: -32601, message: 'Unsupported' } });
			socket.message({ id: socket.sent[1].id, result: {} });
			await failed;
			assert.deepEqual(await good, {});
			assert.equal(client.pending.size, 0);
		});

		it('ignores unsolicited events and unknown responses', async () => {
			const result = client.send('Command');
			socket.message({ method: 'Unrelated.event', params: {} });
			socket.message({ id: 9999, result: {} });
			assert.equal(client.pending.size, 1);
			socket.message({ id: socket.sent[0].id, result: { ok: true } });
			assert.deepEqual(await result, { ok: true });
		});

		for (const event of ['close', 'error']) {
			it(`rejects all pending commands and events on socket ${event}`, async () => {
				const expected = event == 'close' ? /disconnected/i : /WebSocket error/i;
				const pending = [
					assert.rejects(client.send('First'), expected),
					assert.rejects(client.send('Second'), expected),
					assert.rejects(client.wait('Tracing.tracingComplete'), expected),
				];
				socket.dispatchEvent(new Event(event));
				await Promise.all(pending);
				assert.equal(client.pending.size, 0);
				await assert.rejects(client.send('After.disconnect'), /connection is closed/i);
				await assert.rejects(client.wait('After.disconnect'), /connection is closed/i);
				assert.equal(socket.sent.length, 2);
			});
		}

		it('rejects pending work when explicitly closed', async () => {
			const pending = assert.rejects(client.send('Command'), /connection is closed/i);
			let closes = 0;
			socket.addEventListener('close', () => closes++);
			client.close();
			await pending;
			assert.equal(closes, 1);
			assert.equal(client.pending.size, 0);
		});

		it('times out commands and event waits, cleans up, and ignores late replies', async () => {
			client.timeout = 15;
			await Promise.all([
				assert.rejects(client.send('Slow.command'), /Slow\.command timed out/),
				assert.rejects(client.wait('Slow.event'), /Slow\.event timed out/),
			]);
			assert.equal(client.pending.size, 0);
			socket.message({ id: socket.sent[0].id, result: {} });
			socket.message({ method: 'Slow.event', params: {} });
			const next = client.send('Next');
			socket.message({ id: socket.sent[1].id, result: { ok: true } });
			assert.deepEqual(await next, { ok: true });
		});

		it('turns a synchronous send throw into rejection of all pending work', async () => {
			const error = new Error('send failed');
			const waiting = assert.rejects(client.wait('Tracing.tracingComplete'), value => value === error);
			socket.onSend = () => { throw error; };
			let sent;
			assert.doesNotThrow(() => { sent = client.send('Tracing.end'); });
			await Promise.all([waiting, assert.rejects(sent, value => value === error)]);
			assert.equal(client.pending.size, 0);
			await assert.rejects(client.send('Next'), /connection is closed/i);
			assert.equal(socket.sent.length, 1);
		});

		for (const dataLoss of [false, true]) {
			it(`handles tracingComplete before the end response (data loss: ${dataLoss})`, async () => {
				const file = memoryFile(2);
				socket.onSend = ({ id, method, params }) => {
					if (method == 'Tracing.end') {
						socket.message({ method: 'Tracing.tracingComplete', params: {
							stream: 'trace-stream', ...(dataLoss ? { dataLossOccurred: true } : {}),
						} });
					}
					else if (method == 'IO.read') {
						assert.equal(params.handle, 'trace-stream');
						socket.message({ id, result: { data: 'trace', eof: true } });
					}
					else if (method == 'IO.close')
						socket.message({ id, result: {} });
				};
				const stopped = stopTrace(client, file);
				await Promise.resolve();
				assert.deepEqual(socket.sent.map(message => message.method), ['Tracing.end']);
				socket.message({ id: socket.sent[0].id, result: {} });
				assert.deepEqual(await stopped, { bytes: 5, dataLoss });
				assert.equal(Buffer.concat(file.chunks).toString(), 'trace');
				assert.deepEqual(socket.sent.map(message => message.method), ['Tracing.end', 'IO.read', 'IO.close']);
				assert.equal(client.pending.size, 0);
			});
		}

		it('rejects a completion without a stream instead of reading an undefined handle', async () => {
			const stopped = stopTrace(client, memoryFile());
			socket.message({ id: socket.sent[0].id, result: {} });
			socket.message({ method: 'Tracing.tracingComplete', params: {} });
			await assert.rejects(stopped, /did not return a trace stream/i);
			assert.equal(socket.sent.length, 1);
		});

		it('propagates a Tracing.end protocol error', async () => {
			const stopped = stopTrace(client, memoryFile());
			socket.message({ id: socket.sent[0].id, error: { message: 'Not recording' } });
			await assert.rejects(stopped, /Tracing\.end: Not recording/);
			assert.equal(socket.sent.length, 1);
		});
	});

	describe('saveTrace', () => {
		it('decodes plain UTF-8 and base64 chunks and retries partial writes by byte offset', async () => {
			const binary = Buffer.from([0, 255, 128, 10]);
			const file = memoryFile(2);
			const client = streamClient([
				{ data: 'aé', eof: false },
				{ data: '', eof: false },
				{ data: binary.toString('base64'), base64Encoded: true, eof: false },
				{ data: '終', base64Encoded: false, eof: true },
			]);
			const expected = Buffer.concat([Buffer.from('aé'), binary, Buffer.from('終')]);
			assert.equal(await saveTrace(client, 'trace-stream', file), expected.length);
			assert.deepEqual(Buffer.concat(file.chunks), expected);
			assert.deepEqual(file.writes, [
				{ offset: 0, length: 3, bytesWritten: 2 },
				{ offset: 2, length: 1, bytesWritten: 1 },
				{ offset: 0, length: 4, bytesWritten: 2 },
				{ offset: 2, length: 2, bytesWritten: 2 },
				{ offset: 0, length: 3, bytesWritten: 2 },
				{ offset: 2, length: 1, bytesWritten: 1 },
			]);
			assertStreamCalls(client, 4);
		});

		it('closes an empty stream without writing', async () => {
			const file = memoryFile();
			const client = streamClient([{ data: '', eof: true }]);
			assert.equal(await saveTrace(client, 'trace-stream', file), 0);
			assert.equal(file.writes.length, 0);
			assertStreamCalls(client, 1);
		});

		it('closes the stream after a read failure and preserves the error', async () => {
			const error = new Error('read failed');
			const client = streamClient([{ data: 'first', eof: false }, error]);
			const file = memoryFile();
			await assert.rejects(saveTrace(client, 'trace-stream', file), value => value === error);
			assert.equal(Buffer.concat(file.chunks).toString(), 'first');
			assertStreamCalls(client, 2);
		});

		it('closes the stream after a file write failure and preserves the error', async () => {
			const error = new Error('disk full');
			const client = streamClient([{ data: 'trace', eof: false }]);
			const file = { async write() { throw error; } };
			await assert.rejects(saveTrace(client, 'trace-stream', file), value => value === error);
			assertStreamCalls(client, 1);
		});

		it('rejects a zero-byte write instead of looping, and still closes the stream', async () => {
			const client = streamClient([{ data: 'trace', eof: true }]);
			const file = memoryFile(0);
			await assert.rejects(saveTrace(client, 'trace-stream', file), /Cannot write the trace file/);
			assert.equal(file.writes.length, 1);
			assertStreamCalls(client, 1);
		});

		it('propagates IO.close failure after writing the trace', async () => {
			const error = new Error('close failed');
			const client = streamClient([{ data: 'trace', eof: true }], error);
			const file = memoryFile();
			await assert.rejects(saveTrace(client, 'trace-stream', file), value => value === error);
			assert.equal(Buffer.concat(file.chunks).toString(), 'trace');
			assertStreamCalls(client, 1);
		});
	});

	describe('CLI', function() {
		const script = fileURLToPath(new URL('../../scripts/profile-manual.mjs', import.meta.url));

		function run(args) {
			const result = spawnSync(process.execPath, [script, ...args], {
				encoding: 'utf8', input: '', timeout: 5000,
			});
			assert.ifError(result.error);
			assert.equal(result.signal, null);
			return result;
		}

		for (const flag of ['--help', '-h']) {
			it(`prints ${flag} without a browser or interactive input`, { timeout: 10000 }, () => {
				const result = run([flag]);
				assert.equal(result.status, 0, result.stderr);
				assert.equal(result.stderr, '');
				assert.match(result.stdout, /Usage: node scripts\/profile-manual\.mjs/);
				assert.match(result.stdout, /--stacks/);
				assert.match(result.stdout, /CPU samples stay enabled/);
			});
		}

		for (const args of [[], ['--stacks']]) {
			it(`rejects non-TTY input${args.length ? ' with --stacks' : ''} before connecting`, { timeout: 10000 }, () => {
				const result = run(args);
				assert.equal(result.status, 1);
				assert.match(result.stderr, /interactive terminal/i);
				assert.equal(result.stdout, '');
				assert.doesNotMatch(result.stderr, /Cannot reach Chrome/);
			});
		}

		for (const [args, expected] of [
			[['--unknown'], /Unknown option/],
			[['--endpoint'], /argument missing|requires an argument/],
			[['--output'], /argument missing|requires an argument/],
			[['--stacks=false'], /does not take an argument/],
			[['unexpected'], /Unexpected argument/],
		]) {
			it(`rejects invalid arguments: ${args.join(' ')}`, { timeout: 10000 }, () => {
				const result = run(args);
				assert.equal(result.status, 1);
				assert.match(result.stderr, expected);
				assert.doesNotMatch(result.stderr, /interactive terminal|Cannot reach Chrome/i);
				assert.equal(result.stdout, '');
			});
		}
	});
});
