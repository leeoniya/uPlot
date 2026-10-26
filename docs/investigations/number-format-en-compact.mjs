// en-US decimal formatting for Number inputs and integer 0 <= min <= max <= 100.
export function fmtNumEn(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!Number.isFinite(value))
		return Number.isNaN(value) ? 'NaN' : sign + '∞';

	let digits = String(Math.abs(value));
	const exp = digits.indexOf('e');
	const dot = digits.indexOf('.');
	let point = dot < 0 ? (exp < 0 ? digits.length : exp) : dot;
	if (exp >= 0) {
		point += +digits.slice(exp + 1);
		digits = digits.slice(0, exp);
	}
	if (dot >= 0)
		digits = digits.slice(0, dot) + digits.slice(dot + 1);
	if (point < 1) {
		digits = '0'.repeat(1 - point) + digits;
		point = 1;
	}

	let end = point + max;
	if (digits[end] >= '5') {
		while (end && digits[end - 1] === '9')
			end--;
		// Discard carried zeroes; final padding restores only those needed.
		digits = end ? digits.slice(0, end - 1) + (+digits[end - 1] + 1) : '1';
		if (!end)
			point++;
	}
	else
		digits = digits.slice(0, end);

	end = digits.length;
	const stop = point + min;
	while (end > stop && digits[end - 1] === '0')
		end--;
	digits = digits.slice(0, end).padEnd(stop, '0');

	let out = digits.length > point ? '.' + digits.slice(point) : '';
	while (point > 3) {
		out = ',' + digits.slice(point - 3, point) + out;
		point -= 3;
	}
	return sign + digits.slice(0, point) + out;
}
