import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, 'node_modules/.cache/uplot-bench');
// Pin the browser so repeat runs do not silently change the benchmark engine.
const chromeVersion = '153.0.8010.52';
const installDir = join(cache, `chrome-headless-shell-${chromeVersion}-linux64`);
const controller = new AbortController();
const { signal } = controller;

async function runTool(command, args, options) {
	const pending = exec(command, args, { ...options, signal, killSignal: 'SIGKILL' });
	const closed = new Promise(resolve => pending.child.once('close', resolve));
	try {
		return await pending;
	}
	finally {
		await closed;
	}
}

async function chromeBinary() {
	if (process.env.CHROME_BIN) {
		const binary = resolve(process.env.CHROME_BIN);
		await access(binary, constants.X_OK);
		console.log(`Using CHROME_BIN: ${binary}`);
		return binary;
	}

	if (process.platform !== 'linux' || process.arch !== 'x64')
		throw Error('Automatic installation requires Linux x64. Set CHROME_BIN to a compatible Chrome Headless Shell binary.');

	const binary = join(installDir, 'chrome-headless-shell');
	try {
		await access(binary, constants.X_OK);
		console.log(`Using cached Chrome Headless Shell ${chromeVersion}`);
		return binary;
	}
	catch (error) {
		if (error.code !== 'ENOENT')
			throw error;
	}

	try {
		await runTool('unzip', ['-v'], { timeout: 5000 });
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
		const url = `https://storage.googleapis.com/chrome-for-testing-public/${chromeVersion}/linux64/chrome-headless-shell-linux64.zip`;
		const archive = join(staging, 'chrome.zip');
		console.log(`Downloading Chrome Headless Shell ${chromeVersion} from ${url}`);
		const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
		if (!response.ok)
			throw Error(`Chrome download failed: HTTP ${response.status}`);
		await pipeline(Readable.fromWeb(response.body), createWriteStream(archive), { signal });
		// Keep the runtime resources, but extract only the locale used by this benchmark.
		await runTool('unzip', ['-q', archive, '-d', staging, '-x', '*/locales/*'], { timeout: 60000 });
		await runTool('unzip', ['-q', archive, 'chrome-headless-shell-linux64/locales/en-US.pak', '-d', staging], { timeout: 60000 });
		await access(join(staging, 'chrome-headless-shell-linux64/chrome-headless-shell'), constants.X_OK);
		await rename(join(staging, 'chrome-headless-shell-linux64'), installDir);
		console.log(`Cached Chrome Headless Shell in ${installDir}`);
		return binary;
	}
	finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function benchmark(binary, options, outputPath) {
	await mkdir(cache, { recursive: true });
	const runtime = await mkdtemp(join(cache, 'run-'));
	let browser, browserClosed, server, watchdog, logs = '';
	let finish, fail;
	const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
	// An early abort can precede the await below.
	completed.catch(() => {});
	const abort = () => fail(signal.reason);
	signal.addEventListener('abort', abort, { once: true });
	const started = Date.now();
	try {
		signal.throwIfAborted();
		const modules = options.renderer === 'dom'
			? ['src/legend-dom.js', 'src/legend-dom-template.js', 'src/keyed-list.js', 'src/h.js', 'src/utils.js', 'src/dom.js', 'src/domClasses.js', 'src/strings.js']
			: ['src/legend-ivi.js'];
		const files = new Map();
		const moduleSha256 = {};
		const hash = createHash('sha256');
		for (const path of modules) {
			const source = await readFile(join(root, path));
			files.set('/' + path, source);
			moduleSha256[path] = createHash('sha256').update(source).digest('hex');
			hash.update(source);
		}
		files.set('/bench-legend-browser.js', await readFile(join(root, 'scripts/bench-legend-browser.js')));
		server = createServer(async (req, res) => {
			try {
				res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
				res.setHeader('Cache-Control', 'no-store');
				if (req.method === 'GET' && req.url === '/') {
					res.setHeader('Content-Type', 'text/html');
					res.end('<!doctype html><meta charset="utf-8"><title>Legend benchmark</title><script type="module">' +
						'import("/bench-legend-browser.js").then(m => m.run(' + JSON.stringify(options) + '))' +
						'.then(value => ({ value }), error => ({ error: error.stack ?? String(error) }))' +
						'.then(result => fetch("/bench-result", { method: "POST", body: JSON.stringify(result) }));</script>');
				}
				else if (req.method === 'POST' && (req.url === '/bench-result' || req.url === '/bench-progress')) {
					let body = '';
					for await (const chunk of req) {
						body += chunk;
						if (body.length > 1024 * 1024)
							throw Error('Benchmark response exceeded 1 MiB.');
					}
					res.end('ok');
					if (req.url === '/bench-result')
						finish(JSON.parse(body));
					else
						console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${body}`);
				}
				else if (req.method === 'GET' && files.has(req.url)) {
					res.setHeader('Content-Type', 'text/javascript');
					res.end(files.get(req.url));
				}
				else
					res.writeHead(404).end();
			}
			catch (error) {
				res.destroy();
				fail(error);
			}
		});
		server.requestTimeout = 5000;
		server.headersTimeout = 5000;
		server.on('error', fail);
		watchdog = setTimeout(() => fail(Error('Benchmark exceeded the 120-second limit.')), 120000);
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		signal.throwIfAborted();
		for (const name of ['home', 'cache', 'profile'])
			await mkdir(join(runtime, name));
		browser = spawn(binary, [
			'--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
			'--disable-component-update', '--disable-sync', '--metrics-recording-only', '--disable-extensions',
			'--renderer-process-limit=1', '--js-flags=--max-old-space-size=128', '--enable-precise-memory-info',
			'--lang=en-US', '--user-data-dir=' + join(runtime, 'profile'),
			'http://127.0.0.1:' + server.address().port + '/',
		], {
			detached: true, stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, HOME: join(runtime, 'home'), XDG_CACHE_HOME: join(runtime, 'cache') },
		});
		browserClosed = new Promise(resolve => browser.once('close', resolve));
		browser.on('error', fail);
		browser.on('exit', (code, signal) => fail(Error(`Chrome exited: ${code ?? signal}`)));
		for (const stream of [browser.stdout, browser.stderr])
			stream.on('data', data => { logs = (logs + data).slice(-4000); });
		const result = await completed;
		if (result.error)
			throw Error(result.error);
		const output = result.value;
		output.wallMs = Date.now() - started;
		output.sourceSha256 = hash.digest('hex');
		output.moduleSha256 = moduleSha256;
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
		console.log(output.environment);
		console.log(`Saved ${outputPath}`);
	}
	catch (error) {
		if (logs)
			console.error(logs);
		throw error;
	}
	finally {
		clearTimeout(watchdog);
		signal.removeEventListener('abort', abort);
		if (browser?.pid) {
			try { process.kill(-browser.pid, 'SIGKILL'); }
			catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
		}
		if (browserClosed) {
			let timer;
			await Promise.race([browserClosed, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
			clearTimeout(timer);
		}
		server?.closeAllConnections();
		server?.close();
		await rm(runtime, { recursive: true, force: true });
	}
}

async function main() {
	const { values } = parseArgs({ options: {
		renderer: { type: 'string', default: 'ivi' },
		series: { type: 'string', default: '300' },
		iterations: { type: 'string', default: '300' },
		output: { type: 'string' },
		'install-only': { type: 'boolean' },
		help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) {
		console.log(`Usage: bun run bench:legend [--renderer ivi|dom] [--series N] [--iterations N] [--output FILE] [--install-only]

Defaults: ivi, 300 Y series plus X, 300 iterations per workload.
Use --renderer dom for the internal reconciler prototype.
Reports the average of the fastest five calls. Excludes layout and paint.
Limits each run to 120 seconds.

The first run downloads Chrome Headless Shell ${chromeVersion} from Google.
Later runs reuse node_modules/.cache/uplot-bench. No automation package is needed.
Automatic installation requires Linux x64 and unzip. Only the English locale is retained.
Set CHROME_BIN to use an existing binary without a download.
Use --install-only to prepare the browser without a benchmark.
The default JSON output is in the cache directory. Use --output to keep a comparison.`);
		return;
	}
	const options = { renderer: values.renderer, series: Number(values.series), iterations: Number(values.iterations) };
	if (!['ivi', 'dom'].includes(options.renderer))
		throw Error('--renderer must be ivi or dom.');
	if (!Number.isInteger(options.series) || options.series < 1 || options.series > 1000)
		throw Error('--series must be an integer from 1 to 1000.');
	if (!Number.isInteger(options.iterations) || options.iterations < 5 || options.iterations > 1000)
		throw Error('--iterations must be an integer from 5 to 1000.');
	if (process.platform !== 'linux' && process.platform !== 'darwin')
		throw Error('The benchmark runner requires Linux or macOS.');
	const binary = await chromeBinary();
	if (values['install-only'])
		return;
	if (options.renderer === 'ivi') {
		const build = await runTool(process.execPath, ['--max-old-space-size=96', join(root, 'scripts/build-legend.mjs')], {
			cwd: root, timeout: 30000,
		});
		process.stdout.write(build.stdout);
	}
	const output = values.output ? resolve(values.output) : join(cache, `legend-${options.renderer}-n${options.series}-i${options.iterations}.json`);
	console.log(`${options.renderer}: ${options.series} Y series + X, ${options.iterations} iterations, average of fastest five (microseconds)`);
	await benchmark(binary, options, output);
}

const interrupt = () => {
	process.exitCode = 130;
	controller.abort(Error('Benchmark interrupted.'));
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
	await main();
}
catch (error) {
	console.error(error.message);
	process.exitCode ||= 1;
}
finally {
	process.removeListener('SIGINT', interrupt);
	process.removeListener('SIGTERM', interrupt);
}
