const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanPath } = require("../src/scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-pyproj-"));
}

test("pyproject dependencies are parsed from PEP 621 array", () => {
  const dir = makeTempDir();
  const pyproject = `
[project]
name = "demo"
version = "0.1.0"
dependencies = [
  "requests>=2.31",
  "httpx",
  "pydantic"
]
`;
  fs.writeFileSync(path.join(dir, "pyproject.toml"), pyproject.trim());

  const report = scanPath(dir, { basePath: dir });
  const deps = report.manifests.pyproject.dependencies;

  assert.deepEqual(deps, ["requests>=2.31", "httpx", "pydantic"]);

  fs.rmSync(dir, { recursive: true, force: true });
});
