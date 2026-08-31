// Starts a small local static server for the Pixi PhysTrix application.
// It serves the repository root and supports JavaScript module MIME types.
// Run this file through start-server.bat or with "node server.js".

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const PORT = 8080;
const ROOT = resolve(".");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(
    join(ROOT, normalize(decodeURIComponent(requested))),
  );

  if (
    !filePath.startsWith(ROOT) ||
    !existsSync(filePath) ||
    statSync(filePath).isDirectory()
  ) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type":
      MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(PORT, () => {
  console.log(`Pixi PhysTrix is running at http://localhost:${PORT}/`);
  console.log("Press Ctrl+C to stop the server.");
});
