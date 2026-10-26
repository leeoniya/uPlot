// Run serially: node docs/investigations/number-format-iteration.mjs [--browser] [variant ...]
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {rolldown} from 'rolldown';
import {variants} from './number-format-variants.mjs';

function benchmark(variants) {
	const percent = Array.from({length: 4096}, (_, i) => (i * 7919 % 1000000) / 10000);
	const mixed = Array.from({length: 4096}, (_, i) => ((i * 104729 % 2000000000) - 1000000000) / 10 ** (i % 7));
	const integers = Array.from({length: 4096}, (_, i) => i * 7919 - 1000000);
	const large = Array.from({length: 4096}, (_, i) => (i + 0.123456789) * 10 ** (16 + i % 16));
	const tiny = Array.from({length: 4096}, (_, i) => (i - 2048.123456789) * 10 ** (-7 - i % 16));
	const cases = [
		['legend percent', percent, 0, 3], ['legend mixed', mixed, 0, 3],
		['axis2 percent', percent, 2, 2], ['axis2 mixed', mixed, 2, 2],
		['axis6 mixed', mixed, 6, 6], ['axis0 integers', integers, 0, 0],
		['legend large', large, 0, 3], ['axis20 tiny', tiny, 20, 20],
		['axis100 mixed', mixed, 100, 100],
	];
	const rounds = 9, passes = 32;
	let sink = 0;
	function measure(fn, values, passes) {
		let checksum = 0;
		const start = performance.now();
		for (let pass = 0; pass < passes; pass++) {
			for (const value of values) {
				const str = fn(value);
				checksum += str.length + str.charCodeAt(str.length - 1);
			}
		}
		const elapsed = performance.now() - start;
		sink = (sink + checksum) | 0;
		return elapsed * 1e6 / (values.length * passes);
	}
	const results = [];
	for (const [name, values, min, max] of cases) {
		const intl = new Intl.NumberFormat('en-US', {minimumFractionDigits: min, maximumFractionDigits: max}).format;
		const entries = [['intl', intl], ...Object.entries(variants).map(([key, fn]) => [key, value => fn(value, min, max)])];
		const samples = Object.fromEntries(entries.map(([key]) => [key, []]));
		for (const [key, fn] of entries) {
			for (const value of values)
				if (fn(value) !== intl(value)) throw new Error(name + ': ' + key + ': ' + value);
			measure(fn, values, 16);
		}
		for (let round = 0; round < rounds; round++) {
			for (let offset = 0; offset < entries.length; offset++) {
				const [key, fn] = entries[(round + offset) % entries.length];
				samples[key].push(measure(fn, values, passes));
			}
		}
		const medianNs = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [...values].sort((a, b) => a - b)[rounds >> 1]]));
		results.push({name, min, max, samples, medianNs});
	}
	return {rounds, callsPerRound: passes * 4096, results, sink};
}

const browser = process.argv.includes('--browser');
const names = process.argv.slice(2).filter(arg => arg !== '--browser');
const selected = Object.fromEntries((names.length ? names : Object.keys(variants)).map(name => {
	assert.ok(variants[name], 'Unknown variant: ' + name);
	return [name, variants[name]];
}));
const sizes = {};
for (const [name, fn] of Object.entries(selected)) {
	const build = await rolldown({input: 'candidate', plugins: [{name: 'candidate',
		resolveId: id => id === 'candidate' ? id : null,
		load: id => id === 'candidate' ? 'export ' + fn.toString().replace(/^function\s+\w+/, 'function fmtNumEn') : null,
	}]});
	try {
		const {output} = await build.generate({format: 'esm', minify: true});
		const code = output[0].code;
		sizes[name] = {minified: Buffer.byteLength(code), gzip: gzipSync(code, {level: 9}).length};
	}
	finally { await build.close(); }
}

const directory = await mkdtemp('/tmp/uplot-number-iteration-');
let result;
if (browser) {
	const profile = directory + '/profile';
	const source = 'const variants = {' + Object.entries(selected).map(([name, fn]) => name + ':' + fn.toString()).join(',') + '};\n' +
		'const benchmark = ' + benchmark.toString() + ';\n' +
		'try { document.body.textContent = JSON.stringify({environment: navigator.userAgent, ...benchmark(variants)}); }' +
		'catch(error) { document.body.textContent = JSON.stringify({error: error.stack}); }';
	await writeFile(directory + '/bench.html', '<!doctype html><body><script>' + source + '</script>');
	try {
		const run = spawnSync(resolve('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell'),
			['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir=' + profile,
				'--dump-dom', 'file://' + directory + '/bench.html'], {encoding: 'utf8', timeout: 90000, maxBuffer: 1048576});
		assert.ok(!run.error && run.status === 0, String(run.error) + run.stderr);
		const text = run.stdout.match(/<body>([\s\S]*?)<\/body>/)[1]
			.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
		result = JSON.parse(text);
		assert.ok(!result.error, result.error);
	}
	finally { await rm(profile, {recursive: true, force: true}); }
}
else
	result = {environment: process.version + ' / V8 ' + process.versions.v8, ...benchmark(selected)};

result.sizes = sizes;
await writeFile(directory + '/results.json', JSON.stringify(result, null, 2));
console.log(result.environment, JSON.stringify(sizes));
for (const row of result.results)
	console.log(row.name, JSON.stringify(Object.fromEntries(Object.entries(row.medianNs).map(([key, value]) => [key, +value.toFixed(1)]))));
console.log('Evidence:', directory + '/results.json');
