// Investigation-only variants. Source substitutions keep the algorithm differences explicit.
import {fmtNumEn as baseline} from './number-format-en-baseline.mjs';
import {fmtNumEn as compact} from './number-format-en-compact.mjs';
import {structuralVariants} from './number-format-structural-variants.mjs';

function change(fn, before, after) {
	const source = fn.toString();
	if (!source.includes(before)) throw new Error('Variant source no longer matches');
	return Function('return (' + source.replace(before, after) + ')')();
}

const regexTrim = change(compact,
	`end = digits.length;
	const stop = point + min;
	while (end > stop && digits[end - 1] === '0')
		end--;
	digits = digits.slice(0, end).padEnd(stop, '0');`,
	`digits = digits.replace(/0+$/, '').padEnd(point + min, '0');`);

const fusedOutput = change(compact,
	`digits = digits.slice(0, end).padEnd(stop, '0');

	let out = digits.length > point ? '.' + digits.slice(point) : '';
	while (point > 3) {
		out = ',' + digits.slice(point - 3, point) + out;
		point -= 3;
	}
	return sign + digits.slice(0, point) + out;`,
	`digits = digits.slice(0, end);
	let out = sign;
	end = Math.max(digits.length, stop);
	for (let i = 0; i < end; i++) {
		if (i === point) out += '.';
		else if (i && i < point && (point - i) % 3 === 0) out += ',';
		out += digits[i] || '0';
	}
	return out;`);

const splitParse = change(compact,
	`let digits = String(Math.abs(value));
	const exp = digits.indexOf('e');
	const dot = digits.indexOf('.');
	let point = dot < 0 ? (exp < 0 ? digits.length : exp) : dot;
	if (exp >= 0) {
		point += +digits.slice(exp + 1);
		digits = digits.slice(0, exp);
	}
	if (dot >= 0)
		digits = digits.slice(0, dot) + digits.slice(dot + 1);`,
	`const parts = String(Math.abs(value)).split('e');
	let digits = parts[0];
	let point = digits.indexOf('.');
	if (point < 0) point = digits.length;
	else digits = digits.replace('.', '');
	point += +(parts[1] || 0);`);

const charCodes = change(compact, "digits[end] >= '5'", 'digits.charCodeAt(end) >= 53');
const rounding = compact.toString().slice(compact.toString().indexOf("\tif (digits[end] >= '5')"), compact.toString().indexOf('\n\tend = digits.length;'));
const guardedRound = change(compact, rounding, '\tif (digits.length > end) {\n' + rounding + '\t}\n');

const trimSlice = change(guardedRound,
	`end = digits.length;
	const stop = point + min;
	while (end > stop && digits[end - 1] === '0')
		end--;
	digits = digits.slice(0, end).padEnd(stop, '0');`,
	`const stop = point + min;
	while (digits.length > stop && digits.endsWith('0'))
		digits = digits.slice(0, -1);
	digits = digits.padEnd(stop, '0');`);
const replaceDot = change(trimSlice,
	'digits = digits.slice(0, dot) + digits.slice(dot + 1);',
	"digits = digits.replace('.', '');");

const asciiRound = change(change(change(guardedRound,
	"digits[end] >= '5'", 'digits.charCodeAt(end) >= 53'),
	"digits[end - 1] === '9'", 'digits.charCodeAt(end - 1) === 57'),
	"digits[end - 1] === '0'", 'digits.charCodeAt(end - 1) === 48');
const concat = change(guardedRound, 'String(Math.abs(value))', "'' + Math.abs(value)");
const asciiConcat = change(asciiRound, 'String(Math.abs(value))', "'' + Math.abs(value)");

const numberOnly = change(change(concat, 'Number.isFinite(value)', 'isFinite(value)'), 'Number.isNaN(value)', 'isNaN(value)');

export const variants = {baseline, compact, regexTrim, fusedOutput, splitParse, charCodes, guardedRound, trimSlice, replaceDot, asciiRound, concat, asciiConcat, numberOnly, ...structuralVariants};
