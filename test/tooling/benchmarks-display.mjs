import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stripVTControlCharacters } from 'node:util';
import { createBenchmarkDisplay, formatBenchmarkDisplay, countTerminalLines, benchmarkDisplayColorDepth } from '../../scripts/benchmarks-display.mjs';
import { benchmarkLibraryName, benchmarkMetadata } from '../../bench/demo-dependencies.mjs';

const one = [{variant: 'uplot', ms: 1.25}];
const two = [...one, {variant: 'chartjs', ms: 3.5}];
const clear = lines => (lines ? `\x1b[${lines}A` : '') + '\r\x1b[J';

function capture(options = {}, env = {NO_COLOR: ''}) {
	const stream = Object.assign(new EventEmitter(), {isTTY: true, columns: 100, rows: 40}, options);
	const writes = [];
	stream.write = text => { writes.push(text); return true; };
	return {stream, writes, display: createBenchmarkDisplay({stream, env})};
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

describe('benchmark display colors', () => {
	const rgbs = ['34;197;94', '163;230;53', '217;249;157', '253;186;116', '251;146;60',
		'249;115;22', '248;113;113', '239;68;68', '220;38;38', '185;28;28'];
	const palette = [41, 154, 193, 216, 209, 202, 210, 203, 160, 124];
	const totals = values => values.map(value => ({variant: 'custom', 'total ms': value}));
	const coloredValues = text => [...text.matchAll(/\x1b\[(38;[25];[\d;]+)m([^\x1b]*)\x1b\[39m/g)].map(match => match.slice(1));

	it('distinguishes low, middle, and upper green timings in both terminal palettes', () => {
		const values = [4.3, 23.5, 32.4];
		const rows = values.map(value => ({variant: 'custom', 'init ms': value, 'main ms': 0, 'update ms': '-'}));
		for (const colorDepth of [8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			assert.deepEqual(coloredValues(text), values.map((value, band) =>
				[colorDepth === 24 ? `38;2;${rgbs[band]}` : `38;5;${palette[band]}`, value.toFixed(1)]));
			assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
		}
	});

	it('uses exact frame boundaries and starts init red at 100 ms without changing update bands', () => {
		const limits = [1000 / 60, 25, 2000 / 60, 50, 75, 100, 500, 1000, 2000];
		const cases = [[0, 0], [-0, 0], [16.6666, 0], ...limits.flatMap((limit, band) => [
			[limit - 0.0001, band], [limit, band], [limit + 0.0001, band + 1],
		]), [1e12, 9]];
		for (const colorDepth of [8, 24]) {
			const rows = totals(cases.map(([value]) => value));
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			assert.deepEqual(coloredValues(text), cases.map(([value, band]) =>
				[colorDepth === 24 ? `38;2;${rgbs[band]}` : `38;5;${palette[band]}`, value.toFixed(1)]));
			assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
			const workRows = cases.map(([value]) => ({variant: 'custom', 'init ms': value, 'main ms': 1, 'gpu ms': 2, 'update ms': value, 'resize ms': value}));
			const workText = formatBenchmarkDisplay({rows: workRows}, {colorDepth});
			assert.deepEqual(coloredValues(workText), cases.flatMap(([value, band]) =>
								[value === 100 ? 6 : band, band, band].map(shade =>
									[colorDepth === 24 ? `38;2;${rgbs[shade]}` : `38;5;${palette[shade]}`, value.toFixed(1)])));
			assert.equal(stripVTControlCharacters(workText), formatBenchmarkDisplay({rows: workRows}));
		}
	});

	for (const column of ['peak MB', 'retained MB']) {
		const limits = [20, 27.5, 35, 40, 45, 50, 100, 200, 400];
		it(`colors ${column} at exact raw-value boundaries in memory-only and combined tables`, () => {
			const cases = [[0, 0], ...limits.flatMap((limit, band) => [
				[limit - 0.0001, band],
				[limit, limit === 50 ? band + 1 : band],
				[limit + 0.0001, band + 1],
			]), [1e12, 9]];
			for (const colorDepth of [8, 24]) for (const combined of [false, true]) {
				const rows = cases.map(([value]) => ({variant: 'custom',
					...(combined ? {'main ms': 1, 'gpu ms': 2, 'update ms': null} : {}), [column]: value,
				}));
				const original = structuredClone(rows);
				const text = formatBenchmarkDisplay({rows}, {colorDepth});
				assert.deepEqual(coloredValues(text), cases.map(([value, band]) =>
					[colorDepth === 24 ? `38;2;${rgbs[band]}` : `38;5;${palette[band]}`, value.toFixed(1)]));
				assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
				assert.deepEqual(rows, original);
			}
		});
	}

	it('uses a shared memory scale and leaves negative adjustments and missing memory plain', () => {
		const rows = [{variant: 'custom', 'peak MB': 25, 'retained MB': 25},
			...[-1, NaN, Infinity, -Infinity, null, undefined, '-', '25', true].map(value =>
				({variant: 'custom', 'peak MB': value, 'retained MB': value})),
		];
		for (const colorDepth of [8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			assert.deepEqual(coloredValues(text), [1, 1].map(band =>
				[colorDepth === 24 ? `38;2;${rgbs[band]}` : `38;5;${palette[band]}`, '25.0']));
			assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
			assert.match(text, /25\.0\x1b\[39m │/);
		}
	});

	it('colors init, update, resize and hover work without coloring main/gpu or rAF readiness and latency', () => {
		const values = [0, 16.6666, 34, 99.9999, 100.0001, 500, 1000, 2000, -1, NaN, Infinity, null, '-', '10'];
		const rows = values.map(value => ({variant: 'custom', 'init ms': value, 'main ms': 1000, 'gpu ms': 1000, 'update ms': value, 'resize ms': value, 'hover10 ms': value}));
		for (const colorDepth of [8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			assert.deepEqual(coloredValues(text), coloredValues(formatBenchmarkDisplay({rows: totals(values)}, {colorDepth})).flatMap(pair => [pair, pair, pair, pair]));
			assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
			const raf = [{variant: 'custom', 'init rAF ms': 16, 'update ms': 10, 'next rAF ms': 16, 'resize rAF ms': 20, 'hover10 ms': 470}];
			assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: raf}, {colorDepth})), []);
		}
	});

	it('shows cumulative paced hover latency without dividing by ten or subtracting spacing', () => {
		const rows = [{variant: 'uplot', 'init rAF ms': 16, 'update ms': 10, 'next rAF ms': 16, 'resize rAF ms': 20, 'hover10 ms': 470}];
		const original = structuredClone(rows);
		for (const colorDepth of [0, 8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			const cells = stripVTControlCharacters(text).split('\n').filter(line => line.startsWith('│'))
				.map(line => line.split('│').at(-2).trim());
			assert.deepEqual(cells, ['hover10 ms', '470.0']);
			assert.deepEqual(coloredValues(text), []);
		}
		assert.deepEqual(rows, original);
	});

	it('preserves blank hover cells, measured zero, and failed supported cells', () => {
		const rows = ['', 0, '-', 'unavailable'].map(value => ({variant: 'custom', 'main ms': 1, 'update ms': '-', 'hover10 ms': value}));
		const original = structuredClone(rows);
		for (const colorDepth of [0, 8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			const cells = stripVTControlCharacters(text).split('\n').filter(line => line.startsWith('│'))
				.map(line => line.split('│').at(-2).trim());
			assert.deepEqual(cells, ['hover10 ms', '', '0.0', '-', 'unavailable']);
			assert.deepEqual(coloredValues(text), colorDepth ? [[colorDepth === 24 ? `38;2;${rgbs[0]}` : `38;5;${palette[0]}`, '0.0']] : []);
		}
		assert.deepEqual(rows, original);
	});

	it('gives each known context a distinct categorical color and leaves unknown contexts plain', () => {
		const cases = [
			['2d', '96;165;250', 75], ['svg', '249;115;22', 202], ['webgl', '250;204;21', 220],
			['webgl2', '244;114;182', 212], ['webgpu', '192;132;252', 183],
		];
		const rows = [...cases.map(([context]) => context), 'unavailable', 'unknown', '', null, 'constructor', '\x1b[31m2d\x1b[0m']
			.map(context => ({variant: 'custom', context}));
		const original = structuredClone(rows);
		for (const colorDepth of [8, 24]) {
			const text = formatBenchmarkDisplay({rows}, {colorDepth});
			const colors = coloredValues(text);
			assert.deepEqual(colors, cases.map(([context, rgb, palette]) => [colorDepth === 24 ? `38;2;${rgb}` : `38;5;${palette}`, context]));
			assert.equal(new Set(colors.map(([color]) => color)).size, 5);
			assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay({rows}));
			assert.match(text, /2d\x1b\[39m +│/);
		}
		assert.deepEqual(rows, original);
	});

	it('never normalizes colors to the fastest or slowest row', () => {
		const rows = totals([5, 45, 175, 750, 1000]);
		const original = structuredClone(rows);
		for (const colorDepth of [8, 24]) {
			const base = coloredValues(formatBenchmarkDisplay({rows}, {colorDepth}));
			const outlier = coloredValues(formatBenchmarkDisplay({rows: [...totals([0]), ...rows, ...totals([1e15])]}, {colorDepth}));
			assert.deepEqual(outlier.slice(1, -1), base);
		}
		assert.deepEqual(rows, original);
	});

	it('colors only finite nonnegative numeric totals and resets foreground before padding or borders', () => {
		const rows = totals([10, -1, NaN, Infinity, -Infinity, '10', '-', null, undefined, true, '\x1b[41m10\x1b[0m']);
		rows[0] = {...rows[0], variant: '\x1b[31mcustom\x1b[0m', 'init rAF ms': 1000, 'peak MB ': 1000, 'total ms ': 1000};
		const frame = {rows, status: '\x1b[32m1000\x1b[0m', warnings: ['\x1b[41m1000\x1b[0m']};
		const original = structuredClone(frame);
		const plain = formatBenchmarkDisplay(frame);
		assert.doesNotMatch(plain, /\x1b/);
		assert.equal(formatBenchmarkDisplay(frame, {colorDepth: 0}), plain);
		const text = formatBenchmarkDisplay(frame, {colorDepth: 24});
		assert.equal(text, plain.replace(/(│ custom[^\n]*?│ +)10\.0( │)/, '$1\x1b[38;2;34;197;94m10.0\x1b[39m$2'));
		assert.deepEqual(coloredValues(text), [['38;2;34;197;94', '10.0']]);
		assert.equal((text.match(/\x1b/g) ?? []).length, 2);
		assert.deepEqual(frame, original);
	});

	for (const [label, isTTY, depth, env, expected] of [
		['truecolor', true, 24, {}, 24], ['higher depth', true, 32, {}, 24],
		['256 colors', true, 8, {}, 8], ['intermediate depth', true, 16, {}, 8],
		['16 colors', true, 4, {}, 0], ['monochrome', true, 1, {}, 0],
		['unknown depth', true, undefined, {}, 0], ['invalid depth', true, NaN, {}, 0],
		['NO_COLOR empty', true, 24, {NO_COLOR: '', FORCE_COLOR: '3'}, 0],
		['NO_COLOR set', true, 24, {NO_COLOR: '1'}, 0],
		['dumb', true, 24, {TERM: 'dumb', FORCE_COLOR: '3'}, 0],
		['redirect', false, 24, {FORCE_COLOR: '3'}, 0],
	]) {
		it(`detects ${label} without depending on the host environment`, () => {
			const getColorDepth = depth === undefined ? undefined : function(received) {
				assert.equal(received, env);
				assert.equal(this.isTTY, isTTY);
				return depth;
			};
			const {stream, display, writes} = capture({isTTY, getColorDepth}, env);
			assert.equal(benchmarkDisplayColorDepth({stream, env}), expected);
			const frame = {rows: [{variant: 'custom', context: 'webgpu', 'init ms': 16, 'main ms': 5, 'update ms': 1000, 'peak MB': 25, 'retained MB': 15}], final: true};
			display.update(frame);
			assert.equal(writes[0], formatBenchmarkDisplay(frame, {colorDepth: expected}));
		});
	}

	for (const columns of [10, 25, 100]) {
		for (const height of [6, 100]) {
			it(`keeps colored wrapping and erasure equivalent to plain at ${columns}x${height}`, () => {
				const plain = capture({columns, rows: height});
				const colored = capture({columns, rows: height, getColorDepth: () => 24}, {});
				const frames = [
					{rows: totals([16.6, 1000]).map(row => ({...row, context: 'webgpu', 'init ms': 25, 'peak MB': 50, 'retained MB': 30})), status: 'Running\nPlease wait', warnings: ['partial results']},
					{rows: totals([16.6, 1000, 2000]).map(row => ({...row, context: 'webgpu', 'init ms': 25, 'peak MB': 50, 'retained MB': 30})), status: 'Next'},
					{status: 'Done', final: true},
				];
				for (const frame of frames) {
					plain.display.update(frame);
					colored.display.update(frame);
					assert.equal(countTerminalLines(colored.writes.at(-1), columns), countTerminalLines(plain.writes.at(-1), columns));
				}
				// Remove only SGR, leaving cursor commands for exact comparison and simulation.
				const withoutColor = colored.writes.map(text => text.replace(/\x1b\[[\d;]+m/g, ''));
				assert.deepEqual(withoutColor, plain.writes);
				assert.deepEqual(screenAfter(withoutColor, columns, height), screenAfter(plain.writes, columns, height));
			});
		}
	}
});

describe('benchmark display', () => {
	it('hides main/gpu by default without changing rows, work colors, or verbose column order', () => {
		const rows = [{variant: 'uplot', 'init ms': 10, 'main ms': 3, 'gpu ms': 2, 'update ms': 16,
			'peak MB': 20, 'retained MB': 15, 'resize ms': 8, 'hover10 ms': 12}];
		const original = structuredClone(rows);
		for (const colorDepth of [0, 8, 24]) {
			const plain = formatBenchmarkDisplay({rows}, {colorDepth});
			const verbose = formatBenchmarkDisplay({rows}, {colorDepth, verbose: true});
			assert.doesNotMatch(plain, /main ms|gpu ms/);
			assert.match(verbose, /init ms │ main ms │ gpu ms │ update ms/);
			const colors = text => [...text.matchAll(/\x1b\[[\d;]+m[^\x1b]*\x1b\[39m/g)].map(match => match[0]);
			assert.deepEqual(colors(plain), colors(verbose));
		}
		assert.deepEqual(rows, original);
	});

	it('separates the final timing panel with a one-space gap and matching corners', () => {
		const rows = [{variant: 'uplot', 'retained MB': 15, 'resize ms': 8, 'hover10 ms': 12},
			{variant: 'flot', 'retained MB': '-', 'resize ms': '-', 'hover10 ms': ''}];
		const text = formatBenchmarkDisplay({rows});
		assert.equal(text, [
			'┌─────────┬─────────────┐ ┌───────────┬────────────┐',
			'│ variant │ retained MB │ │ resize ms │ hover10 ms │',
			'├─────────┼─────────────┤ ├───────────┼────────────┤',
			'│ uplot   │        15.0 │ │       8.0 │       12.0 │',
			'│ flot    │           - │ │         - │            │',
			'└─────────┴─────────────┘ └───────────┴────────────┘',
			'',
		].join('\n'));
		const width = text.indexOf('\n');
		assert.equal(countTerminalLines(text, width), 6);
		assert.equal(countTerminalLines(text, width - 1), 12);
		for (const columns of [width - 1, width, width + 1]) {
			const {display, writes} = capture({columns});
			display.update({rows});
			display.update({status: 'Done', final: true});
			assert.equal(writes[1], clear(countTerminalLines(text, columns)) + 'Done\n');
			assert.equal(screenAfter(writes, columns).screen, 'prior\nDone');
		}
	});

	it('adds no divider without a retained-memory boundary followed by a final timing column', () => {
		for (const row of [
			{'update ms': 10, 'resize ms': 8, 'hover10 ms': 12},
			{'peak MB': 20, 'retained MB': 15},
			{'retained MB': 15, 'update ms': 10},
		]) assert.doesNotMatch(formatBenchmarkDisplay({rows: [{variant: 'uplot', ...row}]}), /│ │|┐ ┌|┤ ├|┘ └/);
		for (const column of ['resize ms', 'resize rAF ms', 'hover10 ms']) {
			const text = formatBenchmarkDisplay({rows: [{variant: 'uplot', 'retained MB': 15, [column]: 8}]});
			assert.match(text, /retained MB │ │/);
			assert.equal((text.match(/│ │/g) ?? []).length, 2);
		}
	});

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

	it('compacts only the explicit alternative IDs, leaving unknown hyphenated and inherited names alone', () => {
		const alternatives = [
			['d3-svg', 'd3'], ['d3-minmax', 'd3'], ['d3-svg-minmax', 'd3'], ['plotly-svg', 'plotly'], ['highcharts-svg', 'highcharts'],
			['bokeh-canvas', 'bokeh'], ['d3fc-canvas', 'd3fc'], ['g2-webgl', 'g2'],
			['apexcharts-sampled', 'apexcharts'], ['amcharts-sampled', 'amcharts'],
			['devextreme-sampled', 'devextreme'], ['anychart-sampled', 'anychart'], ['fusiontime-sampled', 'fusiontime'],
		];
		const unchanged = ['uplot', 'bokeh', 'custom-svg', 'custom-sampled', 'bokeh-svg', 'd3-sampled',
			'apexcharts-sampled-extra', 'toString', 'constructor', '__proto__'];
		const pairs = [...alternatives, ...unchanged.map(id => [id, id])];
		const rows = pairs.map(([variant]) => ({variant, ms: 1}));
		const original = structuredClone(rows);
		const text = formatBenchmarkDisplay({rows});
		assert.deepEqual(text.split('\n').filter(line => line.startsWith('│')).slice(1)
			.map(line => line.split('│')[1].trim()), pairs.map(([, library]) => library));
		for (const [id, library] of pairs)
			assert.equal(benchmarkLibraryName(id), library);
		assert.deepEqual(rows, original);
	});

	it('measures and wraps the full metadata/combined table using compact names, without shortening progress or warnings', () => {
		const rows = ['bokeh-canvas', 'd3-svg', 'plotly-svg', 'highcharts-svg', 'd3fc-canvas', 'g2-webgl',
			'apexcharts-sampled', 'amcharts-sampled', 'devextreme-sampled', 'anychart-sampled', 'fusiontime-sampled'].map(variant => ({
			variant, ...benchmarkMetadata[variant],
			'prep ms': 4.05, 'init ms': 8.994, 'main ms': 12.011, 'gpu ms': 2.006,
			'update ms': 15.642, 'resize ms': 23.456, 'peak MB': 25.538, 'retained MB': 18.375,
		}));
		// Avoid an unrelated unavailable context making this width fixture wider.
		rows.find(row => row.variant === 'g2-webgl').context = 'webgl2';
		const original = structuredClone(rows);
		const frame = {rows, status: 'Starting bokeh-canvas', warnings: ['d3-svg: failed']};
		const text = formatBenchmarkDisplay(frame);
		const width = 117;
		assert.equal(text.split('\n')[0].length, width);
		assert.equal(countTerminalLines(text, width), rows.length + 6);
		assert.equal(countTerminalLines(text, width - 1), 2 * (rows.length + 4) + 2);
		assert.equal(text, formatBenchmarkDisplay({...frame, rows: rows.map(row => ({...row, variant: benchmarkLibraryName(row.variant)}))}));
		assert.ok(text.endsWith('Starting bokeh-canvas\nWarning: d3-svg: failed\n'));
		for (const columns of [width - 1, width, width + 1]) {
			const {display, writes} = capture({columns, rows: 100});
			display.update(frame);
			const physical = text.split('\n').slice(0, -1).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
			display.update({status: 'Done', final: true});
			assert.deepEqual(writes, [text, clear(physical) + 'Done\n']);
			assert.equal(screenAfter(writes, columns, 100).screen, 'prior\nDone');
		}
		assert.deepEqual(rows, original);
	});

	it('orders and left-aligns metadata independently of row key order while keeping metrics right-aligned', () => {
		const rows = [
			{ms: 2, lossy: '', variant: 'uplot', sampling: 'minmax', context: '2d'},
			{variant: 'old', sampling: 'unavailable', context: 'unavailable', lossy: '?', ms: '-'},
			{variant: 'gpu', sampling: 'none', context: 'webgl2', lossy: '*', ms: 'unavailable'},
		];
		const original = structuredClone(rows);
		const lines = formatBenchmarkDisplay({rows}).split('\n').filter(line => line.startsWith('│'));
		assert.deepEqual(lines, [
			'│ variant │ context     │ sampling    │ lossy │          ms │',
			'│ uplot   │ 2d          │ minmax      │       │         2.0 │',
			'│ old     │ unavailable │ unavailable │ ?     │           - │',
			'│ gpu     │ webgl2      │             │ *     │ unavailable │',
		]);
		assert.deepEqual(rows, original);
	});

	it('formats lossy booleans and unknown snapshots and preserves text markers without a manifest fallback', () => {
		const rows = [
			{variant: 'uplot', lossy: true}, {variant: 'fusiontime', lossy: false},
			{variant: 'chartjs', lossy: null}, {variant: 'echarts'},
			...['*', '?', ''].map(lossy => ({variant: 'agcharts', lossy})),
		];
		const original = structuredClone(rows);
		const lines = formatBenchmarkDisplay({rows}).split('\n').filter(line => line.startsWith('│'));
		assert.deepEqual(lines.slice(1).map(line => line.split('│')[2]),
			[' *     ', '       ', ' ?     ', ' ?     ', ' *     ', ' ?     ', '       ']);
		assert.deepEqual(rows, original);
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

	it('fits the default legacy combined table in 67 columns and counts wrapping below that width', () => {
		const rows = ['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'].map(variant => ({
			variant, 'prep ms': 4.05, 'init ms': 8.994, 'main ms': 12.011, 'gpu ms': 2.006,
			'total ms': 15.642, 'peak MB': 25.538, 'retained MB': 18.375,
		}));
		const frame = {rows, status: 'Running'};
		const text = formatBenchmarkDisplay(frame);
		assert.equal(text.split('\n')[0].length, 67);
		assert.equal(countTerminalLines(text, 67), 11);
		assert.ok(text.indexOf('peak MB') < text.indexOf('retained MB'));
		for (const columns of [66, 67, 100]) {
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
		assert.equal(writes[0], 'Starting\nWarning: No results yet\n');
		display.update({rows: one, status: 'Running chartjs'});
		assert.equal(writes[1], clear(2) + formatBenchmarkDisplay({rows: one, status: 'Running chartjs'}));
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
		assert.match(writes[0], /Warning: third\nWarning: fourth\nWarning: fifth\n$/);
				assert.doesNotMatch(writes[0], /more warning/);
		display.update({rows: one, status: 'Done', final: true});
		assert.equal(writes[1], clear(countTerminalLines(writes[0], 100)) + formatBenchmarkDisplay({rows: one, status: 'Done'}));
		assert.doesNotMatch(screenAfter(writes).screen, /Warning|missing|third/);
	});

	for (const isTTY of [false, true]) {
		it(`keeps the Google Charts timeout skip visible after earlier warnings (TTY=${isTTY})`, () => {
			const {display, writes} = capture({isTTY});
			const reason = 'googlecharts: skipped (Disabled after benchmark timeouts. The standalone demo remains available.)';
			const warnings = ['first failure', 'second failure', 'third failure', reason, 'another skip'];
			display.update({status: 'Starting idle', warnings});
			if (isTTY)
				assert.ok(writes[0].includes(`Warning: ${reason}\n`));
			display.update({rows: one, status: 'Done', warnings, final: true});
			for (const warning of warnings)
				assert.ok(writes.at(-1).includes(`Warning: ${warning}\n`));
			assert.doesNotMatch(writes.at(-1), /more warning/);
		});

		it(`shows skip reasons on final failure before any results (TTY=${isTTY})`, () => {
			const {display, writes} = capture({isTTY});
			display.update({status: 'Idle failed', warnings: ['googlecharts: skipped (Disabled after benchmark timeouts.)'], final: true});
			assert.equal(writes[0], 'Idle failed\nWarning: googlecharts: skipped (Disabled after benchmark timeouts.)\n');
		});
	}

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
