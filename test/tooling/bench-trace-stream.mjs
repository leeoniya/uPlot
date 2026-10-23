import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readTraceFile, readTraceStream } from '../../scripts/bench-trace-stream.mjs';

function* chunks(buffer, size) {
	for (let offset = 0; offset < buffer.length; offset += size)
		yield buffer.subarray(offset, offset + size);
}

async function parse(text, size = 1) {
	const events = [];
	const buffer = Buffer.from(text);
	const info = await readTraceStream(chunks(buffer, size), event => events.push(event));
	assert.equal(info.rawBytes, buffer.length);
	return {events, ...info};
}

describe('streaming benchmark trace JSON', () => {
	const events = [
		{name: 'é中😀', args: {text: 'quotes " and \\ and } ] { [ , :', nested: [null, true, false, -1.25e-7, {a: []}]}},
		JSON.parse('{"__proto__":{"safe":true},"constructor":7,"name":"escaped\\u0020name"}'),
		{name: 'tail', ts: 1e30, dur: 0},
	];

	it('handles every byte split, UTF-8, escapes, nested containers, numbers, and envelope fields', async () => {
		const text = JSON.stringify({before: {traceEvents: ['not events'], metadata: false}, metadata: {dataLoss: true}, traceEvents: events, after: [1, {a: 'x'}]});
		const bytes = Buffer.from(text);
		for (let split = 0; split <= bytes.length; split++) {
			const actual = [];
			const result = await readTraceStream([bytes.subarray(0, split), bytes.subarray(split)], event => actual.push(event));
			assert.deepEqual(actual, events);
			assert.deepEqual(result, {metadata: {dataLoss: true}, rawBytes: bytes.length});
		}
		for (const size of [1, 2, 3, 7, 64, 65536]) {
			assert.deepEqual((await parse(text, size)).events, events);
			assert.deepEqual((await parse(JSON.stringify(events), size)).events, events);
		}
	});

	it('accepts whitespace, escaped property names, duplicate event keys, and metadata after events', async () => {
		const result = await parse(' \r\n{ "trace\\u0045vents" : [{"name":"old","name":"new","v":-0}], "metadata": {"dataLoss":false} }\t');
		assert.deepEqual(result.events, [{name: 'new', v: -0}]);
		assert.deepEqual(result.metadata, {dataLoss: false});
		assert.deepEqual((await parse('[]')).events, []);
		assert.deepEqual((await parse('{"traceEvents":[]}')).events, []);
	});

	it('handles strings larger than a file chunk without rescanning or splitting events', async () => {
		const event = {name: 'large argument', args: {text: '😀 \\ " } ] \n'.repeat(20000)}};
		const text = JSON.stringify({traceEvents: [event], unused: {array: [true, null, {value: 123}]}});
		for (const size of [4093, 65536])
			assert.deepEqual((await parse(text, size)).events, [event]);
	});

	it('rejects malformed JSON even in fields that the analyzer does not use', async () => {
		for (const text of [
			'', ' ', 'null', '42', '"traceEvents"', '{}', '{"other":[]}',
			'{"traceEvents":{}}', '{"traceEvents":null}', '{"traceEvents":[],"traceEvents":[]}',
			'[null]', '[true]', '[[]]', '[1]', '["event"]', '[{},]', '[,{}]', '[{} {}]',
			'{"traceEvents":[],}', '{"traceEvents" []}', '{"traceEvents":[] "x":1}',
			'{"traceEvents":[],"unused":[1,]}', '{"traceEvents":[],"unused":{"a":}}',
			'{"traceEvents":[],"unused":[}', '{"traceEvents":[],"unused":01}',
			'[{"v":1e}]', '[{"v":+1}]', '[{"v":NaN}]', '[{"v":undefined}]', '[{"v":truefalse}]',
			'[{"v":"bad\\q"}]', '[{"v":"bad\\uXX00"}]', '[{"v":"line\nbreak"}]',
			'[] trailing', '[][]', '[{}]]', '{"traceEvents":[]} false',
		]) {
			for (const size of [1, 7, 65536])
				await assert.rejects(parse(text, size), SyntaxError, text);
		}
	});

	it('rejects every truncated prefix of a complete document', async () => {
		const text = JSON.stringify({traceEvents: events, metadata: {dataLoss: true}});
		for (let end = 0; end < text.length; end++)
			await assert.rejects(parse(text.slice(0, end), 7), SyntaxError, `prefix ${end}`);
	});

	it('delivers events before EOF and propagates consumer/source failures', async () => {
		let seen = false;
		await readTraceStream((async function* () {
			yield Buffer.from('[{"name":"first"}');
			assert.equal(seen, true);
			yield Buffer.from(']');
		})(), () => { seen = true; });
		const error = new Error('consumer failed');
		await assert.rejects(readTraceStream([Buffer.from('[{}]')], () => { throw error; }), e => e === error);
		await assert.rejects(readTraceStream((async function* () {
			yield Buffer.from('[');
			throw error;
		})(), () => {}), e => e === error);
	});

	it('reads exact gzip content without an uncompressed file and rejects corrupt/truncated gzip', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bench-trace-stream-'));
		try {
			const path = join(dir, 'trace.json.gz');
			const raw = Buffer.from(JSON.stringify({traceEvents: events, metadata: {dataLoss: true}}));
			const compressed = gzipSync(raw);
			await writeFile(path, compressed);
			const actual = [];
			assert.deepEqual(await readTraceFile(path, event => actual.push(event)), {metadata: {dataLoss: true}, rawBytes: raw.length});
			assert.deepEqual(actual, events);
			assert.deepEqual(await readFile(path), compressed);
			assert.deepEqual(await readdir(dir), ['trace.json.gz']);
			for (const bytes of [compressed.subarray(0, compressed.length - 1), Buffer.from('not gzip'), gzipSync(Buffer.from('[{}'))]) {
				await writeFile(path, bytes);
				await assert.rejects(readTraceFile(path, () => {}));
			}
			await writeFile(path, compressed);
			const failure = new Error('stop reading');
			await assert.rejects(readTraceFile(path, () => { throw failure; }), e => e === failure);
			await assert.rejects(readTraceFile(join(dir, 'missing.json.gz'), () => {}), /ENOENT/);
		}
		finally {
			await rm(dir, {recursive: true, force: true});
		}
	});
});
