import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { writeFailureReport } from '../scripts/replay.mjs';

class ReplayPath {
	ops = [];
	rect(...args) { this.ops.push(['rect', ...args]); }
	closePath() { this.ops.push(['closePath']); }
	moveTo(...args) { this.ops.push(['moveTo', ...args]); }
	lineTo(...args) { this.ops.push(['lineTo', ...args]); }
}

describe('browser failure reports', () => {
	let directory;
	let window;

	beforeEach(() => {
		fs.mkdirSync('test/output', { recursive: true });
		directory = fs.mkdtempSync('test/output/replay-');
	});

	afterEach(async () => {
		await window?.happyDOM.close();
		window = null;
		fs.rmSync(directory, { recursive: true, force: true });
	});

	function loadReport(failures, title) {
		const filename = path.join(directory, 'nested/report.html');
		writeFailureReport(failures, filename, title);
		window = new Window({ settings: { disableJavaScriptEvaluation: true } });
		window.document.write(fs.readFileSync(filename, 'utf8'));
		return window.document;
	}

	it('replays paths and gradients on hover and safely embeds recorded text', () => {
		const text = '</script><script>globalThis.injected = true</script>';
		const title = 'Comparison <img src=x onerror=alert(1)> & "title"';
		const expected = {
			width: 40,
			height: 20,
			ctxlog: [
				['fillStyle', {
					type: 'linearGradient', args: [0, 0, 40, 0],
					log: [['addColorStop', [0, 'red'], [1, 'blue']]],
				}],
				['fill', [{ log: [['rect', [0, 0, 40, 20]], ['closePath', []]] }]],
				['strokeStyle', 'black'],
				['lineWidth', 1, 2],
				['stroke', [{ log: [['moveTo', [0, 0]], ['lineTo', [40, 20]]] }]],
				['fillText', [text, 1, 2]],
			],
		};
		const actual = {
			width: 10, height: 5,
			ctxlog: [['fillStyle', 'green'], ['fillRect', [0, 0, 10, 5]]],
		};
		const document = loadReport([{ expected, actual, title }], title);
		assert.equal(document.title, title);
		assert.equal(document.querySelector('h1').textContent, title);
		assert.equal(document.querySelectorAll('script').length, 1);
		assert.equal(document.querySelectorAll('img, script[src], link').length, 0);

		const canvas = document.querySelector('canvas');
		const comparison = document.querySelector('.comparison');
		const viewState = document.querySelector('.view-state');
		assert.equal(document.querySelector('#toggle'), null);
		const draws = [];
		const dimensions = [];
		const ctx = {
			createLinearGradient(...args) {
				return { args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
			},
			fill(path) { draws.push({ path, style: this.fillStyle }); },
			stroke(path) { draws.push({ path, style: this.strokeStyle, width: this.lineWidth }); },
			fillText(...args) { draws.push(args); },
			fillRect(...args) { draws.push({ args, style: this.fillStyle }); },
		};
		canvas.getContext = type => {
			assert.equal(type, '2d');
			dimensions.push([canvas.width, canvas.height]);
			return ctx;
		};
		const sandbox = { document, Path2D: ReplayPath };
		runInNewContext(document.querySelector('script').textContent, sandbox);

		assert.ok(draws[0].path instanceof ReplayPath);
		assert.deepStrictEqual(draws[0].path.ops, [['rect', 0, 0, 40, 20], ['closePath']]);
		assert.deepStrictEqual(draws[0].style.args, [0, 0, 40, 0]);
		assert.deepStrictEqual(draws[0].style.stops, [[0, 'red'], [1, 'blue']]);
		assert.deepStrictEqual(draws[1].path.ops, [['moveTo', 0, 0], ['lineTo', 40, 20]]);
		assert.equal(draws[1].style, 'black');
		assert.equal(draws[1].width, 2);
		assert.deepStrictEqual(draws[2], [text, 1, 2]);
		assert.equal(sandbox.injected, undefined);
		assert.equal(canvas.getAttribute('aria-label'), 'Expected rendering');

		assert.equal(comparison.style.width, '40px');
		assert.equal(comparison.style.aspectRatio, '40 / 20');
		assert.equal(canvas.style.width, '100%');
		comparison.dispatchEvent(new window.MouseEvent('mouseenter'));
		assert.deepStrictEqual(draws[3], { args: [0, 0, 10, 5], style: 'green' });
		assert.equal(canvas.getAttribute('aria-label'), 'Actual rendering');
		assert.equal(viewState.textContent, 'Showing actual');
		assert.equal(canvas.style.width, '25%');
		assert.equal(comparison.style.width, '40px');
		assert.equal(comparison.style.aspectRatio, '40 / 20');

		comparison.dispatchEvent(new window.MouseEvent('mouseleave'));
		assert.equal(draws.length, 7);
		assert.equal(canvas.getAttribute('aria-label'), 'Expected rendering');
		assert.equal(viewState.textContent, 'Showing expected');
		assert.equal(canvas.style.width, '100%');
		assert.deepStrictEqual(dimensions, [[40, 20], [10, 5], [40, 20]]);
	});

	it('renders every failure immediately with independent hover comparisons and no navigation or instructions', () => {
		const spec = width => ({ width, height: 10, ctxlog: [['fillRect', [0, 0, width, 10]]] });
		const document = loadReport([
			{ title: 'first 0-0', expected: spec(10), actual: spec(20) },
			{ title: 'second 0-pair/1', expected: spec(30), actual: spec(40) },
		]);
		const canvases = Array.from(document.querySelectorAll('canvas'));
		const comparisons = document.querySelectorAll('.comparison');
		assert.equal(canvases.length, 2);
		assert.equal(document.querySelectorAll('select, button').length, 0);
		assert.equal(document.querySelector('p').textContent, '2 failed snapshots');
		assert.deepStrictEqual(Array.from(document.querySelectorAll('h2'), heading => heading.textContent), [
			'first 0-0', 'second 0-pair/1',
		]);
		assert.doesNotMatch(document.body.textContent, /Hover over the chart|Move away to show expected/);
		const draws = [[], []];
		canvases.forEach((canvas, i) => {
			canvas.getContext = () => ({ fillRect() { draws[i].push(canvas.width); } });
		});
		runInNewContext(document.querySelector('script').textContent, { document });
		assert.deepStrictEqual(draws, [[10], [30]]);

		comparisons[0].dispatchEvent(new window.MouseEvent('mouseenter'));
		assert.deepStrictEqual(draws, [[10, 20], [30]]);
		assert.equal(canvases[0].getAttribute('aria-label'), 'Actual rendering');
		assert.equal(canvases[1].getAttribute('aria-label'), 'Expected rendering');

		comparisons[1].dispatchEvent(new window.MouseEvent('mouseenter'));
		comparisons[0].dispatchEvent(new window.MouseEvent('mouseleave'));
		assert.deepStrictEqual(draws, [[10, 20, 10], [30, 40]]);
		assert.equal(canvases[0].getAttribute('aria-label'), 'Expected rendering');
		assert.equal(canvases[1].getAttribute('aria-label'), 'Actual rendering');
		comparisons[1].dispatchEvent(new window.MouseEvent('mouseleave'));
		assert.deepStrictEqual(draws, [[10, 20, 10], [30, 40, 30]]);
	});

	it('shows shared and changed chart titles as inert text without replacing case names', () => {
		const spec = html => ({ html, width: 10, height: 10, ctxlog: [] });
		const document = loadReport([
			{
				title: 'shared 0-0',
				expected: spec('<div class="u-title"><b>Near-flat</b> &amp; tiny</div>'),
				actual: spec('<div class="u-title"><b>Near-flat</b> &amp; tiny</div>'),
			},
			{
				title: 'changed 0-1',
				expected: spec('<div class="u-title">Old title</div>'),
				actual: spec('<div class="u-title">&lt;img src=x onerror=alert(1)&gt;</div><script>globalThis.injected = true</script>'),
			},
			{ title: 'removed 0-2', expected: spec('<div class="u-title">Removed title</div>'), actual: spec('') },
			{ title: 'untitled 0-3', expected: spec(''), actual: spec(undefined) },
		]);
		for (const canvas of document.querySelectorAll('canvas'))
			canvas.getContext = () => ({});
		const sandbox = { document };
		runInNewContext(document.querySelector('script').textContent, sandbox);

		const titles = document.querySelectorAll('.chart-title');
		assert.equal(titles[0].textContent, 'Near-flat & tiny');
		assert.equal(titles[0].hidden, false);
		assert.equal(titles[1].textContent, 'Expected: Old title\nActual: <img src=x onerror=alert(1)>');
		assert.equal(titles[2].textContent, 'Expected: Removed title\nActual: (untitled)');
		assert.equal(titles[3].hidden, true);
		assert.equal(document.querySelector('h2').textContent, 'shared 0-0');
		assert.equal(document.querySelectorAll('img, b').length, 0);
		assert.equal(document.querySelectorAll('script').length, 1);
		assert.equal(sandbox.injected, undefined);
	});

	it('does not create a report when there are no failures', () => {
		const filename = path.join(directory, 'report.html');
		writeFailureReport([], filename);
		assert.equal(fs.existsSync(filename), false);
	});

	it('supports empty zero-size recordings', () => {
		const spec = { width: 0, height: 0, ctxlog: [] };
		const document = loadReport([{ expected: spec, actual: spec, title: 'Empty' }]);
		const canvas = document.querySelector('canvas');
		canvas.getContext = () => ({});
		runInNewContext(document.querySelector('script').textContent, { document });
		assert.equal(canvas.width, 0);
		assert.equal(canvas.height, 0);
		document.querySelector('.comparison').dispatchEvent(new window.MouseEvent('mouseenter'));
		assert.equal(canvas.getAttribute('aria-label'), 'Actual rendering');
		document.querySelector('.comparison').dispatchEvent(new window.MouseEvent('mouseleave'));
		assert.equal(canvas.getAttribute('aria-label'), 'Expected rendering');
	});
});
