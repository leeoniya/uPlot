
import { stripVTControlCharacters } from 'node:util';
import { benchmarkLibraryName } from '../bench/demo-dependencies.mjs';

const segments = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const dimension = value => Number.isInteger(value) && value > 0 ? value : 0;
const clean = value => stripVTControlCharacters(String(value))
	.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const terminated = text => text && (text.endsWith('\n') ? text : `${text}\n`);

function* cellWidths(text) {
	for (const {segment} of segments.segment(text)) {
		const code = segment.codePointAt(0);
		if (/^[\p{Mark}\p{Default_Ignorable_Code_Point}]+$/u.test(segment))
			continue;
		const wide = code >= 0x1100 && (
			code <= 0x115f || code === 0x2329 || code === 0x232a ||
			(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
			(code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) ||
			(code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
			(code >= 0x1b000 && code <= 0x1b2ff) || (code >= 0x20000 && code <= 0x3fffd)
		);
		yield wide || /\p{Emoji_Presentation}|\uFE0F|\u20E3/u.test(segment) ? 2 : 1;
	}
}

// Frames end in a newline. The cursor's empty line is not part of the frame.
// A line exactly columns cells wide does not wrap again when followed by LF.
export function countTerminalLines(text, columns) {
	columns = dimension(columns) || Infinity;
	const lines = clean(text).split('\n');
	if (lines.at(-1) === '')
		lines.pop();
	let count = 0;
	for (const line of lines) {
		count++;
		let used = 0;
		for (const width of cellWidths(line)) {
			if (used && used + width > columns) {
				count++;
				used = 0;
			}
			used += Math.min(width, columns);
		}
	}
	return count;
}

// Absolute bands use raw values, before display rounding. The xterm-256
// approximations keep every band distinct, including the lighter reds.
const workBands = [
	[1000 / 60, '34;197;94', 41],
	[25, '163;230;53', 154],
	[2000 / 60, '217;249;157', 193],
	[50, '253;186;116', 216],
	[75, '251;146;60', 209],
	[100, '249;115;22', 202],
	[500, '248;113;113', 210],
	[1000, '239;68;68', 203],
	[2000, '220;38;38', 160],
	[Infinity, '185;28;28', 124],
];

// Initialization reaches red at 100 ms; update work keeps its inclusive orange limit.
const initBands = workBands.map(band => [...band, band[0] === 100]);

// Both memory columns share MB limits and shades.
// An exclusive upper limit puts exactly 50 MB in the red band.
const memoryScale = [[20, 0], [27.5, 1], [35, 2], [40, 3], [45, 4], [50, 5, true], [100, 6], [200, 7], [400, 8], [Infinity, 9]]
	.map(([limit, shade, exclusive = false]) => [limit, ...workBands[shade].slice(1), exclusive]);
const memoryBands = new Map(['peak MB', 'retained MB'].map(column => [column, memoryScale]));

const contextColors = new Map([
	['2d', ['96;165;250', 75]],
	['svg', ['249;115;22', 202]],
	['webgl', ['250;204;21', 220]],
	['webgl2', ['244;114;182', 212]],
	['webgpu', ['192;132;252', 183]],
]);

// Unknown depth and basic 16-color terminals stay plain. FORCE_COLOR cannot
// override redirection, NO_COLOR (including an empty value), or TERM=dumb.
export function benchmarkDisplayColorDepth({stream = process.stdout, env = process.env} = {}) {
	if (!stream.isTTY || env.NO_COLOR !== undefined || env.TERM === 'dumb')
		return 0;
	const depth = typeof stream.getColorDepth === 'function' ? stream.getColorDepth(env) : 0;
	return Number.isFinite(depth) ? depth >= 24 ? 24 : depth >= 8 ? 8 : 0 : 0;
}

function colorText(text, color, colorDepth) {
	if (!color || !(colorDepth >= 8))
		return text;
	const [rgb, palette] = color;
	return `\x1b[${colorDepth >= 24 ? `38;2;${rgb}` : `38;5;${palette}`}m${text}\x1b[39m`;
}

function colorMetric(text, value, bands, colorDepth) {
	if (!Number.isFinite(value) || value < 0 || !(colorDepth >= 8))
		return text;
	const [, rgb, palette] = bands.find(([limit, , , exclusive]) => exclusive ? value < limit : value <= limit);
	return colorText(text, [rgb, palette], colorDepth);
}

function formatTable(rows, colorDepth, verbose) {
	const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
	const metadata = ['variant', 'context', 'sampling', 'lossy'];
	const columns = [...metadata.filter(key => keys.includes(key)),
		...keys.filter(key => !metadata.includes(key) && (verbose || !['main ms', 'gpu ms'].includes(key)))];
	const split = columns.indexOf('retained MB') + 1;
	const divided = split > 0 && ['resize ms', 'resize rAF ms', 'hover10 ms'].includes(columns[split]);
	// Legacy startup totals keep their label; rAF readiness and latency are not thread work.
	const workColumn = keys.includes('total ms') ? 'total ms' : keys.includes('main ms') ? 'update ms' : null;
	const width = text => [...cellWidths(text)].reduce((sum, size) => sum + size, 0);
	const cell = value => clean(value).replace(/\n/g, ' ');
	const cells = rows.map(row => columns.map(key => key === 'variant' ? cell(benchmarkLibraryName(row[key] ?? ''))
		: key === 'sampling' && row[key] === 'none' ? ''
		: key === 'lossy' ? cell(typeof row[key] === 'string' ? row[key] : row[key] === true ? '*' : row[key] === false ? '' : '?')
		: Number.isFinite(row[key]) ? row[key].toFixed(1)
		: cell(typeof row[key] === 'string' ? row[key] : 'unavailable')));
	const headers = columns.map(cell);
	const widths = headers.map((header, i) => Math.max(width(header), ...cells.map(row => width(row[i]))));
	const join = (values, middle, double) => values.map((value, i) =>
		(i ? divided && i === split ? double : middle : '') + value).join('');
	const border = (left, middle, double, right) => left + join(widths.map(size => '─'.repeat(size + 2)), middle, double) + right + '\n';
	const line = (values, row) => '│ ' + join(values.map((value, i) => {
		const padding = ' '.repeat(widths[i] - width(value));
		if (row && columns[i] === 'context')
			value = colorText(value, contextColors.get(row.context), colorDepth);
		else if (row && memoryBands.has(columns[i]))
			value = colorMetric(value, row[columns[i]], memoryBands.get(columns[i]), colorDepth);
		else if (row && workColumn && (columns[i] === workColumn || columns[i] === 'init ms' || columns[i] === 'resize ms' || columns[i] === 'hover10 ms'))
			value = colorMetric(value, row[columns[i]], columns[i] === 'init ms' ? initBands : workBands, colorDepth);
		return metadata.includes(columns[i]) ? value + padding : padding + value;
	}), ' │ ', ' │ │ ') + ' │\n';
	return border('┌', '┬', '┐ ┌', '┐') + line(headers) + border('├', '┼', '┤ ├', '┤') + cells.map((values, i) => line(values, rows[i])).join('') + border('└', '┴', '┘ └', '┘');
}

export function formatBenchmarkDisplay({rows = [], status = '', warnings = []} = {}, {colorDepth = 0, verbose = false} = {}) {
	let text = (rows.length ? formatTable(rows, colorDepth, verbose) : '') + terminated(clean(status));
	const unique = [...new Set(warnings.map(warning => clean(warning).replace(/\s+/g, ' ').trim()).filter(Boolean))];
	for (const warning of unique) {
		const chars = Array.from(warning);
		text += `Warning: ${chars.length > 160 ? chars.slice(0, 157).join('') + '...' : warning}\n`;
	}

	return text;
}

export function createBenchmarkDisplay({stream = process.stdout, env = process.env, verbose = false} = {}) {
	let previous = null;
	let finished = false;

	return {
		update({rows = [], status = '', warnings = [], final = false} = {}) {
			if (finished)
				return;

			const tty = !!stream.isTTY;
			const columns = dimension(stream.columns);
			const height = dimension(stream.rows);
			const text = tty || final
				? formatBenchmarkDisplay({rows, status, warnings}, {colorDepth: benchmarkDisplayColorDepth({stream, env}), verbose})
				: terminated(clean(status));
			let erase = '';

			// Resize/reflow behavior differs between terminals. Abandon the old
			// frame on a size change (or unknown size), rather than erase above it.
			if (tty && columns && height && previous?.columns === columns && previous.height === height) {
				// LF needs one screen row. Oversized frames can leave a prefix in
				// scrollback, which cursor movement cannot erase.
				const up = Math.min(previous.lines, height - 1);
				erase = (up ? `\x1b[${up}A` : '') + '\r\x1b[J';
			}

			if (erase || text)
				stream.write(erase + text);

			finished = final;
			previous = !final && tty && text ? {columns, height, lines: countTerminalLines(text, columns)} : null;
		},
	};
}
