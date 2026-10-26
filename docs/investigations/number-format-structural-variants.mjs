// Investigation-only structural alternatives to the 611-byte formatter.
import {fmtNumEn as current611} from './number-format-en-611.mjs';
import {fmtNumEn as virtual} from './number-format-virtual.mjs';

function change(fn, before, after) {
	const source = fn.toString();
	if (!source.includes(before)) throw new Error('Variant source no longer matches');
	return Function('return (' + source.replace(before, after) + ')')();
}

const carry = `while (end && digits[end - 1] === '9')
				end--;
			// Discard carried zeroes; final padding restores only those needed.
			digits = end ? digits.slice(0, end - 1) + (+digits[end - 1] + 1) : '1';
			if (!end)
				point++;`;

const bigIntRound = change(current611, carry,
	`digits = '' + (BigInt(digits.slice(0, end)) + 1n);
			if (digits.length > end) point++;
			digits = digits.padStart(end, '0');`);

const safeIntegerRound = change(current611, carry,
	`if (end < 16) {
				digits = '' + (+digits.slice(0, end) + 1);
				if (digits.length > end) point++;
				digits = digits.padStart(end, '0');
			}
			else {
				` + carry + `
			}`);

const latePad = change(virtual,
	`end = digits.length;
	while (digits[end - 1] === '0')
		end--;
	// If no nonzero digits remain, emit only the required fractional zeroes.
	end = Math.max(end || point, point + min);

	let out = sign;
	for (let i = Math.min(0, point - 1); i < end; i++) {
		out += i === point ? '.' : i > 0 && i < point && (point - i) % 3 === 0 ? ',' : '';
		out += digits[i] || '0';
	}
	return out;`,
	`end = digits.length;
	while (digits[end - 1] === '0') end--;
	digits = digits.slice(0, end);
	if (!end) point = 1;
	if (point < 1) {
		digits = '0'.repeat(1 - point) + digits;
		point = 1;
	}
	digits = digits.padEnd(point + min, '0');
	let out = digits.length > point ? '.' + digits.slice(point) : '';
	while (point > 3) {
		out = ',' + digits.slice(point - 3, point) + out;
		point -= 3;
	}
	return sign + digits.slice(0, point) + out;`);

// Preserve the decimal point in ordinary notation: avoid removing and reinserting it.
export function directFixed(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!isFinite(value)) return isNaN(value) ? 'NaN' : sign + '∞';
	let str = '' + Math.abs(value);
	let point = str.indexOf('.');
	const exp = str.indexOf('e');
	if (exp >= 0) {
		const shift = +str.slice(exp + 1);
		str = str.slice(0, exp);
		if (point < 0) point = str.length;
		else str = str.slice(0, point) + str.slice(point + 1);
		point += shift;
		if (point < 1) {
			str = '0'.repeat(1 - point) + str;
			point = 1;
		}
		str = str.padEnd(point, '0');
		str = str.slice(0, point) + '.' + str.slice(point);
	}
	else if (point < 0) point = str.length;
	let end = point + max + 1;
	if (str.length > end) {
		if (str[end] >= '5') {
			while (end && (str[end - 1] === '9' || str[end - 1] === '.')) end--;
			str = end ? str.slice(0, end - 1) + (+str[end - 1] + 1) : '1';
			if (!end) point++;
		}
		else str = str.slice(0, end);
	}
	end = str.length;
	while (end > point && (str[end - 1] === '0' || str[end - 1] === '.')) end--;
	str = str.slice(0, end).padEnd(point, '0');
	if (min) {
		if (str.length === point) str += '.';
		str = str.padEnd(point + min + 1, '0');
	}
	let out = str.slice(point);
	while (point > 3) {
		out = ',' + str.slice(point - 3, point) + out;
		point -= 3;
	}
	return sign + str.slice(0, point) + out;
}

const parse = current611.toString().slice(current611.toString().indexOf("\tlet digits = '' + Math.abs(value);"), current611.toString().indexOf('\n\tif (point < 1)'));
const exponential = change(current611, parse,
	`let digits = Math.abs(value).toExponential();
	const exp = digits.indexOf('e');
	let point = +digits.slice(exp + 1) + 1;
	digits = digits[0] + digits.slice(2, exp);`);
const exponentialLate = change(latePad,
	latePad.toString().slice(latePad.toString().indexOf("\tlet digits = '' + Math.abs(value);"), latePad.toString().indexOf('\n\tlet end = point + max;')),
	`let digits = Math.abs(value).toExponential();
	const exp = digits.indexOf('e');
	let point = +digits.slice(exp + 1) + 1;
	digits = digits[0] + digits.slice(2, exp);\n`);

export const structuralVariants = {current611, virtual, latePad, bigIntRound, safeIntegerRound, directFixed, exponential, exponentialLate};
