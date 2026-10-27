import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { parseSource, generateSource } from '../../scripts/vendor/istanbul/backend.mjs';
import { createInstrumenter } from '../../scripts/vendor/istanbul/index.mjs';

// Keep the old metadata AST builder as an independent byte/map reference.
const identifierPattern = /^[$A-Z_a-z][$\w]*$/;
const identifier = name => ({ type: 'Identifier', name });
const literal = value => ({ type: 'Literal', value });
function valueNode(value) {
	if (Array.isArray(value)) return { type: 'ArrayExpression', elements: value.map(valueNode) };
	if (value != null && typeof value === 'object') {
		const properties = [];
		for (const name of Object.keys(value)) {
			const item = value[name];
			if (item !== undefined) properties.push({
				type: 'Property', key: identifierPattern.test(name) ? identifier(name) : literal(name),
				value: valueNode(item), kind: 'init', computed: false, method: false, shorthand: false,
			});
		}
		return { type: 'ObjectExpression', properties };
	}
	return value === undefined ? identifier('undefined') : literal(value);
}

const filename = '/fixtures/metadata.js';
const escapedText = 'newline\ncarriage\r\n"double" \'single\' \\backslash\t\b\f\0\u2028\u2029 astral:\u{1f600} high:\ud800 low:\udfff';
const escapedFilename = '/fixtures/"quote"-\'single\'-\\slash-\n\r-\u2028\u2029-\u{1f600}-\ud800.js';
const instrumentSource = [
	'function choose(value) {',
	"  const original = { type: 'CoverageData', value: ['kept', 0x2a] };",
	'  return value ? original.value[1] + value : 2;',
	'}',
	'globalThis.result = choose(0) + choose(4);',
	'',
].join('\n');
const inputSourceMap = {
	version: 3,
	file: escapedFilename,
	sources: ['metadata-original.js'],
	sourcesContent: ['\n\n\n\n' + instrumentSource + '/* ' + escapedText + ' */\n'],
	names: [],
	mappings: 'AAIA;AACA;AACA;AACA;AACA',
};
const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } };
const coverageFixture = {
	path: escapedFilename,
	statementMap: { 0: location },
	fnMap: { 0: { name: 'choose', decl: location, loc: location, line: 1 } },
	branchMap: { 0: { loc: location, type: 'cond-expr', locations: [location, location], line: 1 } },
	s: { 0: 0 },
	f: { 0: 0 },
	b: { 0: [0, 0] },
	inputSourceMap,
	_coverageSchema: 'test-schema',
	hash: 'test-hash',
};
const sparse = new Array(5);
sparse[1] = undefined;
sparse[3] = { nested: [] };
const fixtures = [
	['coverage and source-map metadata', coverageFixture],
	['nested arrays and empty objects', { empty: {}, omitted: { missing: undefined }, arrays: [[], {}, [null, {}, []]] }],
	['undefined properties, entries, and sparse holes', { omitted: undefined, entries: [undefined, null, undefined], sparse, holes: new Array(2) }],
	['identifier, quoted, numeric, and Unicode keys', {
		plain: 1, $valid_2: 2, default: 3, '': 4, 'two words': 5, 'hyphen-key': 6,
		'0': 7, '12': 8, '01': 9, '-1': 10, 'é': 11, '漢字': 12, '😀': 13,
		'quote"\\\n\r\u2028\u2029': 14,
	}],
	['escaped strings and AST-shaped data', { text: escapedText, type: 'Literal', value: { type: 'CoverageData', value: ['ordinary data'] } }],
	['booleans, null, and numeric serialization', { values: [true, false, null, 0, -0, -1, 1.25, 1e30, NaN, Infinity, -Infinity] }],
	['top-level empty object', {}],
	['top-level empty array', []],
	['top-level string', escapedText],
	['top-level undefined', undefined],
	['top-level null', null],
	['top-level boolean', false],
	['top-level negative zero', -0],
	['top-level nonfinite number', Infinity],
];
const source = [
	"const beforeMetadata = { value: 0x2a, text: 'before' };",
	'function readMetadata() {',
	"  const metadata = PLACEHOLDER, afterMetadata = { type: 'CoverageData', value: ['after', 0x2a] };",
	'  return [metadata, afterMetadata];',
	'}',
	'globalThis.result = readMetadata();',
	'',
].join('\n');

function metadataAst(value, custom) {
	const { ast } = parseSource(source);
	const declaration = ast.body[1].body.body[0].declarations[0];
	assert.equal(declaration.init.name, 'PLACEHOLDER');
	declaration.init = custom ? { type: 'CoverageData', value } : valueNode(value);
	return ast;
}

function position(code, token) {
	const offset = code.lastIndexOf(token);
	assert.ok(offset >= 0, 'missing token: ' + token);
	const lines = code.slice(0, offset).split('\n');
	return { line: lines.length, column: lines.at(-1).length };
}

function execute(code) {
	const context = createContext({});
	runInContext(code, context, { timeout: 1000 });
	return context;
}

const plain = value => JSON.parse(JSON.stringify(value));

describe('ESTree CoverageData metadata emission', () => {
	for (const compact of [false, true]) {
		for (const produceSourceMap of [false, true]) {
			for (const [name, value] of fixtures) {
				it(`${name} (compact: ${compact}, maps: ${produceSourceMap})`, () => {
					const options = { compact, produceSourceMap };
					const ast = metadataAst(value, true);
					const snapshot = structuredClone(ast);
					const expected = generateSource(metadataAst(value, false), source, filename, options);
					const actual = generateSource(ast, source, filename, options);
					assert.equal(actual.code, expected.code, 'exact legacy code bytes');
					assert.deepEqual(actual.map, expected.map, 'exact legacy source map');
					assert.deepEqual(ast, snapshot, 'generation must not mark or mutate parsed nodes or metadata');
					assert.ok(actual.code.includes("text: 'before'"), 'preserve original string raw spelling');
					assert.ok(actual.code.includes("value: ['after', 0x2a]"), 'ordinary parsed objects are not metadata');

					if (produceSourceMap) {
						assert.deepEqual(actual.map.sourcesContent, [source]);
						const map = new TraceMap(actual.map);
						// Include literals on the same source line after the initializer,
						// as well as identifiers on later lines and before the metadata.
						for (const token of ["'before'", "'after'", '0x2a', 'afterMetadata', 'readMetadata();']) {
							const original = originalPositionFor(map, position(actual.code, token));
							assert.deepEqual({ source: original.source, line: original.line, column: original.column }, {
								source: filename, ...position(source, token),
							}, 'source position for ' + token);
						}
					}
					else
						assert.equal(actual.map, null);
				});
			}
		}

		it(`preserves undefined entries, sparse holes, and legacy numeric values at runtime (compact: ${compact})`, () => {
			const value = { omitted: undefined, entries: [undefined, null], sparse, numbers: [-0, NaN, Infinity, -Infinity] };
			const { code } = generateSource(metadataAst(value, true), source, filename, { compact, produceSourceMap: false });
			const result = execute(code).result[0];
			assert.equal(Object.hasOwn(result, 'omitted'), false);
			assert.equal(result.entries.length, 2);
			assert.equal(Object.hasOwn(result.entries, 0), true);
			assert.equal(result.entries[0], undefined);
			assert.equal(result.entries[1], null);
			assert.equal(result.sparse.length, 5);
			assert.deepEqual(Object.keys(result.sparse), ['1', '3']);
			assert.equal(result.sparse[1], undefined);
			assert.deepEqual(plain(result.sparse[3]), { nested: [] });
			// Literal generation historically uses JSON numeric serialization.
			assert.equal(Object.is(result.numbers[0], 0), true);
			assert.deepEqual(Array.from(result.numbers).slice(1), [null, null, null]);
		});
	}
});

describe('ESTree instrumenter metadata integration', () => {
	for (const compact of [false, true]) {
		it(`round-trips escaped metadata, coverage, and source maps (compact: ${compact})`, () => {
			const options = { compact, produceSourceMap: true };
			const instrumenter = createInstrumenter(options);
			const inputSnapshot = structuredClone(inputSourceMap);
			const code = instrumenter.instrumentSync(instrumentSource, escapedFilename, inputSourceMap);
			const initial = structuredClone(instrumenter.lastFileCoverage());
			assert.deepEqual(inputSourceMap, inputSnapshot, 'input source map is not mutated');
			assert.equal(initial.path, escapedFilename);
			assert.deepEqual(initial.inputSourceMap, inputSourceMap);

			const context = execute(code);
			assert.equal(context.result, 48);
			assert.deepEqual(Object.keys(context.__coverage__), [escapedFilename]);
			const coverage = context.__coverage__[escapedFilename];
			for (const key of ['path', 'statementMap', 'fnMap', 'branchMap', 'inputSourceMap'])
				assert.deepEqual(plain(coverage[key]), initial[key], 'runtime metadata: ' + key);
			assert.deepEqual(plain(coverage.s), { 0: 2, 1: 2, 2: 1 });
			assert.deepEqual(plain(coverage.f), { 0: 2 });
			assert.deepEqual(plain(coverage.b), { 0: [1, 1] });
			assert.deepEqual(instrumenter.lastFileCoverage(), initial, 'runtime counters do not mutate initial metadata');

			const sourceMap = instrumenter.lastSourceMap();
			assert.deepEqual(sourceMap.sourcesContent, inputSourceMap.sourcesContent);
			const map = new TraceMap(sourceMap);
			for (const [token, line] of [['original.value', 7], ['choose(4)', 9]]) {
				const original = originalPositionFor(map, position(code, token));
				assert.equal(original.source, 'metadata-original.js');
				assert.equal(original.line, line);
				assert.equal(original.column, 0);
			}

			const repeat = createInstrumenter(options);
			const repeatedCode = repeat.instrumentSync(code, escapedFilename, sourceMap);
			assert.equal(repeatedCode, code, 're-instrumentation leaves every byte unchanged');
			assert.deepEqual(repeat.lastFileCoverage(), initial, 'recover escaped metadata from generated code');
			assert.deepEqual(repeat.lastSourceMap(), sourceMap);
			const once = plain({ s: coverage.s, f: coverage.f, b: coverage.b });
			runInContext(repeatedCode, context, { timeout: 1000 });
			assert.equal(context.result, 48);
			assert.equal(context.__coverage__[escapedFilename], coverage, 'reuse existing coverage object');
			for (const key of ['s', 'f'])
				assert.deepEqual(plain(coverage[key]), Object.fromEntries(Object.entries(once[key]).map(([id, count]) => [id, count * 2])));
			assert.deepEqual(plain(coverage.b), { 0: [2, 2] });
		});
	}
});
