// Derived from istanbul-lib-instrument 6.0.3. See LICENSE and README.md.
import { createHash } from 'node:crypto';
import { SourceCoverage } from './source-coverage.cjs';
import { parseSource, generateSource } from './backend.mjs';

const MAGIC_KEY = '_coverageSchema';
const MAGIC_VALUE = createHash('sha1').update('istanbul-lib-instrument@4').digest('hex');
const hash = value => createHash('sha1').update(value).digest('hex');
const identifier = name => ({ type: 'Identifier', name });
const literal = value => ({ type: 'Literal', value });
const call = name => ({ type: 'CallExpression', callee: identifier(name), arguments: [], optional: false });
const member = (object, property) => ({ type: 'MemberExpression', object, property: literal(property), computed: true, optional: false });
const statement = expression => ({ type: 'ExpressionStatement', expression });
const block = body => ({ type: 'BlockStatement', body });
const sequence = expressions => ({ type: 'SequenceExpression', expressions });
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const statementTypes = new Set(['ExpressionStatement', 'BreakStatement', 'ContinueStatement', 'DebuggerStatement', 'ReturnStatement', 'ThrowStatement', 'TryStatement', 'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'WithStatement', 'LabeledStatement']);
const visitorTypes = new Set([...statementTypes, ...functionTypes, 'AssignmentPattern', 'BlockStatement', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'VariableDeclaration', 'VariableDeclarator', 'ClassDeclaration', 'PropertyDefinition', 'SwitchCase', 'ConditionalExpression', 'LogicalExpression']);
const hoistedTypes = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression']);
const loopTypes = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const conditionalBranches = ['consequent', 'alternate'];

const hintPattern = /^\s*istanbul\s+ignore\s+(if|else|next)(?=\W|$)/;
const sourceMapPattern = /[#@]\s*sourceMappingURL=(.*)\s*$/m;
const noChildren = [];
const keys = {
	Program: ['body'], BlockStatement: ['body'], StaticBlock: ['body'],
	FunctionDeclaration: ['id', 'params', 'body'], FunctionExpression: ['id', 'params', 'body'], ArrowFunctionExpression: ['params', 'body'],
	ClassDeclaration: ['id', 'superClass', 'body'], ClassExpression: ['id', 'superClass', 'body'], ClassBody: ['body'],
	MethodDefinition: ['key', 'value'], PropertyDefinition: ['key', 'value'], Property: ['key', 'value'],
	VariableDeclaration: ['declarations'], VariableDeclarator: ['id', 'init'],
	IfStatement: ['test', 'consequent', 'alternate'], ForStatement: ['init', 'test', 'update', 'body'],
	ForInStatement: ['left', 'right', 'body'], ForOfStatement: ['left', 'right', 'body'],
	WhileStatement: ['test', 'body'], DoWhileStatement: ['body', 'test'],
	SwitchStatement: ['discriminant', 'cases'], SwitchCase: ['test', 'consequent'],
	TryStatement: ['block', 'handler', 'finalizer'], CatchClause: ['param', 'body'],
	Identifier: noChildren, PrivateIdentifier: noChildren, Literal: noChildren,
	ThisExpression: noChildren, Super: noChildren, TemplateElement: noChildren,
	EmptyStatement: noChildren, DebuggerStatement: noChildren,
	ExpressionStatement: ['expression'], ReturnStatement: ['argument'], ThrowStatement: ['argument'],
	BreakStatement: ['label'], ContinueStatement: ['label'], LabeledStatement: ['label', 'body'], WithStatement: ['object', 'body'],
	ArrayExpression: ['elements'], ArrayPattern: ['elements'], ObjectExpression: ['properties'], ObjectPattern: ['properties'],
	SequenceExpression: ['expressions'], AssignmentExpression: ['left', 'right'], AssignmentPattern: ['left', 'right'],
	BinaryExpression: ['left', 'right'], LogicalExpression: ['left', 'right'], ConditionalExpression: ['test', 'consequent', 'alternate'],
	UnaryExpression: ['argument'], UpdateExpression: ['argument'], SpreadElement: ['argument'], RestElement: ['argument'],
	CallExpression: ['callee', 'arguments'], NewExpression: ['callee', 'arguments'], MemberExpression: ['object', 'property'],
	ChainExpression: ['expression'], ParenthesizedExpression: ['expression'], AwaitExpression: ['argument'], YieldExpression: ['argument'],
	TemplateLiteral: ['expressions', 'quasis'], TaggedTemplateExpression: ['tag', 'quasi'],
};

function childKeys(node) {
	return keys[node.type] ?? Object.keys(node).filter(key => {
		const value = node[key];
		return value && (typeof value.type === 'string' || Array.isArray(value) && value.some(item => item && typeof item.type === 'string'));
	});
}

function scan(node, callback) {
	if (!node || typeof node.type !== 'string') return;
	callback(node);
	for (const key of childKeys(node)) {
		const value = node[key];
		if (Array.isArray(value)) {
			for (const child of value) scan(child, callback);
		}
		else scan(value, callback);
	}
}

function attachHints(ast, comments, source) {
	if (!comments.some(comment => hintPattern.test(comment.value))) return;
	const nodes = [];
	scan(ast, node => { if (node.type !== 'Program') nodes.push(node); });
	nodes.sort((a, b) => a.start - b.start || b.end - a.end);
	for (const comment of comments) {
		const hint = hintPattern.exec(comment.value)?.[1];
		if (!hint) continue;
		// Comments before an expression may sit inside its grouping parentheses.
		let low = 0, high = nodes.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (nodes[mid].start < comment.end) low = mid + 1;
			else high = mid;
		}
		const next = nodes[low];
		if (!next) continue;
		let gap = '', offset = comment.end;
		for (const trivia of comments) {
			if (trivia.start >= offset && trivia.end <= next.start) {
				gap += source.slice(offset, trivia.start);
				offset = trivia.end;
			}
		}
		gap += source.slice(offset, next.start);
		if (/^[\s(]*$/.test(gap)) next.coverageHint = hint;
	}
}


function staticValue(node) {
	if (node.type === 'Literal') return node.value;
	if (node.type === 'ArrayExpression') return node.elements.map(staticValue);
	if (node.type === 'ObjectExpression') {
		const result = {};
		for (const prop of node.properties) {
			if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') throw new Error('Nonliteral coverage metadata');
			Object.defineProperty(result, prop.key.name ?? prop.key.value, { value: staticValue(prop.value), enumerable: true, configurable: true, writable: true });
		}
		return result;
	}
	if (node.type === 'UnaryExpression' && node.operator === '-') return -staticValue(node.argument);
	throw new Error('Nonliteral coverage metadata');
}

function initialCoverage(ast, name) {
	const fn = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
	if (!fn) return null;
	const declaration = fn.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
		.find(node => node.id.name === 'coverageData');
	if (!declaration) return null;
	try {
		const data = staticValue(declaration.init);
		if (data[MAGIC_KEY] !== MAGIC_VALUE) return null;
		delete data[MAGIC_KEY];
		delete data.hash;
		return data;
	}
	catch { return null; }
}

function hasProgramBinding(ast, name) {
	function binds(pattern) {
		if (!pattern) return false;
		if (pattern.type === 'Identifier') return pattern.name === name;
		if (pattern.type === 'RestElement') return binds(pattern.argument);
		if (pattern.type === 'AssignmentPattern') return binds(pattern.left);
		if (pattern.type === 'ArrayPattern') return pattern.elements.some(binds);
		if (pattern.type === 'ObjectPattern') return pattern.properties.some(prop => binds(prop.type === 'RestElement' ? prop.argument : prop.value));
		return false;
	}
	function visit(node, topLevel) {
		if (!node) return false;
		if (node.type === 'VariableDeclaration' && (topLevel || node.kind === 'var') && node.declarations.some(decl => binds(decl.id))) return true;
		if (node.type === 'ImportDeclaration') return node.specifiers.some(specifier => binds(specifier.local));
		if (functionTypes.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression')
			return topLevel && binds(node.id);
		if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') return visit(node.declaration, topLevel);
		return childKeys(node).some(key => {
			const value = node[key];
			return Array.isArray(value) ? value.some(child => visit(child, false)) : visit(value, false);
		});
	}
	return ast.body.some(node => visit(node, true));
}

class Visitor {
	constructor(filename, options, inputSourceMap) {
		this.options = options;
		this.name = 'cov_' + parseInt(hash(filename).slice(0, 12), 16).toString(36);
		this.coverage = new SourceCoverage(filename);
		if (inputSourceMap !== undefined) this.coverage.inputSourceMap(inputSourceMap);
		this.before = new WeakMap();
		this.wrappers = new WeakMap();
		this.parents = new WeakMap();
		this.skipped = new WeakSet();
		this.methodValues = new WeakSet();
		this.switches = new WeakMap();
	}

	increment(type, id, index) {
		let target = member(member(call(this.name), type), id);
		if (index !== undefined) target = member(target, index);
		return { type: 'UpdateExpression', operator: '++', argument: target, prefix: false };
	}

	wrap(node, increment) {
		if (!this.wrappers.has(node)) this.wrappers.set(node, []);
		this.wrappers.get(node).push(increment);
		// Babel transfers leading comments onto the generated sequence, which has
		// no coverage visitor. Keep parent-requested counters and visit the child.
		delete node.coverageHint;
	}

	prepend(node, increment) {
		// A loop must remain the direct target of its label for labeled continue.
		while (this.parents.get(node)?.type === 'LabeledStatement')
			node = this.parents.get(node);
		if (!this.before.has(node)) this.before.set(node, []);
		this.before.get(node).push(statement(increment));
	}

	insert(node, increment, parent, key) {
		if (node.type === 'BlockStatement') node.body.unshift(statement(increment));
		else if (node.type.endsWith('Statement')) this.prepend(node, increment);
		else if (hoistedTypes.has(node.type) && parent?.type === 'VariableDeclarator') {
			const declaration = this.parents.get(parent);
			const owner = this.parents.get(declaration);
			if (owner?.type === 'ExportNamedDeclaration') this.prepend(owner, increment);
			else if (owner?.type === 'Program' || owner?.type === 'BlockStatement') this.prepend(declaration, increment);
			else this.wrap(node, increment);
		}
		else this.wrap(node, increment);
	}

	statement(node, parent, key) {
		if (node?.loc) this.insert(node, this.increment('s', this.coverage.newStatement(node.loc)), parent, key);
	}

	branch(node, id, loc = node.loc) {
		const increment = this.increment('b', id, this.coverage.addBranchPath(id, loc));
		this.insert(node, increment);
	}

	makeBlock(node) {
		if (node?.type === 'BlockStatement') return node;
		const wrapped = block(node ? [node] : []);
		if (node) {
			wrapped.loc = node.loc;
			wrapped.coverageHint = node.coverageHint;
			delete node.coverageHint;
		}
		return wrapped;
	}

	func(node, declaration = node) {
		if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
			const body = node.body;
			node.body = { ...block([{ type: 'ReturnStatement', argument: body, loc: body.loc }]), loc: body.loc };
			node.expression = false;
		}
		const start = declaration.loc.start;
		const decl = node.id?.loc ?? { start, end: { line: start.line, column: start.column + 1 } };
		const id = this.coverage.newFunction(node.id?.name, decl, node.body.loc);
		const offset = node.body.body.findIndex(item => item.directive == null);
		node.body.body.splice(offset < 0 ? node.body.body.length : offset, 0, statement(this.increment('f', id)));
	}

	logical(node, parent) {
		if (parent?.type === 'LogicalExpression') return;
		const id = this.coverage.newBranch('binary-expr', node.loc);
		this.logicalLeaves(node, id);
	}

	logicalLeaves(node, id) {
		if (node.coverageHint === 'next') return;
		if (node.type === 'LogicalExpression') {
			this.logicalLeaves(node.left, id);
			this.logicalLeaves(node.right, id);
		}
		else this.branch(node, id);
	}

	visit(node, parent, key, ignored = false) {
		if (!node || typeof node.type !== 'string') return node;
		// Parsed nodes and converted arrow bodies have locations. Locationless
		// children here are generated counters, with no source subtree to visit.
		if (!node.loc) return node;
		this.parents.set(node, parent);
		if (ignored || this.skipped.has(node)) return node;
		if (node.coverageHint === 'next' && (visitorTypes.has(node.type) ||
			node.type === 'MethodDefinition' && node.key.type !== 'PrivateIdentifier' ||
			node.type === 'Property' && (node.method || node.kind !== 'init'))) return node;
		if (node.type === 'FunctionExpression' && node.id && this.options.ignoreClassMethods.includes(node.id.name)) return node;
		if (node.type === 'MethodDefinition' && this.options.ignoreClassMethods.includes(node.key.name)) return node;

		if (node.loc) {
			if (node.type === 'IfStatement') {
				node.consequent = this.makeBlock(node.consequent);
				node.alternate = this.makeBlock(node.alternate);
			}
			else if (loopTypes.has(node.type))
				node.body = this.makeBlock(node.body);
			if (node.type === 'SwitchStatement')
				this.switches.set(node, this.coverage.newBranch('switch', node.loc));

			if (statementTypes.has(node.type) && node.directive == null) this.statement(node, parent, key);
			if (functionTypes.has(node.type) && !this.methodValues.has(node)) this.func(node);
			if (node.type === 'MethodDefinition' || node.type === 'Property' && (node.method || node.kind !== 'init')) {
				this.methodValues.add(node.value);
				// Istanbul 6 does not assign function counters to private class methods.
				if (node.key.type !== 'PrivateIdentifier') this.func(node.value, node);
			}

			switch (node.type) {
				case 'VariableDeclarator': this.statement(node.init, node, 'init'); break;
				case 'PropertyDefinition': this.statement(node.value, node, 'value'); break;
				case 'AssignmentPattern': {
					const id = this.coverage.newBranch('default-arg', node.loc);
					this.branch(node.right, id);
					break;
				}
				case 'IfStatement': {
					const id = this.coverage.newBranch('if', node.loc);
					if (node.coverageHint === 'if') this.skipped.add(node.consequent);
					else this.branch(node.consequent, id, node.loc);
					if (node.coverageHint === 'else') this.skipped.add(node.alternate);
					else this.branch(node.alternate, id);
					break;
				}
				case 'SwitchCase': {
					const id = this.switches.get(parent);
					node.consequent.unshift(statement(this.increment('b', id, this.coverage.addBranchPath(id, node.loc))));
					break;
				}
				case 'ConditionalExpression': {
					const id = this.coverage.newBranch('cond-expr', node.loc);
					for (const prop of conditionalBranches)
						if (node[prop].coverageHint !== 'next') this.branch(node[prop], id);
					break;
				}
				case 'LogicalExpression': this.logical(node, parent); break;
			}
		}

		for (const prop of childKeys(node)) {
			const child = node[prop];
			if (Array.isArray(child)) {
				let expanded;
				for (let i = 0; i < child.length; i++) {
					const item = child[i];
					const result = item ? this.visit(item, node, prop) : item;
					const before = item && this.before.get(item);
					if (before) {
						expanded ??= child.slice(0, i);
						for (const counter of before) expanded.push(counter);
					}
					if (expanded) expanded.push(result);
					else child[i] = result;
				}
				if (expanded) node[prop] = expanded;
			}
			else if (child && typeof child.type === 'string') {
				const result = this.visit(child, node, prop);
				const before = this.before.get(child);
				node[prop] = before ? block([...before, result]) : result;
			}
		}
		const wrappers = this.wrappers.get(node);
		return wrappers ? sequence([...wrappers, node]) : node;
	}
}

class Instrumenter {
	constructor(options = {}) {
		this.opts = {
			coverageVariable: '__coverage__', coverageGlobalScope: 'this', coverageGlobalScopeFunc: true,
			ignoreClassMethods: [], esModules: false, autoWrap: false, produceSourceMap: false, compact: true,
			...options,
		};
		if (this.opts.reportLogic) throw new Error('reportLogic is not supported by the ESTree prototype');
		this.fileCoverage = null;
		this.sourceMap = null;
	}

	instrumentSync(source, filename = String(Date.now()) + '.js', inputSourceMap) {
		if (typeof source !== 'string') throw new Error('Code must be a string');
		const { ast, comments } = parseSource(source, this.opts);
		const visitor = new Visitor(filename, this.opts, inputSourceMap);
		const existing = initialCoverage(ast, visitor.name);
		if (existing || hasProgramBinding(ast, visitor.name)) {
			this.fileCoverage = existing ?? undefined;
			this.sourceMap = inputSourceMap;
			return source;
		}
		if (comments.some(comment => /^\s*istanbul\s+ignore\s+file(?=\W|$)/.test(comment.value))) {
			this.fileCoverage = visitor.coverage.toJSON();
			this.sourceMap = null;
			return source;
		}
		attachHints(ast, comments, source);
		visitor.visit(ast);
		visitor.coverage.freeze();
		this.fileCoverage = visitor.coverage.toJSON();
		const data = { ...this.fileCoverage, [MAGIC_KEY]: MAGIC_VALUE };
		const digest = hash(JSON.stringify(data));
		data.hash = digest;
		const global = this.opts.coverageGlobalScopeFunc
			? '(new ((function(){}).constructor)(' + JSON.stringify('return ' + this.opts.coverageGlobalScope) + '))()'
			: this.opts.coverageGlobalScope;
		const preamble = `function ${visitor.name}() {
			var path = ${JSON.stringify(filename)};
			var hash = ${JSON.stringify(digest)};
			var global = ${global};
			var gcv = ${JSON.stringify(this.opts.coverageVariable)};
			var coverageData = null;
			var coverage = global[gcv] || (global[gcv] = {});
			if (!coverage[path] || coverage[path].hash !== hash) coverage[path] = coverageData;
			var actualCoverage = coverage[path];
			${visitor.name} = function() { return actualCoverage; };
			return actualCoverage;
		}
		${visitor.name}();`;
		const injected = parseSource(preamble).ast.body;
		let metadata;
		for (const node of injected) scan(node, item => {
			delete item.loc;
			if (item.type === 'VariableDeclarator' && item.id.name === 'coverageData') metadata = item;
		});
		// Emit metadata directly instead of allocating an AST for the coverage map.
		metadata.init = { type: 'CoverageData', value: data };
		const first = ast.body.findIndex(node => node.directive == null);
		ast.body.splice(first < 0 ? ast.body.length : first, 0, ...injected);
		const result = generateSource(ast, source, filename, this.opts, inputSourceMap);
		this.sourceMap = result.map;
		if (this.opts.sourceMapUrlCallback) {
			for (let i = comments.length - 1; i >= 0; i--) {
				const mapComment = sourceMapPattern.exec(comments[i].value)?.[1];
				if (mapComment) {
					this.opts.sourceMapUrlCallback(filename, mapComment);
					break;
				}
			}
		}
		return result.code;
	}

	instrument(source, filename, callback, inputSourceMap) {
		if (!callback && typeof filename === 'function') { callback = filename; filename = undefined; }
		try { callback(null, this.instrumentSync(source, filename, inputSourceMap)); }
		catch (error) { callback(error); }
	}

	lastFileCoverage() { return this.fileCoverage; }
	lastSourceMap() { return this.sourceMap; }
}

export function createInstrumenter(options) { return new Instrumenter(options); }
