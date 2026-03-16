const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { scanPath, compareSymlinks } = require("../src/scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-final-"));
}

function cleanupTemp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("compare exits non-zero when drift exists", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const dir = makeTempDir();
  const baselinePath = path.join(dir, "baseline.json");
  const outDir = path.join(dir, "reports");
  const cliPath = path.join(repoRoot, "src", "cli.js");

  try {
    fs.writeFileSync(path.join(dir, "note.txt"), "hello\n", "utf8");

    const scanResult = spawnSync(
      "node",
      [cliPath, "scan", dir, "--save-baseline", baselinePath, "--out", outDir],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(scanResult.status, 0);
    assert.ok(fs.existsSync(baselinePath));

    fs.writeFileSync(path.join(dir, "note.txt"), "hello again\n", "utf8");

    const compareResult = spawnSync(
      "node",
      [cliPath, "compare", dir, "--baseline", baselinePath, "--out", outDir],
      { cwd: repoRoot, encoding: "utf8" }
    );

    assert.notEqual(compareResult.status, 0);
  } finally {
    cleanupTemp(dir);
  }
});

test("symlinks are reported and compared for drift", (t) => {
  const dir = makeTempDir();

  try {
    fs.writeFileSync(path.join(dir, "target.txt"), "alpha\n", "utf8");
    const linkPath = path.join(dir, "link.txt");
    try {
      fs.symlinkSync("target.txt", linkPath);
    } catch (err) {
      t.skip(`Symlinks not supported: ${err.message}`);
      return;
    }

    const baseline = scanPath(dir, { basePath: dir });
    assert.equal(baseline.symlinks.length, 1);
    assert.equal(baseline.symlinks[0].path, "link.txt");
    assert.equal(baseline.symlinks[0].target, "target.txt");

    fs.writeFileSync(path.join(dir, "target2.txt"), "beta\n", "utf8");
    fs.rmSync(linkPath);
    fs.symlinkSync("target2.txt", linkPath);

    const current = scanPath(dir, { basePath: dir });
    const drift = compareSymlinks(current.symlinks, baseline.symlinks);

    assert.equal(drift.changed.length, 1);
    assert.equal(drift.changed[0].file, "link.txt");
  } finally {
    cleanupTemp(dir);
  }
});
