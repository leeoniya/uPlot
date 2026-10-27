// Run with node or bun scripts/bench-instrument.mjs. Results stay under .cache.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, arch } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const backends = ['istanbul', 'estree'];
// Bound Node heap growth in both the coordinator and its sequential workers.
// Bun's --smol mode is the lower-memory alternative, not a hard heap limit.
const runtimeFlags = process.versions.bun ? ['--smol'] : ['--max-old-space-size=384'];
const repeats = 3;
const cachePasses = 20;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(value);
const inlineMap = map => '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

function tree(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? tree(path) : [path];
	}).sort();
}

function snapshot(paths) {
	const files = Object.fromEntries(paths.map(path => {
		try { return [relative(project, path), hash(readFileSync(path))]; }
		catch (error) {
			if (error.code !== 'ENOENT') throw error;
			return [relative(project, path), null];
		}
	}));
	return { sha256: hash(JSON.stringify(files)), files };
}

function unchanged(manifest) {
	assert.deepStrictEqual(snapshot(manifest.paths), manifest.snapshot,
		'Source or corpus changed during the benchmark; discard these timings and rerun.');
}

async function loadBackend(backend) {
	const module = await import(backend === 'istanbul' ? 'istanbul-lib-instrument' : './vendor/istanbul/index.mjs');
	return module.createInstrumenter ?? module.default.createInstrumenter;
}

function corpus(manifest) {
	return manifest.files.map(filename => ({ filename, source: readFileSync(filename, 'utf8') }));
}

function summary(samples, passes = 1) {
	const sorted = samples.map(ms => ms / passes).sort((a, b) => a - b);
	return { medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: samples, corporaPerSample: passes };
}

async function worker(mode, backend, manifestPath) {
	assert(backends.includes(backend));
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	unchanged(manifest);
	const files = corpus(manifest);
	let consumed = 0;
	let result;
	if (mode === 'cold') {
		// Corpus reads and fingerprint checks are excluded here, but included in parent wall time.
		const start = performance.now();
		const create = await loadBackend(backend);
		const instrumenter = create(manifest.options);
		for (const { filename, source } of files)
			consumed += instrumenter.instrumentSync(source, filename).length;
		result = { importAndInstrumentMs: performance.now() - start };
	}
	else if (mode === 'reused' || mode === 'new') {
		const create = await loadBackend(backend);
		const reused = create(manifest.options);
		const batch = () => {
			const start = performance.now();
			for (const { filename, source } of files) {
				const instrumenter = mode === 'new' ? create(manifest.options) : reused;
				consumed += instrumenter.instrumentSync(source, filename).length;
			}
			return performance.now() - start;
		};
		batch(); // One full corpus warmup; never memoize transformed source.
		result = summary(Array.from({ length: repeats }, batch));
	}
	else if (mode === 'cache') {
		const { createSourceInstrumenter } = await import('./instrument-source.mjs');
		const cacheDir = resolve(dirname(manifestPath), 'cache-' + backend);
		mkdirSync(cacheDir);
		const prime = createSourceInstrumenter(manifest.options, cacheDir, backend);
		const start = performance.now();
		const outputs = files.map(({ filename, source }) => prime(source, filename));
		const primeMs = performance.now() - start;
		outputs.forEach((code, index) => assert.equal(hash(code), manifest.outputHashes[backend][index],
			'Cache miss output differs from direct instrumentation: ' + files[index].filename));
		const entries = tree(cacheDir);
		assert.equal(entries.length, files.length, 'Expected one disk entry per corpus file');
		const cacheState = () => entries.map(path => {
			const stat = statSync(path);
			return [path, stat.size, stat.mtimeMs, stat.ctimeMs, hash(readFileSync(path))];
		});
		const before = cacheState();
		// A fresh closure cannot reuse the priming instrumenter or its module state.
		const cached = createSourceInstrumenter(manifest.options, cacheDir, backend);
		files.forEach(({ filename, source }, index) => assert.equal(cached(source, filename), outputs[index]));
		const samples = [];
		for (let repeat = 0; repeat < repeats; repeat++) {
			const start = performance.now();
			for (let pass = 0; pass < cachePasses; pass++)
				for (const { filename, source } of files)
					consumed += cached(source, filename).length;
			samples.push(performance.now() - start);
		}
		assert.deepStrictEqual(tree(cacheDir), entries, 'Cache hits created new files');
		assert.deepStrictEqual(cacheState(), before, 'Cache hits rewrote entries');
		result = { ...summary(samples, cachePasses), primeMs, diskBytes: entries.reduce((sum, path) => sum + statSync(path).size, 0) };
	}
	else throw new Error('Unknown worker mode: ' + mode);
	assert(consumed > 0);
	unchanged(manifest);
	console.log(JSON.stringify({ ...result, consumedCodeUnits: consumed }));
}

async function main() {
	assert.equal(process.argv.length, 2, 'Usage: node|bun scripts/bench-instrument.mjs');
	const runtime = process.versions.bun ? 'bun' : 'node';
	const base = resolve(project, '.cache/bench-instrument');
	mkdirSync(base, { recursive: true });
	const directory = mkdtempSync(resolve(base, new Date().toISOString().replace(/[:.]/g, '-') + '-' + runtime + '-'));
	const resultPath = resolve(directory, 'result.json');
	const report = {
		valid: false,
		startedAt: new Date().toISOString(),
		runtime: { name: runtime, execPath: process.execPath, execArgv: process.execArgv, versions: process.versions,
			NODE_OPTIONS: process.env.NODE_OPTIONS ?? null, BUN_OPTIONS: process.env.BUN_OPTIONS ?? null },
		host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
		method: {
			repeats, uncachedCorporaPerBatch: 1, cacheCorporaPerBatch: cachePasses, warmupCorpora: 1,
			cold: 'Fresh runtime per sample; import+instrument excludes corpus reads. Wall time includes startup, reads, fingerprints, and exit. OS page cache is not flushed.',
			warm: 'Separate worker per backend/mode; inputs in memory; no output cache; new means one instrumenter per file. No forced GC.',
			cache: 'Separate worker; prime misses and verify outputs before timing. Fresh closure, disk reads/hash/UTF-8 decode included; warm OS page cache. Prime time is not a median.',
			correctness: 'Full JSON-round-tripped lastFileCoverage deep equality, reused and new instrumenters; no fields removed. This is not a runtime semantics or source-map accuracy test.',
		},
	};
	let manifest;
	try {
		const installed = dirname(require.resolve('istanbul-lib-instrument/package.json'));
		const sourcePaths = [script, ...['package.json', 'package-lock.json', 'bun.lock', 'scripts/instrument-source.mjs',
			'scripts/register-hooks.mjs', 'scripts/coverage-files.mjs'].map(path => resolve(project, path)),
			...tree(resolve(project, 'scripts/vendor/istanbul')), ...tree(installed)].sort();
		const sourceSnapshot = snapshot(sourcePaths);
		const config = { ...JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8')).nyc, cwd: project };
		const { coverageFiles } = await import('./coverage-files.mjs');
		const files = coverageFiles(config).files();
		assert.equal(files.length, 30, 'Expected the actual 30-file coverage corpus; do not silently benchmark a different selection');
		const options = { ...config, esModules: true, produceSourceMap: true, compact: true };
		const paths = [...new Set([...sourcePaths, ...files])].sort();
		manifest = { files, options, paths, snapshot: snapshot(paths), outputHashes: { istanbul: [], estree: [] } };
		assert.deepStrictEqual(snapshot(sourcePaths), sourceSnapshot, 'Sources changed while selecting the corpus');
		report.sourceSnapshot = sourceSnapshot;
		report.snapshot = manifest.snapshot;
		report.options = options;
		report.istanbulVersion = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8')).version;
		const inputs = corpus(manifest);
		report.corpus = { files: files.map(path => relative(project, path)), count: files.length,
			bytes: inputs.reduce((sum, file) => sum + bytes(file.source), 0) };
		console.log(`${runtime}: checking complete coverage metadata on ${files.length} files before timings...`);
		const factories = Object.fromEntries(await Promise.all(backends.map(async backend => [backend, await loadBackend(backend)])));
		const reused = Object.fromEntries(backends.map(backend => [backend, factories[backend](options)]));
		const sizes = [];
		for (const { filename, source } of inputs) {
			const row = { file: relative(project, filename), inputBytes: bytes(source) };
			let expected;
			for (const backend of backends) {
				const instrumenter = reused[backend];
				const code = instrumenter.instrumentSync(source, filename);
				const coverage = json(instrumenter.lastFileCoverage());
				assert(coverage && coverage.path === filename, 'Missing coverage: ' + filename);
				if (backend === 'istanbul') expected = coverage;
				else assert.deepStrictEqual(coverage, expected, 'Full coverage metadata mismatch: ' + filename);
				const map = instrumenter.lastSourceMap();
				assert(map && map.version === 3, 'Missing source map: ' + filename);
				const output = code + inlineMap(map);
				row[backend] = { codeBytes: bytes(code), sourceMapJsonBytes: bytes(JSON.stringify(map)), inlineOutputBytes: bytes(output) };
				manifest.outputHashes[backend].push(hash(output));
				const fresh = factories[backend](options);
				assert.equal(fresh.instrumentSync(source, filename), code, 'New/reused code mismatch: ' + filename);
				assert.deepStrictEqual(json(fresh.lastFileCoverage()), expected, 'New instrumenter metadata mismatch: ' + filename);
				assert.deepStrictEqual(json(fresh.lastSourceMap()), json(map), 'New/reused source map mismatch: ' + filename);
			}
			sizes.push(row);
		}
		unchanged(manifest);
		report.correctness = { passed: true, files: files.length, instrumenterModes: ['reused', 'new'] };
		report.sizes = { files: sizes, totals: Object.fromEntries(backends.map(backend => [backend,
			Object.fromEntries(['codeBytes', 'sourceMapJsonBytes', 'inlineOutputBytes'].map(key =>
				[key, sizes.reduce((sum, row) => sum + row[backend][key], 0)]))])) };
		const manifestPath = resolve(directory, 'manifest.json');
		writeFileSync(manifestPath, JSON.stringify(manifest));
		console.log('Metadata parity passed. Running separate cold, warm uncached, and warm disk-cache phases...');
		let sequence = 0;
		function run(mode, backend) {
			unchanged(manifest);
			const start = performance.now();
			const child = spawnSync(process.execPath, [...process.execArgv, ...runtimeFlags, script, '--worker', mode, backend, manifestPath], {
				cwd: project, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
			});
			const wallMs = performance.now() - start;
			writeFileSync(resolve(directory, `${sequence++}-${mode}-${backend}.log`), child.stdout + child.stderr);
			if (child.error) throw child.error;
			assert.equal(child.status, 0, `${mode}/${backend} worker failed (${child.signal}): ${child.stderr}`);
			unchanged(manifest);
			return { ...JSON.parse(child.stdout), wallMs };
		}
		report.timings = Object.fromEntries(backends.map(backend => [backend, {}]));
		const cold = { istanbul: [], estree: [] };
		for (let repeat = 0; repeat < repeats; repeat++)
			for (const backend of repeat % 2 ? [...backends].reverse() : backends)
				cold[backend].push(run('cold', backend));
		for (const backend of backends) {
			report.timings[backend].coldImportAndInstrument = summary(cold[backend].map(sample => sample.importAndInstrumentMs));
			report.timings[backend].coldProcessWall = summary(cold[backend].map(sample => sample.wallMs));
		}
		for (const [index, mode] of ['reused', 'new', 'cache'].entries())
			for (const backend of index % 2 ? [...backends].reverse() : backends)
				report.timings[backend][mode] = run(mode, backend);
		unchanged(manifest);
		report.valid = true;
		console.table(Object.fromEntries(['coldImportAndInstrument', 'coldProcessWall', 'reused', 'new', 'cache'].map(mode => {
			const a = report.timings.istanbul[mode].medianMs;
			const b = report.timings.estree[mode].medianMs;
			return [mode, { 'Istanbul ms/corpus': a.toFixed(2), 'ESTree ms/corpus': b.toFixed(2), 'Istanbul/ESTree': (a / b).toFixed(2) + 'x' }];
		})));
		console.table(report.sizes.totals);
		console.log('Stable source SHA-256: ' + sourceSnapshot.sha256);
	}
	catch (error) {
		report.error = { message: error.message, stack: error.stack };
		if (manifest) report.finalSnapshot = snapshot(manifest.paths);
		console.error('INVALID benchmark: ' + error.message);
		process.exitCode = 1;
	}
	finally {
		report.finishedAt = new Date().toISOString();
		writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n');
		console.log('Result: ' + relative(project, resultPath));
	}
}

if (process.argv[2] === '--worker')
	await worker(...process.argv.slice(3));
else if (process.env.UPLOT_INSTRUMENT_BENCH_BOUNDED !== '1') {
	const child = spawnSync(process.execPath, [...process.execArgv, ...runtimeFlags, script], {
		cwd: project, env: { ...process.env, UPLOT_INSTRUMENT_BENCH_BOUNDED: '1' }, stdio: 'inherit', timeout: 180000,
	});
	if (child.error) throw child.error;
	if (child.signal) console.error('Benchmark terminated by ' + child.signal);
	process.exitCode = child.status ?? 1;
}
else
	await main();
