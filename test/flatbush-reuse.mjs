import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Flatbush from '../demos/lib/flatbush.js';

const all = [-Infinity, -Infinity, Infinity, Infinity];
const sorted = ids => [...ids].sort((a, b) => a - b);
const bounds = index => [index.minX, index.minY, index.maxX, index.maxY];

function rectangles(count, cycle = 0) {
	return Array.from({ length: count }, (_, i) => {
		const rank = (i * 17 + cycle * 7) % count;
		const x = cycle * 1000 + rank % 7 * 10;
		const y = -cycle * 1000 + Math.floor(rank / 7) * 10;
		return [x, y, x + 2, y + 3];
	});
}

function build(index, boxes) {
	boxes.forEach((box, id) => assert.equal(index.add(...box), id));
	index.finish();
}

function expected(boxes, [minX, minY, maxX, maxY]) {
	return boxes.flatMap(([x0, y0, x1, y1], id) =>
		x0 <= maxX && y0 <= maxY && x1 >= minX && y1 >= minY ? [id] : []);
}

describe('Flatbush allocation reuse', () => {
	for (const count of [37, 4, 1]) {
		it(`rebuilds ${count} items after unfinished and finished states`, () => {
			const index = new Flatbush(count, 4);
			let previous;

			for (let cycle = 0; cycle < 3; cycle++) {
				index.reset();
				assert.deepEqual(bounds(index), [Infinity, Infinity, -Infinity, -Infinity]);
				index.add(-1e6, -1e6, 1e6, 1e6);
				index.reset();
				assert.deepEqual(bounds(index), [Infinity, Infinity, -Infinity, -Infinity]);

				const boxes = rectangles(count, cycle);
				build(index, boxes);
				assert.equal(index.numItems, count);
				assert.equal(index.nodeSize, 4);
				assert.deepEqual(bounds(index), [
					Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
					Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
				]);
				assert.deepEqual(sorted(index.search(...all)), boxes.map((_, id) => id));
				boxes.forEach((box, id) => assert.deepEqual(index.search(...box), [id]));
				if (previous)
					assert.deepEqual(index.search(...previous), []);
				previous = bounds(index);
			}
		});
	}

	it('reuses caller arrays and clears stale contents, including on a miss', () => {
		const index = new Flatbush(37, 4);
		const boxes = rectangles(37);
		build(index, boxes);
		const results = [-999];
		const q = [0, 0];
		const query = [5, 5, 45, 45];
		const filter = (id, ...box) => {
			assert.deepEqual(box, boxes[id]);
			return id % 2 === 0;
		};

		assert.equal(index.search(...query, filter, results, q), results);
		assert.deepEqual(sorted(results), expected(boxes, query).filter(id => id % 2 === 0));
		assert.deepEqual(q, []);

		q.push(0, 0);
		assert.equal(index.search(...all, undefined, results, q), results);
		assert.deepEqual(sorted(results), boxes.map((_, id) => id));
		assert.deepEqual(q, []);

		q.push(0, 0);
		assert.equal(index.search(1e6, 1e6, 1e6, 1e6, undefined, results, q), results);
		assert.deepEqual(results, []);
		assert.deepEqual(q, []);

		assert.equal(index.search(...query, undefined, results), results);
		assert.deepEqual(sorted(results), expected(boxes, query));
	});

	it('returns independent default result arrays', () => {
		const index = new Flatbush(37, 4);
		const boxes = rectangles(37);
		build(index, boxes);
		const first = index.search(...all);
		const snapshot = [...first];
		const second = index.search(...all);
		assert.notEqual(first, second);
		second.length = 0;
		index.search(...boxes[0]);
		assert.deepEqual(first, snapshot);
	});

	for (const scratch of [false, true]) {
		it(`supports nested filter searches with ${scratch ? 'separate caller arrays' : 'default arrays'}`, () => {
			const index = new Flatbush(37, 4);
			const boxes = rectangles(37);
			build(index, boxes);
			const outer = scratch ? [[], []] : [];
			const inner = scratch ? [[], []] : [];

			for (const query of [all, [5, 5, 45, 45]]) {
				const visited = [];
				const results = index.search(...query, (id, ...box) => {
					visited.push(id);
					assert.deepEqual(box, boxes[id]);
					assert.deepEqual(index.search(...box, undefined, ...inner), [id]);
					return id % 2 === 0;
				}, ...outer);
				assert.deepEqual(sorted(visited), expected(boxes, query));
				assert.deepEqual(sorted(results), expected(boxes, query).filter(id => id % 2 === 0));
			}
		});
	}

	it('retains typed buffers and allocates Hilbert scratch only for the first packed finish', () => {
		const allocations = [];
		const globals = {};
		for (const Type of [Float64Array, Uint16Array, Uint32Array, Int32Array]) {
			globals[Type.name] = new Proxy(Type, {
				construct(target, args) {
					const array = new target(...args);
					allocations.push([target.name, array.length]);
					return array;
				},
			});
		}
		// Observe private-buffer allocations without changing this process's globals.
		const source = readFileSync(new URL('../demos/lib/flatbush.js', import.meta.url), 'utf8');
		const TrackedFlatbush = runInNewContext(source.replace('export { Flatbush as default };', 'Flatbush;'), globals);
		const index = new TrackedFlatbush(37, 4);
		assert.deepEqual(allocations, [['Float64Array', 204], ['Uint16Array', 51]]);
		index.add(0, 0);
		index.reset();
		const boxes = rectangles(37);
		boxes.forEach(box => index.add(...box));
		assert.equal(allocations.length, 2);
		index.finish();
		assert.deepEqual(allocations[2], ['Int32Array', 37]);
		for (let cycle = 1; cycle <= 3; cycle++) {
			index.reset();
			build(index, rectangles(37, cycle));
		}
		assert.equal(allocations.length, 3);

		for (const count of [1, 4]) {
			const small = new TrackedFlatbush(count, 4);
			const allocated = allocations.length;
			for (let cycle = 0; cycle < 3; cycle++) {
				small.reset();
				build(small, rectangles(count, cycle));
			}
			assert.equal(allocations.length, allocated);
		}
	});
});
