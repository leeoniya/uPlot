import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stripVTControlCharacters } from 'node:util';
import { createBenchmarkDisplay, formatBenchmarkDisplay, countTerminalLines, benchmarkDisplayColorDepth } from '../../scripts/benchmarks-display.mjs';
import { benchmarkLibraryName, benchmarkMetadata } from '../../bench/demo-dependencies.mjs';

const one = [{variant: 'uplot', ms: 1.25}];
const two = [...one, {variant: 'chartjs', ms: 3.5}];
const clear = lines => (lines ? `\x1b[${lines}A` : '') + '\r\x1b[J';
const tableText = text => text.slice(text.indexOf('┌'));
const tableWidth = text => stripVTControlCharacters(tableText(text)).split('\n')[0].length;
const legendLabels = width => {
	const labels = Array(width).fill(' ');
	for (const [i, name] of ['Minimum', '1.5× cap', '2× cap', '4× cap', '8× cap', '16× cap'].entries()) {
		const position = Math.round(i * (width - 1) / 5);
		const start = Math.max(0, Math.min(width - name.length, position - Math.floor(name.length / 2)));
		labels.splice(start, name.length, ...name);
	}
	return labels.join('');
};
const withoutSGR = text => text.replace(/\x1b\[[\d;]+m/g, '');
const physicalLines = (text, columns) => withoutSGR(text).split('\n').slice(0, -1)
	.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);

function capture(options = {}, env = {NO_COLOR: ''}, displayOptions = {}) {
	const stream = Object.assign(new EventEmitter(), {isTTY: true, columns: 100, rows: 40}, options);
	const writes = [];
	stream.write = text => { writes.push(text); return true; };
	return {stream, writes, display: createBenchmarkDisplay({stream, env, ...displayOptions})};
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
	const rgbs = [[34, 197, 94], [132, 204, 22], [250, 204, 21], [249, 115, 22], [239, 41, 41], [185, 28, 28]];
	const values = [10, 15, 16, 32, 33, 132, 133, 1064, 1065, 17040, 20000];
	const stops = [10, 15, 32, 132, 1064, 17040];
	const columns = ['init ms', 'update ms', 'resize ms', 'hover10 ms', 'peak MB', 'retained MB'];
	const metricRows = (values, column) => values.map(value => ({variant: 'custom', 'main ms': 0, [column]: value}));
	const updateRows = values => metricRows(values, 'update ms');
	const coloredValues = text => [...tableText(text).matchAll(/\x1b\[(38;[25];[\d;]+)m([^\x1b]*)\x1b\[39m/g)].map(match => match.slice(1));
	// This oracle takes explicit fixture stops, not observations or implementation helpers.
	const rgbAt = (value, logs = stops.map(Math.log)) => {
		const log = Math.log(value);
		if (log <= logs[0]) return rgbs[0];
		const upper = logs.findIndex(stop => log <= stop);
		if (upper < 0) return rgbs.at(-1);
		const t = (log - logs[upper - 1]) / (logs[upper] - logs[upper - 1]);
		return rgbs[upper - 1].map((channel, i) => Math.round(channel + t * (rgbs[upper][i] - channel)));
	};
	const levels = [0, 95, 135, 175, 215, 255];
	const xterm = [...levels.flatMap(r => levels.flatMap(g => levels.map(b => [r, g, b]))),
		...Array.from({length: 24}, (_, n) => [8 + 10 * n, 8 + 10 * n, 8 + 10 * n])];
	const nearest = rgb => {
		const distances = xterm.map(candidate => candidate.reduce((sum, channel, i) => sum + (channel - rgb[i]) ** 2, 0));
		return 16 + distances.indexOf(Math.min(...distances));
	};
	const color = (rgb, depth) => depth === 24 ? `38;2;${rgb.join(';')}` : `38;5;${nearest(rgb)}`;
	const expected = (values, depth, logs) => values.map(value => [color(rgbAt(value, logs), depth), value.toFixed(1)]);

	for (const colorDepth of [8, 24]) for (const width of [61, 62, 64, 80, 137]) {
		it(`renders a ${width}-cell legend with exact stops, RGB intermediates, and aligned labels at depth ${colorDepth}`, () => {
			const rows = updateRows(values);
			const text = formatBenchmarkDisplay({rows, status: 'Running', warnings: ['partial']}, {colorDepth, legendWidth: width});
			const [bar, labels, border] = text.split('\n');
			assert.equal(stripVTControlCharacters(bar), '█'.repeat(width));
			assert.equal(labels, legendLabels(width));
			assert.equal(labels.length, width);
			assert.ok(labels.startsWith('Minimum'));
			assert.ok(labels.endsWith('16× cap'));
			assert.ok(border.startsWith('┌'));
			const blocks = [...bar.matchAll(/\x1b\[(38;[25];[\d;]+)m█(?:\x1b\[39m)?/g)];
			assert.equal(blocks.length, width);
			const positions = rgbs.map((_, i) => Math.round(i * (width - 1) / 5));
			assert.deepEqual(positions.map(i => blocks[i][1]), rgbs.map(rgb => color(rgb, colorDepth)));
			for (let i = 0; i < width; i++) {
				const segment = Math.min(4, positions.findLastIndex(position => position <= i));
				const step = i - positions[segment];
				const span = positions[segment + 1] - positions[segment];
				const channels = rgbs[segment].map((channel, j) => (channel * (span - step) + rgbs[segment + 1][j] * step) / span);
				if (colorDepth === 24) {
					const actual = blocks[i][1].split(';').slice(2).map(Number);
					assert.equal(actual.length, 3);
					for (const [j, channel] of channels.entries()) {
						// Equivalent interpolation expressions can straddle an exact half-channel by one ulp.
						if (channel % 1 === 0.5) assert.ok(actual[j] === Math.floor(channel) || actual[j] === Math.ceil(channel));
						else assert.equal(actual[j], Math.round(channel), `legend cell ${i}, channel ${j}`);
					}
				}
				else assert.equal(blocks[i][1], color(channels.map(Math.round), colorDepth), `legend cell ${i}`);
			}
			assert.match(bar, /\x1b\[39m$/);
			assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay({rows, status: 'Running', warnings: ['partial']}));
		});
	}

	it('sizes standalone legends to the full visible table, including Unicode, panel gaps, and verbose columns', () => {
		const rows = [{variant: '\x1b[31m' + '界'.repeat(24) + '\x1b[0m', context: 'webgpu', 'main ms': 3, 'gpu ms': 2,
			'peak MB': 20, 'retained MB': 15, 'resize ms': 8, 'hover10 ms': 12}];
		const widths = [];
		for (const verbose of [false, true]) for (const colorDepth of [8, 24]) {
			const frame = {rows, status: 's'.repeat(300), warnings: ['w'.repeat(150)]};
			const text = formatBenchmarkDisplay(frame, {colorDepth, verbose});
			const [bar, labels, border] = text.split('\n');
			const width = tableWidth(text);
			assert.ok(width > 61);
			assert.match(border, /┐ ┌/);
			assert.equal(stripVTControlCharacters(bar), '█'.repeat(width));
			assert.equal(labels, legendLabels(width));
			assert.equal(countTerminalLines(tableText(text).split('\n')[3] + '\n', width), 1);
			assert.equal(countTerminalLines(tableText(text).split('\n')[3] + '\n', width - 1), 2);
			assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay(frame, {verbose}));
			widths.push(width);
		}
		assert.equal(widths[2] - widths[0], 19);
		const tiny = formatBenchmarkDisplay({rows: updateRows([10])}, {colorDepth: 24});
		assert.ok(tableWidth(tiny) < 61);
		assert.equal(stripVTControlCharacters(tiny).split('\n')[0], '█'.repeat(61));
		assert.equal(tiny.split('\n')[1], 'Minimum 1.5× cap     2× cap      4× cap      8× cap   16× cap');
	});

	it('shows exactly one legend for any valid eligible scale, including tiny and extreme positive minima', () => {
		for (const colorDepth of [8, 24]) for (const verbose of [false, true]) {
			for (const column of columns) for (const value of [Number.MIN_VALUE, 0.014, 10, Number.MAX_VALUE]) {
				const rows = metricRows([value, value], column);
				const text = formatBenchmarkDisplay({rows}, {colorDepth, verbose});
				assert.equal(stripVTControlCharacters(text).split('\n')[0], '█'.repeat(Math.max(61, tableWidth(text))));
				assert.equal((text.match(/Minimum/g) ?? []).length, 1);
			}
			for (const rows of [
				[{variant: 'custom', 'peak MB': 10}],
				[{variant: 'custom', 'retained MB': 10}],
				[{variant: 'custom', 'main ms': undefined, 'update ms': 10}],
				[{variant: 'custom', 'main ms': 0, 'update ms': 0, 'peak MB': 10}],
				[{variant: 'custom', 'main ms': 0, ...Object.fromEntries(columns.map(column => [column, 10]))}],
			]) {
				const text = formatBenchmarkDisplay({rows}, {colorDepth, verbose});
				assert.equal(text.slice(0, text.indexOf('┌')).split('\n').length, 3);
				assert.equal(stripVTControlCharacters(text).split('\n')[0], '█'.repeat(Math.max(61, tableWidth(text))));
			}
		}
	});

	it('omits the legend without a valid eligible scale or sufficient color depth', () => {
		const invalid = [-1, NaN, Infinity, -Infinity, null, undefined, '', '-', '10', true, false];
		const frames = [
			{}, {rows: []}, {status: 'Starting', warnings: ['partial']},
			{rows: [{variant: 'custom', context: 'webgpu', sampling: 'none', lossy: false}]},
			{rows: [{variant: 'custom', 'prep ms': 10, 'main ms': 10, 'gpu ms': 10}]},
			{rows: [{variant: 'custom', 'init rAF ms': 10, 'update ms': 10, 'next rAF ms': 10, 'resize rAF ms': 10, 'hover10 ms': 10}]},
			...columns.flatMap(column => [
				{rows: metricRows(invalid, column)},
				{rows: metricRows([0, 10], column)},
				{rows: metricRows([-0, 10], column)},
			]),
		];
		for (const colorDepth of [8, 24]) for (const verbose of [false, true]) {
			for (const frame of frames) {
				const text = formatBenchmarkDisplay(frame, {colorDepth, verbose});
				assert.doesNotMatch(text, /█|Minimum|cap/);
				assert.equal(stripVTControlCharacters(text), formatBenchmarkDisplay(frame, {verbose}));
			}
		}
		for (const colorDepth of [0, 1, 4]) {
			const frame = {rows: updateRows(values)};
			assert.equal(formatBenchmarkDisplay(frame, {colorDepth}), formatBenchmarkDisplay(frame));
		}
	});

	for (const column of columns) {
		it(`uses observed groups, inclusive caps, and exact smooth stops for ${column}`, () => {
			for (const colorDepth of [8, 24]) {
				const rows = metricRows(values, column);
				const original = structuredClone(rows);
				const text = formatBenchmarkDisplay({rows}, {colorDepth});
				const colors = coloredValues(text);
				assert.deepEqual(colors, expected(values, colorDepth));
				assert.deepEqual([0, 1, 3, 5, 7, 9].map(i => colors[i][0]), rgbs.map(rgb => color(rgb, colorDepth)));
				assert.deepEqual(colors.at(-1), [color(rgbs.at(-1), colorDepth), '20000.0']);
				assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay({rows}));
				assert.deepEqual(rows, original);
			}
		});

		it(`excludes invalid ${column} observations and leaves zero or absent references plain`, () => {
			const invalid = [-1, -Number.MIN_VALUE, NaN, Infinity, -Infinity, null, undefined, '-', '', '10', true, false];
			for (const colorDepth of [8, 24]) {
				const rows = [...metricRows(invalid, column), {variant: 'missing', 'main ms': 1}, ...metricRows(values, column)];
				const original = structuredClone(rows);
				const text = formatBenchmarkDisplay({rows}, {colorDepth});
				assert.deepEqual(coloredValues(text), expected(values, colorDepth));
				assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay({rows}));
				assert.deepEqual(rows, original);
				for (const zero of [0, -0]) {
					const zeroRows = [...rows, ...metricRows([zero], column)];
					assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: zeroRows}, {colorDepth})), []);
				}
				assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: metricRows(invalid, column)}, {colorDepth})), []);
			}
		});

		it(`handles ${column} singletons, ties, and exhausted observed groups`, () => {
			for (const colorDepth of [8, 24]) {
				for (const value of [Number.MIN_VALUE, 0.014, 10, 100, Number.MAX_VALUE]) {
					for (const repeated of [[value], [value, value, value]])
						assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: metricRows(repeated, column)}, {colorDepth})),
							repeated.map(value => [color(rgbs[0], colorDepth), value.toFixed(1)]));
				}
				for (const subset of [[10, 15], [10, 15, 16, 32], values.flatMap(value => [value, value])])
					assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: metricRows(subset, column)}, {colorDepth})), expected(subset, colorDepth));
			}
		});

		it(`uses raw ${column} measurements rather than rounded cells`, () => {
			const raw = [0.0101, 0.0149, 0.01515, 0.016, 0.032];
			const logs = [0.0101, 0.01515, 0.032, 0.128, 1.024, 16.384].map(Math.log);
			for (const colorDepth of [8, 24]) {
				const colors = coloredValues(formatBenchmarkDisplay({rows: metricRows(raw, column)}, {colorDepth}));
				assert.deepEqual(colors, expected(raw, colorDepth, logs));
				assert.ok(colors.every(([, text]) => text === '0.0'));
				assert.ok(new Set(colors.map(([shade]) => shade)).size >= 3);
			}
		});

		it(`keeps ${column} finite across subnormal values, overflowing ratios, and overflowing caps`, () => {
			// MIN_VALUE * 1.5 rounds to 2 * MIN_VALUE, including both observations at the first cap.
			// With no observations left, subsequent caps extend from that rounded cap.
			const subnormal = [Number.MIN_VALUE, Number.MIN_VALUE * 2];
			const subnormalLogs = [1, 2, 4, 16, 128, 2048].map(factor => Math.log(Number.MIN_VALUE * factor));
			for (const colorDepth of [8, 24]) {
				const colors = coloredValues(formatBenchmarkDisplay({rows: metricRows(subnormal, column)}, {colorDepth}));
				assert.deepEqual(colors, expected(subnormal, colorDepth, subnormalLogs));
				assert.deepEqual(colors.map(([shade]) => shade), [color(rgbs[0], colorDepth), color(rgbs[1], colorDepth)]);
			}
			for (const [minimum, next] of [[Number.MIN_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE / 2, Number.MAX_VALUE]]) {
				const logs = [Math.log(minimum), Math.log(minimum * 1.5), Math.log(next) + Math.log(2)];
				for (const factor of [4, 8, 16]) logs.push(logs.at(-1) + Math.log(factor));
				for (const colorDepth of [8, 24])
					assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows: metricRows([minimum, next], column)}, {colorDepth})),
						expected([minimum, next], colorDepth, logs));
			}
		});
	}

	it('interpolates geometric midpoints and interior points in log space, not linearly', () => {
		for (let i = 1; i < stops.length; i++) {
			const probes = [0.2, 0.5, 0.8].map(t => Math.exp(Math.log(stops[i - 1]) * (1 - t) + Math.log(stops[i]) * t));
			const rows = updateRows([...values, ...probes]);
			for (const colorDepth of [8, 24]) {
				const colors = coloredValues(formatBenchmarkDisplay({rows}, {colorDepth}));
				assert.deepEqual(colors.slice(0, values.length), expected(values, colorDepth));
				for (const [j, value] of probes.entries()) {
					const actual = colors[values.length + j];
					if (colorDepth === 24 && j === 1) {
						const channels = actual[0].split(';').slice(2).map(Number);
						assert.equal(actual[1], value.toFixed(1));
						// Equivalent log expressions can straddle an exact half-channel by one ulp.
						for (const [k, channel] of channels.entries()) {
							const midpoint = (rgbs[i - 1][k] + rgbs[i][k]) / 2;
							assert.ok(channel === Math.floor(midpoint) || channel === Math.ceil(midpoint));
						}
					}
					else assert.deepEqual(actual, expected([value], colorDepth)[0]);
				}
			}
			const midpoint = rgbAt(probes[1]);
			const linearT = (probes[1] - stops[i - 1]) / (stops[i] - stops[i - 1]);
			const linear = rgbs[i - 1].map((channel, j) => Math.round(channel + linearT * (rgbs[i][j] - channel)));
			assert.notDeepEqual(midpoint, linear);
		}
	});

	it('has no shade jumps at stops or within segments with stable observed group anchors', () => {
		const anchors = [10], caps = [10];
		for (const factor of [1.5, 2, 4, 8, 16]) {
			caps.push(anchors.at(-1) * factor);
			anchors.push(caps.at(-1) * (1 + 1e-10));
		}
		const logs = caps.map(Math.log);
		const boundaries = caps.slice(1).flatMap(cap => [cap * (1 - 1e-7), cap, cap * (1 + 1e-7)]);
		const probes = caps.slice(1).flatMap((cap, i) => Array.from({length: 102}, (_, n) =>
			n === 0 ? caps[i] : n === 101 ? cap : Math.exp(logs[i] + (Math.log(cap) - logs[i]) * n / 101)));
		const rows = updateRows([...anchors, ...boundaries, ...probes]);
		const colors = coloredValues(formatBenchmarkDisplay({rows}, {colorDepth: 24}));
		assert.deepEqual(colors, expected([...anchors, ...boundaries, ...probes], 24, logs));
		assert.deepEqual(colors.slice(anchors.length, anchors.length + boundaries.length).map(([shade]) => shade),
			rgbs.slice(1).flatMap(rgb => Array(3).fill(color(rgb, 24))));
		const shades = colors.slice(anchors.length + boundaries.length).map(([shade]) => shade.split(';').slice(2).map(Number));
		for (let i = 1; i < shades.length; i++)
			assert.ok(shades[i].every((channel, j) => Math.abs(channel - shades[i - 1][j]) <= 2), `shade jump at ${i}`);
	});

	it('uses independent column references without sorting or mutating rows, regardless of verbosity', () => {
		const rows = values.map((_, i) => ({variant: `custom-${i}`, 'main ms': 1, 'gpu ms': 2,
			...Object.fromEntries(columns.map((column, j) => [column, values[(i + j) % values.length] * (j + 1)])),
		}));
		const original = structuredClone(rows);
		for (const colorDepth of [8, 24]) for (const verbose of [false, true]) {
			for (const ordered of [rows, [...rows].reverse(), [...rows.slice(4), ...rows.slice(0, 4)]]) {
				const text = formatBenchmarkDisplay({rows: ordered}, {colorDepth, verbose});
				assert.deepEqual(coloredValues(text), ordered.flatMap(row => columns.map((column, j) =>
					[color(rgbAt(row[column] / (j + 1)), colorDepth), row[column].toFixed(1)])));
				assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay({rows: ordered}, {verbose}));
			}
		}
		assert.deepEqual(rows, original);
	});

	it('gates only work columns on main ms presence and leaves prep, main, gpu, and rAF metrics plain', () => {
		for (const main of [{}, {'main ms': undefined}, {'main ms': 0}]) {
			const rows = values.map((value, i) => ({variant: 'custom', ...(i === 0 ? main : {}), 'prep ms': value, 'gpu ms': value,
				'init rAF ms': value, 'next rAF ms': value, 'resize rAF ms': value,
				...Object.fromEntries(columns.map(column => [column, value])),
			}));
			for (const colorDepth of [8, 24]) for (const verbose of [false, true]) {
				const text = formatBenchmarkDisplay({rows}, {colorDepth, verbose});
				assert.deepEqual(coloredValues(text), expected(values, colorDepth).flatMap(pair =>
					Array(Object.hasOwn(main, 'main ms') ? 6 : 2).fill(pair)));
				assert.equal(stripVTControlCharacters(tableText(text)), formatBenchmarkDisplay({rows}, {verbose}));
			}
		}
	});

	it('does not let a zero reference disable other eligible columns', () => {
		for (const zeroColumn of columns) for (const zero of [0, -0]) {
			const rows = values.map((value, i) => ({variant: 'custom', 'main ms': 1,
				...Object.fromEntries(columns.map(column => [column, column === zeroColumn && i === 0 ? zero : value])),
			}));
			assert.deepEqual(coloredValues(formatBenchmarkDisplay({rows}, {colorDepth: 24})),
				expected(values, 24).flatMap(pair => Array(5).fill(pair)));
		}
	});

	it('uses the nearest fixed xterm color with lower-index ties instead of categorical palette approximations', () => {
		const probes = Array.from({length: 401}, (_, n) => 10 * 1.5 ** (n / 400));
		// Red 115 is exactly between cube levels 95 and 135; both candidates have equal distance.
		const tie = 10 * 1.5 ** (81 / 98);
		assert.deepEqual(rgbAt(tie), [115, 203, 34]);
		assert.equal(nearest(rgbAt(tie)), 76);
		assert.deepEqual(rgbs.map(nearest), [41, 112, 220, 202, 196, 124]);
		const rows = updateRows([...values, ...probes, tie]);
		const colors = coloredValues(formatBenchmarkDisplay({rows}, {colorDepth: 8}));
		assert.deepEqual(colors, expected([...values, ...probes, tie], 8));
		assert.equal(colors.at(-1)[0], '38;5;76');
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
			assert.deepEqual(coloredValues(text), []);
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

	for (const column of columns) {
		it(`recomputes live ${column} colors for new minima and intermediate groups, but not upper outliers`, () => {
			for (const colorDepth of [8, 24]) {
				const {display, writes} = capture({getColorDepth: () => colorDepth, rows: 100}, {});
				const cases = [
					[values, stops],
					[[...values, Number.MAX_VALUE], stops],
					[[...values, 5], [5, 7.5, 20, 128, 1056, 17024]],
					[[...values, 15.5], [10, 15, 31, 128, 1056, 17024]],
					[[...values, 0], null],
					[values, stops],
				];
				for (const [i, [observed, caps]] of cases.entries()) {
					const rows = metricRows(observed, column);
					const original = structuredClone(rows);
					display.update({rows, status: `Frame ${i}`, final: i === cases.length - 1});
					assert.deepEqual(coloredValues(writes.at(-1)), caps ? expected(observed, colorDepth, caps.map(Math.log)) : []);
					assert.deepEqual(rows, original);
				}
				const base = coloredValues(writes[0]);
				assert.deepEqual(coloredValues(writes[1]).slice(0, -1), base);
				assert.notDeepEqual(coloredValues(writes[2]).slice(0, -1), base);
				if (colorDepth === 24) assert.notDeepEqual(coloredValues(writes[3]).slice(0, -1), base);
				assert.deepEqual(coloredValues(writes.at(-1)), base);
			}
		});
	}

	it('colors only finite nonnegative numeric update work and resets foreground before padding or borders', () => {
		const rows = updateRows([10, -1, NaN, Infinity, -Infinity, '10', '-', null, undefined, true, '\x1b[41m10\x1b[0m']);
		rows[0] = {...rows[0], variant: '\x1b[31mcustom\x1b[0m', 'init rAF ms': 1000, 'peak MB ': 1000, 'update ms ': 1000};
		const frame = {rows, status: '\x1b[32m1000\x1b[0m', warnings: ['\x1b[41m1000\x1b[0m']};
		const original = structuredClone(frame);
		const plain = formatBenchmarkDisplay(frame);
		assert.doesNotMatch(plain, /\x1b/);
		assert.equal(formatBenchmarkDisplay(frame, {colorDepth: 0}), plain);
		const text = formatBenchmarkDisplay(frame, {colorDepth: 24});
		assert.equal(tableText(text), plain.replace(/(│ custom[^\n]*?│ +)10\.0( │)/, '$1\x1b[38;2;34;197;94m10.0\x1b[39m$2'));
		assert.deepEqual(coloredValues(text), [['38;2;34;197;94', '10.0']]);
		assert.equal((tableText(text).match(/\x1b/g) ?? []).length, 2);
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
			assert.equal(writes[0].includes('█'), expected >= 8);
			if (!expected) assert.equal(writes[0], formatBenchmarkDisplay(frame));
		});
	}

	for (const columns of [10, 25, 60, 61, 100]) {
		for (const height of [6, 100]) for (const colorDepth of [8, 24]) {
			it(`counts and erases the legend with wrapped tables at ${columns}x${height}, depth ${colorDepth}`, () => {
				const {display, writes} = capture({columns, rows: height, getColorDepth: () => colorDepth}, {});
				const frames = [
					{status: 'Starting'},
					{rows: updateRows([16.6, 1000]).map(row => ({...row, context: 'webgpu', 'init ms': 25, 'peak MB': 50, 'retained MB': 30})), status: 'Running\nPlease wait', warnings: ['partial results']},
					{rows: updateRows([16.6, 1000, 2000]).map(row => ({...row, context: 'webgpu', 'init ms': 25, 'peak MB': 50, 'retained MB': 30})), status: 'Next'},
					{rows: updateRows([0, 10]), status: 'Zero reference'},
					{rows: updateRows([10]), status: 'Valid again'},
					{status: 'Done', final: true},
				];
				const legendWidth = Math.max(61, tableWidth(formatBenchmarkDisplay(frames[1])));
				let previousLines = 0;
				for (const [i, frame] of frames.entries()) {
					const text = formatBenchmarkDisplay(frame, {colorDepth, legendWidth});
					display.update(frame);
					assert.equal(writes[i], (i ? clear(Math.min(previousLines, height - 1)) : '') + text);
					previousLines = physicalLines(text, columns);
					assert.equal(countTerminalLines(text, columns), previousLines);
					const legendLines = text.includes('█') ? 2 * Math.ceil(legendWidth / columns) : 0;
					assert.equal(previousLines, physicalLines(formatBenchmarkDisplay(frame), columns) + legendLines);
				}
				// Keep cursor commands so the terminal model checks actual erasure, not just text.
				const result = screenAfter(writes.map(withoutSGR), columns, height);
				assert.equal(result.screen, height === 100 ? 'prior\nDone' : 'Done');
				assert.equal(result.column, 0);
				if (height === 100) assert.equal(result.scrollback, '');
				else assert.match(result.scrollback, /█/);
			});
		}
	}

	for (const colorDepth of [8, 24]) for (const verbose of [false, true]) for (const eligible of [false, true]) {
		it(`caches the first table width across live changes (depth ${colorDepth}, verbose ${verbose}, initial scale ${eligible})`, () => {
			const {stream, display, writes} = capture({rows: 200, getColorDepth: () => colorDepth}, {}, {verbose});
			const initial = {rows: [{variant: 'custom', context: 'webgpu', sampling: 'custom sampling method with extra metadata',
				'main ms': 3, 'gpu ms': 2, 'update ms': eligible ? 10 : '-'}], status: 'First row'};
			const legendWidth = Math.max(61, tableWidth(formatBenchmarkDisplay(initial, {verbose})));
			assert.ok(legendWidth > 61);
			let previous;
			const render = frame => {
				const text = formatBenchmarkDisplay(frame, {colorDepth, verbose, legendWidth});
				const erase = previous && previous.columns === stream.columns && previous.height === stream.rows
					? clear(Math.min(physicalLines(previous.text, stream.columns), stream.rows - 1)) : '';
				display.update(frame);
				assert.equal(writes.at(-1), erase + text);
				if (text.includes('█')) {
					assert.equal(stripVTControlCharacters(text).split('\n')[0], '█'.repeat(legendWidth));
					assert.equal(text.split('\n')[1], legendLabels(legendWidth));
				}
				previous = {text, columns: stream.columns, height: stream.rows};
			};
			render({status: 'Starting ' + 's'.repeat(200), warnings: ['No rows yet']});
			render(initial);
			assert.equal(writes.at(-1).includes('█'), eligible);
			const longer = {rows: [...initial.rows, {...initial.rows[0], variant: 'a much longer custom library name', 'update ms': 1234567890}], status: 'Longer values'};
			render(longer);
			assert.ok(tableWidth(formatBenchmarkDisplay(longer, {verbose})) > legendWidth);
			const expanded = {rows: longer.rows.map(row => ({...row, 'peak MB': 20, 'retained MB': 15, 'resize ms': 8, 'hover10 ms': 12})), status: 'New columns'};
			render(expanded);
			render({...expanded, status: 'Status changed ' + 's'.repeat(200)});
			for (const [columns, height] of [[40, 200], [240, 200], [240, 6]]) {
				stream.columns = columns;
				stream.rows = height;
				render(expanded);
			}
			render({rows: expanded.rows.map(row => ({...row, 'update ms': 0, 'peak MB': 0, 'retained MB': 0, 'resize ms': 0, 'hover10 ms': 0})), status: 'No scale'});
			assert.doesNotMatch(writes.at(-1), /█|Minimum/);
			render({status: 'Temporarily no table'});
			render({rows: updateRows([10]), status: 'Smaller table'});
			render(expanded);

			const independent = capture({columns: stream.columns, rows: stream.rows, getColorDepth: () => colorDepth}, {}, {verbose});
			independent.display.update(expanded);
			const standalone = formatBenchmarkDisplay(expanded, {colorDepth, verbose});
			assert.equal(independent.writes[0], standalone);
			assert.equal(stripVTControlCharacters(standalone).split('\n')[0].length, tableWidth(standalone));
			assert.ok(tableWidth(standalone) > legendWidth);
			render({...expanded, status: 'Done', final: true});
		});
	}

	it('abandons the colored region after resize and counts the legend at the new dimensions', () => {
		for (const colorDepth of [8, 24]) {
			const {stream, display, writes} = capture({rows: 100, getColorDepth: () => colorDepth}, {});
			const frame = {rows: updateRows([10, 20]), status: 'Running'};
			display.update(frame);
			for (const [columns, height] of [[60, 100], [61, 100], [61, 6], [100, 100]]) {
				stream.columns = columns;
				stream.rows = height;
				display.update(frame);
				const text = formatBenchmarkDisplay(frame, {colorDepth});
				assert.equal(writes.at(-1), text);
				display.update({status: 'Cleared'});
				assert.equal(writes.at(-1), clear(Math.min(physicalLines(text, columns), height - 1)) + 'Cleared\n');
				const result = screenAfter([text, writes.at(-1)].map(withoutSGR), columns, height);
				assert.equal(result.screen, height === 100 ? 'prior\nCleared' : 'Cleared');
			}
		}
	});
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
			const colors = text => [...tableText(text).matchAll(/\x1b\[[\d;]+m[^\x1b]*\x1b\[39m/g)].map(match => match[0]);
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

	it('fits the update and memory table in 68 columns and counts wrapping below that width', () => {
		const rows = ['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'].map(variant => ({
			variant, 'prep ms': 4.05, 'init ms': 8.994, 'main ms': 12.011, 'gpu ms': 2.006,
			'update ms': 15.642, 'peak MB': 25.538, 'retained MB': 18.375,
		}));
		const frame = {rows, status: 'Running'};
		const text = formatBenchmarkDisplay(frame);
		assert.equal(text.split('\n')[0].length, 68);
		assert.equal(countTerminalLines(text, 68), 11);
		assert.ok(text.indexOf('peak MB') < text.indexOf('retained MB'));
		for (const columns of [67, 68, 100]) {
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
