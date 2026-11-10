import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import { flattenCss, plotCss } from '../../scripts/test-css.mjs';

function withStyles(css, html, check) {
	const style = document.createElement('style');
	const host = document.createElement('div');
	style.textContent = css;
	host.innerHTML = html;
	document.head.appendChild(style);
	document.body.appendChild(host);
	try {
		check(host);
	}
	finally {
		host.remove();
		style.remove();
	}
}

describe('flattenCss supported subset', () => {
	it('flattens multiple descendant levels without leaking into sibling rules', () => {
		assert.equal(flattenCss(`
			.plot {
				.legend {
					color: red;
					.label { display: block; }
				}
				canvas { display: none; }
			}
			.outside { color: blue; }
		`), [
			'.plot .legend { color: red; }',
			'.plot .legend .label { display: block; }',
			'.plot canvas { display: none; }',
			'.outside { color: blue; }',
		].join('\n'));
	});

	it('resolves compound, reversed, repeated, and functional nesting references', () => {
		assert.equal(flattenCss(`
			.plot {
				&.active { color: red; }
				.theme & { color: blue; }
				&& { opacity: .5; }
				& + & { margin: 0; }
				:is(&, .fallback) { display: block; }
			}
		`), [
			'.plot.active { color: red; }',
			'.theme :is(.plot) { color: blue; }',
			':is(.plot):is(.plot) { opacity: .5; }',
			':is(.plot) + :is(.plot) { margin: 0; }',
			':is(:is(.plot), .fallback) { display: block; }',
		].join('\n'));
	});

	it('preserves implicit and explicit child combinators at multiple levels', () => {
		assert.equal(flattenCss('.plot { > .legend { & > .label { color: red } } & > canvas { display: block } }'), [
			'.plot > .legend > .label { color: red; }',
			'.plot > canvas { display: block; }',
		].join('\n'));
	});

	it('groups complex parents for reversed, repeated, and functional references only', () => {
		const children = `
			.label { color: red; }
			&.active { color: blue; }
			.theme & { color: green; }
			.theme > & { color: purple; }
			&& { opacity: .5; }
			& + & { margin: 0; }
			& .child & { padding: 0; }
			:is(&, .fallback) { display: block; }
			:not(&.disabled) { display: grid; }
		`;
		const expected = [
			'.layout > .plot .label { color: red; }',
			'.layout > .plot.active { color: blue; }',
			'.theme :is(.layout > .plot) { color: green; }',
			'.theme > :is(.layout > .plot) { color: purple; }',
			':is(.layout > .plot):is(.layout > .plot) { opacity: .5; }',
			':is(.layout > .plot) + :is(.layout > .plot) { margin: 0; }',
			':is(.layout > .plot) .child :is(.layout > .plot) { padding: 0; }',
			':is(:is(.layout > .plot), .fallback) { display: block; }',
			':not(:is(.layout > .plot).disabled) { display: grid; }',
		].join('\n');
		for (const css of [`.layout > .plot { ${children} }`, `.layout { > .plot { ${children} } }`])
			assert.equal(flattenCss(css), expected);
	});

	it('wraps the entire mixed-specificity parent list for every child branch', () => {
		// Happy DOM is not the oracle for :is() specificity; assert the grouping itself.
		assert.equal(flattenCss(`
			.plot, #special {
				color: black;
				.label, > canvas, &.active, .theme & { color: red; }
				& + & { display: block; }
			}
		`), [
			'.plot, #special { color: black; }',
			':is(.plot, #special) .label, :is(.plot, #special) > canvas, :is(.plot, #special).active, .theme :is(.plot, #special) { color: red; }',
			':is(.plot, #special) + :is(.plot, #special) { display: block; }',
		].join('\n'));
	});

	it('retains selector lists as the parent of a further nested rule', () => {
		assert.equal(flattenCss('.a, .b { .c, #d { &.active, > .e { color: red } } }'),
			':is(:is(.a, .b) .c, :is(.a, .b) #d).active, :is(:is(.a, .b) .c, :is(.a, .b) #d) > .e { color: red; }');
	});

	it('does not split commas inside selector functions, attributes, or declaration values', () => {
		assert.equal(flattenCss(`
			:is(.a, :not(.b, .c)), [data-label="x,y"] {
				:where(.d, .e), &[data-label="a,b"] {
					color: rgb(1, 2, 3);
					width: min(10px, max(2px, 3px));
				}
			}
		`), ':is(:is(.a, :not(.b, .c)), [data-label="x,y"]) :where(.d, .e), :is(:is(.a, :not(.b, .c)), [data-label="x,y"])[data-label="a,b"] { color: rgb(1, 2, 3); width: min(10px, max(2px, 3px)); }');
	});

	it('keeps quoted punctuation, escaped quotes, and comment markers literal', () => {
		const selector = String.raw`[data-label="a\";{},&[]()/*literal*/"], [data-label='it\'s,;&{}']`;
		const declarations = String.raw`content: "a\";{},&[]()/*literal*/"; --label: 'it\'s;{},&'; background: url("data:image/svg+xml;utf8,<svg>{a,b}</svg>");`;
		assert.equal(flattenCss(`${selector} { &.active { ${declarations} } }`),
			`:is(${selector}).active { ${declarations} }`);
	});

	it('keeps escaped selector punctuation literal rather than treating it as structure', () => {
		const selector = String.raw`.comma\,name, .amp\&name, .brace\{name\}, .bracket\[name\], .semi\;name, .colon\:name, .slash\\name`;
		assert.equal(flattenCss(`${selector} { &.active, .child\\,name { color: red } }`),
			String.raw`:is(${selector}).active, :is(${selector}) .child\,name { color: red; }`);
	});

	it('does not mistake quoted pseudo-elements or ampersands for selector syntax', () => {
		assert.equal(flattenCss('[data-label="::before &"] { &[data-label="&-x"], [data-label="&"] { color: red } }'),
			'[data-label="::before &"][data-label="&-x"], [data-label="::before &"] [data-label="&"] { color: red; }');
	});

	it('preserves comments without interpreting their punctuation as CSS structure', () => {
		assert.equal(flattenCss('.plot/* selector */.active { color: /* { [ " & @media ; */red; > .label { display: block; } /* } ) */ opacity: .5; } /* trailing */'), [
			'.plot/* selector */.active { color: /* { [ " & @media ; */red; }',
			'.plot/* selector */.active > .label { display: block; }',
			'.plot/* selector */.active { /* } ) */ opacity: .5; }',
		].join('\n'));
	});

	it('does not merge tokens separated by comments', () => {
		assert.equal(flattenCss('.a { --value: 1/**/px; &/**/.active { color: red } }'),
			'.a { --value: 1/**/px; }\n.a/**/.active { color: red; }');
		assert.equal(flattenCss('.a { /* ::before */ &.active { color: red } }'),
			'/* ::before */ .a.active { color: red; }');
	});

	it('allows modern and legacy pseudo-elements in leaf rules', () => {
		assert.equal(flattenCss(`
			.top::before { content: ":"; }
			.plot {
				&::before, &::after, .label:first-letter { content: ";"; }
				*::before, *::after { box-sizing: border-box; }
			}
		`), [
			'.top::before { content: ":"; }',
			'.plot::before, .plot::after, .plot .label:first-letter { content: ";"; }',
			'.plot *::before, .plot *::after { box-sizing: border-box; }',
		].join('\n'));
	});

	it('preserves source order across interleaved declarations and rules', () => {
		assert.equal(flattenCss(`
			.a, #b {
				color: red;
				color: orange;
				& { color: blue; }
				color: green;
				.child {
					display: block;
					&.active { display: flex; }
					display: grid;
				}
				color: purple;
			}
			.after { color: black; }
		`), [
			'.a, #b { color: red; color: orange; }',
			':is(.a, #b) { color: blue; }',
			'.a, #b { color: green; }',
			':is(.a, #b) .child { display: block; }',
			':is(.a, #b) .child.active { display: flex; }',
			':is(.a, #b) .child { display: grid; }',
			'.a, #b { color: purple; }',
			'.after { color: black; }',
		].join('\n'));
	});

	it('accepts optional final semicolons and non-block custom properties', () => {
		const expected = '.a { --size: 2px; width: var(--size); }\n.a .b { color: red; }\n.a { opacity: .5; }';
		for (const semicolon of ['', ';']) {
			assert.equal(flattenCss(`.a { --size: 2px; width: var(--size); .b { color: red${semicolon} } opacity: .5${semicolon} }`), expected);
		}
	});

	it('omits empty rules and accepts empty or comment-only stylesheets', () => {
		for (const css of ['', ' \n\t ', '/* nothing */', '.a {}', '.a { .b {} }'])
			assert.equal(flattenCss(css), '', css);
		assert.equal(flattenCss('.a { color: red; .empty {} color: blue }'),
			'.a { color: red; }\n.a { color: blue; }');
	});
});

describe('flattenCss malformed input', () => {
	// These are parser boundaries, not an attempt to validate the full CSS grammar.
	for (const [name, css, message] of [
		['unterminated comment', '.a { /* unfinished', 'Unterminated comment'],
		['unterminated double quote', '.a { content: "unfinished }', 'Unterminated string'],
		['unterminated single quote', ".a { content: 'unfinished }", 'Unterminated string'],
		['trailing escape', '.a\\', 'Trailing escape'],
		['mismatched groups', '.a:not([)] { color: red }', 'Unbalanced parentheses or brackets'],
		['unexpected parenthesis', '.a) { color: red }', 'Unbalanced parentheses or brackets'],
		['unexpected bracket', '.a] { color: red }', 'Unbalanced parentheses or brackets'],
		['unclosed parenthesis', '.a { width: calc(1px + 2px; }', 'Unclosed parentheses or brackets'],
		['unclosed bracket', '[data-label=x { color: red }', 'Unclosed parentheses or brackets'],
		['unexpected closing brace', '}', 'Unexpected closing brace'],
		['extra closing brace', '.a {} }', 'Unexpected closing brace'],
		['unclosed rule', '.a { color: red;', 'Unclosed rule'],
		['unclosed outer rule', '.a { .b {}', 'Unclosed rule'],
		['top-level declaration', 'color: red;', 'Expected a declaration: color: red'],
		['missing declaration colon', '.a { color red; }', 'Expected a declaration: color red'],
		['empty selector', '{ color: red }', 'Empty selector'],
				['comment-only selector', '/* empty */ { color: red }', 'Empty selector'],
				['comment-only list branch', '.a, /* empty */ { color: red }', 'Empty selector'],
		['leading empty list branch', ', .a { color: red }', 'Empty selector'],
		['trailing empty list branch', '.a, { color: red }', 'Empty selector'],
		['empty nested list branch', '.a { .b,,.c {} }', 'Empty selector'],
		['top-level relative selector', '> .a { color: red }', 'Top-level relative selector'],
	]) {
		it(`rejects ${name}`, () => {
			assert.throws(() => flattenCss(css), { name: 'SyntaxError', message: 'Test CSS: ' + message });
		});
	}
});

describe('flattenCss explicitly unsupported features', () => {
	for (const [name, css, message] of [
		['statement at-rule', '@import "theme.css";', 'At-rules are unsupported'],
				['comment-prefixed at-rule', '/* comment */ @media screen {}', 'At-rules are unsupported'],
		['block at-rule', '@media screen { .a { color: red } }', 'At-rules are unsupported'],
		['nested at-rule', '.a { @media screen { color: red } }', 'At-rules are unsupported'],
		['block-valued custom property', '.a { --theme: { color: red }; }', 'Block-valued custom properties are unsupported'],
		['pseudo-element parent', '.a::before { .b { color: red } }', 'Nested rules under pseudo-elements are unsupported'],
		['legacy pseudo-element parent', '.a:after { & { color: red } }', 'Nested rules under pseudo-elements are unsupported'],
		['pseudo-element branch in a parent list', '.a, .b::after { .c { color: red } }', 'Nested rules under pseudo-elements are unsupported'],
		['pseudo-element at a deeper nesting level', '.a { &::before { .b { color: red } } }', 'Nested rules under pseudo-elements are unsupported'],
		['top-level nesting reference', '&.a { color: red }', 'Top-level & is unsupported'],
		['top-level reversed nesting reference', '.theme & { color: red }', 'Top-level & is unsupported'],
		['Sass suffix concatenation', '.a { &-x { color: red } }', 'Selector concatenation after & is unsupported'],
		['identifier concatenation', '.a { &span { color: red } }', 'Selector concatenation after & is unsupported'],
		['escaped suffix concatenation', String.raw`.a { &\-x { color: red } }`, 'Selector concatenation after & is unsupported'],
	]) {
		it(`rejects ${name}`, () => {
			assert.throws(() => flattenCss(css), { name: 'SyntaxError', message: 'Test CSS: ' + message });
		});
	}
});

describe('flattened CSS in Happy DOM', () => {
	it('matches descendants, direct children, compound classes, and reversed references', () => {
		withStyles(flattenCss(`
			.css-test-plot {
				.label { padding-left: 7px; }
				> .label { margin-left: 11px; }
				&.active { border-top-width: 3px; }
				.theme & { border-bottom-width: 5px; }
			}
		`), '<div class="theme"><div class="css-test-plot active"><span class="label direct"></span><div><span class="label deep"></span></div></div></div><span class="label outside"></span>', host => {
			const style = selector => getComputedStyle(host.querySelector(selector));
			assert.equal(style('.direct').paddingLeft, '7px');
			assert.equal(style('.deep').paddingLeft, '7px');
			assert.equal(style('.direct').marginLeft, '11px');
			assert.notEqual(style('.deep').marginLeft, '11px');
			assert.notEqual(style('.outside').paddingLeft, '7px');
			assert.equal(style('.css-test-plot').borderTopWidth, '3px');
			assert.equal(style('.css-test-plot').borderBottomWidth, '5px');
		});
	});

	it('applies later declarations after a nested self rule at equal specificity', () => {
		withStyles(flattenCss('.css-test-order { width: 1px; & { width: 2px; height: 4px; } width: 3px; }'),
			'<div class="css-test-order"></div>', host => {
				const style = getComputedStyle(host.firstElementChild);
				assert.equal(style.width, '3px');
				assert.equal(style.height, '4px');
			});
	});

	it('computes grid placement for a leading compound reference under a complex parent', () => {
		for (const css of [
			'.uplot > .u-legend { &.u-top { grid-area: top } }',
			'.uplot { > .u-legend { &.u-top { grid-area: top } } }',
		]) {
			const flattened = flattenCss(css);
			assert.equal(flattened, '.uplot > .u-legend.u-top { grid-area: top; }');
			withStyles(flattened, `
				<div class="uplot">
					<div class="u-legend u-top direct"></div>
					<div class="u-legend other"></div>
					<div><div class="u-legend u-top deep"></div></div>
				</div>
				<div class="u-legend u-top outside"></div>
			`, host => {
				assert.equal(getComputedStyle(host.querySelector('.direct')).gridArea, 'top');
				for (const selector of ['.other', '.deep', '.outside'])
					assert.notEqual(getComputedStyle(host.querySelector(selector)).gridArea, 'top', selector);
			});
		}
	});

	it('styles namespaced components without a chart-root ancestor', () => {
		// Happy DOM does not compute color-mix() backgrounds.
		assert.ok(plotCss.includes('.u-focus { background: color-mix(in srgb, currentColor 12%, transparent); }'));
		withStyles(plotCss, `
			<div class="u-title"></div>
			<div class="u-wrap"></div>
			<table class="u-detail u-legend u-table u-rgt">
				<tbody><tr class="u-series u-off"><th><span class="u-marker"></span>Label</th><td class="u-value">1</td></tr></tbody>
			</table>
			<span class="u-marker standalone"></span>
		`, host => {
			const style = selector => getComputedStyle(host.querySelector(selector));
			assert.equal(style('.u-title').gridArea, 'tit');
			assert.equal(style('.u-wrap').gridArea, 'plot');
			assert.equal(style('.u-legend').gridArea, 'rgt');
			assert.equal(style('th').textAlign, 'left');
			assert.equal(style('td').textAlign, 'right');
			assert.equal(style('th').opacity, '0.3');
			assert.equal(style('td').opacity, '0.3');
			assert.equal(style('.standalone').verticalAlign, 'middle');
			assert.equal(style('.standalone').marginRight, '4px');
		});
	});

	it('exports flattened production CSS with working nested layout and visibility rules', () => {
		assert.equal(plotCss, flattenCss(readFileSync(new URL('../../src/uPlot.css', import.meta.url), 'utf8')));
		assert.ok(plotCss.includes('.u-title { grid-area: tit;'));
		assert.ok(plotCss.includes('.u-legend.u-top { grid-area: top; }'));
		withStyles(plotCss, '<div class="uplot"><div class="u-title"></div><div class="u-legend u-top"></div><div class="u-cursor-pt u-off"></div><canvas></canvas></div>', host => {
			const style = selector => getComputedStyle(host.querySelector(selector));
			assert.equal(style('.uplot').display, 'grid');
			assert.equal(style('.u-title').gridArea, 'tit');
			assert.equal(style('.u-legend').gridArea, 'top');
			assert.equal(style('.u-cursor-pt').display, 'none');
			assert.equal(style('canvas').display, 'block');
		});
	});
});
