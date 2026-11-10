import { readFileSync } from 'node:fs';

function fail(message) {
	throw new SyntaxError('Test CSS: ' + message);
}

// Strings, comments, and escapes are indivisible; their punctuation stays literal.
function tokenize(css) {
	const tokens = [];
	for (let i = 0; i < css.length;) {
		const start = i;
		const char = css[i++];
		if (char == '/' && css[i] == '*') {
			const end = css.indexOf('*/', i + 1);
			if (end < 0)
				fail('Unterminated comment');
			i = end + 2;
		}
		else if (char == '"' || char == "'") {
			while (i < css.length && css[i] != char) {
				if (css[i] == '\\')
					i++;
				i++;
			}
			if (i >= css.length)
				fail('Unterminated string');
			i++;
		}
		else if (char == '\\') {
			if (i == css.length)
				fail('Trailing escape');
			i++;
		}
		tokens.push(css.slice(start, i));
	}
	return tokens;
}

function* split(tokens, delimiters) {
	let part = [];
	const groups = [];
	for (const token of tokens) {
		if (token == '(' || token == '[')
			groups.push(token == '(' ? ')' : ']');
		else if (token == ')' || token == ']') {
			if (groups.pop() != token)
				fail('Unbalanced parentheses or brackets');
		}
		if (groups.length == 0 && delimiters.includes(token)) {
			yield [part, token];
			part = [];
		}
		else
			part.push(token);
	}
	if (groups.length > 0)
		fail('Unclosed parentheses or brackets');
	yield [part, ''];
}

function significant(tokens) {
	return tokens.filter(token => !token.startsWith('/*'));
}

function resolveSelectors(tokens, parent) {
	// Nesting cannot represent a pseudo-element parent. Reject rather than
	// silently dropping that branch when wrapping a selector list in :is().
	if (parent != null) {
		const structural = significant(tokenize(parent.join(','))).filter(token => token[0] != '"' && token[0] != "'" && token[0] != '\\').join('');
		if (/::|:(before|after|first-line|first-letter)\b/i.test(structural))
			fail('Nested rules under pseudo-elements are unsupported');
	}
	return [...split(tokens, ',')].map(([part]) => {
		const syntax = significant(part).join('').trim();
		if (!syntax)
			fail('Empty selector');
		if (parent == null && /^[>+~]/.test(syntax))
			fail('Top-level relative selector');
		let attribute = false;
		const refs = [];
		part.forEach((token, index) => {
			if (token == '[') attribute = true;
			if (token == ']') attribute = false;
			if (token == '&' && !attribute) {
				if (parent == null)
					fail('Top-level & is unsupported');
				if (/^[\w-]|^\\/.test(part[index + 1] ?? ''))
					fail('Selector concatenation after & is unsupported');
				refs.push(index);
			}
		});
		// A single parent can be inlined for implicit nesting or one leading &.
		// Lists, reversed contexts, and repeated & need :is() grouping.
		const leading = refs.length == 0 || refs.length == 1 && significant(part.slice(0, refs[0])).join('').trim() == '';
		const reference = parent == null ? null : parent.length == 1 && leading ? parent[0] : ':is(' + parent.join(', ') + ')';
		const selector = part.map((token, index) => refs.includes(index) ? reference : token).join('').trim();

		return reference == null || refs.length > 0 ? selector : reference + ' ' + selector;
	});
}

// Test-only subset: style rules, declarations, selector lists, and nesting.
// No at-rules or block-valued custom properties. This is not a CSS validator.
export function flattenCss(css) {
	const chunks = [...split(tokenize(css), '{};')];
	const output = [];
	let index = 0;

	function block(parent) {
		let declarations = [];
		function flush() {
			if (declarations.length > 0) {
				output.push(parent.join(', ') + ' { ' + declarations.join(' ') + ' }');
				declarations = [];
			}
		}
		while (index < chunks.length) {
			const [tokens, delimiter] = chunks[index++];
			const text = significant(tokens).join('').trim();
			if (text.startsWith('@'))
				fail('At-rules are unsupported');
			if (delimiter == '{') {
				if (/^--[\w-]+\s*:/.test(text))
					fail('Block-valued custom properties are unsupported');
				flush();
				block(resolveSelectors(tokens, parent));
			}
			else {
				if (text) {
					if (parent == null || !/^(--[\w-]+|[a-z-]+)\s*:/i.test(text))
						fail('Expected a declaration: ' + text);
					declarations.push(tokens.join('').trim() + ';');
				}
				if (delimiter == '}') {
					if (parent == null)
						fail('Unexpected closing brace');
					flush();
					return;
				}
				if (delimiter == '') {
					if (parent != null)
						fail('Unclosed rule');
					return;
				}
			}
		}
	}

	block(null);
	return output.join('\n');
}

// Happy DOM cannot parse native nesting; production CSS remains untouched.
export const plotCss = flattenCss(readFileSync(new URL('../src/uPlot.css', import.meta.url), 'utf8'));
