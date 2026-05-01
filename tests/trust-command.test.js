const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const CLI = path.resolve(__dirname, "../src/cli.js");

function run(args) {
  return spawnSync("node", [CLI, ...args], { encoding: "utf8", timeout: 10000 });
}

test("trust command saves a baseline to default path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-trust-"));
  try {
    fs.writeFileSync(path.join(tmp, "hello.js"), "console.log('hi');\n");
    const result = run(["trust", tmp, "--out", path.join(tmp, "out")]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const baselinePath = path.join(tmp, "out", "baseline.json");
    assert.ok(fs.existsSync(baselinePath), "baseline.json should be created");
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    assert.ok(baseline.hashes, "baseline should contain hashes");
    assert.ok(baseline.version, "baseline should contain version");
    assert.ok(baseline.trust, "baseline should contain trust metadata");
    assert.ok(baseline.trust.approvedAt, "trust metadata should contain approval time");
    assert.ok(baseline.trust.risk, "trust metadata should contain risk snapshot");
    assert.ok(baseline.trust.findings, "trust metadata should contain finding summary");
    const report = JSON.parse(fs.readFileSync(path.join(tmp, "out", "report.json"), "utf8"));
    assert.equal(report.savedBaseline.path, baselinePath);
    assert.ok(
      report.verdict.nextSteps.includes("Trusted baseline saved; use compare after future changes to review drift."),
      "trust reports should not ask the user to trust again"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust command records approver and note metadata", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-trust-note-"));
  try {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", version: "1.2.3" }));
    const baselinePath = path.join(tmp, "baseline.json");
    const result = run([
      "trust",
      tmp,
      "--baseline",
      baselinePath,
      "--trusted-by",
      "David",
      "--note",
      "Reviewed before release",
      "--out",
      path.join(tmp, "out")
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    assert.equal(baseline.trust.approvedBy, "David");
    assert.equal(baseline.trust.note, "Reviewed before release");
    assert.equal(baseline.trust.packageVersion, "1.2.3");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust command respects --baseline to override save path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-trust-custom-"));
  try {
    fs.writeFileSync(path.join(tmp, "index.js"), "module.exports = {};\n");
    const customPath = path.join(tmp, "custom-baseline.json");
    const result = run(["trust", tmp, "--baseline", customPath, "--out", path.join(tmp, "out")]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(customPath), "custom baseline path should be used");
    const baseline = JSON.parse(fs.readFileSync(customPath, "utf8"));
    assert.ok(baseline.hashes, "baseline should contain hashes");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust command creates parent directories for custom baseline", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-trust-nested-"));
  try {
    fs.writeFileSync(path.join(tmp, "index.js"), "module.exports = {};\n");
    const customPath = path.join(tmp, "nested", "baselines", "baseline.json");
    const result = run(["trust", tmp, "--baseline", customPath, "--out", path.join(tmp, "out")]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(customPath), "nested baseline path should be created");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust command prefers --save-baseline over --baseline when both are provided", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-trust-precedence-"));
  try {
    fs.writeFileSync(path.join(tmp, "index.js"), "module.exports = {};\n");
    const baselinePath = path.join(tmp, "baseline.json");
    const savePath = path.join(tmp, "save-baseline.json");
    const result = run([
      "trust",
      tmp,
      "--baseline",
      baselinePath,
      "--save-baseline",
      savePath,
      "--out",
      path.join(tmp, "out")
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(savePath), "--save-baseline should take precedence");
    assert.ok(!fs.existsSync(baselinePath), "--baseline should be ignored when --save-baseline is set");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust then compare round-trip detects no drift", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-roundtrip-"));
  try {
    fs.writeFileSync(path.join(tmp, "app.js"), "const x = 1;\n");
    const outDir = path.join(tmp, "out");
    const baselinePath = path.join(outDir, "baseline.json");

    // trust
    const trustResult = run(["trust", tmp, "--out", outDir]);
    assert.equal(trustResult.status, 0, `trust stderr: ${trustResult.stderr}`);
    assert.ok(fs.existsSync(baselinePath));

    // compare (no changes)
    const compareResult = run(["compare", tmp, "--baseline", baselinePath, "--out", outDir]);
    assert.equal(compareResult.status, 0, `compare stderr: ${compareResult.stderr}`);
    assert.ok(compareResult.stdout.includes("SAFE TO TRUST"), "should be safe to trust when nothing changed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("trust then compare detects drift after file change", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dg-drift-"));
  try {
    fs.writeFileSync(path.join(tmp, "app.js"), "const x = 1;\n");
    const outDir = path.join(tmp, "out");
    const baselinePath = path.join(outDir, "baseline.json");

    // trust
    run(["trust", tmp, "--out", outDir]);

    // modify a file
    fs.writeFileSync(path.join(tmp, "app.js"), "const x = require('child_process').exec('rm -rf /');\n");

    // compare (should detect drift)
    const compareResult = run(["compare", tmp, "--baseline", baselinePath, "--out", outDir]);
    assert.notEqual(compareResult.status, 0, "should exit non-zero on drift");
    assert.ok(
      compareResult.stdout.includes("What Changed Since Trust"),
      "should show drift section"
    );
    assert.ok(compareResult.stdout.includes("Risk diff"), "should show risk diff summary");
    const report = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8"));
    assert.ok(report.drift.riskDiff, "report should include risk diff");
    assert.ok(
      report.drift.riskDiff.capabilities.added.includes("shell"),
      "risk diff should show new shell capability"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("help text uses driftguard command name", () => {
  const result = run(["--help"]);
  assert.ok(result.stdout.includes("driftguard scan"), "help should reference driftguard scan");
  assert.ok(result.stdout.includes("driftguard trust"), "help should reference driftguard trust");
  assert.ok(result.stdout.includes("driftguard compare"), "help should reference driftguard compare");
});
