import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBenchmarkDisplay, formatBenchmarkDisplay, countTerminalLines } from '../../scripts/benchmarks-display.mjs';

const one = [{variant: 'uplot', ms: 1.25}];
const two = [...one, {variant: 'chartjs', ms: 3.5}];
const clear = lines => (lines ? `\x1b[${lines}A` : '') + '\r\x1b[J';

function capture(options = {}) {
	const stream = Object.assign(new EventEmitter(), {isTTY: true, columns: 100, rows: 40}, options);
	const writes = [];
	stream.write = text => { writes.push(text); return true; };
	return {stream, writes, display: createBenchmarkDisplay({stream})};
}

// Small terminal model for ASCII/table borders, including delayed wrap and scroll.
function screenAfter(writes, columns = 100, height = 40) {
	const screen = ['prior'];
	const scrollback = [];
	let row = 1, column = 0;
	const down = () => {
		row++;
		column = 0;
		if (row === height) {
			scrollback.push(screen.shift() ?? '');
			row--;
		}
	};
	for (const text of writes) {
		for (let i = 0; i < text.length;) {
			const up = /^\x1b\[(\d+)A/.exec(text.slice(i));
			if (up) {
				row = Math.max(0, row - Number(up[1]));
				i += up[0].length;
			}
			else if (text.startsWith('\x1b[J', i)) {
				screen[row] = (screen[row] ?? '').slice(0, column);
				screen.length = row + 1;
				i += 3;
			}
			else {
				const char = text[i++];
				if (char === '\r')
					column = 0;
				else if (char === '\n')
					down();
				else {
					if (column === columns)
						down();
					const line = screen[row] ?? '';
					screen[row] = line.padEnd(column).slice(0, column) + char + line.slice(column + 1);
					column++;
				}
			}
		}
	}
	return {screen: screen.join('\n'), scrollback: scrollback.join('\n'), column};
}

describe('benchmark display', () => {
	it('omits quotes and the index, left-aligns names, and right-aligns one-decimal values', () => {
		assert.equal(formatBenchmarkDisplay({rows: two}), [
			'┌─────────┬─────┐',
			'│ variant │  ms │',
			'├─────────┼─────┤',
			'│ uplot   │ 1.3 │',
			'│ chartjs │ 3.5 │',
			'└─────────┴─────┘',
			'',
		].join('\n'));
	});

	it('formats integers, zero, negative values, and missing measurements without changing inputs', () => {
		const rows = [
			{variant: 'uplot', ms: 0}, {variant: 'chartjs', ms: 12}, {variant: 'd3', ms: -1.25},
			{variant: 'echarts', ms: 'unavailable'}, {variant: 'flot', ms: null}, {variant: 'dygraphs', ms: NaN},
		];
		const original = structuredClone(rows);
		const cells = formatBenchmarkDisplay({rows}).split('\n').filter(line => line.startsWith('│')).slice(1);
		assert.deepEqual(cells.map(line => line.split('│')[2]),
			['         0.0 ', '        12.0 ', '        -1.3 ', ' unavailable ', ' unavailable ', ' unavailable ']);
		assert.deepEqual(rows, original);
	});

	it('pads Unicode names by display width and prevents multiline cells or terminal escapes', () => {
		const rows = [{variant: '\x1b[31m界界\x1b[0m\n', ms: 1}, {variant: 'e\u0301', ms: 2}];
		const text = formatBenchmarkDisplay({rows});
		assert.doesNotMatch(text, /\x1b/);
		assert.ok(text.includes('│ 界界    │ 1.0 │'));
		assert.ok(text.includes('│ e\u0301       │ 2.0 │'));
		assert.equal(countTerminalLines(text, 17), 6);
	});

	it('fits the full combined table in 86 columns and counts wrapping below that width', () => {
		const rows = ['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'].map(variant => ({
			variant, 'prep ms': 4.05, 'init ms': 8.994, 'main ms': 12.011, 'gpu ms': 2.006,
			'total ms': 15.642, 'peak MB': 25.538, 'retained MB': 18.375,
		}));
		const frame = {rows, status: 'Running'};
		const text = formatBenchmarkDisplay(frame);
		assert.equal(text.split('\n')[0].length, 86);
		assert.equal(countTerminalLines(text, 86), 11);
		assert.ok(text.indexOf('peak MB') < text.indexOf('retained MB'));
		for (const columns of [85, 86, 100]) {
			const {display, writes} = capture({columns, rows: 12});
			display.update(frame);
			assert.equal(writes[0], text);
			display.update({...frame, status: 'Done', final: true});
			assert.equal(writes[1], clear(Math.min(countTerminalLines(text, columns), 11)) + formatBenchmarkDisplay({...frame, status: 'Done'}));
		}
	});

	it('shows status without an empty table, then replaces the entire growing frame', () => {
		const {display, writes} = capture();
		display.update({status: 'Starting', warnings: ['No results yet']});
		assert.equal(writes[0], 'Starting\n');
		display.update({rows: one, status: 'Running chartjs'});
		assert.equal(writes[1], clear(1) + formatBenchmarkDisplay({rows: one, status: 'Running chartjs'}));
		display.update({rows: two, status: 'Done', final: true});
		assert.equal(writes[2], clear(6) + formatBenchmarkDisplay({rows: two, status: 'Done'}));
		const result = screenAfter(writes);
		assert.equal(result.screen, 'prior\n' + formatBenchmarkDisplay({rows: two, status: 'Done'}).trimEnd());
		assert.equal(result.column, 0);
	});

	it('replaces running status even when rows do not change, with status below the table', () => {
		const {display, writes} = capture();
		display.update({rows: one, status: 'Running chartjs: a long previous status'});
		display.update({rows: one, status: 'Running d3'});
		assert.equal(writes[1], clear(6) + formatBenchmarkDisplay({rows: one, status: 'Running d3'}));
		const {screen} = screenAfter(writes);
		assert.ok(screen.indexOf('└') < screen.indexOf('Running d3'));
		assert.doesNotMatch(screen, /chartjs|previous/);
		assert.equal(screen.match(/Running/g).length, 1);
	});

	it('includes concise, deduplicated warnings in the replaceable region', () => {
		const {display, writes} = capture();
		const frame = {rows: one, status: 'Running', warnings: ['missing\nsamples', 'missing samples', 'x'.repeat(200), 'third', 'fourth', 'fifth']};
		display.update(frame);
		assert.match(writes[0], /Running\nWarning: missing samples\n/);
		assert.equal(writes[0].match(/missing samples/g).length, 1);
		assert.match(writes[0], new RegExp(`Warning: ${'x'.repeat(157)}\\.\\.\\.\\n`));
		assert.match(writes[0], /Warning: 2 more warning\(s\)\n$/);
		display.update({rows: one, status: 'Done', final: true});
		assert.equal(writes[1], clear(countTerminalLines(writes[0], 100)) + formatBenchmarkDisplay({rows: one, status: 'Done'}));
		assert.doesNotMatch(screenAfter(writes).screen, /Warning|missing|third/);
	});

	it('counts newlines, blank lines, exact-width lines, and physical wraps', () => {
		for (const [text, columns, expected] of [
			['', 10, 0], ['\n', 10, 1], ['\n\n', 10, 2],
			['12345\n', 5, 1], ['123456\n', 5, 2], ['1234567890\n', 5, 2],
			['12345678901\n\nabc\n', 5, 5], ['abc', 5, 1],
			['界界界\n', 3, 3], ['e\u0301e\u0301\n', 2, 1], ['👩‍💻!\n', 2, 2],
			['abc\tdef\n', 5, 2], ['abc\r\ndef\n', 5, 2],
			['\x1b[31m12345\x1b[0m\n', 5, 1],
		])
			assert.equal(countTerminalLines(text, columns), expected, JSON.stringify({text, columns}));
	});

	for (const columns of [10, 21, 40, 100]) {
		it(`clears wrapped table, multiline status, and warnings at width ${columns}`, () => {
			const {display, writes} = capture({columns, rows: 100});
			const frame = {rows: one, status: 'Running the next benchmark\n\nPlease wait\n', warnings: ['missing measurement']};
			display.update(frame);
			// These fixtures contain only single-cell characters, so this is an
			// independent physical-line count, not the implementation helper.
			const physical = writes[0].split('\n').slice(0, -1).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
			display.update({status: 'Failed', final: true});
			assert.equal(writes[1], clear(physical) + 'Failed\n');
			assert.equal(screenAfter(writes, columns, 100).screen, 'prior\nFailed');
		});
	}

	it('abandons the old region safely after resize, then tracks the new size', () => {
		const {stream, display, writes} = capture();
		display.update({rows: one, status: 'Running'});
		stream.columns = 20;
		display.update({rows: one, status: 'Narrow'});
		assert.doesNotMatch(writes[1], /\x1b/);
		display.update({rows: two, status: 'Next'});
		assert.ok(writes[2].startsWith(clear(countTerminalLines(writes[1], 20))));
		stream.columns = 100;
		display.update({rows: two, status: 'Wide'});
		assert.doesNotMatch(writes[3], /\x1b/);
		stream.rows = 10;
		display.update({rows: two, status: 'Short', final: true});
		assert.doesNotMatch(writes[4], /\x1b/);
	});

	it('prints tall tables and bounds cursor erasure to the visible viewport', () => {
		const {display, writes} = capture({rows: 4});
		const frame = {rows: two, status: 'Running'};
		display.update(frame);
		display.update({status: 'Failed', final: true});
		assert.deepEqual(writes, [formatBenchmarkDisplay(frame), clear(3) + 'Failed\n']);
		const result = screenAfter(writes, 100, 4);
		assert.ok(result.scrollback.startsWith('prior\n┌'));
		assert.equal(result.screen, 'Failed');
	});

	it('prints every incremental table in a 100-column, 6-row viewport', () => {
		const {display, writes} = capture({columns: 100, rows: 6});
		const frames = [
			{rows: one, status: 'Running chartjs'},
			{rows: two, status: 'Running d3', warnings: ['partial results']},
			{rows: two, status: 'Finishing'},
			{rows: two, status: 'Done', warnings: ['partial results'], final: true},
		];
		for (const [i, frame] of frames.entries()) {
			display.update(frame);
			assert.equal(writes[i], (i === 0 ? '' : clear(5)) + formatBenchmarkDisplay(frame));
		}
		display.update(frames.at(-1));
		assert.equal(writes.length, 4);
		assert.equal(writes.join('').match(/┌/g).length, 4);
		assert.equal(writes.join('').match(/└/g).length, 4);
		const result = screenAfter(writes, 100, 6);
		assert.ok(result.scrollback.startsWith('prior\n'));
		assert.ok(result.screen.endsWith('Done\nWarning: partial results'));
		assert.equal(result.column, 0);
	});

	it('keeps rendering the full table as it grows beyond the viewport', () => {
		const {display, writes} = capture({rows: 7});
		const frame = {rows: one, status: 'Running'};
		display.update(frame);
		assert.equal(countTerminalLines(writes[0], 100), 6);
		assert.equal(writes[0], formatBenchmarkDisplay(frame));
		display.update({rows: two, status: 'Next'});
		assert.equal(writes[1], clear(6) + formatBenchmarkDisplay({rows: two, status: 'Next'}));
		display.update(frame);
		assert.equal(writes[2], clear(6) + formatBenchmarkDisplay(frame));
	});

	it('always includes wrapped tables and warnings even when the frame does not fit', () => {
		for (const options of [{columns: 10, rows: 10}, {columns: 100, rows: 7}]) {
			const {display, writes} = capture(options);
			const frame = {rows: one, status: 'Running', warnings: ['missing samples']};
			assert.ok(countTerminalLines(formatBenchmarkDisplay(frame), options.columns) > options.rows - 1);
			display.update(frame);
			assert.deepEqual(writes, [formatBenchmarkDisplay(frame)]);
			display.update({...frame, status: 'Failed', final: true});
			assert.equal(writes[1], clear(options.rows - 1) + formatBenchmarkDisplay({...frame, status: 'Failed'}));
		}
	});

	it('does not guess cursor movement when terminal dimensions are unavailable', () => {
		for (const options of [{columns: undefined}, {rows: undefined}, {columns: 0, rows: 0}]) {
			const {display, writes} = capture(options);
			display.update({status: 'Running'});
			display.update({rows: one, final: true});
			assert.doesNotMatch(writes.join(''), /\x1b/);
		}
	});

	it('writes plain progress and exactly one final table to non-TTY streams', () => {
		const {display, writes} = capture({isTTY: false});
		display.update({status: '\x1b[32mStarting\x1b[0m'});
		display.update({rows: one, status: 'Running chartjs', warnings: ['partial']});
		display.update({rows: two});
		assert.deepEqual(writes, ['Starting\n', 'Running chartjs\n']);
		display.update({rows: two, status: 'Done', warnings: ['partial'], final: true});
		assert.equal(writes[2], formatBenchmarkDisplay({rows: two, status: 'Done', warnings: ['partial']}));
		display.update({rows: two, final: true});
		display.update({status: 'Too late'});
		assert.equal(writes.length, 3);
		assert.equal(writes.join('').match(/┌/g).length, 1);
		assert.doesNotMatch(writes.join(''), /\x1b/);
	});

	for (const isTTY of [false, true]) {
		it(`finalizes partial failures without listeners or cursor hiding (TTY=${isTTY})`, () => {
			const {stream, display, writes} = capture({isTTY});
			const listener = () => {};
			stream.on('resize', listener);
			display.update({rows: one, status: 'Running'});
			display.update({rows: one, status: 'Failed: worker exited', warnings: ['partial results'], final: true});
			const final = writes.at(-1);
			assert.ok(final.endsWith(formatBenchmarkDisplay({rows: one, status: 'Failed: worker exited', warnings: ['partial results']})));
			assert.deepEqual(stream.eventNames(), ['resize']);
			assert.deepEqual(stream.listeners('resize'), [listener]);
			assert.doesNotMatch(writes.join(''), /\x1b\[\?25[hl]/);
			const length = writes.length;
			stream.emit('resize');
			display.update({rows: two, final: true});
			display.update({status: 'Ignored'});
			assert.equal(writes.length, length);
		});
	}

	it('supports empty updates and final failure before any rows exist', () => {
		const {display, writes} = capture();
		display.update();
		assert.deepEqual(writes, []);
		display.update({status: 'Starting'});
		display.update({status: 'Failed', final: true});
		assert.deepEqual(writes, ['Starting\n', clear(1) + 'Failed\n']);
	});
});
