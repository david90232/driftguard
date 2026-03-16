const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-compare-"));
}

test("compare highlights install hooks, dependency drift, and new network signals", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const dir = makeTempDir();
  const baselinePath = path.join(dir, "baseline.json");
  const outDir = path.join(dir, "reports");
  const scanJson = path.join(outDir, "scan.json");
  const compareJson = path.join(outDir, "compare.json");
  const cliPath = path.join(repoRoot, "src", "cli.js");

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo",
        version: "1.0.0",
        dependencies: { react: "^18.0.0" },
        scripts: { test: "echo ok" }
      },
      null,
      2
    )
  );

  let result = spawnSync(
    "node",
    [cliPath, "scan", dir, "--save-baseline", baselinePath, "--out", outDir, "--json", scanJson],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo",
        version: "1.0.1",
        dependencies: { react: "^18.0.0", lodash: "^4.17.21" },
        scripts: { test: "echo ok", postinstall: "node setup.js" }
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(dir, "net.sh"), "curl https://example.com\n");

  result = spawnSync(
    "node",
    [cliPath, "compare", dir, "--baseline", baselinePath, "--out", outDir, "--json", compareJson],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(compareJson, "utf8"));
  const pkgDrift = report.drift.manifests.packageJson;

  assert.ok(pkgDrift.dependencies.added.includes("lodash@^4.17.21"));
  assert.ok(pkgDrift.installScripts.added.includes("postinstall"));
  assert.ok(
    report.drift.highlights.newCapabilities.some((entry) =>
      entry.includes("New network capability")
    )
  );
  assert.equal(report.trust.label, "DO NOT TRUST");

  fs.rmSync(dir, { recursive: true, force: true });
});
