// en-US decimal formatting for Number inputs and integer 0 <= min <= max <= 100.
// Uses shortest-decimal digits and half-away-from-zero rounding, without Intl.
export function fmtNumEn(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!Number.isFinite(value))
		return Number.isNaN(value) ? 'NaN' : sign + '∞';

	let digits = String(Math.abs(value));
	let exp = digits.indexOf('e');
	const dot = digits.indexOf('.');
	let point = dot < 0 ? (exp < 0 ? digits.length : exp) : dot;
	if (dot >= 0)
		digits = digits.slice(0, dot) + digits.slice(dot + 1);
	if (exp >= 0) {
		exp = digits.indexOf('e');
		point += +digits.slice(exp + 1);
		digits = digits.slice(0, exp);
	}
	if (point < 1) {
		digits = '0'.repeat(1 - point) + digits;
		point = 1;
	}
	if (digits.length < point)
		digits = digits.padEnd(point, '0');

	const cut = point + max;
	if (digits.length > cut) {
		const up = digits.charCodeAt(cut) >= 53;
		digits = digits.slice(0, cut);
		if (up) {
			let i = cut;
			while (i > 0 && digits.charCodeAt(i - 1) === 57)
				i--;
			digits = i === 0 ? '1' + '0'.repeat(cut) :
				digits.slice(0, i - 1) + (+digits[i - 1] + 1) + '0'.repeat(cut - i);
			if (i === 0)
				point++;
		}
	}

	const stop = point + min;
	let end = digits.length;
	while (end > stop && digits.charCodeAt(end - 1) === 48)
		end--;
	digits = digits.slice(0, end).padEnd(stop, '0');

	let out = digits.length > point ? '.' + digits.slice(point) : '';
	while (point > 3) {
		out = ',' + digits.slice(point - 3, point) + out;
		point -= 3;
	}
	return sign + digits.slice(0, point) + out;
}
