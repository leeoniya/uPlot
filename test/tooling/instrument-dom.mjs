import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';

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

const canvasMethods = ['clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill', 'save', 'restore', 'clip', 'fillRect', 'rect', 'arc', 'arcTo'];
const canvasProps = ['strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap', 'globalAlpha'];
const context = () => document.createElement('canvas').getContext('2d');

function assertMethod(mock, name) {
	assert.deepStrictEqual(Object.getOwnPropertyDescriptor(mock, name), {
		value: mock[name], enumerable: false, writable: false, configurable: false,
	});
	assert.throws(() => { mock[name] = () => {}; }, TypeError);
	assert.throws(() => { delete mock[name]; }, TypeError);
}

describe('canvas recorder contract', () => {
	it('preserves own descriptors, property order, and setter-only properties', () => {
		const ctx = context();
		assert.deepStrictEqual(Reflect.ownKeys(ctx), ['log', 'record', ...canvasMethods, ...canvasProps, 'createLinearGradient', 'width', 'height']);
		assert.deepStrictEqual(Object.keys(ctx), ['log', 'width', 'height']);
		assert.equal(Object.getPrototypeOf(ctx), Object.prototype);
		for (const name of ['log', 'width', 'height']) {
			assert.deepStrictEqual(Object.getOwnPropertyDescriptor(ctx, name), {
				value: ctx[name], enumerable: true, writable: true, configurable: true,
			});
		}
		for (const name of ['record', ...canvasMethods, 'createLinearGradient'])
			assertMethod(ctx, name);
		for (const name of canvasProps) {
			const descriptor = Object.getOwnPropertyDescriptor(ctx, name);
			assert.deepStrictEqual(Object.keys(descriptor), ['get', 'set', 'enumerable', 'configurable']);
			assert.equal(descriptor.enumerable, false);
			assert.equal(descriptor.configurable, name === 'globalAlpha');
			assert.equal(typeof descriptor.set, 'function');
			assert.equal(typeof descriptor.get, name === 'globalAlpha' ? 'function' : 'undefined');
			assert.equal(ctx[name], name === 'globalAlpha' ? 1 : undefined);
			ctx[name] = .25;
			assert.equal(ctx[name], name === 'globalAlpha' ? .25 : undefined);
		}
	});

	it('keeps detached methods, accessors, and record bound to their original context', () => {
		const first = context();
		const second = context();
		const { moveTo, record } = first;
		moveTo(1, 2);
		moveTo.call(second, 3, 4);
		record.call(second, 'custom', 5);
		const { set } = Object.getOwnPropertyDescriptor(first, 'fillStyle');
		set('red');
		set.call(second, 'blue');
		const alpha = Object.getOwnPropertyDescriptor(first, 'globalAlpha');
		alpha.set.call(second, .5);
		assert.equal(alpha.get(), .5);
		assert.equal(alpha.get.call(second), .5);
		assert.equal(second.globalAlpha, 1);
		assert.deepStrictEqual(second.log, []);
		assert.deepStrictEqual(first.log, [
			['moveTo', [1, 2], [3, 4]], ['custom', 5], ['fillStyle', 'red', 'blue'], ['globalAlpha', .5],
		]);
	});

	it('copies argument lists, normalizes only top-level method -0, and preserves object identity', () => {
		const ctx = context();
		const nested = [-0];
		const object = {};
		const args = [-0, nested, object, undefined, NaN];
		ctx.fillText(...args);
		ctx.fillText(...args);
		const [first, second] = ctx.log[0].slice(1);
		assert.notEqual(first, args);
		assert.notEqual(first, second);
		assert.equal(Object.is(args[0], -0), true);
		assert.equal(Object.is(first[0], 0), true);
		assert.equal(first[1], nested);
		assert.equal(first[2], object);
		assert.equal(Object.is(first[1][0], -0), true);
		args[0] = 123;
		assert.equal(first[0], 0);
		ctx.lineWidth = -0;
		ctx.record('custom', -0);
		assert.equal(Object.is(ctx.log[1][1], -0), true);
		assert.equal(Object.is(ctx.log[2][1], -0), true);
	});

	it('preserves push observers, reentrant recording, alpha overrides, and per-context logs', () => {
		const ctx = context();
		const other = context();
		const events = [];
		let alpha = 1;
		Object.defineProperty(ctx, 'globalAlpha', {
			get: () => alpha,
			set: value => ctx.record('globalAlpha', value),
		});
		ctx.log.push = function(entry) {
			events.push([entry[0], entry[1]]);
			if (entry[0] === 'globalAlpha')
				alpha = entry[1];
			Object.defineProperty(entry, 'push', {
				value(value) {
					events.push([entry[0], value]);
					if (entry[0] === 'globalAlpha')
						alpha = value;
					return Array.prototype.push.call(this, value);
				},
			});
			const length = Array.prototype.push.call(this, entry);
			if (entry[0] === 'save')
				ctx.globalAlpha = .75;
			return length;
		};
		ctx.save();
		ctx.globalAlpha = .5;
		ctx.fillRect(1, 2, 3, 4);
		ctx.fillRect(5, 6, 7, 8);
		other.globalAlpha = .25;
		assert.equal(ctx.globalAlpha, .5);
		assert.equal(other.globalAlpha, .25);
		assert.deepStrictEqual(other.log, [['globalAlpha', .25]]);
		assert.deepStrictEqual(events, [
			['save', []], ['globalAlpha', .75], ['globalAlpha', .5],
			['fillRect', [1, 2, 3, 4]], ['fillRect', [5, 6, 7, 8]],
		]);
		assert.deepStrictEqual(Array.from(ctx.log), [
			['save', []], ['globalAlpha', .75, .5], ['fillRect', [1, 2, 3, 4], [5, 6, 7, 8]],
		]);
	});

	it('retains the captured log and last group when the public log is cleared or replaced', () => {
		const ctx = context();
		const log = ctx.log;
		ctx.moveTo(1, 2);
		const last = log[0];
		log.length = 0;
		ctx.moveTo(3, 4);
		assert.deepStrictEqual(log, []);
		assert.deepStrictEqual(last, ['moveTo', [1, 2], [3, 4]]);
		ctx.log = [];
		ctx.lineTo(5, 6);
		ctx.record('lineTo', [7, 8]);
		assert.deepStrictEqual(ctx.log, []);
		assert.deepStrictEqual(log, [['lineTo', [5, 6], [7, 8]]]);
	});

	it('keeps gradient descriptors, detached calls, arguments, and logs independent', () => {
		const ctx = context();
		const { createLinearGradient } = ctx;
		const args = [-0, 1, 2, 3];
		const first = createLinearGradient(...args);
		const second = createLinearGradient.call(null, 4, 5, 6, 7);
		assert.deepStrictEqual(Reflect.ownKeys(first), ['log', 'record', 'addColorStop', 'type', 'args']);
		assert.deepStrictEqual(Object.keys(first), ['log', 'type', 'args']);
		assertMethod(first, 'record');
		assertMethod(first, 'addColorStop');
		assert.equal(first.type, 'linearGradient');
		assert.deepStrictEqual(first.args, args);
		assert.notEqual(first.args, args);
		assert.equal(Object.is(first.args[0], -0), true);
		const { addColorStop } = first;
		addColorStop(-0, 'red');
		addColorStop.call(second, 1, 'blue');
		assert.deepStrictEqual(first.log, [['addColorStop', [0, 'red'], [1, 'blue']]]);
		assert.deepStrictEqual(second.log, []);
		assert.deepStrictEqual(ctx.log, []);
	});

	it('keeps canvas descriptors, native dimension coercion, and context identity', () => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		assert.equal(canvas.getContext('anything'), ctx);
		assert.deepStrictEqual(Object.getOwnPropertyDescriptor(canvas, 'ctx'), {
			value: ctx, enumerable: false, writable: false, configurable: false,
		});
		for (const name of ['width', 'height']) {
			const inherited = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
			const own = Object.getOwnPropertyDescriptor(canvas, name);
			assert.equal(own.get, inherited.get);
			assert.equal(own.enumerable, inherited.enumerable);
			assert.equal(own.configurable, inherited.configurable);
			canvas[name] = '123';
			assert.equal(canvas[name], 123);
			assert.equal(ctx[name], '123');
			assert.deepStrictEqual(ctx.log.at(-1), ['canvas.' + name, '123']);
		}
	});
});
