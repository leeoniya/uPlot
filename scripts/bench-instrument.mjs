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
const require = createRequire(new URL('./vendor/istanbul/index.mjs', import.meta.url));

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

async function loadInstrumenter() {
	return (await import('./vendor/istanbul/index.mjs')).createInstrumenter;
}

function dependencyPaths() {
	const directories = new Set();
	function visit(name, from) {
		let directory = dirname(from.resolve(name));
		let pkg;
		for (;;) {
			try { pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')); }
			catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
			if (pkg?.name === name) break;
			const parent = dirname(directory);
			assert.notEqual(parent, directory, 'Cannot locate dependency package: ' + name);
			directory = parent;
		}
		if (directories.has(directory)) return;
		directories.add(directory);
		const localRequire = createRequire(resolve(directory, 'package.json'));
		for (const dependency of Object.keys(pkg.dependencies ?? {}))
			visit(dependency, localRequire);
	}
	for (const name of ['meriyah', 'astring', '@jridgewell/gen-mapping', '@jridgewell/remapping', 'istanbul-lib-coverage'])
		visit(name, require);
	return [...directories].flatMap(tree);
}

function corpus(manifest) {
	return manifest.files.map(filename => ({ filename, source: readFileSync(filename, 'utf8') }));
}

function summary(samples, passes = 1) {
	const sorted = samples.map(ms => ms / passes).sort((a, b) => a - b);
	return { medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1), samplesMs: samples, corporaPerSample: passes };
}

async function worker(mode, manifestPath) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	unchanged(manifest);
	const files = corpus(manifest);
	let consumed = 0;
	let result;
	if (mode === 'cold') {
		// Corpus reads and fingerprint checks are excluded here, but included in parent wall time.
		const start = performance.now();
		const create = await loadInstrumenter();
		const instrumenter = create(manifest.options);
		for (const { filename, source } of files)
			consumed += instrumenter.instrumentSync(source, filename).length;
		result = { importAndInstrumentMs: performance.now() - start };
	}
	else if (mode === 'reused' || mode === 'new') {
		const create = await loadInstrumenter();
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
		const cacheDir = resolve(dirname(manifestPath), 'cache');
		mkdirSync(cacheDir);
		const prime = createSourceInstrumenter(manifest.options, cacheDir);
		const start = performance.now();
		const outputs = files.map(({ filename, source }) => prime(source, filename));
		const primeMs = performance.now() - start;
		outputs.forEach((code, index) => assert.equal(hash(code), manifest.outputHashes[index],
			'Cache miss output differs from direct instrumentation: ' + files[index].filename));
		const entries = tree(cacheDir);
		assert.equal(entries.length, files.length, 'Expected one disk entry per corpus file');
		const cacheState = () => entries.map(path => {
			const stat = statSync(path);
			return [path, stat.size, stat.mtimeMs, stat.ctimeMs, hash(readFileSync(path))];
		});
		const before = cacheState();
		// A fresh closure cannot reuse the priming instrumenter instance.
		const cached = createSourceInstrumenter(manifest.options, cacheDir);
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
		instrumenter: 'estree',
		runtime: { name: runtime, execPath: process.execPath, execArgv: process.execArgv, versions: process.versions,
			NODE_OPTIONS: process.env.NODE_OPTIONS ?? null, BUN_OPTIONS: process.env.BUN_OPTIONS ?? null },
		host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
		method: {
			repeats, uncachedCorporaPerBatch: 1, cacheCorporaPerBatch: cachePasses, warmupCorpora: 1,
			cold: 'Fresh runtime per sample; import+instrument excludes corpus reads. Wall time includes startup, reads, fingerprints, and exit. OS page cache is not flushed.',
			warm: 'Separate sequential worker per mode; inputs in memory; no output cache; new means one instrumenter per file. No forced GC.',
			cache: 'Separate worker; prime misses and verify outputs before timing. Fresh closure, disk reads/hash/UTF-8 decode included; warm OS page cache. Prime time is not a median.',
			correctness: 'Reused/new code, complete JSON-round-tripped coverage metadata, and source maps must match. Cache output must match direct output. Internal consistency only, not independent upstream parity, runtime semantics, or source-map accuracy.',
		},
	};
	let manifest;
	try {
		const sourcePaths = [script, ...['package.json', 'package-lock.json', 'bun.lock', 'scripts/instrument-source.mjs',
			'scripts/register-hooks.mjs', 'scripts/coverage-files.mjs'].map(path => resolve(project, path)),
			...tree(resolve(project, 'scripts/vendor/istanbul')), ...dependencyPaths()].sort();
		const sourceSnapshot = snapshot(sourcePaths);
		const config = { ...JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8')).nyc, cwd: project };
		const { coverageFiles } = await import('./coverage-files.mjs');
		const files = coverageFiles(config).files();
		assert.equal(files.length, 30, 'Expected the actual 30-file coverage corpus; do not silently benchmark a different selection');
		const options = { ...config, esModules: true, produceSourceMap: true, compact: true };
		const paths = [...new Set([...sourcePaths, ...files])].sort();
		manifest = { files, options, paths, snapshot: snapshot(paths), outputHashes: [] };
		assert.deepStrictEqual(snapshot(sourcePaths), sourceSnapshot, 'Sources changed while selecting the corpus');
		report.sourceSnapshot = sourceSnapshot;
		report.snapshot = manifest.snapshot;
		report.options = options;

		const inputs = corpus(manifest);
		report.corpus = { files: files.map(path => relative(project, path)), count: files.length,
			bytes: inputs.reduce((sum, file) => sum + bytes(file.source), 0) };
		console.log(`${runtime}: checking ESTree output consistency on ${files.length} files before timings...`);
		const create = await loadInstrumenter();
		const reused = create(options);
		const sizes = [];
		for (const { filename, source } of inputs) {
			const code = reused.instrumentSync(source, filename);
			const coverage = json(reused.lastFileCoverage());
			assert(coverage && coverage.path === filename, 'Missing coverage: ' + filename);
			const map = reused.lastSourceMap();
			assert(map && map.version === 3, 'Missing source map: ' + filename);
			const output = code + inlineMap(map);
			manifest.outputHashes.push(hash(output));
			const fresh = create(options);
			assert.equal(fresh.instrumentSync(source, filename), code, 'New/reused code mismatch: ' + filename);
			assert.deepStrictEqual(json(fresh.lastFileCoverage()), coverage, 'New/reused coverage metadata mismatch: ' + filename);
			assert.deepStrictEqual(json(fresh.lastSourceMap()), json(map), 'New/reused source map mismatch: ' + filename);
			sizes.push({ file: relative(project, filename), inputBytes: bytes(source),
				codeBytes: bytes(code), sourceMapJsonBytes: bytes(JSON.stringify(map)), inlineOutputBytes: bytes(output) });
		}
		unchanged(manifest);
		report.correctness = { passed: true, files: files.length, instrumenterModes: ['reused', 'new'] };
		report.sizes = { files: sizes, totals: Object.fromEntries(['codeBytes', 'sourceMapJsonBytes', 'inlineOutputBytes'].map(key =>
			[key, sizes.reduce((sum, row) => sum + row[key], 0)])) };
		const manifestPath = resolve(directory, 'manifest.json');
		writeFileSync(manifestPath, JSON.stringify(manifest));
		console.log('Output consistency passed. Running sequential cold, warm uncached, and warm disk-cache phases...');
		let sequence = 0;
		function run(mode) {
			unchanged(manifest);
			const start = performance.now();
			const child = spawnSync(process.execPath, [...process.execArgv, ...runtimeFlags, script, '--worker', mode, manifestPath], {
				cwd: project, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
			});
			const wallMs = performance.now() - start;
			writeFileSync(resolve(directory, `${sequence++}-${mode}.log`), child.stdout + child.stderr);
			if (child.error) throw child.error;
			assert.equal(child.status, 0, `${mode} worker failed (${child.signal}): ${child.stderr}`);
			unchanged(manifest);
			return { ...JSON.parse(child.stdout), wallMs };
		}
		const cold = [];
		for (let repeat = 0; repeat < repeats; repeat++)
			cold.push(run('cold'));
		report.timings = {
			coldImportAndInstrument: summary(cold.map(sample => sample.importAndInstrumentMs)),
			coldProcessWall: summary(cold.map(sample => sample.wallMs)),
		};
		for (const mode of ['reused', 'new', 'cache'])
			report.timings[mode] = run(mode);
		report.correctness.cachePassed = true;
		unchanged(manifest);
		report.valid = true;
		console.table(Object.fromEntries(Object.entries(report.timings).map(([mode, timing]) =>
			[mode, { 'ESTree ms/corpus': timing.medianMs.toFixed(2) }])));
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
