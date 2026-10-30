import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createChromeInstaller, chromeBinary, cachedChromeBinary } from '../../scripts/chrome-headless-shell.mjs';

const stableUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json';
const stable = '156.0.8078.47';
const directory = version => `chrome-headless-shell-${version}-linux64`;
const metadata = version => ({ channels: { Stable: { version } } });
const missing = path => assert.rejects(stat(path), { code: 'ENOENT' });

async function fixture(t, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'uplot-chrome-test-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const cacheDir = join(root, 'cache');
	const lock = join(cacheDir, 'chrome-headless-shell.installing');
	const f = {
		root, cacheDir, lock, env: {}, requests: [], tools: [], version: stable,
		async install(version, mode = 0o755) {
			const dir = join(cacheDir, directory(version));
			await mkdir(dir, { recursive: true });
			const binary = join(dir, 'chrome-headless-shell');
			await writeFile(binary, 'fixture, not a real browser');
			await chmod(binary, mode);
			return binary;
		},
		async fetch(url, { signal }) {
			assert.ok(signal);
			signal.throwIfAborted();
			f.requests.push(url);
			if (url === stableUrl)
				return f.onMetadata ? f.onMetadata(signal) : Response.json(metadata(f.version));
			assert.equal(url, `https://storage.googleapis.com/chrome-for-testing-public/${f.version}/linux64/chrome-headless-shell-linux64.zip`);
			assert.ok((await stat(lock)).isDirectory(), 'download must hold the global lock');
			return f.onDownload ? f.onDownload(signal) : new Response('mock zip');
		},
		async runTool(command, args, options) {
			f.tools.push({ command, args, options });
			assert.equal(command, 'unzip');
			options.signal?.throwIfAborted();
			if (f.onTool)
				await f.onTool(args, options);
			if (args[0] === '-v')
				return;
			assert.equal(await readFile(join(lock, 'chrome.zip'), 'utf8'), 'mock zip');
			const extracted = join(lock, 'chrome-headless-shell-linux64');
			if (args.includes('-x')) {
				await mkdir(extracted);
				await writeFile(join(extracted, 'chrome-headless-shell'), 'extracted fixture');
				await chmod(join(extracted, 'chrome-headless-shell'), 0o755);
			}
			else {
				await mkdir(join(extracted, 'locales'));
				await writeFile(join(extracted, 'locales/en-US.pak'), 'locale fixture');
			}
		},
	};
	Object.assign(f, createChromeInstaller({
		cacheDir, env: f.env, platform: 'linux', arch: 'x64',
		fetch: (...args) => f.fetch(...args), runTool: (...args) => f.runTool(...args),
		log() {}, ...options,
	}));
	return f;
}

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

describe('Chrome Headless Shell Stable installer', () => {
	it('exports the default installer and cache-only API', () => {
		assert.equal(typeof chromeBinary, 'function');
		assert.equal(typeof cachedChromeBinary, 'function');
	});

	it('looks up Stable, uses trusted storage, and preserves the English-only locale extraction', async t => {
		const f = await fixture(t);
		const binary = await f.chromeBinary();
		assert.equal(binary, join(f.cacheDir, directory(stable), 'chrome-headless-shell'));
		assert.equal(await readFile(binary, 'utf8'), 'extracted fixture');
		assert.equal(f.requests[0], stableUrl);
		assert.equal(f.requests.length, 2);
		assert.deepEqual(f.tools.map(call => call.args), [
			['-v'],
			['-q', join(f.lock, 'chrome.zip'), '-d', f.lock, '-x', '*/locales/*'],
			['-q', join(f.lock, 'chrome.zip'), 'chrome-headless-shell-linux64/locales/en-US.pak', '-d', f.lock],
		]);
		assert.deepEqual(await readdir(join(f.cacheDir, directory(stable), 'locales')), ['en-US.pak']);
		await missing(f.lock);
	});

	it('fetches metadata on every call, reuses Stable, and cleans obsolete directories even on reuse', async t => {
		const f = await fixture(t);
		const binary = await f.install(stable);
		for (const version of ['155.0.1.2', '999.0.1.2']) {
			await f.install(version);
			assert.equal(await f.chromeBinary(), binary);
			await missing(join(f.cacheDir, directory(version)));
			await missing(f.lock);
		}
		assert.deepEqual(f.requests, [stableUrl, stableUrl]);
		assert.deepEqual(f.tools, []);
		assert.equal(await readFile(binary, 'utf8'), 'fixture, not a real browser');
	});

	it('removes a different Stable before downloading, while preserving unrelated entries and symlinks', async t => {
		const f = await fixture(t);
		await f.chromeBinary();
		f.version = '157.1.2.3';
		await writeFile(join(f.cacheDir, 'results.json'), 'keep');
		await writeFile(join(f.cacheDir, directory('1.0.0.0')), 'not a directory');
		for (const name of ['chrome-headless-shell-not-a-version-linux64', 'chrome-headless-shell-2.0.0.0-linux64.installing', 'other'])
			await mkdir(join(f.cacheDir, name));
		const outside = join(f.root, 'outside');
		await mkdir(outside);
		await writeFile(join(outside, 'keep'), 'keep');
		await symlink(outside, join(f.cacheDir, directory('3.0.0.0')));
		const preserved = (await readdir(f.cacheDir)).filter(name => name !== directory(stable));
		f.onDownload = async () => {
			await missing(join(f.cacheDir, directory(stable)));
			return new Response('mock zip');
		};
		await f.chromeBinary();
		assert.deepEqual((await readdir(f.cacheDir)).sort(), [...preserved, directory(f.version)].sort());
		assert.equal(await readFile(join(f.cacheDir, 'results.json'), 'utf8'), 'keep');
		assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'keep');
	});

	it('replaces an incomplete current-version installation', async t => {
		const f = await fixture(t);
		const binary = await f.install(stable, 0o644);
		await writeFile(join(f.cacheDir, directory(stable), 'partial'), 'partial');
		assert.equal(await f.chromeBinary(), binary);
		assert.equal(await readFile(binary, 'utf8'), 'extracted fixture');
		await missing(join(f.cacheDir, directory(stable), 'partial'));
		await missing(f.lock);
	});

	for (const [name, response, message] of [
		['HTTP failure', () => new Response('', { status: 503 }), /HTTP 503/],
		['network failure', () => { throw Error('offline'); }, /offline/],
		['invalid JSON', () => new Response('{'), /metadata failed/],
		['missing Stable', () => Response.json({ channels: { Beta: { version: stable } } }), /channels.Stable.version/],
		...['156', '1.2.3', '1.2.3.4.5', '../1.2.3.4', '1.2.3.4\n', ' 1.2.3.4', '1.2.3.x', 123, null].map(version =>
			[`invalid version ${JSON.stringify(version)}`, () => Response.json(metadata(version)), /full numeric Chrome version/]),
	]) {
		it(`fails clearly on ${name}, without stale fallback or cache changes`, async t => {
			const f = await fixture(t);
			const binary = await f.install(stable);
			f.onMetadata = response;
			await assert.rejects(f.chromeBinary(), error => {
				assert.match(error.message, /Chrome Stable metadata failed/);
				assert.match(error.message, message);
				assert.ok(error.cause);
				return true;
			});
			assert.equal(await readFile(binary, 'utf8'), 'fixture, not a real browser');
			assert.deepEqual(await readdir(f.cacheDir), [directory(stable)]);
			assert.deepEqual(f.requests, [stableUrl]);
			assert.deepEqual(f.tools, []);
		});
	}

	for (const phase of ['unzip check', 'download', 'stream', 'extraction', 'locale', 'missing executable']) {
		it(`cleans its staging/lock after ${phase} failure`, async t => {
			const f = await fixture(t);
			if (phase === 'download')
				f.onDownload = () => new Response('', { status: 502 });
			else if (phase === 'stream')
				f.onDownload = () => new Response(new ReadableStream({ start(controller) { controller.error(Error('broken stream')); } }));
			else {
				f.onTool = async args => {
					if ((phase === 'unzip check' && args[0] === '-v') ||
						(phase === 'extraction' && args.includes('-x')) ||
						(phase === 'locale' && args.includes('chrome-headless-shell-linux64/locales/en-US.pak')))
						throw Error('tool failed');
					if (phase === 'missing executable' && args.includes('chrome-headless-shell-linux64/locales/en-US.pak'))
						await rm(join(f.lock, 'chrome-headless-shell-linux64/chrome-headless-shell'));
				};
			}
			await assert.rejects(f.chromeBinary(), /requires unzip|HTTP 502|broken stream|tool failed|did not produce an executable/);
			await missing(f.lock);
			await missing(join(f.cacheDir, directory(stable)));
			f.onDownload = f.onTool = null;
			await f.chromeBinary();
			await missing(f.lock);
		});
	}

	it('does not restore obsolete versions after a failed replacement, but preserves unrelated files', async t => {
		const f = await fixture(t);
		await f.install('155.0.0.1');
		await writeFile(join(f.cacheDir, 'results.json'), 'keep');
		f.onDownload = () => new Response('', { status: 503 });
		await assert.rejects(f.chromeBinary(), /Chrome download failed: HTTP 503/);
		assert.deepEqual(await readdir(f.cacheDir), ['results.json']);
		assert.equal(await f.cachedChromeBinary(), null);
		assert.equal(await readFile(join(f.cacheDir, 'results.json'), 'utf8'), 'keep');
	});

	it('does not publish an installation when extraction finishes after cancellation', async t => {
		const f = await fixture(t);
		const controller = new AbortController();
		const reason = Error('cancelled before publication');
		f.onTool = async args => {
			if (args.includes('chrome-headless-shell-linux64/locales/en-US.pak'))
				controller.abort(reason);
		};
		await assert.rejects(f.chromeBinary({ signal: controller.signal }), error => error === reason);
		await missing(f.lock);
		await missing(join(f.cacheDir, directory(stable)));
	});

	it('rejects pre-aborted calls without accessing tools, network, or cache', async t => {
		const f = await fixture(t);
		const reason = Error('cancelled');
		const signal = AbortSignal.abort(reason);
		for (const run of [f.chromeBinary, f.cachedChromeBinary])
			await assert.rejects(run({ signal }), error => error === reason);
		assert.deepEqual(f.requests, []);
		assert.deepEqual(f.tools, []);
		await missing(f.cacheDir);
	});

	for (const phase of ['metadata', 'download', 'stream', 'unzip check', 'extraction', 'locale']) {
		it(`honors abort during ${phase} and cleans only its own staging`, { timeout: 3000 }, async t => {
			const f = await fixture(t);
			const controller = new AbortController();
			const reason = Error('cancelled');
			const abortFetch = signal => new Promise((resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				controller.abort(reason);
			});
			if (phase === 'metadata')
				f.onMetadata = abortFetch;
			else if (phase === 'download')
				f.onDownload = abortFetch;
			else if (phase === 'stream')
				f.onDownload = () => new Response(new ReadableStream({ pull() { controller.abort(reason); } }));
			else {
				f.onTool = async (args, { signal }) => {
					assert.equal(signal, controller.signal);
					if ((phase === 'unzip check' && args[0] === '-v') ||
						(phase === 'extraction' && args.includes('-x')) ||
						(phase === 'locale' && args.includes('chrome-headless-shell-linux64/locales/en-US.pak'))) {
						controller.abort(reason);
						signal.throwIfAborted();
					}
				};
			}
			await assert.rejects(f.chromeBinary({ signal: controller.signal }), error => error === reason || error.name === 'AbortError');
			await missing(f.lock);
			await missing(join(f.cacheDir, directory(stable)));
		});
	}

	it('never removes an existing lock or cache entries when lock acquisition fails', async t => {
		const f = await fixture(t);
		await f.install('155.0.0.1');
		await mkdir(f.lock);
		await writeFile(join(f.lock, 'owner'), 'another process');
		await assert.rejects(f.chromeBinary(), /Another Chrome installation owns/);
		assert.equal(await readFile(join(f.lock, 'owner'), 'utf8'), 'another process');
		assert.deepEqual((await readdir(f.cacheDir)).sort(), [directory('155.0.0.1'), 'chrome-headless-shell.installing'].sort());
		assert.deepEqual(f.tools, []);
		assert.deepEqual(f.requests, [stableUrl]);
	});

	it('uses one lock across different versions and does not steal it from an active installer', { timeout: 3000 }, async t => {
		const f = await fixture(t);
		const started = deferred();
		const release = deferred();
		f.onDownload = async () => {
			started.resolve();
			await release.promise;
			return new Response('mock zip');
		};
		const first = f.chromeBinary();
		try {
			await started.promise;
			f.version = '157.0.0.1';
			await assert.rejects(f.chromeBinary(), /Another Chrome installation owns/);
			assert.ok((await stat(f.lock)).isDirectory());
			assert.equal(f.requests.length, 3, 'second installer must not download');
		}
		finally {
			release.resolve();
			await first;
		}
		assert.ok((await stat(join(f.cacheDir, directory(stable), 'chrome-headless-shell'))).isFile());
		await missing(f.lock);
	});
});

describe('Chrome Headless Shell override and cache-only lookup', () => {
	it('honors CHROME_BIN for both APIs, even on unsupported platforms, without cache or network access', async t => {
		const f = await fixture(t, { platform: 'darwin', arch: 'arm64' });
		const binary = join(f.root, 'custom-chrome');
		await writeFile(binary, 'override');
		await chmod(binary, 0o755);
		f.env.CHROME_BIN = relative(process.cwd(), binary);
		for (const run of [f.chromeBinary, f.cachedChromeBinary])
			assert.equal(await run(), binary);
		assert.deepEqual(f.requests, []);
		assert.deepEqual(f.tools, []);
		await missing(f.cacheDir);
		await rm(binary);
		for (const run of [f.chromeBinary, f.cachedChromeBinary])
			await assert.rejects(run(), { code: 'ENOENT' });
		assert.deepEqual(f.requests, []);
		await missing(f.cacheDir);
	});

	it('rejects unsupported automatic installation and returns a cache miss without creating a cache', async t => {
		for (const options of [{ platform: 'darwin' }, { arch: 'arm64' }]) {
			const f = await fixture(t, options);
			await assert.rejects(f.chromeBinary(), /requires Linux x64/);
			assert.equal(await f.cachedChromeBinary(), null);
			assert.deepEqual(f.requests, []);
			await missing(f.cacheDir);
		}
	});

	it('returns null for a missing cache without creating it', async t => {
		const f = await fixture(t);
		assert.equal(await f.cachedChromeBinary(), null);
		await missing(f.cacheDir);
		assert.deepEqual(f.requests, []);
		assert.deepEqual(f.tools, []);
	});

	it('selects the latest executable numerically across all four components without cleanup or locking', async t => {
		const f = await fixture(t);
		const versions = ['99.100.100.100', '100.9.100.100', '100.10.9.100', '100.10.10.9', '100.10.10.10'];
		const binaries = [];
		for (const version of versions)
			binaries.push(await f.install(version));
		await f.install('101.0.0.0', 0o644);
		await mkdir(join(f.cacheDir, directory('102.0.0.0')));
		await mkdir(join(f.cacheDir, directory('103.0.0.0'), 'chrome-headless-shell'), { recursive: true });
		await f.install('999.0.0.0-extra');
		await f.install('999.0.0.0\n');
		await mkdir(f.lock);
		await writeFile(join(f.lock, 'owner'), 'do not touch');
		for (const binary of binaries.reverse()) {
			const before = await readdir(f.cacheDir);
			assert.equal(await f.cachedChromeBinary(), binary);
			assert.deepEqual(await readdir(f.cacheDir), before);
			await rm(binary);
		}
		assert.equal(await f.cachedChromeBinary(), null);
		assert.equal(await readFile(join(f.lock, 'owner'), 'utf8'), 'do not touch');
		assert.deepEqual(f.requests, []);
		assert.deepEqual(f.tools, []);
	});
});
