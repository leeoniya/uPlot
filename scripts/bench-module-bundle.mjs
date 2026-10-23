import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {rolldown, VERSION} from 'rolldown';

const digest = source => createHash('sha256').update(source).digest('hex');
const schema = 3;

async function atomicWrite(path, source) {
	const temp = path + '.' + randomUUID() + '.tmp';
	try {
		await writeFile(temp, source);
		await rename(temp, path);
	}
	finally { await rm(temp, {force: true}); }
}
async function cachedJSON(path) {
	try { return JSON.parse(await readFile(path, 'utf8')); }
	catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
}

function remoteUrl(value, importer) {
	let url;
	if (value.startsWith('https://') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../'))
		url = new URL(value, importer || 'https://esm.sh/');
	else
		throw new Error(`Unresolved bare module ${value} from ${importer || 'entry'}`);
	if (url.origin !== 'https://esm.sh' || url.username || url.password || url.hash)
		throw new Error(`Unsupported remote module URL: ${url.href}`);
	return url.href;
}

// Bundle the WHOLE variant, not individual dependencies: otherwise React and its
// hooks/context are duplicated. Export names are the manifest's `global` values.
// Run before serving the benchmark. Browsers import only the resulting local ESM.
export async function bundleModuleDependencies(dependencies, {cacheDir, fetchImpl = fetch, signal} = {}) {
	if (!cacheDir) throw new Error('cacheDir is required for module dependency delivery.');
	if (!dependencies.length) throw new Error('At least one module dependency is required.');
	const names = new Set();
	for (const dependency of dependencies) {
		if (dependency.type !== 'module' || !/^[A-Za-z_$][\w$]*$/.test(dependency.global || '') || names.has(dependency.global))
			throw new Error('Module dependencies need unique JavaScript identifiers in global.');
		names.add(dependency.global);
		const url = remoteUrl(dependency.url);
		if (!/^\/(?:@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+(?:\/|\?|$)/.test(new URL(url).pathname))
			throw new Error(`Module entry must have an exact stable package pin: ${url}`);
		if (new URL(url).searchParams.has('dev')) throw new Error('Development modules are not benchmark dependencies.');
	}
	await mkdir(cacheDir, {recursive: true});
	const key = digest(JSON.stringify({schema, rolldown: VERSION, dependencies}));
	const cacheName = `modules-${key}.mjs`;
	const path = join(cacheDir, cacheName);
	const metaPath = path + '.json';
	const cached = await cachedJSON(metaPath);
	if (cached) {
		const code = await readFile(path, 'utf8');
		if (digest(code) !== cached.sha256) throw new Error(`Module bundle cache checksum mismatch: ${path}`);
		return {...cached, code, path, cacheName};
	}

	const sources = new Map();
	const pending = new Map();
	async function load(url) {
		if (!pending.has(url)) pending.set(url, (async () => {
			const sourcePath = join(cacheDir, `source-${digest(url)}.json`);
			let record = await cachedJSON(sourcePath);
			if (record) {
				if (record.url !== url || digest(record.code) !== record.sha256)
					throw new Error(`Module source cache checksum mismatch: ${url}`);
			}
			else {
				const timeout = AbortSignal.timeout(30000);
				const response = await fetchImpl(url, {signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error'});
				if (!response.ok) throw new Error(`Module download failed: ${url}: HTTP ${response.status}`);
				const code = await response.text();
				record = {url, code, sha256: digest(code)};
				await atomicWrite(sourcePath, JSON.stringify(record));
			}
			sources.set(url, {url, sha256: record.sha256, bytes: Buffer.byteLength(record.code)});
			return record.code;
		})());
		return pending.get(url);
	}
	const entry = '\0benchmark-module-entry';
	const entrySource = dependencies.map(dep => `export * as ${dep.global} from ${JSON.stringify(dep.url)};`).join('\n');
	let build;
	try {
		build = await rolldown({
			input: entry, platform: 'browser',
			transform: {define: {'process.env.NODE_ENV': '"production"'}},
			onwarn(warning) {
				// Network-backed hooks dominate cold builds. Every entry is client-only.
				if (warning.code === 'PLUGIN_TIMINGS' ||
					(warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"'))) return;
				throw new Error(warning.message);
			},
			plugins: [{
				name: 'benchmark-pinned-remote-modules',
				resolveId(source, importer) {
					return source === entry ? entry : remoteUrl(source, importer === entry ? undefined : importer);
				},
				load(id) { return id === entry ? entrySource : load(id); },
			}],
		});
		const {output} = await build.generate({format: 'esm', minify: true, sourcemap: false, codeSplitting: false});
		// Rolldown lists the chunk itself for an inlined dynamic import.
		if (output.length !== 1 || output[0].type !== 'chunk' || output[0].imports.length ||
			output[0].dynamicImports.some(name => name !== output[0].fileName))
			throw new Error('Module dependency bundle is not a self-contained ESM chunk.');
		const code = output[0].code;
		// Fail closed on non-literal imports that a bundler cannot resolve.
		if (/\bimport\s*\(/.test(code)) throw new Error('Unresolved runtime import in module dependency bundle.');
		const metadata = {schema, rolldown: VERSION, sha256: digest(code), bytes: Buffer.byteLength(code),
			globals: [...names], dependencies, sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url))};
		await atomicWrite(path, code);
		await atomicWrite(metaPath, JSON.stringify(metadata, null, 2) + '\n');
		return {...metadata, code, path, cacheName};
	}
	finally { await build?.close(); }
}
