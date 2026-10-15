const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../../..');
const port = 4173;

function startServer() {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };

  const server = http.createServer((req, res) => {
    const filePath = req.url === '/' ? `${rootDir}/index.html` : `${rootDir}${req.url}`;
    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500);
        res.end(error.code === 'ENOENT' ? '404: File Not Found' : '500: Internal Server Error');
      }
      else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });

  server.listen(port);

  return server;
}

module.exports = { startServer };
