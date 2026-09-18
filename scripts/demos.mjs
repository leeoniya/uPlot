import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const withinRoot = file => file == root || file.startsWith(root + sep);
const types = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.csv': 'text/csv; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
	const reply = (status, headers = {}, body = '') => {
		res.writeHead(status, headers);
		res.end(req.method == 'HEAD' ? undefined : body);
	};

	if (req.method != 'GET' && req.method != 'HEAD')
		return reply(405, { Allow: 'GET, HEAD' });

	try {
		const url = new URL(req.url, 'http://localhost');
		if (url.pathname == '/')
			return reply(302, { Location: '/demos/' });

		let file = resolve(root, '.' + decodeURIComponent(url.pathname));
		if (!withinRoot(file))
			return reply(403);
		if ((await stat(file)).isDirectory()) {
			if (!url.pathname.endsWith('/'))
				return reply(302, { Location: url.pathname + '/' + url.search });
			file = resolve(file, 'index.html');
		}
		file = await realpath(file);
		if (!withinRoot(file))
			return reply(403);

		const body = await readFile(file);
		reply(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' }, body);
	}
	catch (error) {
		reply(error instanceof URIError || error.code == 'ERR_INVALID_ARG_VALUE' ? 400 : error.code == 'ENOENT' || error.code == 'ENOTDIR' ? 404 : 500);
	}
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
	console.log(`Demos: http://127.0.0.1:${server.address().port}/demos/`);
});
