import assert from 'node:assert/strict';
import {describe, it} from 'mocha';
import {Window} from 'happy-dom';
import {hoverVariants, hoverTargets, visibleText, nearHoverIndex, validateHoverPlan, runHover, verifyHover} from '../../bench/hover.mjs';

const targets = () => hoverTargets(55550, (index, seriesIndex) => ({x: index / 100, y: 100 + seriesIndex * 50}));
const evidence = target => ({index: target.index, seriesIndex: target.seriesIndex, value: 42, text: 'CPU: 42'});
const plan = () => ({targets: targets(), verify: evidence});
const immediate = {move: async () => {}, wait: async () => {}};
const signal = () => {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return {promise, resolve};
};

describe('benchmark hover helpers', () => {
	it('exports the full fixed capability snapshot including idle', () => {
		assert.deepEqual(hoverVariants, ['idle', 'uplot', 'uplot-release', 'd3', 'd3-minmax', 'd3-svg', 'd3-svg-minmax',
			'd3fc', 'd3fc-canvas', 'deckgl', 'chartjs', 'dygraphs', 'highcharts-svg', 'plotly', 'plotly-svg', 'lightweight']);
		assert.equal(new Set(hoverVariants).size, 16);
	});

	it('projects ten unique interior rows and cycles all three series', () => {
		for (const length of [12, 13, 100, 55550]) {
			const calls = [];
			const points = hoverTargets(length, (index, seriesIndex) => {
				calls.push([index, seriesIndex]);
				return {x: index, y: seriesIndex};
			});
			assert.equal(points.length, 10);
			assert.equal(new Set(points.map(point => point.index)).size, 10);
			points.forEach((point, i) => {
				assert.equal(point.index, Math.round((i + 1) * (length - 1) / 11));
				assert.ok(point.index > 0 && point.index < length - 1);
				assert.equal(point.seriesIndex, i % 3);
				assert.deepEqual(calls[i], [point.x, point.y]);
			});
		}
		for (const length of [0, 11, 12.5, NaN, Infinity, '12'])
			assert.throws(() => hoverTargets(length, () => assert.fail('must validate first')), /twelve/);
	});

	it('validates target count, verifier, unique rows, series order and viewport bounds', () => {
		assert.doesNotThrow(() => validateHoverPlan({...plan(), verify() { assert.fail('geometry validation must not verify values'); }}, 1920, 900));
		for (const invalid of [null, {}, {targets: []}, {...plan(), targets: targets().slice(1)}, {...plan(), verify: null}])
			assert.throws(() => validateHoverPlan(invalid, 1920, 900), /ten targets/);
		for (const patch of [{x: -1}, {x: 1920}, {x: NaN}, {x: Infinity}, {y: -1}, {y: 900}, {y: NaN},
			{index: -1}, {index: 1.5}, {index: Number.MAX_SAFE_INTEGER + 1}, {seriesIndex: 1}]) {
			const invalid = plan();
			Object.assign(invalid.targets[0], patch);
			assert.throws(() => validateHoverPlan(invalid, 1920, 900), /Invalid hover target 0/);
		}
		const duplicate = plan();
		duplicate.targets[1].index = duplicate.targets[0].index;
		assert.throws(() => validateHoverPlan(duplicate, 1920, 900), /Invalid hover target 1/);
		const edge = plan();
		Object.assign(edge.targets[0], {x: 0, y: 0});
		Object.assign(edge.targets[1], {x: 1919.9, y: 899.9});
		assert.doesNotThrow(() => validateHoverPlan(edge, 1920, 900));
	});

	it('checks nearest-row tolerance without accepting invalid indices or tolerances', () => {
		const target = {index: 100};
		assert.equal(nearHoverIndex(100, target, 0), true);
		assert.equal(nearHoverIndex(98, target, 2), true);
		assert.equal(nearHoverIndex(102, target, 2), true);
		assert.equal(nearHoverIndex(103, target, 2), false);
		for (const actual of [-1, 100.5, NaN, Infinity, '100']) assert.equal(nearHoverIndex(actual, target, 2), false);
		for (const tolerance of [-1, NaN, Infinity, '2']) assert.equal(nearHoverIndex(100, target, tolerance), false);
	});

	it('requires connected, nonempty geometry and visible ancestors before returning trimmed text', () => {
		const window = new Window();
		const style = window.document.createElement('style');
				style.textContent = '* { opacity: 1; }'; // happy-dom does not supply the browser default.
				window.document.head.append(style);
				const parent = window.document.createElement('div');
		const child = window.document.createElement('span');
		parent.append(child);
		window.document.body.append(parent);
		child.textContent = '  CPU: 42  ';
		child.getBoundingClientRect = () => ({width: 80, height: 20});
		assert.equal(visibleText(child), 'CPU: 42');
		for (const node of [child, parent, window.document.body]) {
			for (const [property, value] of [['display', 'none'], ['visibility', 'hidden'], ['visibility', 'collapse'], ['opacity', '0']]) {
				node.style[property] = value;
				assert.equal(visibleText(child), '', `${node.tagName} ${property}`);
				node.style[property] = '';
			}
		}
		for (const rect of [{width: 0, height: 20}, {width: 20, height: 0}]) {
			child.getBoundingClientRect = () => rect;
			assert.equal(visibleText(child), '');
		}
		child.remove();
		assert.equal(visibleText(child), '');
		assert.equal(visibleText(null), '');
	});

	it('moves immediately, awaits each acknowledgement and waits 50ms only between the ten moves', async () => {
		const input = targets();
		const events = [];
		let time = 0;
		const pending = runHover(input, {
			async move(x, y) {
				events.push(['move', x, y, time]);
				await Promise.resolve();
				events.push(['ack', x, y, time]);
			},
			async wait(ms) {
				events.push(['wait', ms]);
				await Promise.resolve();
				time += ms;
				events.push(['waited', ms]);
			},
		});
		assert.deepEqual(events, [['move', input[0].x, input[0].y, 0]]);
		assert.deepEqual(await pending, {count: 10, intervalMs: 50});
		assert.deepEqual(events, input.flatMap(({x, y}, i) => [
			['move', x, y, i * 50], ['ack', x, y, i * 50],
			...(i < 9 ? [['wait', 50], ['waited', 50]] : []),
		]));
		assert.equal(time, 450);
	});

	it('does not compress waits after slow acknowledgements or send moves while a wait is pending', async () => {
		const acknowledgements = Array.from({length: 10}, signal);
		const waits = Array.from({length: 9}, signal);
		const events = [];
		let moves = 0, waiting = 0, time = 0;
		const pending = runHover(targets(), {
			move() { events.push(['move', time]); return acknowledgements[moves++].promise; },
			wait(ms) { events.push(['wait', ms, time]); return waits[waiting++].promise; },
		});
		for (let i = 0; i < 10; i++) {
			assert.equal(moves, i + 1);
			assert.equal(waiting, i);
			time += 120;
			acknowledgements[i].resolve();
			await Promise.resolve();
			if (i < 9) {
				assert.equal(waiting, i + 1);
				assert.equal(moves, i + 1);
				assert.deepEqual(events.at(-1), ['wait', 50, time]);
				time += 50;
				waits[i].resolve();
				await Promise.resolve();
			}
		}
		assert.deepEqual(await pending, {count: 10, intervalMs: 50});
		assert.deepEqual(events.filter(event => event[0] === 'move').map(event => event[1]),
			Array.from({length: 10}, (_, i) => i * 170));
		assert.equal(waiting, 9);
	});

	it('reads only immutable coordinates, never verification, selected data, frames or a clock', async () => {
		const input = targets().map(({x, y}) => ({x, y}));
		const options = {...immediate};
		for (const object of [input, options, ...input]) {
			for (const key of ['targets', 'verify', 'idle', 'index', 'seriesIndex', 'value', 'text', 'frame', 'now', 'timeoutMs', 'requestAnimationFrame', 'document', 'getBoundingClientRect', 'readPixels'])
				Object.defineProperty(object, key, {get() { assert.fail(`must not read ${key}`); }});
			Object.freeze(object);
		}
		assert.deepEqual(await runHover(input, options), {count: 10, intervalMs: 50});
	});

	it('propagates move and wait failures without sending subsequent moves', async () => {
		await assert.rejects(runHover(targets(), {...immediate, move: null}), /mouse-input bridge/);
		for (const phase of ['move', 'wait']) {
			for (const asynchronous of [false, true]) {
				const error = new Error(`${phase} failed`);
				let moves = 0, waits = 0;
				const fail = () => { if (asynchronous) return Promise.reject(error); throw error; };
				await assert.rejects(runHover(targets(), {
					move() { moves++; return phase === 'move' ? fail() : Promise.resolve(); },
					wait() { waits++; return fail(); },
				}), actual => actual === error);
				assert.equal(moves, 1);
				assert.equal(waits, phase === 'wait' ? 1 : 0);
			}
		}
	});

	it('diagnoses each target once after its acknowledgement and an independent 50ms wait, including the last', async () => {
		const input = plan();
		const events = [];
		let current;
		input.verify = target => {
			assert.equal(target, current);
			events.push(['verify', target.index]);
			return Object.freeze(evidence(target));
		};
		input.targets.forEach(Object.freeze);
		Object.freeze(input.targets);
		Object.freeze(input);
		const result = await verifyHover(input, {
			async move(x, y) {
				current = input.targets.find(target => target.x === x && target.y === y);
				events.push(['move', current.index]);
				await Promise.resolve();
				events.push(['ack', current.index]);
			},
			async wait(ms) {
				assert.equal(ms, 50);
				events.push(['wait', current.index]);
				await Promise.resolve();
				events.push(['waited', current.index]);
			},
			get frame() { assert.fail('no diagnostic frame polling'); },
			get now() { assert.fail('no diagnostic clock polling'); },
		});
		assert.deepEqual(events, input.targets.flatMap(({index}) => ['move', 'ack', 'wait', 'waited', 'verify'].map(kind => [kind, index])));
		assert.deepEqual(result, {count: 10, intervalMs: 50,
			moves: input.targets.map(target => ({x: target.x, y: target.y, targetIndex: target.index, ...evidence(target)}))});
	});

	it('rejects missing diagnostic evidence after one wait and one check, without retrying', async () => {
		let moves = 0, waits = 0, checks = 0;
		await assert.rejects(verifyHover({...plan(), verify() { checks++; return null; }}, {
			move: async () => { moves++; },
			wait: async ms => { assert.equal(ms, 50); waits++; },
		}), /series 0, row 5050|non-displayed/);
		assert.deepEqual({moves, waits, checks}, {moves: 1, waits: 1, checks: 1});
	});

	it('rejects duplicate or invalid diagnostic evidence without retrying or issuing another move', async () => {
		for (const patch of [{index: -1}, {index: 1.5}, {index: Number.MAX_SAFE_INTEGER + 1}, {seriesIndex: 2},
			{value: undefined}, {value: NaN}, {value: Infinity}, {text: ''}, {text: '  '}, {text: 42}]) {
			let moves = 0, checks = 0;
			await assert.rejects(verifyHover({...plan(), verify: target => { checks++; return {...evidence(target), ...patch}; }}, {
				...immediate, move: async () => { moves++; },
			}), /invalid, duplicate, or non-displayed/);
			assert.deepEqual({moves, checks}, {moves: 1, checks: 1});
		}
		let moves = 0, checks = 0;
		await assert.rejects(verifyHover({...plan(), verify: target => { checks++; return {...evidence(target), index: 5}; }}, {
			...immediate, move: async () => { moves++; },
		}), /duplicate/);
		assert.deepEqual({moves, checks}, {moves: 2, checks: 2});
	});

	it('allows diagnostic idle evidence without values but retains row and series checks', async () => {
		const idle = {...plan(), idle: true, verify: target => ({index: target.index, seriesIndex: target.seriesIndex, idle: true})};
		assert.equal((await verifyHover(idle, immediate)).count, 10);
		await assert.rejects(verifyHover({...idle, idle: false}, immediate), /non-displayed/);
		for (const patch of [{index: -1}, {seriesIndex: 2}])
			await assert.rejects(verifyHover({...idle, verify: target => ({...idle.verify(target), ...patch})}, immediate), /invalid/);
	});

	it('propagates diagnostic move, wait and verifier failures without retrying', async () => {
		await assert.rejects(verifyHover(plan(), {...immediate, move: null}), /mouse-input bridge/);
		for (const phase of ['move', 'wait', 'verify']) {
			const error = new Error(`${phase} failed`);
			const calls = [];
			const invoke = name => { calls.push(name); if (phase === name) throw error; };
			await assert.rejects(verifyHover({...plan(), verify() { invoke('verify'); }}, {
				move: async () => invoke('move'), wait: async () => invoke('wait'),
			}), actual => actual === error);
			assert.deepEqual(calls, ['move', 'wait', 'verify'].slice(0, ['move', 'wait', 'verify'].indexOf(phase) + 1));
		}
	});
});
