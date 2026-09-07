// 零依赖本地静态服务器：node serve.cjs [端口]
// PWA 的 fetch 与 Service Worker 必须运行在 http(s) 下，不能直接双击 file:// 打开
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8765;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404 Not Found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`刷题应用已启动： http://127.0.0.1:${PORT}/index.html  (Ctrl+C 停止)`);
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
  require('child_process').exec(cmd);
});
