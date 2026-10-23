import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';

const whitespace = char => char === ' ' || char === '\t' || char === '\r' || char === '\n';
const punctuation = char => '{}[],:'.includes(char);
const invalid = message => new SyntaxError('Invalid trace JSON: ' + message);

// Tokens can cross byte chunks. Only an unfinished token survives the next write.
class Tokens {
	constructor(emit) {
		this.emit = emit;
		this.buffer = '';
		this.index = 0;
		this.mode = null;
		this.escaped = false;
	}

	write(text, final = false) {
		this.buffer += text;
		let start = 0;
		while (this.index < this.buffer.length) {
			const char = this.buffer[this.index];
			if (this.mode === 'string') {
				this.index++;
				if (this.escaped)
					this.escaped = false;
				else if (char === '\\')
					this.escaped = true;
				else if (char === '"') {
					this.emit('value', JSON.parse(this.buffer.slice(start, this.index)));
					this.mode = null;
				}
			}
			else if (this.mode === 'scalar') {
				if (whitespace(char) || punctuation(char)) {
					this.emit('value', JSON.parse(this.buffer.slice(start, this.index)));
					this.mode = null;
				}
				else
					this.index++;
			}
			else if (whitespace(char))
				this.index++;
			else if (punctuation(char)) {
				this.emit(char);
				this.index++;
			}
			else {
				start = this.index++;
				if (char === '"')
					this.mode = 'string';
				else if ('-0123456789tfn'.includes(char))
					this.mode = 'scalar';
				else
					throw invalid('unexpected character');
			}
		}
		if (final && this.mode === 'scalar') {
			this.emit('value', JSON.parse(this.buffer.slice(start)));
			this.mode = null;
		}
		if (final && this.mode !== null)
			throw invalid('unterminated string');
		this.buffer = this.mode === null ? '' : this.buffer.slice(start);
		this.index = this.buffer.length;
	}
}

// Validate the entire document, including discarded fields. Build only one event
// at a time (or metadata); do not retain the traceEvents array or other envelopes.
class TraceJSON {
	constructor(onEvent) {
		this.onEvent = onEvent;
		this.stack = [{kind: 'root', state: 'value'}];
		this.hasEvents = false;
		this.metadata = undefined;
	}

	token = (type, value) => {
		const frame = this.stack.at(-1);
		if (frame.state === 'done')
			throw invalid('trailing content');
		if (frame.kind === 'object' && ['key', 'keyOrEnd'].includes(frame.state)) {
			if (type === '}' && frame.state === 'keyOrEnd')
				return this.close();
			if (type !== 'value' || typeof value !== 'string')
				throw invalid('expected object key');
			frame.key = value;
			frame.state = 'colon';
			return;
		}
		if (frame.state === 'colon') {
			if (type !== ':')
				throw invalid('expected colon');
			frame.state = 'value';
			return;
		}
		if (frame.state === 'comma') {
			if (type === (frame.kind === 'array' ? ']' : '}'))
				return this.close();
			if (type !== ',')
				throw invalid('expected comma or closing bracket');
			frame.state = frame.kind === 'array' ? 'value' : 'key';
			return;
		}
		if (frame.kind === 'array' && frame.state === 'valueOrEnd' && type === ']')
			return this.close();
		if (!['value', '{', '['].includes(type))
			throw invalid('expected value');

		let role;
		if (frame.kind === 'root') {
			if (type !== '{' && type !== '[')
				throw invalid('expected trace object or array');
			role = type === '[' ? 'events' : 'envelope';
		}
		else if (frame.role === 'envelope') {
			if (frame.key === 'traceEvents') {
				if (type !== '[' || this.hasEvents)
					throw invalid('expected one traceEvents array');
				role = 'events';
			}
			else if (frame.key === 'metadata')
				role = 'metadata';
		}
		else if (frame.role === 'events') {
			if (type !== '{')
				throw invalid('expected event object');
			role = 'event';
		}
		if (role === 'events')
			this.hasEvents = true;
		const keep = frame.keep || role === 'event' || role === 'metadata';
		if (type === '{' || type === '[') {
			this.stack.push({kind: type === '{' ? 'object' : 'array',
				state: type === '{' ? 'keyOrEnd' : 'valueOrEnd', role, keep,
				value: keep ? (type === '{' ? {} : []) : undefined});
		}
		else
			this.complete(value, role);
	};

	close() {
		const frame = this.stack.pop();
		this.complete(frame.value, frame.role);
	}

	complete(value, role) {
		if (role === 'event')
			this.onEvent(value);
		else if (role === 'metadata')
			this.metadata = value;
		const parent = this.stack.at(-1);
		if (parent.keep) {
			if (parent.kind === 'array')
				parent.value.push(value);
			else
				Object.defineProperty(parent.value, parent.key, {value, enumerable: true, writable: true, configurable: true});
		}
		parent.state = parent.kind === 'root' ? 'done' : 'comma';
	}

	finish() {
		if (this.stack.length !== 1 || this.stack[0].state !== 'done')
			throw invalid('truncated document');
		if (!this.hasEvents)
			throw invalid('missing traceEvents array');
		return this.metadata;
	}
}

/** Consume byte chunks with backpressure. onEvent is synchronous; events are not retained. */
export async function readTraceStream(chunks, onEvent) {
	const parser = new TraceJSON(onEvent);
	const tokens = new Tokens(parser.token);
	const decoder = new StringDecoder('utf8');
	let rawBytes = 0;
	for await (const chunk of chunks) {
		rawBytes += chunk.length;
		tokens.write(decoder.write(chunk));
	}
	tokens.write(decoder.end(), true);
	return {metadata: parser.finish(), rawBytes};
}

/** .gz files are decompressed in memory; no uncompressed file is created. */
export async function readTraceFile(path, onEvent) {
	let result;
	const streams = [createReadStream(path)];
	if (String(path).endsWith('.gz'))
		streams.push(createGunzip());
	await pipeline(...streams, async chunks => {
		result = await readTraceStream(chunks, onEvent);
	});
	return result;
}
