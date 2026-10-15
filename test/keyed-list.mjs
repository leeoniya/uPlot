import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import '../scripts/instrument.mjs';
import { createKeyedList } from '../src/keyed-list.js';

function assertNodes(actual, expected) {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++)
		assert.equal(actual[i] === expected[i], true, `node ${i} retains identity`);
}

function entries(keys, value = 'value') {
	return Object.freeze(keys.map(key => Object.freeze({ key, value })));
}

function textInstance() {
	const node = document.createElement('div');
	const text = document.createTextNode('');
	node.appendChild(text);
	return {
		node,
		update(entry) { text.data = String(entry.value); },
		destroy() {},
	};
}

describe('keyed list', () => {
	let fixtures;

	beforeEach(() => { fixtures = []; });
	afterEach(() => {
		for (const fixture of fixtures)
			fixture.list.destroy();
	});

	function fixture({ parent = document.createElement('div'), before = null, create = textInstance } = {}) {
		const mounted = [];
		const live = new Map();
		const operations = [];
		const insertBefore = parent.insertBefore;
		const moveBefore = parent.moveBefore;
		const removeChild = parent.removeChild;
		parent.insertBefore = function(node, anchor) {
			operations.push(['insert', node, anchor]);
			return insertBefore.call(this, node, anchor);
		};
		if (typeof moveBefore === 'function') {
			parent.moveBefore = function(node, anchor) {
				operations.push(['move', node, anchor]);
				return moveBefore.call(this, node, anchor);
			};
		}
		parent.removeChild = function(node) {
			operations.push(['remove', node]);
			return removeChild.call(this, node);
		};

		const list = createKeyedList(parent, entry => entry.key, entry => {
			const instance = create(entry);
			const record = {
				key: entry.key,
				node: instance.node,
				updates: [],
				destroys: 0,
				update(entry) {
					assert.equal(this, record);
					assert.equal(record.destroys, 0);
					record.updates.push(entry);
					instance.update(entry);
				},
				destroy() {
					assert.equal(this, record);
					assert.equal(++record.destroys, 1);
					live.delete(record.key);
					instance.destroy();
				},
			};
			mounted.push(record);
			live.set(entry.key, record);
			return record;
		}, before);

		const result = { parent, list, mounted, live, operations };
		fixtures.push(result);
		return result;
	}

	function update(f, nextEntries) {
		const previous = new Map(f.live);
		const counts = new Map(f.mounted.map(record => [record, record.updates.length]));
		const keys = new Set(nextEntries.map(entry => entry.key));
		const mountCount = f.mounted.length;
		f.list.update(nextEntries);

		assert.equal(f.mounted.length, mountCount + nextEntries.filter(entry => !previous.has(entry.key)).length);
		assert.equal(f.live.size, nextEntries.length);
		for (const entry of nextEntries) {
			const record = f.live.get(entry.key);
			if (previous.has(entry.key))
				assert.equal(record, previous.get(entry.key));
			assert.equal(record.updates.length, (counts.get(record) ?? 0) + 1);
			assert.equal(record.updates.at(-1), entry);
			assert.equal(record.destroys, 0);
		}
		for (const record of f.mounted) {
			if (f.live.get(record.key) !== record) {
				assert.equal(record.destroys, 1);
				assert.equal(record.node.parentNode, null);
				assert.equal(record.updates.length, counts.get(record));
			}
		}
		for (const [key, record] of previous) {
			if (!keys.has(key))
				assert.equal(record.destroys, 1);
		}
		return nextEntries.map(entry => f.live.get(entry.key).node);
	}

	it('imports without DOM globals', () => {
		const url = new URL('../src/keyed-list.js', import.meta.url).href;
		execFileSync(process.execPath, ['--input-type=module', '--eval', `
			import assert from 'node:assert/strict';
			assert.equal(typeof document, 'undefined');
			assert.equal(typeof window, 'undefined');
			const { createKeyedList } = await import(${JSON.stringify(url)});
			assert.equal(typeof createKeyedList, 'function');
		`], { timeout: 5000 });
	});

	it('updates every instance exactly once without structural mutations for stable keys', () => {
		const f = fixture();
		const initial = entries(['a', 'b', 'c']);
		const roots = update(f, initial);
		assertNodes(f.parent.childNodes, roots);
		f.operations.length = 0;
		const observer = new MutationObserver(() => {});
		observer.observe(f.parent, { childList: true });
		try {
			update(f, initial);
			update(f, entries(['a', 'b', 'c'], 'changed'));
			assertNodes(f.parent.childNodes, roots);
			assert.deepEqual(f.operations, []);
			assert.deepEqual(observer.takeRecords(), []);
			assert.deepEqual(roots.map(node => node.textContent), ['changed', 'changed', 'changed']);
			assert.equal(f.mounted.length, 3);
		}
		finally {
			observer.disconnect();
		}
	});

	it('uses moveBefore for connected roots, insertBefore for mounts, and no writes for stable order', () => {
		for (const bounded of [false, true]) {
			const parent = document.createElement('div');
			const prefix = document.createTextNode('prefix');
			const before = bounded ? document.createComment('end') : null;
			const suffix = document.createElement('hr');
			parent.append(prefix);
			if (bounded)
				parent.append(before, suffix);

			// Happy DOM lacks moveBefore. This stub tests routing, not native state preservation.
			const insertBefore = parent.insertBefore;
			parent.moveBefore = function(node, anchor) {
				assert.equal(node.parentNode, this);
				assert.equal(node.isConnected, true);
				insertBefore.call(this, node, anchor);
			};
			const f = fixture({ parent, before });
			document.body.appendChild(parent);
			try {
				const [a, b] = update(f, entries(['a', 'b', 'c']));
				assert.deepEqual(f.operations.map(operation => operation[0]), ['insert', 'insert', 'insert']);
				f.operations.length = 0;
				const roots = update(f, entries(['c', 'new', 'a']));
				assertNodes(parent.childNodes, [prefix, ...roots, ...(bounded ? [before, suffix] : [])]);
				assert.deepEqual(f.operations.map(operation => operation[0]), ['remove', 'move', 'insert']);
				assertNodes(f.operations.map(operation => operation[1]), [b, a, roots[1]]);
				assertNodes(f.operations.slice(1).map(operation => operation[2]), [before, a]);
				f.operations.length = 0;
				update(f, entries(['c', 'new', 'a'], 'changed'));
				assert.deepEqual(f.operations, []);
				f.list.destroy();
				assertNodes(parent.childNodes, [prefix, ...(bounded ? [before, suffix] : [])]);
			}
			finally {
				parent.remove();
			}
		}
	});

	it('uses insertBefore for disconnected roots even when moveBefore is available', () => {
		const parent = document.createElement('div');
		parent.moveBefore = () => assert.fail('disconnected roots must use insertBefore');
		const f = fixture({ parent });
		const roots = update(f, entries(['a', 'b']));
		assert.deepEqual(f.operations.map(operation => operation[0]), ['insert', 'insert']);
		f.operations.length = 0;
		update(f, entries(['b', 'a']));
		assertNodes(parent.childNodes, roots.toReversed());
		assert.deepEqual(f.operations.map(operation => operation[0]), ['insert']);
	});

	it('falls back to insertBefore for connected roots without moveBefore', () => {
		const parent = document.createElement('div');
		parent.moveBefore = undefined;
		const f = fixture({ parent });
		document.body.appendChild(parent);
		try {
			const roots = update(f, entries(['a', 'b']));
			f.operations.length = 0;
			update(f, entries(['b', 'a']));
			assertNodes(parent.childNodes, roots.toReversed());
			assert.deepEqual(f.operations.map(operation => operation[0]), ['insert']);
			f.operations.length = 0;
			update(f, entries(['b', 'a']));
			assert.deepEqual(f.operations, []);
		}
		finally {
			parent.remove();
		}
	});

	it('preserves input focus, value, and selection with native moveBefore', function() {
		const parent = document.createElement('div');
		if (typeof parent.moveBefore !== 'function')
			this.skip();

		const f = fixture({
			parent,
			create() {
				const node = document.createElement('label');
				node.appendChild(document.createElement('input'));
				return { node, update() {}, destroy() {} };
			},
		});
		document.body.appendChild(parent);
		try {
			const roots = update(f, entries(['a', 'b']));
			const input = roots[0].firstChild;
			input.value = 'user-edited label';
			input.focus();
			input.setSelectionRange(1, 5, 'backward');
			assert.equal(document.activeElement, input);
			f.operations.length = 0;
			update(f, entries(['b', 'a']));
			assertNodes(parent.childNodes, roots.toReversed());
			assert.deepEqual(f.operations.map(operation => operation[0]), ['move']);
			assert.equal(document.activeElement, input);
			assert.equal(input.value, 'user-edited label');
			assert.equal(input.selectionStart, 1);
			assert.equal(input.selectionEnd, 5);
			assert.equal(input.selectionDirection, 'backward');
		}
		finally {
			parent.remove();
		}
	});

	it('handles inserts, removals, reversals, rotations, and empty lists', () => {
		const f = fixture();
		for (const keys of [
			[], ['b', 'd'], ['a', 'b', 'c', 'd', 'e'],
			['e', 'd', 'c', 'b', 'a'], ['c', 'b', 'a', 'e', 'd'],
			['d', 'f', 'b'], ['f'], [], ['b', 'a'], [], [],
		])
			assertNodes(f.parent.childNodes, update(f, entries(keys)));
	});

	it('removes stale roots before placement and does not move already-correct survivors', () => {
		const f = fixture();
		update(f, entries(['a', 'b', 'c', 'd']));
		const b = f.live.get('b').node;
		const d = f.live.get('d').node;
		f.operations.length = 0;
		assertNodes(f.parent.childNodes, update(f, entries(['a', 'c'])));
		assert.deepEqual(f.operations.map(operation => operation[0]), ['remove', 'remove']);
		assertNodes(f.operations.map(operation => operation[1]), [b, d]);

		const a = f.live.get('a').node;
		const c = f.live.get('c').node;
		f.operations.length = 0;
		const roots = update(f, entries(['x', 'y', 'z']));
		assertNodes(f.parent.childNodes, roots);
		assert.deepEqual(f.operations.map(operation => operation[0]), ['remove', 'remove', 'insert', 'insert', 'insert']);
		assertNodes(f.operations.map(operation => operation[1]), [a, c, ...roots.toReversed()]);
		assertNodes(f.operations.slice(2).map(operation => operation[2]), [null, roots[2], roots[1]]);
	});

	it('supports filtered and page subsets, with fresh instances when keys return', () => {
		const f = fixture();
		const all = entries(['a', 'b', 'c', 'd', 'e', 'f']);
		update(f, all);
		const original = new Map(f.live);
		assertNodes(f.parent.childNodes, update(f, all.filter((_, i) => i % 2 == 0)));
		assertNodes(f.parent.childNodes, update(f, all.slice(2, 5)));
		assert.equal(f.live.get('c'), original.get('c'));
		assert.equal(f.live.get('e'), original.get('e'));
		assert.notEqual(f.live.get('d'), original.get('d'));
		assertNodes(f.parent.childNodes, update(f, all.slice(0, 2)));
		assertNodes(f.parent.childNodes, update(f, all));
		for (const [key, record] of original) {
			assert.notEqual(f.live.get(key), record);
			assert.notEqual(f.live.get(key).node, record.node);
			assert.equal(record.destroys, 1);
		}
	});

	for (const [parentTag, rootTag, childTag] of [['ul', 'li', 'span'], ['tbody', 'tr', 'td'], ['section', 'article', 'button']]) {
		it(`updates custom ${rootTag} structures without changes to the reconciler`, () => {
			const f = fixture({
				parent: document.createElement(parentTag),
				create() {
					const node = document.createElement(rootTag);
					const child = document.createElement(childTag);
					const nested = document.createElement('strong');
					child.appendChild(nested);
					node.appendChild(child);
					return {
						node,
						update(entry) {
							nested.textContent = entry.value;
							child.setAttribute('data-key', entry.key);
							if (entry.value == 'expanded')
								child.appendChild(document.createElement('small'));
						},
						destroy() {},
					};
				},
			});
			const roots = update(f, entries(['a', 'b']));
			const children = roots.map(node => node.firstChild);
			assertNodes(f.parent.childNodes, update(f, entries(['b', 'a'], 'expanded')));
			assertNodes(f.parent.childNodes, roots.toReversed());
			assertNodes(roots.map(node => node.firstChild), children);
			for (const node of roots) {
				assert.equal(node.localName, rootTag);
				assert.equal(node.firstChild.localName, childTag);
				assert.equal(node.querySelector('strong').textContent, 'expanded');
				assert.equal(node.querySelectorAll('small').length, 1);
			}
		});
	}

	it('preserves boundary siblings and independent lists in one parent', () => {
		const parent = document.createElement('div');
		const prefix = document.createTextNode('prefix');
		const leftEnd = document.createComment('left end');
		const spacer = document.createElement('hr');
		const rightEnd = document.createElement('hr');
		const suffix = document.createTextNode('suffix');
		parent.append(prefix, leftEnd, spacer, rightEnd, suffix);
		const left = fixture({ parent, before: leftEnd });
		const right = fixture({ parent, before: rightEnd });
		let leftRoots = update(left, entries(['a', 'b']));
		let rightRoots = update(right, entries(['a', 'c']));
		assertNodes(parent.childNodes, [prefix, ...leftRoots, leftEnd, spacer, ...rightRoots, rightEnd, suffix]);
		leftRoots = update(left, entries(['b', 'd', 'a']));
		rightRoots = update(right, entries(['c']));
		assertNodes(parent.childNodes, [prefix, ...leftRoots, leftEnd, spacer, ...rightRoots, rightEnd, suffix]);
		left.operations.length = 0;
		right.operations.length = 0;
		update(left, entries(['b', 'd', 'a'], 'new'));
		update(right, entries(['c'], 'new'));
		assert.deepEqual(left.operations, []);
		assert.deepEqual(right.operations, []);
		left.list.destroy();
		left.list.destroy();
		assertNodes(parent.childNodes, [prefix, leftEnd, spacer, ...rightRoots, rightEnd, suffix]);
		right.list.destroy();
		assertNodes(parent.childNodes, [prefix, leftEnd, spacer, rightEnd, suffix]);
	});

	it('retains unrelated nodes without an explicit boundary', () => {
		const f = fixture();
		const prefix = document.createElement('header');
		f.parent.appendChild(prefix);
		update(f, entries(['a', 'b']));
		const unrelated = document.createTextNode('unrelated');
		f.parent.insertBefore(unrelated, f.live.get('b').node);
		const roots = update(f, entries(['b', 'a']));
		assertNodes(f.parent.childNodes, [prefix, unrelated, ...roots]);
		f.list.destroy();
		assertNodes(f.parent.childNodes, [prefix, unrelated]);
	});

	it('uses key identity without coercion and does not mutate caller data', () => {
		const f = fixture();
		const keys = [0, '0', null, undefined, NaN, Symbol('key'), Object.freeze({}), '__proto__'];
		const initial = entries(keys);
		const roots = update(f, initial);
		assertNodes(f.parent.childNodes, roots);
		assertNodes(f.parent.childNodes, update(f, entries(keys.toReversed(), 'new')));
		assertNodes(f.parent.childNodes, roots.toReversed());
		assert.deepEqual(initial.map(entry => entry.key), keys);
		assert.deepEqual(initial.map(entry => entry.value), keys.map(() => 'value'));
	});

	it('retains instances through a deterministic sequence of modest permutations', () => {
		const f = fixture();
		const keys = Array.from({ length: 12 }, (_, i) => i);
		update(f, entries(keys));
		const original = new Map(f.live);
		let seed = 12345;
		for (let step = 0; step < 40; step++) {
			for (let i = keys.length - 1; i > 0; i--) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				const j = seed % (i + 1);
				[keys[i], keys[j]] = [keys[j], keys[i]];
			}
			assertNodes(f.parent.childNodes, update(f, entries(keys, step)));
			for (const [key, record] of original)
				assert.equal(f.live.get(key), record);
		}
		assert.equal(f.mounted.length, 12);
	});

	it('calls cleanup once for removed and remaining instances, even after repeated destroy', () => {
		let clicks = 0;
		let cleanups = 0;
		const f = fixture({
			create() {
				const node = document.createElement('button');
				const onClick = () => { clicks++; };
				node.addEventListener('click', onClick);
				return {
					node,
					update(entry) { node.textContent = entry.value; },
					destroy() {
						cleanups++;
						node.removeEventListener('click', onClick);
					},
				};
			},
		});
		f.list.destroy();
		f.list.destroy();
		const roots = update(f, entries(['a', 'b', 'c']));
		roots.forEach(node => node.click());
		assert.equal(clicks, 3);
		update(f, entries(['a', 'c']));
		assert.equal(cleanups, 1);
		roots[1].click();
		assert.equal(clicks, 3);
		f.list.destroy();
		f.list.destroy();
		assert.equal(cleanups, 3);
		assert.equal(f.live.size, 0);
		assert.equal(f.parent.childNodes.length, 0);
		for (const record of f.mounted) {
			assert.equal(record.destroys, 1);
			assert.equal(record.node.parentNode, null);
			record.node.click();
		}
		assert.equal(clicks, 3);
	});
});
