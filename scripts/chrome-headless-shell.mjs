import { execFile } from 'node:child_process';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, 'node_modules/.cache/uplot-bench');

async function runTool(command, args, options) {
	const pending = exec(command, args, { ...options, killSignal: 'SIGKILL' });
	const closed = new Promise(resolve => pending.child.once('close', resolve));
	try {
		return await pending;
	}
	finally {
		await closed;
	}
}

const stableUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json';
const versionPattern = /^\d+\.\d+\.\d+\.\d+$/;
const directoryPattern = /^chrome-headless-shell-(\d+\.\d+\.\d+\.\d+)-linux64$/;

function requestSignal(signal, ms) {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function executable(binary) {
	try {
		if (!(await stat(binary)).isFile())
			return false;
		await access(binary, constants.X_OK);
		return true;
	}
	catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES')
			return false;
		throw error;
	}
}

function compareVersions(a, b) {
	const left = a.version.split('.').map(BigInt);
	const right = b.version.split('.').map(BigInt);
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i])
			return left[i] > right[i] ? -1 : 1;
	}
	return a.name.localeCompare(b.name);
}

// Keep real filesystem operations; inject only external tools and environment for offline tests.
export function createChromeInstaller({
	cacheDir = cache,
	env = process.env,
	platform = process.platform,
	arch = process.arch,
	fetch: fetchUrl = (...args) => fetch(...args),
	runTool: tool = runTool,
	log = console.log,
} = {}) {
	async function override(signal) {
		signal?.throwIfAborted();
		if (!env.CHROME_BIN)
			return null;
		const binary = resolve(env.CHROME_BIN);
		await access(binary, constants.X_OK);
		signal?.throwIfAborted();
		log(`Using CHROME_BIN: ${binary}`);
		return binary;
	}

	async function directories() {
		let entries;
		try {
			entries = await readdir(cacheDir, { withFileTypes: true });
		}
		catch (error) {
			if (error.code === 'ENOENT')
				return [];
			throw error;
		}
		return entries.flatMap(entry => {
			const match = directoryPattern.exec(entry.name);
			return entry.isDirectory() && match?.[0] === entry.name
				? [{ name: entry.name, version: match[1] }] : [];
		});
	}

	async function cachedChromeBinary({ signal } = {}) {
		const explicit = await override(signal);
		if (explicit)
			return explicit;
		if (platform !== 'linux' || arch !== 'x64')
			return null;
		for (const { name } of (await directories()).sort(compareVersions)) {
			signal?.throwIfAborted();
			const binary = join(cacheDir, name, 'chrome-headless-shell');
			const valid = await executable(binary);
			signal?.throwIfAborted();
			if (valid)
				return binary;
		}
		signal?.throwIfAborted();
		return null;
	}

	async function chromeBinary({ signal } = {}) {
		const explicit = await override(signal);
		if (explicit)
			return explicit;
		if (platform !== 'linux' || arch !== 'x64')
			throw Error('Automatic installation requires Linux x64. Set CHROME_BIN to a compatible Chrome Headless Shell binary.');

		let version;
		try {
			const response = await fetchUrl(stableUrl, { signal: requestSignal(signal, 30000) });
			if (!response.ok)
				throw Error(`HTTP ${response.status}`);
			version = (await response.json())?.channels?.Stable?.version;
			if (typeof version !== 'string' || version.trim() !== version || !versionPattern.test(version))
				throw Error('channels.Stable.version must be a full numeric Chrome version, such as 153.0.8010.52.');
		}
		catch (error) {
			signal?.throwIfAborted();
			throw Error(`Chrome Stable metadata failed (${stableUrl}): ${error.message}`, { cause: error });
		}
		signal?.throwIfAborted();

		const installName = `chrome-headless-shell-${version}-linux64`;
		const installDir = join(cacheDir, installName);
		const binary = join(installDir, 'chrome-headless-shell');
		// The global lock doubles as staging. Only its successful mkdir owner may remove it.
		const staging = join(cacheDir, 'chrome-headless-shell.installing');
		await mkdir(cacheDir, { recursive: true });
		signal?.throwIfAborted();
		try {
			await mkdir(staging);
		}
		catch (error) {
			if (error.code === 'EEXIST')
				throw Error(`Another Chrome installation owns ${staging}. If that process stopped, remove this directory and retry.`);
			throw error;
		}
		try {
			for (const { name } of await directories()) {
				signal?.throwIfAborted();
				if (name !== installName)
					await rm(join(cacheDir, name), { recursive: true, force: true });
			}
			signal?.throwIfAborted();
			if (await executable(binary)) {
				signal?.throwIfAborted();
				log(`Using cached Chrome Headless Shell ${version}`);
				return binary;
			}

			try {
				await tool('unzip', ['-v'], { timeout: 5000, signal });
			}
			catch (error) {
				signal?.throwIfAborted();
				throw Error('Chrome extraction requires unzip. Install unzip or set CHROME_BIN.', { cause: error });
			}
			signal?.throwIfAborted();
			// An interrupted or invalid installation of the current version is not reusable.
			await rm(installDir, { recursive: true, force: true });
			const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/linux64/chrome-headless-shell-linux64.zip`;
			const archive = join(staging, 'chrome.zip');
			log(`Downloading Chrome Headless Shell ${version} from ${url}`);
			const downloadSignal = requestSignal(signal, 180000);
			const response = await fetchUrl(url, { signal: downloadSignal });
			if (!response.ok)
				throw Error(`Chrome download failed: HTTP ${response.status}`);
			await pipeline(Readable.fromWeb(response.body), createWriteStream(archive), { signal: downloadSignal });
			// Keep the runtime resources, but extract only the locale used by the benchmarks.
			await tool('unzip', ['-q', archive, '-d', staging, '-x', '*/locales/*'], { timeout: 60000, signal });
			await tool('unzip', ['-q', archive, 'chrome-headless-shell-linux64/locales/en-US.pak', '-d', staging], { timeout: 60000, signal });
			const extracted = join(staging, 'chrome-headless-shell-linux64');
			if (!await executable(join(extracted, 'chrome-headless-shell')))
				throw Error('Chrome extraction did not produce an executable Chrome Headless Shell.');
			signal?.throwIfAborted();
			await rename(extracted, installDir);
			log(`Cached Chrome Headless Shell in ${installDir}`);
			return binary;
		}
		finally {
			await rm(staging, { recursive: true, force: true });
		}
	}

	return { chromeBinary, cachedChromeBinary };
}

export const { chromeBinary, cachedChromeBinary } = createChromeInstaller();
