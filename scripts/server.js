const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

const port = 4173;

function startServer() {
  const MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".json": "application/json"
  };

  const server = http.createServer((req, res) => {
    // 1. Resolve file path
    const filePath = req.url === "/" ? `${rootDir}/index.html` : `${rootDir}${req.url}`;
    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || "application/octet-stream";

    // console.log(filePath);

    // 2. Read and serve the file
    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === "ENOENT") {
          res.writeHead(404);
          res.end("404: File Not Found");
        } else {
          res.writeHead(500);
          res.end("500: Internal Server Error");
        }
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content, "utf-8");
      }
    });
  });

  server.listen(port, () => {
    // console.log(`Server running at http://localhost:${port}/`);
  });

  return server;
}

exports.startServer = startServer;