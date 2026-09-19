import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';

describe('instrumented DOM', () => {
	it('supports the cached Node textContent setter on elements, including zero and empty text', () => {
		const setText = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set;
		for (const tag of ['td', 'div', 'th']) {
			const element = document.createElement(tag);
			element.appendChild(document.createElement('span'));
			for (const [value, expected] of [[0, '0'], [42, '42'], ['<b>&</b>', '<b>&</b>'], ['', ''], [null, '']]) {
				setText.call(element, value);
				assert.equal(element.textContent, expected);
				assert.equal(element.children.length, 0);
				assert.equal(element.childNodes.length, expected == '' ? 0 : 1);
			}
		}
	});
});
