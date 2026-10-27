import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { parseSource, generateSource } from '../../scripts/vendor/istanbul/backend.mjs';
import { createInstrumenter } from '../../scripts/vendor/istanbul/index.mjs';

const filename = fileURLToPath(new URL('./estree-chains-fixture.js', import.meta.url));

function execute(code) {
	const context = createContext({ result: null, events: [] });
	let error = null;

	try {
		runInContext(code, context, { timeout: 1000 });
	}
	catch (caught) {
		error = caught.name;
	}

	return {
		result: context.result === undefined ? undefined : JSON.parse(JSON.stringify(context.result)),
		events: Array.from(context.events),
		error,
	};
}

// Check the original program against explicit expectations before transforming it.
const fixtures = [
	['outer member throws', 'globalThis.result = (null?.x).y;', null, [], 'TypeError'],
	['outer computed member evaluates its key, then throws', 'globalThis.result = (null?.x)[events.push("key")];', null, ['key'], 'TypeError'],
	['outer call throws', 'globalThis.result = (null?.x)();', null, [], 'TypeError'],
	['outer call evaluates arguments, then throws', 'globalThis.result = (null?.x)(events.push("argument"));', null, ['argument'], 'TypeError'],
	['outer member after optional call throws', 'globalThis.result = (null?.()).x;', null, [], 'TypeError'],
	['outer call after optional call throws', 'globalThis.result = (null?.())();', null, [], 'TypeError'],
	['outer constructor', 'const ns = { C: class {} }; globalThis.result = new (ns?.C)() instanceof ns.C;', true],
	['outer constructor evaluates arguments, then throws', 'globalThis.result = new (null?.C)(events.push("argument"));', null, ['argument'], 'TypeError'],
	['constructor with a member of a completed chain', 'const ns = { inner: { C: class {} } }; globalThis.result = new (ns?.inner).C() instanceof ns.inner.C;', true],
	['constructor from an optional call', 'const factory = () => class {}; globalThis.result = typeof new (factory?.())();', 'object'],
	['outer tag evaluates substitutions, then throws', 'globalThis.result = (null?.tag)`value:${events.push("substitution")}`;', null, ['substitution'], 'TypeError'],
	['outer tag preserves its receiver', '"use strict"; const obj = { value: 7, tag(strings, n) { return [this.value, strings[0], n]; } }; globalThis.result = (obj?.tag)`value:${3}`;', [7, 'value:', 3]],
	['tag from an optional call', 'const factory = () => (strings => strings[0]); globalThis.result = (factory?.())`ok`;', 'ok'],
	['outer member succeeds', 'const obj = { x: { y: 7 } }; globalThis.result = (obj?.x).y;', 7],
	['outer call preserves its receiver', '"use strict"; const obj = { value: 7, method() { return this.value; } }; globalThis.result = (obj?.method)();', 7],
	['outer optional call preserves its receiver', '"use strict"; const obj = { value: 7, method() { return this.value; } }; globalThis.result = (obj?.method)?.();', 7],
	['nested chain boundary preserves its receiver', '"use strict"; const obj = { inner: { value: 7, method() { return this.value; } } }; globalThis.result = ((obj?.inner)?.method)();', 7],
	['method getter runs once', '"use strict"; const obj = { value: 7, get method() { events.push("getter"); return function() { return this.value; }; } }; globalThis.result = (obj?.method)();', 7, ['getter']],
	['unbound sequence call stays unbound', '"use strict"; const obj = { method() { return this === undefined; } }; globalThis.result = (0, obj?.method)();', true],
	['ordinary member chain short-circuits', 'globalThis.result = null?.x.y;', undefined],
	['ordinary call chain short-circuits and skips arguments', 'globalThis.result = null?.method(events.push("argument"));', undefined],
	['ordinary optional-call chain skips later members', 'const fn = null; globalThis.result = fn?.().x;', undefined],
	['ordinary computed chain skips its key', 'globalThis.result = null?.x[events.push("key")];', undefined],
	['ordinary method chain preserves its receiver', '"use strict"; const obj = { value: 7, method() { return this.value; } }; globalThis.result = obj?.method();', 7],
	['ordinary optional method call preserves its receiver', '"use strict"; const obj = { value: 7, method() { return this.value; } }; globalThis.result = obj.method?.();', 7],
	['ordinary chain still throws on a later null member', 'const obj = { x: null }; globalThis.result = obj?.x.y;', null, [], 'TypeError'],
	['outer optional member short-circuits', 'globalThis.result = (null?.x)?.y;', undefined],
	['outer optional call skips arguments', 'globalThis.result = (null?.method)?.(events.push("argument"));', undefined],
	['outer optional chain does not swallow a later boundary', 'globalThis.result = ((null?.x)?.y).z;', null, [], 'TypeError'],
	['optional call before an outer member does not extend the chain', 'globalThis.result = (null?.x.y?.()).z;', null, [], 'TypeError'],
	['delete preserves the property reference', 'const obj = { x: 7 }; globalThis.result = [delete obj?.x, "x" in obj];', [true, false]],
	['delete of a null chain succeeds', 'globalThis.result = delete null?.x.y;', true],
	['delete of an outer member throws', 'globalThis.result = delete (null?.x).y;', null, [], 'TypeError'],
	['chain used as an argument', 'globalThis.result = [null?.x, ({ x: 7 })?.x];', [null, 7]],
	['chain used as a computed key', 'globalThis.result = ({ key: 7 })[({ value: "key" })?.value];', 7],
	['chain used in a binary expression', 'globalThis.result = ({ value: 3 })?.value + 4;', 7],
	['optional eval remains indirect', 'globalThis.value = "global"; function check() { const value = "local"; return eval?.("value"); } globalThis.result = check();', 'global'],
];

describe('ESTree optional-chain boundaries', () => {
	for (const compact of [false, true]) {
		for (const [name, source, result, events = [], error = null] of fixtures) {
			it(`${name} (compact: ${compact})`, () => {
				const expected = { result, events, error };
				const original = execute(source);
				assert.deepEqual(original, expected, 'original program');

				const options = { compact, produceSourceMap: false };

				const { ast } = parseSource(source, options);
				const generated = generateSource(ast, source, filename, options).code;
				assert.deepEqual(execute(generated), original, 'ESTree round trip');

				const local = createInstrumenter(options).instrumentSync(source, filename);
				assert.deepEqual(execute(local), original, 'ESTree instrumentation');
			});
		}
	}
});
