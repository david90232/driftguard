const path = require("path");
const fs = require("fs");
const { scanPath, loadConfig, compareHashes } = require("../src/scanner");
const { printSummary } = require("../src/reporters");

const fixtures = [
  {
    name: "sample-skill",
    root: path.resolve(__dirname, "../fixtures/sample-skill")
  },
  {
    name: "sample-repo",
    root: path.resolve(__dirname, "../fixtures/sample-repo")
  },
  {
    name: "ignore-config",
    root: path.resolve(__dirname, "../fixtures/ignore-config")
  }
];

for (const fixture of fixtures) {
  const configResult = loadConfig(fixture.root, { basePath: process.cwd() });
  const report = scanPath(fixture.root, {
    ignorePaths: configResult.config.ignorePaths,
    ignoreRules: configResult.config.ignoreRules,
    configPath: configResult.path,
    basePath: process.cwd()
  });
  console.log("=".repeat(60));
  console.log(`[fixture] ${fixture.name}`);
  console.log(printSummary(report));
}

const driftRoot = path.resolve(__dirname, "../fixtures/hash-drift");
const baselinePath = path.join(driftRoot, "baseline.json");
if (fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const report = scanPath(driftRoot, { basePath: process.cwd() });
  report.drift = {
    baselinePath: path.relative(process.cwd(), baselinePath),
    ...compareHashes(report.hashes, baseline.hashes || {})
  };
  console.log("=".repeat(60));
  console.log("[fixture] hash-drift");
  console.log(printSummary(report));
}
