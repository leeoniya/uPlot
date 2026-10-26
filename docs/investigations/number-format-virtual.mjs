// en-US decimal formatting for Number inputs and integer 0 <= min <= max <= 100.
// Keep the decimal point virtual while rounding shortest-decimal mantissa digits.
export function fmtNumEn(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!isFinite(value))
		return isNaN(value) ? 'NaN' : sign + '∞';

	let digits = '' + Math.abs(value);
	const exp = digits.indexOf('e');
	const dot = digits.indexOf('.');
	let point = dot < 0 ? (exp < 0 ? digits.length : exp) : dot;
	if (exp >= 0) {
		point += +digits.slice(exp + 1);
		digits = digits.slice(0, exp);
	}
	if (dot >= 0)
		digits = digits.slice(0, dot) + digits.slice(dot + 1);

	let end = point + max;
	if (digits.length > end) {
		// A negative index denotes an implicit zero and cannot round up.
		if (digits[end] >= '5') {
			while (end && digits[end - 1] === '9')
				end--;
			digits = end ? digits.slice(0, end - 1) + (+digits[end - 1] + 1) : '1';
			if (!end)
				point++;
		}
		else
			digits = digits.slice(0, end < 0 ? 0 : end);
	}

	end = digits.length;
	while (digits[end - 1] === '0')
		end--;
	// If no nonzero digits remain, emit only the required fractional zeroes.
	end = Math.max(end || point, point + min);

	let out = sign;
	for (let i = Math.min(0, point - 1); i < end; i++) {
		out += i === point ? '.' : i > 0 && i < point && (point - i) % 3 === 0 ? ',' : '';
		out += digits[i] || '0';
	}
	return out;
}
