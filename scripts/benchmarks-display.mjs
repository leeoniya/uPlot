
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

// Absolute bands use raw milliseconds, before display rounding. The xterm-256
// approximations keep every band distinct, including the lighter reds.
const totalBands = [
	[16.6, '34;197;94', 41],
	[35, '74;222;128', 78],
	[100, '134;239;172', 121],
	[150, '253;186;116', 216],
	[225, '251;146;60', 209],
	[300, '249;115;22', 202],
	[500, '248;113;113', 210],
	[1000, '239;68;68', 203],
	[2000, '220;38;38', 160],
	[Infinity, '185;28;28', 124],
];

// Unknown depth and basic 16-color terminals stay plain. FORCE_COLOR cannot
// override redirection, NO_COLOR (including an empty value), or TERM=dumb.
export function benchmarkDisplayColorDepth({stream = process.stdout, env = process.env} = {}) {
	if (!stream.isTTY || env.NO_COLOR !== undefined || env.TERM === 'dumb')
		return 0;
	const depth = typeof stream.getColorDepth === 'function' ? stream.getColorDepth(env) : 0;
	return Number.isFinite(depth) ? depth >= 24 ? 24 : depth >= 8 ? 8 : 0 : 0;
}

function colorTotal(text, value, colorDepth) {
	if (!Number.isFinite(value) || value < 0 || !(colorDepth >= 8))
		return text;
	const [, rgb, palette] = totalBands.find(([limit]) => value < limit || limit === 100 && value === 100);
	return `\x1b[${colorDepth >= 24 ? `38;2;${rgb}` : `38;5;${palette}`}m${text}\x1b[39m`;
}

function formatTable(rows, colorDepth) {
	const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
	const metadata = ['variant', 'context', 'sampling', 'lossy'];
	const columns = [...metadata.filter(key => keys.includes(key)), ...keys.filter(key => !metadata.includes(key))];
	const width = text => [...cellWidths(text)].reduce((sum, size) => sum + size, 0);
	const cell = value => clean(value).replace(/\n/g, ' ');
	const cells = rows.map(row => columns.map(key => key === 'variant' ? cell(benchmarkLibraryName(row[key] ?? ''))
		: key === 'sampling' && row[key] === 'none' ? ''
		: key === 'lossy' ? cell(typeof row[key] === 'string' ? row[key] : row[key] === true ? '*' : row[key] === false ? '' : '?')
		: Number.isFinite(row[key]) ? row[key].toFixed(1)
		: cell(typeof row[key] === 'string' ? row[key] : 'unavailable')));
	const headers = columns.map(cell);
	const widths = headers.map((header, i) => Math.max(width(header), ...cells.map(row => width(row[i]))));
	const border = (left, middle, right) => left + widths.map(size => '─'.repeat(size + 2)).join(middle) + right + '\n';
	const line = (values, row) => '│ ' + values.map((value, i) => {
		const padding = ' '.repeat(widths[i] - width(value));
		if (row && columns[i] === 'total ms')
			value = colorTotal(value, row[columns[i]], colorDepth);
		return metadata.includes(columns[i]) ? value + padding : padding + value;
	}).join(' │ ') + ' │\n';
	return border('┌', '┬', '┐') + line(headers) + border('├', '┼', '┤') + cells.map((values, i) => line(values, rows[i])).join('') + border('└', '┴', '┘');
}

export function formatBenchmarkDisplay({rows = [], status = '', warnings = []} = {}, {colorDepth = 0} = {}) {
	let text = (rows.length ? formatTable(rows, colorDepth) : '') + terminated(clean(status));
	const unique = [...new Set(warnings.map(warning => clean(warning).replace(/\s+/g, ' ').trim()).filter(Boolean))];
	for (const warning of unique) {
		const chars = Array.from(warning);
		text += `Warning: ${chars.length > 160 ? chars.slice(0, 157).join('') + '...' : warning}\n`;
	}

	return text;
}

export function createBenchmarkDisplay({stream = process.stdout, env = process.env} = {}) {
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
				? formatBenchmarkDisplay({rows, status, warnings}, {colorDepth: benchmarkDisplayColorDepth({stream, env})})
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
