const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-out-"));
}

test("reports written under root are auto-ignored on subsequent scans", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const dir = makeTempDir();
  const targetFile = path.join(dir, "hello.txt");
  fs.writeFileSync(targetFile, "ok");

  const outDir = path.join(dir, "reports");
  const jsonPath = path.join(outDir, "report.json");
  const mdPath = path.join(outDir, "report.md");
  const cliPath = path.join(repoRoot, "src", "cli.js");

  let result = spawnSync(
    "node",
    [cliPath, "scan", dir, "--out", outDir, "--json", jsonPath, "--md", mdPath],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = spawnSync(
    "node",
    [cliPath, "scan", dir, "--out", outDir, "--json", jsonPath, "--md", mdPath],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const hashKeys = Object.keys(report.hashes || {});

  assert.ok(!hashKeys.some((key) => key.startsWith("reports/")));
  assert.ok((report.ignoredFiles || []).includes("reports/"));

  fs.rmSync(dir, { recursive: true, force: true });
});
