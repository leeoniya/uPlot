import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { h } from '../src/h.js';

describe('DOM hyperscript construction', () => {
	it('creates elements without properties or children', () => {
		assert.equal(h('th').outerHTML, '<th></th>');
		assert.equal(h('tbody', null).outerHTML, '<tbody></tbody>');
	});

	it('constructs nested table structure and keeps captured references', () => {
		let body, cell;
		const table = h('table', {className: 'u-legend'},
			body = h('tbody', null,
				h('tr', null,
					h('th', null, h('div', {className: 'u-label'}, 'Series')),
					cell = h('td', {className: 'u-value'}, '42'),
				),
			),
		);
		assert.equal(table.outerHTML, '<table class="u-legend"><tbody><tr><th><div class="u-label">Series</div></th><td class="u-value">42</td></tr></tbody></table>');
		assert.equal(table.firstChild === body, true);
		assert.equal(body.firstChild.lastChild === cell, true);
	});

	it('flattens child arrays without wrappers and omits optional children', () => {
		const node = h('div', null, null, false, '', [undefined, [h('span', null, 'a'), 0]], 'b');
		assert.equal(node.outerHTML, '<div><span>a</span>0b</div>');
		assert.equal(node.childNodes.length, 3);
		assert.equal(h('div', null, [null, false, '', undefined, []]).childNodes.length, 0);
	});

	it('assigns DOM properties and styles without null attributes', () => {
		const node = h('input', {className: 'editor', value: 'typed', disabled: false, title: null, style: {color: 'red', opacity: null}});
		assert.equal(node.className, 'editor');
		assert.equal(node.value, 'typed');
		assert.equal(node.disabled, false);
		assert.equal(node.hasAttribute('disabled'), false);
		assert.equal(node.hasAttribute('title'), false);
		assert.equal(node.style.color, 'red');
		assert.equal(node.style.opacity, '');
		assert.equal(h('div', {style: {color: null, border: undefined}}).hasAttribute('style'), false);
	});

	it('inserts strings as text, not markup', () => {
		const node = h('div', null, '<b>&</b>');
		assert.equal(node.textContent, '<b>&</b>');
		assert.equal(node.children.length, 0);
		assert.equal(node.firstChild.nodeType, Node.TEXT_NODE);
	});

	it('preserves supplied nodes, their state, and their listeners', () => {
		const input = h('input', {value: 'edited'});
		let clicks = 0;
		input.addEventListener('click', () => clicks++);
		const oldParent = h('div', null, input);
		const label = h('div', {className: 'u-label'}, input);
		assert.equal(label.firstChild === input, true);
		assert.equal(oldParent.childNodes.length, 0);
		assert.equal(input.value, 'edited');
		input.dispatchEvent(new MouseEvent('click'));
		assert.equal(clicks, 1);
	});
});
