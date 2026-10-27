import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { coverageFiles } from '../../scripts/coverage-files.mjs';
import { createInstrumenter } from '../../scripts/vendor/istanbul/index.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).nyc;
const filename = join(project, 'test/tooling/estree-fixture.js');
const coverageKeys = ['statementMap', 'fnMap', 'branchMap', 's', 'f', 'b'];
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const coverageData = coverage => coverage == null ? coverage : Object.fromEntries(coverageKeys.map(key => [key, coverage[key]]));
const counters = coverage => coverage == null ? coverage : { s: coverage.s, f: coverage.f, b: coverage.b };

function assertInitialCoverage(coverage, source, file = filename) {
	assert.equal(coverage.path, file);
	const lines = source.split(/\r\n|[\n\r\u2028\u2029]/);
	const location = loc => {
		assert.deepEqual(Object.keys(loc).sort(), ['end', 'start']);
		for (const point of [loc.start, loc.end]) {
			assert.ok(Number.isInteger(point.line) && point.line >= 1 && point.line <= lines.length, 'source line');
			assert.ok(Number.isInteger(point.column) && point.column >= 0 && point.column <= lines[point.line - 1].length, 'source column');
		}
		assert.ok(loc.start.line < loc.end.line || loc.start.line === loc.end.line && loc.start.column <= loc.end.column, 'ordered location');
	};
	for (const [map, counts] of [['statementMap', 's'], ['fnMap', 'f'], ['branchMap', 'b']]) {
		assert.equal(typeof coverage[map], 'object');
		assert.equal(typeof coverage[counts], 'object');
		assert.deepEqual(Object.keys(coverage[map]), Object.keys(coverage[counts]));
		for (const [id, entry] of Object.entries(coverage[map])) {
			assert.match(id, /^(0|[1-9]\d*)$/);
			if (counts === 's') location(entry);
			if (counts === 'f') {
				assert.equal(typeof entry.name, 'string');
				assert.ok(entry.name.length > 0);
				location(entry.decl);
				location(entry.loc);
				assert.equal(entry.line, entry.loc.start.line);
			}
			if (counts === 'b') {
				assert.ok(['if', 'switch', 'cond-expr', 'binary-expr', 'default-arg'].includes(entry.type));
				location(entry.loc);
				assert.equal(entry.line, entry.loc.start.line);
				assert.ok(entry.locations.length > 0);
				assert.equal(coverage.b[id].length, entry.locations.length);
				for (const [index, loc] of entry.locations.entries()) {
					// An implicit else has no source coordinates.
					if (entry.type === 'if' && index === 1 && loc.start.line === undefined)
						assert.deepEqual(loc, { start: { line: undefined, column: undefined }, end: { line: undefined, column: undefined } });
					else location(loc);
				}
				assert.deepEqual(coverage.b[id], entry.locations.map(() => 0));
			}
			else assert.equal(coverage[counts][id], 0);
		}
	}
}

function instrument(source, options = {}, file = filename, inputSourceMap) {
	const actual = createInstrumenter(options);
	const code = actual.instrumentSync(source, file, inputSourceMap);
	assertInitialCoverage(actual.lastFileCoverage(), source, file);
	return { actual, code };
}

function execute(code, seed = {}) {
	const context = createContext(seed);
	runInContext(code, context, { timeout: 1000 });
	return context;
}

function runtime(source, options = {}, seed = () => ({}), coverageScope = context => context) {
	const compiled = instrument(source, options);
	const initial = plain(compiled.actual.lastFileCoverage());
	const expected = execute(source, seed());
	const actualContext = execute(compiled.code, seed());
	assert.deepEqual(plain(actualContext.result), plain(expected.result), 'original program result');
	// Runtime increments must not mutate the instrumenter's initial metadata.
	assert.deepEqual(plain(compiled.actual.lastFileCoverage()), initial);
	const coverage = coverageScope(actualContext)[options.coverageVariable ?? '__coverage__']?.[filename];
	if (coverage) {
		assert.equal(coverage.path, initial.path);
		for (const key of ['statementMap', 'fnMap', 'branchMap'])
			assert.deepEqual(plain(coverage[key]), initial[key], 'runtime ' + key);
		for (const key of ['s', 'f', 'b']) {
			assert.deepEqual(Object.keys(coverage[key]), Object.keys(initial[key]), 'runtime counter IDs: ' + key);
			for (const [id, value] of Object.entries(coverage[key])) {
				if (key === 'b') {
					assert.ok(Array.isArray(value), 'branch counter array');
					assert.equal(value.length, initial.b[id].length, 'branch counter paths');
				}
				for (const count of key === 'b' ? value : [value])
					assert.ok(Number.isInteger(count) && count >= 0, 'nonnegative integer counter: ' + key + '.' + id);
			}
		}
	}
	return { ...compiled, actualContext, coverage };
}

const fixtures = [
	['functions and arrows', `
const anonymous = function(value) { return value + 1; };
const named = function inside(value) { return value * 2; };
const expression = value => ({ value: anonymous(value) });
const block = value => { return named(value); };
function outer(value) { return function(delta) { return value + delta; }; }
globalThis.result = [anonymous.name, named.name, expression.name, block.name,
  expression(2).value, block(3), outer(4)(5), [1, 2].map(function(x) { return x * x; })];
`],
	['methods, accessors, and computed keys', `
let keys = 0;
const object = {
  value: 2,
  method(delta = 1) { return this.value + delta; },
  ['computed' + ++keys](value) { return value * 3; },
  get current() { return this.value; },
  set current(value) { this.value = value; },
  anonymous: function(value) { return value - 1; },
  named: function explicit(value) { return value + 1; }
};
object.current = 5;
globalThis.result = [keys, object.method(), object.method(2), object.computed1(3),
  object.current, object.anonymous(4), object.named(4), object.method.name];
`],
	['classes, private fields, and inheritance', `
class Base {
  constructor(value) { this.value = value; }
  read() { return this.value; }
}
class Child extends Base {
  #offset = 2;
  field = value => value + this.#offset;
  static total = 3;
  constructor(value = 4) { super(value); }
  #private(value) { return value + this.#offset; }
  get current() { return super.read() + this.#offset; }
  set current(value) { this.value = value; }
  read() { return this.#private(super.read()); }
}
const Anonymous = class { read() { return 7; } };
const Named = class Inner { read() { return Inner.name; } };
const child = new Child();
child.current = 5;
globalThis.result = [child.current, child.read(), child.field(4), Child.total,
  Anonymous.name, new Anonymous().read(), Named.name, new Named().read()];
`],
	['defaults, destructuring, and rest', `
function unpack({ value = 2, nested: { count = 3 } = {} } = {}, [first = 4, ...rest] = []) {
  const { missing = 5, ...other } = { present: 6 };
  let [last = 7] = [];
  return [value, count, first, rest.length, missing, other.present, last];
}
const arrow = ({ value = 8 } = {}) => value;
let assigned;
({ assigned = 9 } = {});
globalThis.result = [unpack(), unpack({ value: 0, nested: { count: 1 } }, [2, 3]), arrow(), arrow({ value: 0 }), assigned];
`],
	['if, else, and missing alternatives', `
function choose(value) {
  let result = 0;
  if (value > 0) result++;
  if (value === 1) result += 2;
  else if (value === 2) { result += 3; }
  else result -= 1;
  if (value < 0) { if (value === -1) result += 4; }
  return result;
}
globalThis.result = [-2, -1, 0, 1, 2].map(choose);
`],
	['loops and labeled continue', `
let sum = 0;
outer: for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 3; j++) {
    if (j === 1) continue outer;
    sum += i;
  }
}
for (const value of [2, 3]) sum += value;
for (const key in { a: 1, bb: 2 }) sum += key.length;
let n = 0;
while (n < 2) sum += ++n;
do { sum++; } while (--n > 0);
stop: { for (;;) { sum++; break stop; } }
globalThis.result = [sum, n];
`],
	['switch fallthrough and default', `
function choose(value) {
  let result = '';
  switch (value) {
    case 0:
    case 1: result += 'a';
    case 2: result += 'b'; break;
    default: result += 'd';
  }
  switch (value) { case 0: result += 'z'; }
  return result;
}
globalThis.result = [0, 1, 2, 3].map(choose);
`],
	['logical expressions, ternaries, and evaluation order', `
const seen = [];
function mark(value) { seen.push(value); return value; }
function choose(value) {
  return [(mark(value) && mark('and')) || mark('or'),
    mark(value) ?? mark('nullish'), value ? mark('yes') : mark('no'),
    value && (value === 1 || mark('nested'))];
}
globalThis.result = [[0, 1, 2, null].map(choose), seen];
`],
	['ignore next, if, and else', `
/* istanbul ignore next */
function hidden(value = 0) { return value ? 1 : 2; }
function choose(value) {
  let result = 0;
  /* istanbul ignore if */
  if (value) result += hidden(value); else result += 3;
  /* istanbul ignore else */
  if (value) result += 4; else result += 5;
  /* istanbul ignore next */
  if (value) result += 6; else result += 7;
  return result;
}
const object = { /* istanbul ignore next */ ignored() { return hidden(); }, kept() { return 8; } };
globalThis.result = [choose(false), choose(true), object.ignored(), object.kept()];
`],
	['ignore hints separated by comment trivia', `
/* istanbul ignore next */
/* reason */
// another reason
function hidden() { return 1; }
/* istanbul ignore else */ /* reason */
if (true) globalThis.result = hidden(); else globalThis.result = 2;
`],
	['ignored initializers retain parent counters', `
const literal = /* istanbul ignore next */ 1;
const arrow = /* istanbul ignore next */ (() => 2);
const object = /* istanbul ignore next */ ({ read() { return 3; } });
function defaults(value = /* istanbul ignore next */ (() => 4)) { return value(); }
class Fields { value = /* istanbul ignore next */ 5; read = /* istanbul ignore next */ (() => 6); }
globalThis.result = [literal, arrow(), object.read(), defaults(), new Fields().value, new Fields().read()];
`],
	['ignore whole file', `/* istanbul ignore file */
function hidden(value) { return value ? 1 : 2; }
globalThis.result = [hidden(false), hidden(true)];
`],
	['strict directives and function name inference', `'use strict';
const fn = function() { 'use strict'; return this === undefined; };
const arrow = () => 2;
const Klass = class {};
function scoped() {
  'use strict';
  const nested = function() { return this; };
  let caught = false;
  try { accidentalGlobal = 1; } catch (error) { caught = error instanceof ReferenceError; }
  return [nested.name, nested() === undefined, caught];
}
globalThis.result = [fn.name, arrow.name, Klass.name, fn(), arrow(), scoped()];
`],
	['sparse child lists and delayed counter insertion', `
'use strict';
function run() {
  'use strict';
  /* istanbul ignore next */
  function untouched() { return 7; }
  const values = [1, , 3, , 5];
  const [, second = 2, ...rest] = values;
  const first = () => second, next = function() { return rest.length; };
  let result = 0;
  if (first()) result += next();
  result += untouched();
  return [result, first.name, next.name, values.length, 1 in values, 3 in values];
}
globalThis.result = run();
`],
	['try, catch, finally, generators, and optional chaining', `
function* values() { yield 1; yield 2; }
function read(value) {
  let result;
  try { if (value < 0) throw new Error('negative'); result = value?.item ?? 3; }
  catch (error) { result = error.message; }
  finally { globalThis.finalized = (globalThis.finalized || 0) + 1; }
  return result;
}
globalThis.result = [[...values()], read(null), read({ item: 0 }), read(-1), globalThis.finalized];
`],
	['Unicode and CRLF locations', "const café = '😀';\r\nfunction λ(值 = 2) { return 值 ? café + 值 : '☃'; }\r\nglobalThis.result = [λ(), λ(0), café.length];\r\n"],
];

const loc = (startLine, startColumn, endLine, endColumn) => ({
	start: { line: startLine, column: startColumn }, end: { line: endLine, column: endColumn },
});

// Select explicitly named source spans, independently of the instrumenter's AST.
function sourceSpan(source) {
	const lines = source.split('\n');
	return (line, text, width = text.length) => {
		const column = lines[line - 1].indexOf(text);
		assert.ok(column >= 0 && lines[line - 1].lastIndexOf(text) === column, 'unique fixture span: ' + text);
		return loc(line, column, line, column + width);
	};
}

const coverageFixtures = [
	{
		name: 'function, default argument, if, and implicit else',
		source: [
			'function choose(value = 2) {',
			'  if (value) return value;',
			'  return 0;',
			'}',
			'globalThis.result = [choose(), choose(0), choose(3)];',
		].join('\n'),
		result: [2, 0, 3],
		expected: at => ({
			statementMap: { 0: at(2, 'if (value) return value;'), 1: at(2, 'return value;'), 2: at(3, 'return 0;'), 3: at(5, 'globalThis.result = [choose(), choose(0), choose(3)];') },
			fnMap: { 0: { name: 'choose', decl: at(1, 'choose'), loc: loc(1, 27, 4, 1), line: 1 } },
			branchMap: {
				0: { type: 'default-arg', loc: at(1, 'value = 2'), locations: [at(1, '2')], line: 1 },
				1: { type: 'if', loc: at(2, 'if (value) return value;'), locations: [at(2, 'if (value) return value;'), loc()], line: 2 },
			},
			s: { 0: 3, 1: 2, 2: 1, 3: 1 }, f: { 0: 3 }, b: { 0: [1], 1: [2, 1] },
		}),
	},
	{
		name: 'arrow return, ternary, and short-circuit leaves',
		source: [
			'const choose = value => value ? 9 : value && 7;',
			'globalThis.result = [choose(0), choose(1), choose(2)];',
		].join('\n'),
		result: [0, 9, 9],
		expected: at => ({
			statementMap: { 0: at(1, 'value => value ? 9 : value && 7'), 1: at(1, 'value ? 9 : value && 7'), 2: at(2, 'globalThis.result = [choose(0), choose(1), choose(2)];') },
			fnMap: { 0: { name: '(anonymous_0)', decl: at(1, 'value =>', 1), loc: at(1, 'value ? 9 : value && 7'), line: 1 } },
			branchMap: {
				0: { type: 'cond-expr', loc: at(1, 'value ? 9 : value && 7'), locations: [at(1, '9'), at(1, 'value && 7')], line: 1 },
				1: { type: 'binary-expr', loc: at(1, 'value && 7'), locations: [at(1, 'value &&', 5), at(1, '7')], line: 1 },
			},
			s: { 0: 1, 1: 3, 2: 1 }, f: { 0: 3 }, b: { 0: [2, 1], 1: [1, 0] },
		}),
	},
	{
		name: 'switch case entry, fallthrough, and uncalled functions',
		source: [
			'function choose(value) {',
			'  switch (value) {',
			'    case 0:',
			'    case 1: return 7;',
			'    default: return 9;',
			'  }',
			'}',
			'function unused() { return 8; }',
			'globalThis.result = [choose(0), choose(1), choose(2)];',
		].join('\n'),
		result: [7, 7, 9],
		expected: at => ({
			statementMap: { 0: loc(2, 2, 6, 3), 1: at(4, 'return 7;'), 2: at(5, 'return 9;'), 3: at(8, 'return 8;'), 4: at(9, 'globalThis.result = [choose(0), choose(1), choose(2)];') },
			fnMap: {
				0: { name: 'choose', decl: at(1, 'choose'), loc: loc(1, 23, 7, 1), line: 1 },
				1: { name: 'unused', decl: at(8, 'unused'), loc: at(8, '{ return 8; }'), line: 8 },
			},
			branchMap: { 0: { type: 'switch', loc: loc(2, 2, 6, 3), locations: [at(3, 'case 0:'), at(4, 'case 1: return 7;'), at(5, 'default: return 9;')], line: 2 } },
			s: { 0: 3, 1: 2, 2: 1, 3: 0, 4: 1 }, f: { 0: 3, 1: 0 }, b: { 0: [1, 2, 1] },
		}),
	},
	{
		name: 'ignore next, ignore if, and ignore else omit only their subtrees',
		source: [
			'/* istanbul ignore next */',
			'function hidden(value) { return value ? 1 : 2; }',
			'function choose(value) {',
			'  let result = 0;',
			'  /* istanbul ignore if */',
			'  if (value) result += hidden(value); else result += 3;',
			'  /* istanbul ignore else */',
			'  if (value) result += 4; else result += 5;',
			'  /* istanbul ignore next */',
			'  if (value) result += 6; else result += 7;',
			'  return result;',
			'}',
			'globalThis.result = [choose(false), choose(true)];',
		].join('\n'),
		result: [15, 11],
		expected: at => ({
			statementMap: {
				0: at(4, '0'), 1: at(6, 'if (value) result += hidden(value); else result += 3;'),
				2: at(6, 'result += 3;'), 3: at(8, 'if (value) result += 4; else result += 5;'),
				4: at(8, 'result += 4;'), 5: at(11, 'return result;'), 6: at(13, 'globalThis.result = [choose(false), choose(true)];'),
			},
			fnMap: { 0: { name: 'choose', decl: at(3, 'choose'), loc: loc(3, 23, 12, 1), line: 3 } },
			branchMap: {
				0: { type: 'if', loc: at(6, 'if (value) result += hidden(value); else result += 3;'), locations: [at(6, 'result += 3;')], line: 6 },
				1: { type: 'if', loc: at(8, 'if (value) result += 4; else result += 5;'), locations: [at(8, 'if (value) result += 4; else result += 5;')], line: 8 },
			},
			s: { 0: 2, 1: 2, 2: 1, 3: 2, 4: 1, 5: 2, 6: 1 }, f: { 0: 2 }, b: { 0: [1], 1: [1] },
		}),
	},
	{
		name: 'ignore hints survive intervening block and line comments',
		source: [
			'/* istanbul ignore next */',
			'/* reason */',
			'// another reason',
			'function hidden() { return 7; }',
			'function choose(value) {',
			'  /* istanbul ignore else */ /* reason */',
			'  if (value) return hidden(); else return 9;',
			'}',
			'globalThis.result = [choose(true), choose(false)];',
		].join('\n'),
		result: [7, 9],
		expected: at => ({
			statementMap: {
				0: at(7, 'if (value) return hidden(); else return 9;'),
				1: at(7, 'return hidden();'), 2: at(9, 'globalThis.result = [choose(true), choose(false)];'),
			},
			fnMap: { 0: { name: 'choose', decl: at(5, 'choose'), loc: loc(5, 23, 8, 1), line: 5 } },
			branchMap: {
				0: { type: 'if', loc: at(7, 'if (value) return hidden(); else return 9;'), locations: [at(7, 'if (value) return hidden(); else return 9;')], line: 7 },
			},
			s: { 0: 2, 1: 1, 2: 1 }, f: { 0: 2 }, b: { 0: [1] },
		}),
	},
	{
		name: 'static and instance field initializers count separately from arrow calls',
		source: [
			'class Fields {',
			'  static total = 3;',
			'  value = 2;',
			'  read = () => this.value + Fields.total;',
			'}',
			'const first = new Fields();',
			'const second = new Fields();',
			'globalThis.result = [first.read(), first.read(), second.read(), Fields.total];',
		].join('\n'),
		result: [5, 5, 5, 3],
		expected: at => ({
			statementMap: {
				0: at(2, '3'), 1: at(3, '2'), 2: at(4, '() => this.value + Fields.total'),
				3: at(4, 'this.value + Fields.total'), 4: at(6, 'new Fields()'), 5: at(7, 'new Fields()'),
				6: at(8, 'globalThis.result = [first.read(), first.read(), second.read(), Fields.total];'),
			},
			fnMap: { 0: { name: '(anonymous_0)', decl: at(4, '() =>', 1), loc: at(4, 'this.value + Fields.total'), line: 4 } },
			branchMap: {},
			s: { 0: 1, 1: 2, 2: 2, 3: 3, 4: 1, 5: 1, 6: 1 }, f: { 0: 3 }, b: {},
		}),
	},
	{
		name: 'for loop entry, initializer, if, and continue counters',
		source: [
			'let sum = 0;',
			'for (let i = 0; i < 4; i++) {',
			'  if (i === 1) continue;',
			'  sum += i;',
			'}',
			'globalThis.result = sum;',
		].join('\n'),
		result: 5,
		expected: at => ({
			statementMap: {
				0: at(1, '0'), 1: loc(2, 0, 5, 1), 2: at(2, '0'),
				3: at(3, 'if (i === 1) continue;'), 4: at(3, 'continue;'),
				5: at(4, 'sum += i;'), 6: at(6, 'globalThis.result = sum;'),
			},
			fnMap: {},
			branchMap: { 0: { type: 'if', loc: at(3, 'if (i === 1) continue;'), locations: [at(3, 'if (i === 1) continue;'), loc()], line: 3 } },
			s: { 0: 1, 1: 1, 2: 1, 3: 4, 4: 1, 5: 3, 6: 1 }, f: {}, b: { 0: [1, 3] },
		}),
	},
	{
		name: 'ignored initializer retains its parent statement but not function counters',
		source: 'const read = /* istanbul ignore next */ (() => 2);\nglobalThis.result = read();',
		result: 2,
		expected: at => ({
			statementMap: { 0: at(1, '() => 2'), 1: at(2, 'globalThis.result = read();') },
			fnMap: {}, branchMap: {}, s: { 0: 1, 1: 1 }, f: {}, b: {},
		}),
	},
];

describe('explicit ESTree coverage expectations', () => {
	for (const { name, source, result, expected } of coverageFixtures) {
		for (const compact of [false, true]) {
			it(`${name} (compact: ${compact})`, () => {
				const { actual, actualContext, coverage } = runtime(source, { compact });
				const specified = expected(sourceSpan(source));
				assert.deepEqual(plain(actualContext.result), result);
				assert.deepEqual(plain(coverageData(coverage)), plain(specified));
				for (const key of ['statementMap', 'fnMap', 'branchMap'])
					assert.deepEqual(plain(actual.lastFileCoverage()[key]), plain(specified[key]), key);
			});
		}
	}

	it('ignore file leaves the source unchanged and creates no runtime coverage', () => {
		const source = '/* istanbul ignore file */ function read() { return 7; } globalThis.result = read();';
		const { actual, code, coverage, actualContext } = runtime(source);
		assert.equal(code, source);
		assert.equal(actualContext.result, 7);
		assert.equal(coverage, undefined);
		assert.deepEqual(coverageData(actual.lastFileCoverage()), { statementMap: {}, fnMap: {}, branchMap: {}, s: {}, f: {}, b: {} });
	});
});

describe('ESTree instrumentation', () => {
	describe('complete configured coverage corpus (metadata only)', () => {
		const files = coverageFiles({ ...config, cwd: project }).files();
		it('selects production sources, the distribution, and plugins', () => {
			assert.ok(files.includes(join(project, 'src/uPlot.js')));
			assert.ok(files.includes(join(project, 'dist/uPlot.esm.js')));
			assert.ok(files.includes(join(project, 'demos/lib/heatmapPlugin.js')));
		});
		for (const file of files) {
			it(relative(project, file), () => {
				instrument(readFileSync(file, 'utf8'), { esModules: true }, file);
			});
		}
	});

	for (const [name, source] of fixtures) {
		it(name, () => runtime(source));
	}

	for (const source of [
		'export const fn = value => value + 1; export function named(value = 2) { return fn(value); }',
		'export default function(value = 1) { return value ? 2 : 3; }',
		'export default function named(value) { return value; }',
		'export default class { field = 1; method() { return this.field; } }',
		'export class Named { static method() { return 1; } } export default Named;',
		'const value = 1; export { value }; export { other } from "other"; export * from "another";',
	]) {
		it('module metadata: ' + source, () => {
			instrument(source, { esModules: true });
		});
	}

	it('honors ignored class methods', () => {
		const { coverage } = runtime('class Example { skipped() { return 1; } kept() { return 2; } } globalThis.result = [new Example().skipped(), new Example().kept()];', {
			ignoreClassMethods: ['skipped'],
		});
		assert.deepEqual(plain(counters(coverage)), { s: { 0: 1, 1: 1 }, f: { 0: 1 }, b: {} });
		assert.deepEqual(plain(coverage.fnMap), {
			0: { name: '(anonymous_0)', decl: loc(1, 40, 1, 41), loc: loc(1, 47, 1, 60), line: 1 },
		});
	});

	for (const options of [
		{ coverageVariable: '__alternateCoverage__' },
		{ coverageVariable: 'coverage-with-dashes' },
		{ coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false },
		{ coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: true },
		{ coverageVariable: '__custom__', coverageGlobalScope: 'holder', coverageGlobalScopeFunc: false },
	]) {
		it('coverage options ' + JSON.stringify(options), () => {
			const scope = context => options.coverageGlobalScope === 'holder' ? context.holder : context;
			const { actualContext, coverage } = runtime('globalThis.result = (() => 42)();', options, () => ({ holder: {} }), scope);
				assert.deepEqual(plain(counters(coverage)), { s: { 0: 1, 1: 1 }, f: { 0: 1 }, b: {} });
			assert.ok(scope(actualContext)[options.coverageVariable ?? '__coverage__'][filename]);
			if (options.coverageVariable || options.coverageGlobalScope === 'holder')
				assert.equal(actualContext.__coverage__, undefined);
		});
	}

	for (const declaration of [
		name => `const ${name} = 42; globalThis.result = ${name};`,
		name => `function ${name}() { return 42; } globalThis.result = ${name}();`,
		name => `if (true) { var ${name} = 42; } globalThis.result = ${name};`,
		name => `const { value: ${name} } = { value: 42 }; globalThis.result = ${name};`,
	]) {
		it('does not inject a helper over a program binding: ' + declaration('helper'), () => {
			const name = 'cov_' + parseInt(createHash('sha1').update(filename).digest('hex').slice(0, 12), 16).toString(36);
			const source = declaration(name);
			const actual = createInstrumenter();
			const code = actual.instrumentSync(source, filename);
			assert.equal(code, source);
			assert.equal(actual.lastFileCoverage(), undefined);
			assert.equal(execute(code).result, 42);
		});
	}

	it('preserves async execution and counters across await', async () => {
		const source = `
async function choose(value = 1) {
  await Promise.resolve();
  return value ? await Promise.resolve(2) : 3;
}
globalThis.done = (async () => { globalThis.result = [await choose(), await choose(0)]; })();`;
		const { code } = instrument(source);
		const actual = execute(code), expected = execute(source);
		await Promise.all([actual.done, expected.done]);
		assert.deepEqual(plain(actual.result), plain(expected.result));
		assert.deepEqual(plain(actual.result), [2, 3]);
		assert.deepEqual(plain(counters(actual.__coverage__[filename])), {
			s: { 0: 2, 1: 2, 2: 1, 3: 1 }, f: { 0: 2, 1: 1 }, b: { 0: [1], 1: [1, 1] },
		});
	});

	it('handles a local binding that shadows Function', () => {
		runtime('const Function = 17; globalThis.result = Function;');
	});

	it('preserves a top-level return when autoWrap is enabled', () => {
		const source = 'if (true) return 42; return 0;';
		const { code } = instrument(source, { autoWrap: true });
		const wrap = body => 'globalThis.result = (function() {\n' + body + '\n})();';
		const context = execute(wrap(code));
		assert.equal(context.result, execute(wrap(source)).result);
		assert.equal(context.result, 42);
		assert.deepEqual(plain(counters(context.__coverage__[filename])), {
			s: { 0: 1, 1: 1, 2: 0 }, f: {}, b: { 0: [1, 0] },
		});
	});

	for (const source of ['function {', 'const value = ;', 'let same; let same;', '"use strict"; with ({}) {}', 'class Broken { #field; method() { return this.#missing; } }']) {
		it('throws for invalid syntax: ' + source, () => {
			assert.throws(() => createInstrumenter().instrumentSync(source, filename), SyntaxError);
		});
	}

	it('rejects non-string source', () => {
		for (const source of [null, undefined, 42, {}, Buffer.from('let x = 1;')]) {
			assert.throws(() => createInstrumenter().instrumentSync(source, filename), /Code must be a string/);
		}
	});

	it('resets metadata between files without mutating earlier results', () => {
		const actual = createInstrumenter();
		assert.equal(actual.lastFileCoverage(), null);
		assert.equal(actual.lastSourceMap(), null);
		let previous;
		let saved;
		for (const [source, file, expected] of [
			['function first(x) { return x ? 1 : 2; } first(0);', filename, { s: { 0: 0, 1: 0 }, f: { 0: 0 }, b: { 0: [0, 0] } }],
			['const second = 2;', filename + '.second.js', { s: { 0: 0 }, f: {}, b: {} }],
			['/* istanbul ignore file */ const ignored = 3;', filename + '.ignored.js', { s: {}, f: {}, b: {} }],
			['', filename + '.empty.js', { s: {}, f: {}, b: {} }],
		]) {
			actual.instrumentSync(source, file);
			assertInitialCoverage(actual.lastFileCoverage(), source, file);
			assert.deepEqual(counters(actual.lastFileCoverage()), expected);
			if (previous) assert.deepEqual(plain(previous), saved);
			previous = actual.lastFileCoverage();
			saved = plain(previous);
		}
	});

	it('does not instrument already-instrumented code twice', () => {
		const source = 'globalThis.result = (globalThis.result || 0) + 1;';
		const { code } = instrument(source);
		const actual = createInstrumenter();
		const second = actual.instrumentSync(code, filename);
		assert.equal(second, code, 'repeat instrumentation must leave code unchanged');
		assertInitialCoverage(actual.lastFileCoverage(), source);
		assert.deepEqual(counters(actual.lastFileCoverage()), { s: { 0: 0 }, f: {}, b: { 0: [0, 0] } });
		const context = execute(second);
		assert.equal(context.result, 1);
		assert.deepEqual(plain(counters(context.__coverage__[filename])), { s: { 0: 1 }, f: {}, b: { 0: [1, 1] } });
		runInContext(second, context, { timeout: 1000 });
		assert.equal(context.result, 2);
		assert.deepEqual(plain(counters(context.__coverage__[filename])), { s: { 0: 2 }, f: {}, b: { 0: [2, 1] } });
	});

	it('shares counters for matching code but replaces stale coverage for changed code', () => {
		const instrumenter = createInstrumenter();
		const context = createContext({});
		const run = source => {
			runInContext(instrumenter.instrumentSync(source, filename), context, { timeout: 1000 });
			return context.__coverage__[filename];
		};
		const first = run('globalThis.result = 1;');
		assert.equal(context.result, 1);
		assert.deepEqual(plain(counters(first)), { s: { 0: 1 }, f: {}, b: {} });
		assert.strictEqual(run('globalThis.result = 1;'), first);
		assert.deepEqual(plain(counters(first)), { s: { 0: 2 }, f: {}, b: {} });
		const changed = run('globalThis.result = 2; globalThis.result++;');
		assert.notStrictEqual(changed, first);
		assert.notEqual(changed.hash, first.hash);
		assert.equal(context.result, 3);
		assert.deepEqual(plain(counters(changed)), { s: { 0: 1, 1: 1 }, f: {}, b: {} });
		assert.deepEqual(plain(changed.statementMap), { 0: loc(1, 0, 1, 22), 1: loc(1, 23, 1, 43) });
		assert.deepEqual(plain(counters(first)), { s: { 0: 2 }, f: {}, b: {} });
	});
});

function generatedPosition(code, token) {
	const offset = code.lastIndexOf(token);
	assert.ok(offset >= 0, 'generated token: ' + token);
	const lines = code.slice(0, offset).split('\n');
	return { line: lines.length, column: lines.at(-1).length };
}

const mappedSource = 'const mappedReturnToken = 40;\nfunction mappedRead() { return mappedReturnToken + 2; }\nglobalThis.result = mappedRead();\n';
const inputMap = {
	version: 3,
	file: basename(filename),
	sources: ['original.js'],
	sourcesContent: ['\n\n\n\n' + mappedSource],
	names: [],
	mappings: 'AAIA;AACA;AACA',
};

describe('ESTree source maps and callback API', () => {
	for (const input of [undefined, inputMap]) {
		it('maps generated tokens to ' + (input ? 'input-map original locations' : 'source locations'), () => {
			const { actual, code } = instrument(mappedSource, { produceSourceMap: true }, filename, input);
			const map = actual.lastSourceMap();
			assert.equal(map.version, 3);
			assert.deepEqual(map.sourcesContent, [input ? input.sourcesContent[0] : mappedSource]);
			const position = originalPositionFor(new TraceMap(map), generatedPosition(code, 'mappedReturnToken'));
			assert.equal(basename(position.source), input ? 'original.js' : basename(filename));
			assert.equal(position.line, input ? 6 : 2);
			assert.equal(position.column, input ? 0 : 31);
			assert.deepEqual(actual.lastFileCoverage().inputSourceMap, input);
			assert.equal(execute(code).result, 42);
		});
	}

	it('does not produce a source map when disabled', () => {
		const { actual } = instrument(mappedSource, { produceSourceMap: false }, filename, inputMap);
		assert.equal(actual.lastSourceMap(), null);
		assert.deepEqual(actual.lastFileCoverage().inputSourceMap, inputMap);
	});

	it('reports the last source-map comment exactly once', () => {
		const source = 'let value = 1; //# sourceMappingURL=first.map\n' +
			'globalThis.result = value;\n/*# sourceMappingURL=last.map*/';
		const calls = [];
		const instrumenter = createInstrumenter({ sourceMapUrlCallback: (...args) => calls.push(args) });
		assert.equal(execute(instrumenter.instrumentSync(source, filename, false)).result, 1);
		assert.deepEqual(calls, [[filename, 'last.map']]);
		instrumenter.instrumentSync('globalThis.result = 2;', filename);
		assert.deepEqual(calls, [[filename, 'last.map']], 'no callback without a map comment');
	});

	it('replaces source maps on successive calls', () => {
		const actual = createInstrumenter({ produceSourceMap: true });
		actual.instrumentSync(mappedSource, filename, inputMap);
		const first = actual.lastSourceMap();
		const saved = plain(first);
		actual.instrumentSync('globalThis.result = 7;', filename + '.second.js');
		assert.notStrictEqual(actual.lastSourceMap(), first);
		assert.deepEqual(plain(first), saved);
		assert.deepEqual(actual.lastSourceMap().sourcesContent, ['globalThis.result = 7;']);
		assert.equal(actual.lastFileCoverage().inputSourceMap, undefined);
		actual.instrumentSync('/* istanbul ignore file */ const ignored = 1;', filename);
		assert.equal(actual.lastSourceMap(), null);
	});

	it('returns generated code and input-map metadata through the callback', { timeout: 2000 }, async () => {
		const actual = createInstrumenter({ produceSourceMap: true });
		let calls = 0;
		const code = await new Promise((resolve, reject) => {
			actual.instrument(mappedSource, filename, (error, result) => {
				calls++;
				if (error) reject(error); else resolve(result);
			}, inputMap);
		});
		assert.equal(calls, 1);
		assertInitialCoverage(actual.lastFileCoverage(), mappedSource);
		assert.deepEqual(counters(actual.lastFileCoverage()), { s: { 0: 0, 1: 0, 2: 0 }, f: { 0: 0 }, b: {} });
		assert.deepEqual(actual.lastFileCoverage().inputSourceMap, inputMap);
		assert.equal(execute(code).result, 42);
		assert.equal(originalPositionFor(new TraceMap(actual.lastSourceMap()), generatedPosition(code, 'mappedReturnToken')).line, 6);
	});

	it('accepts the callback overload without a filename', { timeout: 2000 }, async () => {
		const actual = createInstrumenter();
		const code = await new Promise((resolve, reject) => {
			actual.instrument('globalThis.result = 5;', (error, result) => error ? reject(error) : resolve(result));
		});
		assert.equal(execute(code).result, 5);
		assert.equal(typeof actual.lastFileCoverage().path, 'string');
		assert.ok(actual.lastFileCoverage().path.length > 0);
	});

	it('reports syntax errors through the callback and can then instrument valid code', { timeout: 2000 }, async () => {
		const actual = createInstrumenter();
		let calls = 0;
		const failure = await new Promise(resolve => {
			assert.doesNotThrow(() => actual.instrument('function {', filename, (error, code) => {
				calls++;
				resolve({ error, code });
			}));
		});
		assert.equal(calls, 1);
		assert.ok(failure.error instanceof SyntaxError);
		assert.equal(failure.code, undefined);
		assert.equal(execute(actual.instrumentSync('globalThis.result = 6;', filename)).result, 6);
	});
});

describe('explicitly unsupported instrumenter options', () => {
	for (const [name, options] of [
		['reportLogic', { reportLogic: true }],
		['preserveComments', { preserveComments: true }],
		['parserPlugins', { parserPlugins: ['jsx'] }],
		['generatorOpts', { generatorOpts: { comments: true } }],
	]) {
		it('rejects ' + name, () => {
			assert.throws(() => createInstrumenter(options).instrumentSync('globalThis.result = 1;', filename), error => {
				assert.match(error.message, new RegExp(name, 'i'));
				assert.match(error.message, /unsupported|not supported|not implemented|does not support/i);
				return true;
			});
		});
	}
});
