// node scripts/bench-axis-size.mjs [--baseline-only | --final [path/to/uPlot.iife.js]] [--idle-ms 500]
// Without a bundle path, build a snapshot in .cache; do not rebuild the working dist.
// CHROME_BIN overrides the cached Chrome Headless Shell. Run without other benchmarks/tests.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, release, platform, arch } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cachedChromeBinary, createChromeInstaller } from './chrome-headless-shell.mjs';

const argv = process.argv.slice(2);
const finalAt = argv.indexOf('--final');
if (finalAt != -1 && (!argv[finalAt + 1] || argv[finalAt + 1].startsWith('--')))
	argv.splice(finalAt + 1, 0, ''); // --final alone requests the isolated build
const { values: args } = parseArgs({ args: argv, options: {
	ref: { type: 'string', default: 'd3eefe61a583e30712f13b85c5ede8f15298a967' },
	'baseline-only': { type: 'boolean' }, final: { type: 'string' },
	rounds: { type: 'string' }, updates: { type: 'string' }, 'idle-ms': { type: 'string' },
} });
const idleMs = Number(args['idle-ms'] ?? 0);
assert.ok(args['idle-ms'] === undefined || Number.isSafeInteger(idleMs) && idleMs > 0, '--idle-ms requires a positive integer');
const rounds = Number(args.rounds ?? (idleMs ? 3 : 12)), updates = Number(args.updates ?? (idleMs ? 12 : 96)), warmup = 32;
assert.ok(Number.isInteger(rounds) && rounds > 0 && Number.isInteger(updates) && updates >= 2);
assert.ok(!args['baseline-only'] || args.final === undefined, 'Choose --baseline-only or --final, not both');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.cache/bench-axis-size');
mkdirSync(cache, { recursive: true });
const git = (...args) => execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8' }).trimEnd();
const ref = git('rev-parse', '--verify', '--end-of-options', args.ref + '^{commit}');
const gitFile = path => execFileSync('git', ['--no-pager', 'show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' });
const baseline = gitFile('dist/uPlot.iife.js');
writeFileSync(join(cache, `${ref}.iife.js`), baseline);
const css = gitFile('dist/uPlot.min.css'); // identical styles for all variants, regardless of working tree
const sha = code => createHash('sha256').update(code).digest('hex');
let final, builder;
if (!args['baseline-only']) {
	if (args.final) {
		builder = args.final;
		final = readFileSync(args.final, 'utf8');
	}
	else {
		const stage = mkdtempSync(join(cache, 'build-'));
		try {
			for (const name of ['src', 'package.json', 'rolldown.config.js'])
				cpSync(join(root, name), join(stage, name), { recursive: true });
			mkdirSync(join(stage, 'dist'));
			const cli = join(root, 'node_modules/.bin/rolldown');
			builder = `isolated production config: ${execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim()}`;
			execFileSync(cli, ['-c', '--configLoader', 'native'], { cwd: stage, timeout: 30000 });
			final = readFileSync(join(stage, 'dist/uPlot.iife.js'), 'utf8');
		}
		finally { rmSync(stage, { recursive: true, force: true }); }
	}
	if (sha(final) == sha(baseline)) throw Error(`Final IIFE is byte-identical to ${ref}; no final implementation to measure. Use --baseline-only.`);
	writeFileSync(join(cache, `final-${sha(final)}.iife.js`), final);
}
const installer = createChromeInstaller({ cacheDir: join(cache, 'chrome') });
const binary = await cachedChromeBinary() ?? await installer.cachedChromeBinary() ?? await installer.chromeBinary();
const variants = final ? ['static50', 'oldAuto', 'nullish'] : ['static50', 'oldAuto'];

// Probe the call sites rather than wrapping axis.size: layout can branch on its identity.
// Only the profiling browser gets this code. Reject an unrecognized bundle rather than reporting zeros.
function profileBundle(code) {
	for (const [anchor, condition, ms, count] of [
		['let changedY = updateLayout();', 'true', 'layoutMs', 'layouts'],
		['let size = ceil(axis.size(self, ori == 0 ? null : axis._values, i));', 'ori == 1', 'sizeMs', 'sizes'],
	]) {
		assert.equal(code.split(anchor).length, 2, `Cannot identify profiling boundary: ${anchor}`);
		code = code.replace(anchor, `const tProbe = ${condition} ? performance.now() : 0; ${anchor}
			if (${condition}) { window.probe.${ms} += performance.now() - tProbe; window.probe.${count}++; }`);
	}
	return code;
}

// Serialized into the browser page. No CDP round trips, fixture construction, RAF waits or logging in the timed interval.
async function benchmark({ variants, profile, paced, idleMs, rounds, updates, fixtureUpdates, warmup }) {
	const frame = () => new Promise(requestAnimationFrame);
	const now = () => performance.now();
	const check = (condition, message) => { if (!condition) throw Error(message); };
	const zero = () => ({ layoutMs: 0, sizeMs: 0, textMs: 0, drawMs: 0, layouts: 0, sizes: 0, texts: 0, draws: 0 });
	window.probe = zero();
	if (profile) {
		for (const prototype of [OffscreenCanvasRenderingContext2D.prototype, CanvasRenderingContext2D.prototype]) {
			const measure = prototype.measureText;
			prototype.measureText = function(text) {
				const t = now();
				const result = measure.call(this, text);
				probe.textMs += now() - t;
				probe.texts++;
				return result;
			};
		}
	}

	const n = fixtureUpdates + warmup + 1, count = 256, base = 100000;
	const array = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
	const x = array(count, i => i);
	const zoomData = [array(n * count, i => i), array(n * count, i => base + (i >> 4))];
	const percentile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
	const summary = values => {
		const sorted = values.slice().sort((a, b) => a - b);
		return { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(sorted, .5), p95: percentile(sorted, .95) };
	};
	const results = [];
	function makePlot(variant, fast, data, hooks) {
		const Plot = variant == 'nullish' ? window.Final : window.Baseline;
		return new Plot({
			width: 820, height: 470, pxRatio: 1, padding: [8, 8, 8, 8],
			cursor: { show: false }, legend: { show: false },
			axes: [{ size: 50 }, { incrs: [1], space: 18, font: '12px Arial', ...(variant == 'nullish' ? {} : { size: variant == 'oldAuto' ? 'auto' : 50 }) }],
			scales: { x: { time: false }, y: { range: fast ? [base - .25, base + 15.25] : (_, lo, hi) => [lo - .25, hi + .25] } },
			series: [{}, { stroke: '#336699', points: { show: false } }],
			...(hooks && { hooks }),
		}, data, document.body);
	}
	for (const operation of ['zoom', 'data']) {
		for (const pattern of ['stable', 'partial', 'churn', ...(operation == 'data' ? ['resize-churn', 'no-layout'] : [])]) {
			if (idleMs && (pattern == 'stable' || pattern == 'resize-churn')) continue;
			const fast = pattern == 'no-layout';
			const resize = pattern == 'resize-churn';
			const offset = i => pattern == 'partial' ? i : resize ? i * 16 + (i & 1) * 1000000 : pattern == 'churn' ? i * 16 : 0;
			const windows = array(n, i => ({ min: offset(i) * 16 + (i & 1) * 3, max: offset(i) * 16 + count - 1 - (i & 1) * 2 }));
			// Changing the fractional extrema forces layout even when all 16 displayed strings are stable.
			const datasets = operation == 'data' ? array(n, i => [x, array(count, j => base + offset(i) + (j >> 4) + (i & 1) * .05)]) : null;
			const rows = Object.fromEntries(variants.map(variant => [variant, { variant, operation, pattern, blocks: [] }]));
			const mounted = new Map(); // sporadic pass: one chart per variant for all rotations
			for (let round = 0; round < rounds; round++) {
				for (let pos = 0; pos < variants.length; pos++) {
					const variant = variants[(round + pos) % variants.length];
					let drawStart;
					const hooks = profile && { drawClear: [() => { drawStart = now(); }], draw: [() => { probe.drawMs += now() - drawStart; probe.draws++; }] };
					const u = mounted.get(variant) ?? makePlot(variant, fast, datasets?.[0] ?? zoomData, hooks);
					if (idleMs) {
						mounted.set(variant, u);
						u.root.style.display = '';
					}
					await Promise.resolve();
					const y = u.axes[1];

					const update = i => operation == 'zoom' ? u.setScale('x', windows[i]) : u.setData(datasets[i]);
					// On return to a mounted chart, prime one adjacent update before its first idle interval.
					const prime = warmup + (idleMs ? round * (updates + 1) : 0);
					for (let i = idleMs && round > 0 ? prime : 0; i <= prime; i++) {
						update(i);
						await Promise.resolve();
						u.over.getBoundingClientRect();
					}
					let previousEnd = now();
					check(u.status == 1 && y._values?.length == 16, `${variant}/${operation}/${pattern}: expected ready chart with 16 Y ticks; got ${y._values}`);
					check(variant == 'static50' ? y._size == 50 : y._size > 0 && y._size != 50, `${variant}: expected ${variant == 'static50' ? 'static' : 'automatic'} width, got ${y._size}; check final source/build`);
					await frame();
					window.probe = zero();
					let prev = y._values, widths = y._labelWidths, replacements = 0, plotWidth = u.bbox.width, resizes = 0;
					const us = new Array(updates), gapsMs = [];
					for (let k = 0; k < updates; k++) {
						const i = prime + 1 + k;
						if (idleMs) {
							const deadline = previousEnd + idleMs;
							while (now() < deadline)
								await new Promise(resolve => setTimeout(resolve, Math.ceil(deadline - now())));
						}
						if (paced) {
							await frame(); // no update on this frame
							await frame(); // issue the next update on this frame, outside the wait
						}
						const t = now();
						update(i);
						await Promise.resolve(); // one queued uPlot commit per API call, not a coalesced batch
						u.over.getBoundingClientRect(); // include pending DOM style/layout, not compositor presentation
						const end = now();
						us[k] = (end - t) * 1000;
						if (idleMs || paced && k > 0) gapsMs.push(t - previousEnd);
						previousEnd = end;
						if (profile || idleMs) {
							const values = y._values;
							const shared = values.filter(value => prev.includes(value)).length;
							check(values.length == 16 && shared == (resize || pattern == 'churn' ? 0 : pattern == 'partial' ? 15 : 16), `${operation}/${pattern}: unexpected Y labels ${prev} -> ${values}`);
							prev = values;
							resizes += plotWidth != u.bbox.width ? 1 : 0;
							plotWidth = u.bbox.width;
							replacements += widths !== y._labelWidths ? 1 : 0;
							widths = y._labelWidths;
						}
					}
					const block = { ...summary(us), width: y._size };
					if (!profile) block.samplesUs = us;
					if (paced || idleMs) block.gapsMs = gapsMs;
					if (profile) {
						check(probe.draws == updates && probe.layouts == (fast ? 0 : updates) && probe.sizes == probe.layouts, `${variant}/${operation}/${pattern}: wrong draw/layout/size counts ${JSON.stringify(probe)}`);
						check(resizes == (resize && variant != 'static50' ? updates : 0), `${variant}/${operation}/${pattern}: unexpected plot width changes: ${resizes}`);
						Object.assign(block, probe, { widthArrayReplacements: replacements, resizes });
					}
					rows[variant].blocks.push(block);
					if (idleMs) u.root.style.display = 'none';
					else u.destroy();
				}
			}
			for (const u of mounted.values()) u.destroy();
			results.push(...Object.values(rows));
		}
	}
	// Separate retention pass. Count distinct observable arrays, not bytes or all allocations.
	const retention = [];
	if (profile) {
		const collect = async () => { await frame(); gc(); await frame(); gc(); };
		for (const variant of variants) {
			const samples = { _values: [], _labelWidths: [] }, seen = new WeakSet();
			const data = i => [x, x.map(j => base + 10000 + i * 16 + (j >> 4))];
			let u = makePlot(variant, false, data(0));
			await Promise.resolve();
			const chart = new WeakRef(u);
			let maxDirectAxisMapEntries = 0;
			function sample(axis) {
				for (const key in samples) {
					const obj = axis[key];
					if (obj != null && !seen.has(obj)) {
						seen.add(obj);
						samples[key].push(new WeakRef(obj));
					}
				}
				for (const field of Object.values(axis))
					if (field instanceof Map) maxDirectAxisMapEntries = Math.max(maxDirectAxisMapEntries, field.size);
			}
			for (let i = 1; i <= 512; i++) {
				u.setData(data(i));
				await Promise.resolve();
				sample(u.axes[1]);
			}
			const counts = live => Object.fromEntries(Object.entries(samples).map(([k, refs]) => [k, live ? refs.filter(r => r.deref()).length : refs.length]));
			await collect();
			const withChart = counts(true);
			u.destroy();
			u = null;
			await collect();
			retention.push({ variant, churnUpdates: 512, distinct: counts(false), withChart, afterDestroy: counts(true), chartCollected: !chart.deref(), maxDirectAxisMapEntries });
		}
	}
	return { results, retention, userAgent: navigator.userAgent, dpr: devicePixelRatio, crossOriginIsolated };
}

async function run(pass) {
	const profile = pass == 'profile', paced = pass == 'paced';
	const config = { variants, profile, paced, idleMs, warmup, fixtureUpdates: idleMs ? Math.max(96, rounds * (updates + 1)) : updates,
		rounds: profile ? 3 : paced ? Math.min(6, rounds) : rounds, updates: paced ? Math.min(16, updates) : updates };
	const assets = new Map([['/baseline.js', profile ? profileBundle(baseline) : baseline]]);
	if (final) assets.set('/final.js', profile ? profileBundle(final) : final);
	const page = `<!doctype html><html lang="en"><meta charset="utf-8"><style>${css}</style><body>
<script src="/baseline.js"></script><script>window.Baseline = uPlot;</script>
${final ? '<script src="/final.js"></script><script>window.Final = uPlot;</script>' : ''}
<script>(${benchmark})(${JSON.stringify(config)}).catch(e => ({error: e.stack})).then(result => fetch('/report', {method:'POST', body:JSON.stringify(result)}));</script>`;
	let done, fail;
	const result = new Promise((resolve, reject) => { done = resolve; fail = reject; });
	const server = createServer(async (req, res) => {
		if (req.url == '/report' && req.method == 'POST') {
			try {
				let body = '';
				for await (const chunk of req) body += chunk;
				const report = JSON.parse(body);
				res.end('ok');
				report.error ? fail(Error(report.error)) : done(report);
			}
			catch (error) { fail(error); res.end(); }
		}
		else if (req.url == '/') {
			res.writeHead(200, { 'Content-Type': 'text/html', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
			res.end(page);
		}
		else if (assets.has(req.url)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(assets.get(req.url)); }
		else { res.writeHead(404); res.end(); }
	});
	const dir = mkdtempSync(join(cache, 'profile-'));
	let browser, closed, timer, log = '';
	try {
		await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
		browser = spawn(binary, ['--disable-gpu', '--force-device-scale-factor=1', '--lang=en-US', ...(profile ? ['--js-flags=--expose-gc'] : []), `--user-data-dir=${dir}`, `http://127.0.0.1:${server.address().port}/`], { stdio: ['ignore', 'ignore', 'pipe'] });
		browser.stderr.on('data', chunk => { log = (log + chunk).slice(-3000); });
		browser.once('error', fail);
		closed = new Promise(resolve => browser.once('close', code => { resolve(); fail(Error(`Chrome closed (${code}): ${log}`)); }));
		const timeout = 180000 + idleMs * 5 * variants.length * rounds * updates;
		timer = setTimeout(() => fail(Error(`Browser run exceeded ${timeout} ms: ${log}`)), timeout);
		return { ...await result, config };
	}
	finally {
		clearTimeout(timer);
		browser?.kill('SIGTERM');
		await closed;
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		rmSync(dir, { recursive: true, force: true });
	}
}

const report = { ref, baselineSHA256: sha(baseline), finalSHA256: final ? sha(final) : null, builder, rounds, updates, warmup,
	os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0].model, logicalCPUs: cpus().length, node: process.version, binary };
const output = join(cache, `results-${idleMs ? `idle-${idleMs}ms-` : ''}${report.finalSHA256?.slice(0, 12) ?? 'baseline'}-${rounds}x${updates}.json`);
if (idleMs) {
	console.log(`Timing only sporadic updates: ${rounds} × ${updates} per case and variant, at least ${idleMs} ms idle`);
	report.sporadic = await run('sporadic');
}
else {
	console.log('Timing without probes:', variants.join(', '));
	report.timing = await run('hot');
	console.log('Timing with one idle frame between updates in a fresh browser');
	report.paced = await run('paced');
	console.log('Profiling in a fresh browser');
	report.profile = await run('profile');
}
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const timing = report.sporadic ?? report.timing;
const rows = timing.results.map(({ operation, pattern, variant, blocks }, i) => {
	const latency = (blocks, p) => { const xs = blocks.flatMap(b => b.samplesUs).sort((a, b) => a - b); return +xs[Math.ceil(xs.length * p) - 1].toFixed(2); };
	if (variant == 'nullish') assert.equal(blocks[0].width, timing.results[i - 1].blocks[0].width, 'Final width differs from baseline auto');
	if (idleMs) {
		const gaps = blocks.flatMap(b => b.gapsMs);
		assert.ok(gaps.length == rounds * updates && gaps.every(ms => ms >= idleMs), 'Missing or short idle interval');
		return { operation, pattern, variant, samples: gaps.length, 'p50 us': latency(blocks, .5), 'p95 us': latency(blocks, .95), 'idle ms': +median(gaps).toFixed(2) };
	}
	const prof = report.profile.results[i].blocks;
	const paced = report.paced.results[i].blocks;
	const metric = key => +median(prof.map(b => b[key] * 1000 / updates)).toFixed(2);
	return { operation, pattern, variant, width: blocks[0].width, 'us/update': +median(blocks.map(b => b.mean)).toFixed(2),
		'hot p50': latency(blocks, .5), 'hot p95': latency(blocks, .95), 'paced p50': latency(paced, .5), 'paced p95': latency(paced, .95),
		'idle ms': +median(paced.flatMap(b => b.gapsMs)).toFixed(2), 'texts/update': median(prof.map(b => b.texts / updates)),
		'profile us': +median(prof.map(b => b.mean)).toFixed(2), 'layout us': metric('layoutMs'), 'Y size us': metric('sizeMs'), 'text us': metric('textMs'), 'draw us': metric('drawMs') };
});
report.summary = rows;
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.table(rows);
if (report.profile) {
	console.log('Post-GC array liveness after 512 disjoint setData updates:', report.profile.retention);
	console.log('p50/p95: individual updates in µs, excluding idle time. us/update: median hot block mean. Profile timers: text ⊂ Y size ⊂ layout. Draw excludes clearRect/presentation.');
}
console.log(output);
