const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-baseline-"));
}

test("malformed baseline files fail cleanly", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const dir = makeTempDir();
  const baselinePath = path.join(dir, "baseline.json");
  fs.writeFileSync(baselinePath, "{not json");

  const cliPath = path.join(repoRoot, "src", "cli.js");
  const result = spawnSync(
    "node",
    [cliPath, "compare", dir, "--baseline", baselinePath],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Failed to parse baseline"));

  fs.rmSync(dir, { recursive: true, force: true });
});
