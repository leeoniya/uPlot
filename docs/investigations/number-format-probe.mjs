// Compare reused Intl, toFixed-based candidates, and shortest-decimal rounding.
// Run: node docs/investigations/number-format-probe.mjs
import {performance} from 'node:perf_hooks';
import {fmtNumEn as fmtNumEnDecimal} from './number-format-en.mjs';

export function fmtNumEn(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!Number.isFinite(value))
		return Number.isNaN(value) ? 'NaN' : sign + '∞';

	let str = Math.abs(value).toFixed(max);
	// toFixed uses scientific notation at magnitudes >= 1e21.
	if (str.includes('e'))
		return sign + str;

	if (max > min) {
		let end = str.length;
		const stop = str.indexOf('.') + 1 + min;
		while (end > stop && str.charCodeAt(end - 1) === 48)
			end--;
		if (str.charCodeAt(end - 1) === 46)
			end--;
		str = str.slice(0, end);
	}

	const dot = str.indexOf('.');
	let end = dot < 0 ? str.length : dot;
	let out = str.slice(end);
	while (end > 3) {
		out = ',' + str.slice(end - 3, end) + out;
		end -= 3;
	}
	return sign + str.slice(0, end) + out;
}

// Alternative grouping implementation, to compare code size against loop speed.
function fmtNumEnRegex(value, min = 0, max = 3) {
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (!Number.isFinite(value))
		return Number.isNaN(value) ? 'NaN' : sign + '∞';
	let str = Math.abs(value).toFixed(max);
	if (str.includes('e')) return sign + str;
	if (max > min) {
		let end = str.length;
		const stop = str.indexOf('.') + 1 + min;
		while (end > stop && str.charCodeAt(end - 1) === 48) end--;
		if (str.charCodeAt(end - 1) === 46) end--;
		str = str.slice(0, end);
	}
	const dot = str.indexOf('.');
	const end = dot < 0 ? str.length : dot;
	return sign + str.slice(0, end).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + str.slice(end);
}

const datasets = {
	percent: Array.from({length: 4096}, (_, i) => (i * 7919 % 1000000) / 10000),
	mixed: Array.from({length: 4096}, (_, i) => ((i * 104729 % 2000000000) - 1000000000) / 10 ** (i % 7)),
};
const cases = [
	{name: 'legend: up to 3 decimals', min: 0, max: 3},
	{name: 'axis: fixed 2 decimals', min: 2, max: 2},
	{name: 'axis: fixed 6 decimals', min: 6, max: 6},
];
const rounds = 7;
const passes = 64;
let sink = 0;

function measure(fn, values, count) {
	let checksum = 0;
	const start = performance.now();
	for (let pass = 0; pass < count; pass++) {
		for (const value of values) {
			const str = fn(value);
			checksum += str.length + str.charCodeAt(str.length - 1);
		}
	}
	const elapsed = performance.now() - start;
	sink = (sink + checksum) | 0;
	return elapsed * 1e6 / (values.length * count);
}

const results = [];
for (const {name, min, max} of cases) {
	const intl = new Intl.NumberFormat('en-US', {minimumFractionDigits: min, maximumFractionDigits: max}).format;
	const functions = {intl, loop: value => fmtNumEn(value, min, max), regex: value => fmtNumEnRegex(value, min, max),
			decimal: value => fmtNumEnDecimal(value, min, max)};
	for (const [dataset, values] of Object.entries(datasets)) {
		const samples = Object.fromEntries(Object.keys(functions).map(key => [key, []]));
		const entries = Object.entries(functions);
		for (const [, fn] of entries) measure(fn, values, 16);
		// Rotate execution order to reduce ordering bias.
		for (let round = 0; round < rounds; round++) {
			for (let offset = 0; offset < entries.length; offset++) {
				const [key, fn] = entries[(round + offset) % entries.length];
				samples[key].push(measure(fn, values, passes));
			}
		}
		const medianNs = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, values.sort((a, b) => a - b)[rounds >> 1]]));
		const mismatches = values.filter(value => intl(value) !== functions.loop(value));
		results.push({name, dataset, medianNs, loopSpeedup: medianNs.intl / medianNs.loop,
			decimalSpeedup: medianNs.intl / medianNs.decimal,
			decimalMismatchCount: values.filter(value => intl(value) !== functions.decimal(value)).length,
			mismatchCount: mismatches.length,
			mismatchExamples: mismatches.slice(0, 3).map(value => ({value, intl: intl(value), candidate: functions.loop(value)}))});
	}
}

const edgeValues = [0, -0, -0.00001, 1.005, 2.675, -1.005, 1.2345, 1234.5, 1e21, NaN, Infinity, -Infinity];
const edgeIntl = new Intl.NumberFormat('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
console.log(JSON.stringify({node: process.version, v8: process.versions.v8, rounds, callsPerRound: passes * 4096,
	results, fixed2Edges: edgeValues.map(value => ({input: Object.is(value, -0) ? '-0' : String(value),
		intl: edgeIntl.format(value), candidate: fmtNumEn(value, 2, 2), decimal: fmtNumEnDecimal(value, 2, 2)})), sink}, null, 2));
