import { execFile } from 'node:child_process';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
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

export async function chromeBinary({ version, signal }) {
	if (typeof version !== 'string' || version.trim() !== version || !/^\d+\.\d+\.\d+\.\d+$/.test(version))
		throw Error('Chrome version must be a full pinned version, such as 153.0.8010.52.');
	signal?.throwIfAborted();

	if (process.env.CHROME_BIN) {
		const binary = resolve(process.env.CHROME_BIN);
		await access(binary, constants.X_OK);
		console.log(`Using CHROME_BIN: ${binary}`);
		return binary;
	}

	if (process.platform !== 'linux' || process.arch !== 'x64')
		throw Error('Automatic installation requires Linux x64. Set CHROME_BIN to a compatible Chrome Headless Shell binary.');

	const installDir = join(cache, `chrome-headless-shell-${version}-linux64`);
	const binary = join(installDir, 'chrome-headless-shell');
	try {
		await access(binary, constants.X_OK);
		console.log(`Using cached Chrome Headless Shell ${version}`);
		return binary;
	}
	catch (error) {
		if (error.code !== 'ENOENT')
			throw error;
	}

	try {
		await runTool('unzip', ['-v'], { timeout: 5000, signal });
	}
	catch (error) {
		throw Error('Chrome extraction requires unzip. Install unzip or set CHROME_BIN.', { cause: error });
	}

	await mkdir(cache, { recursive: true });
	const staging = installDir + '.installing';
	try {
		await mkdir(staging);
	}
	catch (error) {
		if (error.code === 'EEXIST')
			throw Error(`Another Chrome installation owns ${staging}. If that process stopped, remove this directory and retry.`);
		throw error;
	}
	try {
		const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/linux64/chrome-headless-shell-linux64.zip`;
		const archive = join(staging, 'chrome.zip');
		console.log(`Downloading Chrome Headless Shell ${version} from ${url}`);
		const timeout = AbortSignal.timeout(180000);
		const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
		if (!response.ok)
			throw Error(`Chrome download failed: HTTP ${response.status}`);
		await pipeline(Readable.fromWeb(response.body), createWriteStream(archive), { signal });
		// Keep the runtime resources, but extract only the locale used by the benchmarks.
		await runTool('unzip', ['-q', archive, '-d', staging, '-x', '*/locales/*'], { timeout: 60000, signal });
		await runTool('unzip', ['-q', archive, 'chrome-headless-shell-linux64/locales/en-US.pak', '-d', staging], { timeout: 60000, signal });
		await access(join(staging, 'chrome-headless-shell-linux64/chrome-headless-shell'), constants.X_OK);
		await rename(join(staging, 'chrome-headless-shell-linux64'), installDir);
		console.log(`Cached Chrome Headless Shell in ${installDir}`);
		return binary;
	}
	finally {
		await rm(staging, { recursive: true, force: true });
	}
}
