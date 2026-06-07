const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const log = fs.openSync(path.join(root, "fileflow-vite.log"), "a");

const child = spawn(
  process.execPath,
  [viteBin, "--host", "127.0.0.1", "--port", "5180", "--strictPort"],
  {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  }
);

child.unref();
console.log(`FileFlow dev server started on http://127.0.0.1:5180 (pid ${child.pid})`);
