import {parseModule, parseScript} from 'meriyah';
import {generate, GENERATOR, EXPRESSIONS_PRECEDENCE} from 'astring';
import {GenMapping, addMapping, setSourceContent, toEncodedMap} from '@jridgewell/gen-mapping';
import remapping from '@jridgewell/remapping';

function validateOptions(options) {
	for (const name of ['generatorOpts', 'parserPlugins']) {
		if (options[name] != null && Object.keys(options[name]).length !== 0)
			throw new Error(`The ESTree Istanbul backend does not support nonempty ${name}.`);
	}

	if (options.preserveComments)
		throw new Error('The ESTree Istanbul backend does not support preserveComments: true.');
}

export function parseSource(source, options = {}) {
	validateOptions(options);

	const comments = [];
	const parse = options.esModules === true ? parseModule : parseScript;
	const ast = parse(source, {
		loc: true,
		ranges: {start: true, end: true, range: false},
		raw: true,
		lexical: true,
		validateRegex: true,
		// Meriyah 7 emits directive metadata unconditionally. Its equivalent
		// of allowReturnOutsideFunction is globalReturn (scripts only).
		globalReturn: options.esModules !== true && options.autoWrap === true,
		onComment: comments,
	});

	for (const comment of comments)
		comment.type = comment.type === 'MultiLine' ? 'Block' : 'Line';

	return {ast, comments};
}

const generator = {
	...GENERATOR,

	ChainExpression(node, state) {
		// Keep the complete chain separate from outer calls, members, and tags.
		// Parentheses preserve references (including method receivers and delete).
		this.ParenthesizedExpression(node, state);
	},

	ParenthesizedExpression(node, state) {
		state.write('(');
		this[node.expression.type](node.expression, state);
		state.write(')');
	},

	ExpressionStatement(node, state) {
		// Meriyah discards parentheses. A parenthesized string must not become
		// a directive, including when instrumentation moves surrounding code.
		if (node.directive == null && node.expression.type === 'Literal' && typeof node.expression.value === 'string') {
			state.write('(');
			this.Literal(node.expression, state);
			state.write(');');
		}
		else
			GENERATOR.ExpressionStatement.call(this, node, state);
	},
};

const expressionsPrecedence = {
	...EXPRESSIONS_PRECEDENCE,
	ParenthesizedExpression: 20,
};

export function generateSource(ast, source, filename, options = {}, inputSourceMap) {
	validateOptions(options);

	const mapping = options.produceSourceMap === false ? null : new GenMapping({file: filename});
	let sourceMap;

	if (mapping != null) {
		setSourceContent(mapping, filename, source);
		sourceMap = {
			// Astring uses file as the source name and supplies one-based lines,
			// matching addMapping (not the zero-based addSegment API).
			file: filename,
			addMapping(entry) {
				addMapping(mapping, entry);
			},
		};
	}

	const hashbang = /^(#![^\r\n\u2028\u2029]*)/.exec(source);
	const code = generate(ast, {
		generator: {
			...generator,
			Program(node, state) {
				// Emit this through Astring so generated map lines include it.
				if (hashbang != null)
					state.write(hashbang[1] + '\n');

				GENERATOR.Program.call(this, node, state);
			},
		},
		expressionsPrecedence,
		indent: options.compact === true ? '' : '  ',
		// Keep line breaks even in compact mode: deleting them can change
		// literals, ASI, or the meaning of a shebang.
		lineEnd: '\n',
		sourceMap,
	});

	let map = mapping == null ? null : toEncodedMap(mapping);

	if (map != null && inputSourceMap != null && inputSourceMap !== false)
		map = {...remapping([map, inputSourceMap], () => null)};

	return {code, map};
}
