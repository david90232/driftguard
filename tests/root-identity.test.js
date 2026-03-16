const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanPath } = require("../src/scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-root-"));
}

test("root identity is stable across base paths", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "index.js"), "console.log('ok');");

  const reportA = scanPath(dir, { basePath: dir });
  const reportB = scanPath(dir, { basePath: path.dirname(dir) });

  assert.equal(reportA.rootId, reportB.rootId);
  assert.notEqual(reportA.rootPath, reportB.rootPath);

  fs.rmSync(dir, { recursive: true, force: true });
});
