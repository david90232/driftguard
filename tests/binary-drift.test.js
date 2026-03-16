const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanPath, compareHashes } = require("../src/scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-binary-"));
}

test("binary files are hashed and drift is detected", () => {
  const dir = makeTempDir();
  const binPath = path.join(dir, "payload.bin");
  fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 3, 4, 5, 6]));

  const baseline = scanPath(dir, { basePath: dir });
  assert.ok(baseline.hashes["payload.bin"]);

  fs.writeFileSync(binPath, Buffer.from([9, 8, 7, 6, 5, 4, 3]));
  const current = scanPath(dir, { basePath: dir });
  const drift = compareHashes(current.hashes, baseline.hashes);

  assert.equal(drift.changed.length, 1);
  assert.equal(drift.changed[0].file, "payload.bin");

  fs.rmSync(dir, { recursive: true, force: true });
});
