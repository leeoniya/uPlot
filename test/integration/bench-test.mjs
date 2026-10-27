import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Window} from 'happy-dom';
import {prepData, updateChart} from '../../bench/uplot.mjs';
import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';

const html = readFileSync(new URL('../../bench/bench-test.html', import.meta.url), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
const packed = [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
	10, 50, 2, 3, 4, 25, 75, 11, 40, 2, 4, 4, 30, 70, 12, 30, 2, 5, 4, 35, 65];

function fixture(response, bundle = function() {}) {
	const window = new Window();
	const document = window.document;
	Object.defineProperty(document, 'fonts', {value: {ready: Promise.resolve()}});
	document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
	const prepared = [], constructions = [], updates = [], errors = [], hosts = [];
	const loadEvents = new EventTarget(), timers = new Map();
	let now = 0, nextTimer = 0;
	const chart = {setData(input, reset) { updates.push({input, reset, at: now}); }};
	const context = {
		document, window: loadEvents, uPlot: bundle, smallLifecycleData, updateChart,
		setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, at: now + delay}); return id; },
		clearTimeout: id => timers.delete(id),
		console: {error: error => errors.push(error)},
		fetch: async url => { assert.equal(url, './data.json'); return response; },
		prepData(input) { const data = prepData(input); prepared.push(data); return data; },
		setupDemo(variant, parent) {
			assert.equal(variant, 'uplot');
			const host = document.createElement('div');
			parent.append(host);
			hosts.push(host);
			return host;
		},
		makeChart(input, host, wait) {
			constructions.push({input, host, wait, at: now});
			return chart;
		},
	};
	const ready = runInNewContext(`(async () => {${source}\n})()`, context);
	return {window, ready, prepared, constructions, updates, errors, hosts, timers,
		load: () => loadEvents.dispatchEvent(new Event('load')),
		async advance(ms) {
			const end = now + ms;
			while (true) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end) break;
				const [id, {callback, at}] = next;
				timers.delete(id);
				now = at;
				await callback();
			}
			now = end;
		},
		status: document.getElementById('status')};
}

describe('automatic uPlot benchmark phases', () => {
	it('creates at load + 2000ms and updates once at load + 4000ms with already prepared data', async () => {
		const f = fixture({ok: true, json: async () => packed});
		try {
			await f.ready;
			assert.equal(f.window.document.querySelectorAll('button').length, 0);
			assert.equal(f.prepared.length, 2);
			assert.deepEqual(f.prepared[0][0], [600, 720]);
			assert.ok(f.prepared[0].every(column => column.length === 2));
			assert.ok(f.prepared[1].every(column => column.length === 3));
			assert.equal(f.hosts.length, 0);
			assert.equal(f.timers.size, 0);
			await f.advance(500);
			f.load();
			f.load();
			assert.equal(f.timers.size, 2);
			await f.advance(1999);
			assert.equal(f.constructions.length, 0);
			await f.advance(1);
			assert.equal(f.hosts.length, 1);
			assert.equal(f.constructions[0].input, f.prepared[0]);
			assert.equal(f.constructions[0].at, 2500);
			await f.advance(1999);
			assert.equal(f.updates.length, 0);
			await f.advance(1);
			assert.deepEqual(f.updates, [{input: f.prepared[1], reset: true, at: 4500}]);
			assert.equal(f.updates[0].input, f.prepared[1]);
			assert.equal(f.prepared.length, 2);
			await f.advance(10000);
			assert.equal(f.constructions.length, 1);
			assert.equal(f.updates.length, 1);
			assert.equal(f.timers.size, 0);
			assert.match(f.status.textContent, /Full dataset applied/);
			assert.deepEqual(f.errors, []);
		}
		finally { await f.window.happyDOM.close(); }
	});

	it('cancels the update if preparation misses the creation deadline', async () => {
		const response = Promise.withResolvers();
		const f = fixture(response.promise);
		try {
			f.load();
			await f.advance(2000);
			assert.match(f.status.textContent, /did not finish before the 2-second creation phase/);
			assert.equal(f.timers.size, 0);
			response.resolve({ok: true, json: async () => packed});
			await f.ready;
			await f.advance(10000);
			assert.match(f.status.textContent, /^Error:/);
			assert.equal(f.constructions.length, 0);
			assert.equal(f.updates.length, 0);
			assert.equal(f.errors.length, 1);
		}
		finally { await f.window.happyDOM.close(); }
	});

	for (const [name, response, bundle, error] of [
		['fetch error', {ok: false, status: 404}, function() {}, /HTTP 404/],
		['missing bundle', {ok: true, json: async () => packed}, null, /local uPlot bundle/],
	]) it(`does not execute phases on ${name}`, async () => {
		const f = fixture(response, bundle);
		try {
			f.load();
			await f.ready;
			await f.advance(4000);
			assert.equal(f.timers.size, 0);
			assert.equal(f.constructions.length, 0);
			assert.equal(f.updates.length, 0);
			assert.equal(f.errors.length, 1);
			assert.match(f.status.textContent, error);
		}
		finally { await f.window.happyDOM.close(); }
	});
});
