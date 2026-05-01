const { test } = require("node:test");
const assert = require("node:assert/strict");
const { printSummary, attachVerdict } = require("../src/reporters");

test("scan summary uses DriftGuard branding", () => {
  const report = {
    rootPath: ".",
    risk: { level: "low", score: 0 },
    findings: [],
    comboRisks: [],
    stats: { findings: 0, comboFindings: 0, totalFiles: 1, scannedFiles: 1, skippedFiles: 0 },
    manifests: {},
    hashes: {},
    symlinks: []
  };
  attachVerdict(report);
  const output = printSummary(report);
  assert.ok(output.includes("DriftGuard Summary"), "should use DriftGuard branding");
});

test("compare summary shows drift section with clear header", () => {
  const report = {
    rootPath: ".",
    version: "0.2.0",
    risk: { level: "medium", score: 5 },
    findings: [
      { file: "new.js", ruleId: "shell.eval", severity: "high", description: "eval", line: "eval(x)", lineNumber: 1, match: "eval(", context: "code", scored: true, confidence: "high" }
    ],
    comboRisks: [],
    stats: { findings: 1, comboFindings: 0, totalFiles: 3, scannedFiles: 3, skippedFiles: 0 },
    manifests: {},
    hashes: { "a.js": "aaa", "new.js": "bbb" },
    symlinks: [],
    drift: {
      baselinePath: "baseline.json",
      added: ["new.js"],
      removed: [],
      changed: [],
      unchanged: ["a.js"],
      unchangedCount: 1,
      symlinks: { added: [], removed: [], changed: [], unchanged: [], unchangedCount: 0 },
      highlights: { newCapabilities: ["New executable behavior detected."], installHooks: { added: [], removed: [] }, dependencyChanges: [], notes: [] },
      configChanged: false,
      rootMismatch: false,
      trustMode: "hashes",
      baselineVersion: "0.2.0"
    }
  };
  attachVerdict(report);
  const output = printSummary(report);
  assert.ok(output.includes("--- What Changed Since Trust ---"), "should have drift section header");
  assert.ok(output.includes("+1 added"), "should show added count with + prefix");
  assert.ok(output.includes("! New executable behavior"), "should highlight new capabilities");
});

test("next steps reference driftguard trust command", () => {
  const report = {
    rootPath: ".",
    risk: { level: "low", score: 0 },
    findings: [],
    comboRisks: [],
    stats: { findings: 0, comboFindings: 0, totalFiles: 1, scannedFiles: 1, skippedFiles: 0 },
    manifests: {},
    hashes: {},
    symlinks: []
  };
  attachVerdict(report);
  const output = printSummary(report);
  assert.ok(output.includes("driftguard trust"), "next steps should reference trust command");
});
