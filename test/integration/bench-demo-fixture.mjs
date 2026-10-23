import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { demos } from '../helpers/bench-demo-evaluator.mjs';

const root = new URL('../../', import.meta.url);

function inBrowserStub(source) {
	execFileSync(process.execPath, ['--input-type=module', '-e', `
		import assert from 'node:assert/strict';
		import {Window} from 'happy-dom';
		const window = new Window();
		globalThis.document = window.document;
		globalThis.devicePixelRatio = 1.5;
		const root = new URL(${JSON.stringify(root.href)});
		const loaded = [];
		document.head.append = element => { loaded.push(element); };
		globalThis.fetch = () => assert.fail('unexpected fetch');
		globalThis.requestAnimationFrame = () => assert.fail('unexpected animation');
		globalThis.setTimeout = () => assert.fail('unexpected timer');
		console.time = console.timeEnd = () => {};
		try {
			${source}
		}
		finally {
			await window.happyDOM.abort();
		}
	`], {cwd: root, timeout: 10000, stdio: 'pipe'});
}

describe('shared benchmark demo fixture and standalone boot', () => {
	it('all six HTML entry points import the same standalone runner with their own variant', () => {
		for (const [id, file] of demos) {
			const html = readFileSync(new URL('bench/' + file, root), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1, file);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.match(scripts[0][2], /import \{runDemo\} from '\.\/demo\.mjs';/);
			assert.ok(scripts[0][2].includes(`runDemo('${id}').catch(console.error);`), file);
			assert.doesNotMatch(html, /<link\b|<canvas\b|function (?:makeChart|prepData)|fetch\(/);
		}
	});

	it('creates variant-scoped hosts and shares one awaited stylesheet load', () => {
		inBrowserStub(`
			const {applyDemoStyles, setupDemo} = await import(new URL('bench/demo-fixture.mjs', root));
			assert.equal(loaded.length, 0, 'import must not start styles or create DOM');
			assert.equal(document.body.children.length, 0);
			const parent = document.createElement('section');
			parent.classList.add('keep-me', 'flot');
			document.body.append(parent);
			for (const [id, selector] of [
				['uplot', null], ['d3', '#plot'], ['chartjs', '#chart1'],
				['echarts', null], ['flot', '#placeholder'], ['dygraphs', null], ['idle', null],
			]) {
				parent.replaceChildren();
				const host = setupDemo(id, parent);
				assert.equal(host.parentNode, parent);
				assert.equal(parent.children.length, 1);
				assert.deepEqual([...parent.classList].sort(), ['keep-me', 'bench-demo', id].sort());
				if (selector) assert.ok(host.querySelector(selector), id);
				if (id === 'd3') {
					for (const selector of ['#overlay', '#cpu-value', '#ram-value', '#tcp-value'])
						assert.ok(host.querySelector(selector), selector);
					assert.equal(host.querySelector('h3').textContent, 'Server Events');
				}
				if (id === 'chartjs') assert.equal(host.className, 'chart-container');
				if (id === 'echarts') assert.equal(host.id, 'chart');
				if (id === 'flot') {
					assert.equal(host.className, 'demo-container');
					assert.equal(host.firstElementChild.className, 'demo-placeholder');
				}
				if (id === 'dygraphs') assert.equal(host.id, 'graphdiv');
				if (id === 'uplot' || id === 'idle') assert.equal(host.children.length, 0);
			}
			const before = parent.outerHTML;
			assert.throws(() => setupDemo('unknown', parent), /Unknown demo variant/);
			assert.equal(parent.outerHTML, before);
			let ready = false;
			const first = applyDemoStyles().then(() => { ready = true; });
			const second = applyDemoStyles();
			assert.equal(loaded.length, 1);
			assert.equal(loaded[0].tagName, 'LINK');
			assert.equal(loaded[0].rel, 'stylesheet');
			assert.equal(loaded[0].href, new URL('bench/demo.css', root).href);
			await Promise.resolve();
			assert.equal(ready, false);
			loaded[0].onload();
			await Promise.all([first, second]);
			assert.equal(ready, true);
			await applyDemoStyles();
			assert.equal(loaded.length, 1);
		`);
	});

	it('rejects a failed shared stylesheet load', () => {
		inBrowserStub(`
			const {applyDemoStyles} = await import(new URL('bench/demo-fixture.mjs', root));
			const pending = applyDemoStyles();
			loaded[0].onerror();
			await assert.rejects(pending, /Failed to load .*demo\\.css/);
		`);
	});

	it('boots the actual uPlot module with ordered local dependencies, prepared data, host, wait, and instance return', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			assert.equal(document.body.children.length, 0);
			assert.equal(loaded.length, 0);
			const timers = [];
			globalThis.setTimeout = (callback, delay) => {
				assert.equal(delay, 0);
				timers.push(callback);
			};
			const packed = [8, 'epoch', 'idl', 'recv', 'send', 'read', 'writ', 'used', 'free', 10, 75, 2, 3, 4, 25, 75, 0];
			let fetches = 0, creates = 0;
			globalThis.fetch = async url => {
				assert.equal(url.href, new URL('bench/data.json', root).href);
				assert.equal(document.getElementById('wait').textContent, 'Fetching data.json (2.07MB)....');
				fetches++;
				return {ok: true, json: async () => packed};
			};
			const instance = {};
			globalThis.uPlot = function(options, data, host) {
				creates++;
				assert.equal(host.parentNode, document.body);
				assert.notEqual(host, document.body);
				assert.ok(document.body.classList.contains('uplot'));
				assert.deepEqual(data, [[600], [25], [25], [3]]);
				assert.deepEqual(options.cache, {paths: false});
				assert.equal(document.getElementById('wait').textContent, 'Rendering...');
				return instance;
			};
			const pending = runDemo('uplot');
			assert.equal(document.getElementById('wait').textContent, 'Loading lib....');
			for (const [index, tag, route] of [
				[0, 'SCRIPT', 'dist/uPlot.iife.min.js'],
				[1, 'LINK', 'dist/uPlot.min.css'],
				[2, 'LINK', 'bench/demo.css'],
			]) {
				for (let i = 0; loaded.length <= index && i < 100; i++) await Promise.resolve();
				assert.equal(loaded.length, index + 1, 'dependencies must load sequentially');
				assert.equal(loaded[index].tagName, tag);
				assert.equal(loaded[index][tag === 'SCRIPT' ? 'src' : 'href'], new URL(route, root).href);
				assert.equal(fetches, 0);
				loaded[index].onload();
			}
			// File imports can require an event-loop turn, not just a microtask.
			for (let i = 0; timers.length === 0 && i < 100; i++) await new Promise(setImmediate);
			assert.equal(timers.length, 1);
			assert.equal(creates, 0);
			timers.shift()();
			assert.equal(await pending, instance);
			assert.equal(creates, 1);
			assert.equal(fetches, 1);
			assert.equal(document.getElementById('wait').textContent, 'Done!');

			document.body.replaceChildren();
			assert.equal(await runDemo('idle'), undefined);
			assert.equal(document.getElementById('wait').textContent, 'Done!');
			assert.ok(document.body.classList.contains('idle'));
			assert.equal(document.body.classList.contains('uplot'), false);
			assert.equal(loaded.length, 3, 'shared styles are cached');
			assert.equal(fetches, 1, 'idle must not fetch data');
			assert.equal(timers.length, 0);
			const before = document.body.innerHTML;
			await assert.rejects(runDemo('unknown'), /Unknown demo variant/);
			assert.equal(document.body.innerHTML, before);

			document.body.replaceChildren();
			globalThis.fetch = async () => ({ok: false, status: 503, statusText: 'Unavailable'});
			await assert.rejects(runDemo('uplot'), /Failed to load data.json: 503 Unavailable/);
			assert.equal(document.getElementById('wait').textContent, 'Error: Failed to load data.json: 503 Unavailable');
			assert.equal(loaded.length, 3, 'local dependencies are cached too');
			assert.equal(creates, 1);
		`);
	});
});
