import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/demos.mjs', import.meta.url));

async function load(url, method = 'GET') {
	const response = await new Promise((resolve, reject) => {
		request(url, { method }, resolve).on('error', reject).end();
	});
	const chunks = [];
	for await (const chunk of response)
		chunks.push(chunk);
	return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) };
}

describe('demos HTTP server', function() {
	this.timeout(10000);
	let child, origin;

	before(async () => {
		child = spawn(process.execPath, [script], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
		origin = await new Promise((resolve, reject) => {
			let output = '';
			const timer = setTimeout(() => reject(new Error('Demo server did not start: ' + output)), 5000);
			const finish = (error, url) => { clearTimeout(timer); error ? reject(error) : resolve(url); };
			child.on('error', error => finish(error));
			child.on('exit', code => finish(new Error(`Demo server exited (${code}): ${output}`)));
			child.stderr.on('data', chunk => { output += chunk; });
			child.stdout.on('data', chunk => {
				output += chunk;
				const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
				if (match) finish(null, match[0]);
			});
		});
	});

	after(async () => {
		if (child?.exitCode == null && child?.pid) {
			const exited = once(child, 'exit');
			child.kill();
			await exited;
		}
	});

	it('redirects the root and bare demos directory to the index directory', async () => {
		for (const path of ['/', '/demos']) {
			const response = await load(origin + path);
			assert.equal(response.status, 302);
			assert.equal(response.headers.location, '/demos/');
		}
		assert.match((await load(origin + '/demos/')).body.toString(), /μPlot Demos/);
	});

	for (const [path, type] of [
		['/demos/axis-range-aligned.html', 'text/html'],
		['/demos/axis-range-aligned.js', 'text/javascript'],
		['/src/uPlot.js', 'text/javascript'],
		['/src/uPlot.css', 'text/css'],
		['/dist/uPlot.esm.js', 'text/javascript'],
		['/dist/uPlot.min.css', 'text/css'],
		['/uPlot.png', 'image/png'],
	]) {
		it(`serves ${path} with its MIME type`, async () => {
			const response = await load(origin + path + '?test=1');
			assert.equal(response.status, 200);
			assert.equal(response.headers['content-type'].split(';')[0], type);
			assert.ok(response.body.length > 0);
		});
	}

	it('supports HEAD without a response body', async () => {
		const response = await load(origin + '/demos/index.html', 'HEAD');
		assert.equal(response.status, 200);
		assert.ok(Number(response.headers['content-length']) > 0);
		assert.equal(response.body.length, 0);
	});

	it('rejects missing files, malformed URLs, traversal, and unsupported methods', async () => {
		for (const [path, status, method] of [['/missing-file', 404], ['/%ZZ', 400], ['/..%2fpackage.json', 403], ['/demos/', 405, 'POST']])
			assert.equal((await load(origin + path, method)).status, status);
	});
});
