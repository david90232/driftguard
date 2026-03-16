#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  scanPath,
  loadConfig,
  compareHashes,
  compareSymlinks,
  saveBaseline,
  buildRiskProfile
} = require("./scanner");
const { VERSION } = require("./version");
const { writeReports, printSummary, attachVerdict } = require("./reporters");

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function printHelp() {
  console.log(`Driftguard Integrity Scanner (v${VERSION})

Usage:
  node ./src/cli.js scan <path> [options]
  node ./src/cli.js compare <path> --baseline <file> [options]

Options:
  --out <dir>             Output directory for reports (default: ./reports)
  --json <file>           JSON report path
  --md <file>             Markdown report path
  --config <file>         Config path (default: <root>/.driftguard.json)
  --save-baseline <file>  Write baseline hash file after scan
  --baseline <file>       Baseline hash file (compare mode only)
  --skills-summary        Concise summary when scanning a directory of skills
  --help, -h              Show help

Examples:
  node ./src/cli.js scan ./skills
  node ./src/cli.js scan ./skills --out ./reports
  node ./src/cli.js scan ./skills --json ./reports/scan.json --md ./reports/scan.md
  node ./src/cli.js scan ./skills --save-baseline ./reports/baseline.json
  node ./src/cli.js compare ./skills --baseline ./reports/baseline.json
  node ./src/cli.js scan ./skills --skills-summary
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  const target = args.shift();
  const options = {};
  const unknown = [];
  const errors = [];

  const readValue = (flag, inlineValue, nextValue) => {
    if (inlineValue !== undefined) {
      if (!inlineValue.trim()) {
        errors.push(`Missing value for ${flag}.`);
        return { value: null, consumed: 0 };
      }
      return { value: inlineValue, consumed: 0 };
    }
    if (!nextValue || nextValue.startsWith("-")) {
      errors.push(`Missing value for ${flag}.`);
      return { value: null, consumed: 0 };
    }
    return { value: nextValue, consumed: 1 };
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [flag, inlineValue] = arg.split("=");
    const nextValue = inlineValue !== undefined ? inlineValue : args[i + 1];

    switch (flag) {
      case "--out":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.outDir = value;
          i += consumed;
        }
        break;
      case "--json":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.jsonFile = value;
          i += consumed;
        }
        break;
      case "--md":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.mdFile = value;
          i += consumed;
        }
        break;
      case "--config":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.configPath = value;
          i += consumed;
        }
        break;
      case "--baseline":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.baselinePath = value;
          i += consumed;
        }
        break;
      case "--save-baseline":
        {
          const { value, consumed } = readValue(flag, inlineValue, nextValue);
          if (value) options.saveBaseline = value;
          i += consumed;
        }
        break;
      case "--skills-summary":
        options.skillsSummary = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (flag.startsWith("-")) unknown.push(flag);
        break;
    }
  }

  return { command, target, options, unknown, errors };
}

function requireValue(name, value) {
  if (!value) {
    console.error(`Missing value for ${name}.`);
    process.exit(1);
  }
}

function resolveOptionalPath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function resolveTarget(target) {
  return path.resolve(process.cwd(), target);
}

function riskRank(level) {
  const order = ["low", "medium", "high", "critical"];
  const index = order.indexOf(level);
  return index === -1 ? 0 : index;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean))).sort();
}

function diffStringLists(currentList, baselineList) {
  const current = new Set(normalizeStringList(currentList));
  const baseline = new Set(normalizeStringList(baselineList));
  const added = [];
  const removed = [];
  for (const item of current) {
    if (!baseline.has(item)) added.push(item);
  }
  for (const item of baseline) {
    if (!current.has(item)) removed.push(item);
  }
  return { added, removed };
}

function addDiffIfChanged(target, key, diff) {
  if (!diff) return;
  if (diff.added.length || diff.removed.length) {
    target[key] = diff;
  }
}

function buildManifestDrift(currentManifests, baselineManifests) {
  const drift = {};
  const currentPkg = currentManifests ? currentManifests.packageJson : null;
  const baselinePkg = baselineManifests ? baselineManifests.packageJson : null;

  if (currentPkg || baselinePkg) {
    const pkgDrift = {};
    addDiffIfChanged(
      pkgDrift,
      "dependencies",
      diffStringLists(currentPkg && currentPkg.dependencies, baselinePkg && baselinePkg.dependencies)
    );
    addDiffIfChanged(
      pkgDrift,
      "devDependencies",
      diffStringLists(
        currentPkg && currentPkg.devDependencies,
        baselinePkg && baselinePkg.devDependencies
      )
    );
    addDiffIfChanged(
      pkgDrift,
      "optionalDependencies",
      diffStringLists(
        currentPkg && currentPkg.optionalDependencies,
        baselinePkg && baselinePkg.optionalDependencies
      )
    );
    addDiffIfChanged(
      pkgDrift,
      "peerDependencies",
      diffStringLists(
        currentPkg && currentPkg.peerDependencies,
        baselinePkg && baselinePkg.peerDependencies
      )
    );
    addDiffIfChanged(
      pkgDrift,
      "scripts",
      diffStringLists(currentPkg && currentPkg.scripts, baselinePkg && baselinePkg.scripts)
    );
    addDiffIfChanged(
      pkgDrift,
      "lifecycleScripts",
      diffStringLists(
        currentPkg && currentPkg.lifecycleScripts,
        baselinePkg && baselinePkg.lifecycleScripts
      )
    );
    addDiffIfChanged(
      pkgDrift,
      "installScripts",
      diffStringLists(
        currentPkg && currentPkg.installScripts,
        baselinePkg && baselinePkg.installScripts
      )
    );
    if (Object.keys(pkgDrift).length) {
      drift.packageJson = pkgDrift;
    }
  }

  const currentReq = currentManifests ? currentManifests.requirements : null;
  const baselineReq = baselineManifests ? baselineManifests.requirements : null;
  if (currentReq || baselineReq) {
    const reqDrift = {};
    addDiffIfChanged(
      reqDrift,
      "dependencies",
      diffStringLists(
        currentReq && currentReq.dependencies,
        baselineReq && baselineReq.dependencies
      )
    );
    if (Object.keys(reqDrift).length) drift.requirements = reqDrift;
  }

  const currentPy = currentManifests ? currentManifests.pyproject : null;
  const baselinePy = baselineManifests ? baselineManifests.pyproject : null;
  if (currentPy || baselinePy) {
    const pyDrift = {};
    addDiffIfChanged(
      pyDrift,
      "dependencies",
      diffStringLists(
        currentPy && currentPy.dependencies,
        baselinePy && baselinePy.dependencies
      )
    );
    if (Object.keys(pyDrift).length) drift.pyproject = pyDrift;
  }

  return drift;
}

function buildDriftHighlights(report, manifestDrift, hasBaselineManifests) {
  const highlights = {
    newCapabilities: [],
    installHooks: { added: [], removed: [] },
    dependencyChanges: [],
    notes: []
  };

  if (!report || !report.drift) return highlights;

  if (report.drift.trustMode === "all-findings") {
    highlights.notes.push("Baseline mismatch; treating all findings as new.");
  }
  if (!hasBaselineManifests) {
    highlights.notes.push("Baseline missing manifest data; dependency drift not available.");
  }

  const scored = report.findings.filter((finding) => finding.scored !== false);
  const hasRulePrefix = (prefix) =>
    scored.some((finding) => finding.ruleId && finding.ruleId.startsWith(prefix));

  if (hasRulePrefix("shell.")) highlights.newCapabilities.push("New executable behavior detected.");
  if (hasRulePrefix("net.")) highlights.newCapabilities.push("New network capability detected.");

  if (report.drift.symlinks && report.drift.symlinks.added.length) {
    highlights.newCapabilities.push("New symlink(s) introduced.");
  }

  if (manifestDrift && manifestDrift.packageJson && manifestDrift.packageJson.installScripts) {
    const install = manifestDrift.packageJson.installScripts;
    highlights.installHooks = install;
    if (install.added.length) {
      highlights.newCapabilities.push("New install hook(s) added in package.json.");
    }
  }

  if (manifestDrift) {
    const depChanges = [];
    const pkg = manifestDrift.packageJson;
    if (pkg) {
      for (const key of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies"
      ]) {
        if (pkg[key] && (pkg[key].added.length || pkg[key].removed.length)) {
          depChanges.push(`package.json ${key}`);
        }
      }
    }
    if (manifestDrift.requirements && manifestDrift.requirements.dependencies) {
      depChanges.push("requirements.txt dependencies");
    }
    if (manifestDrift.pyproject && manifestDrift.pyproject.dependencies) {
      depChanges.push("pyproject.toml dependencies");
    }
    highlights.dependencyChanges = depChanges;
  }

  return highlights;
}

function ensurePathExists(label, filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${label} does not exist: ${filePath}`);
    process.exit(1);
  }
}

function resolveConfig(rootPath, configPath) {
  const resolved = resolveOptionalPath(configPath);
  const result = loadConfig(rootPath, { configPath: resolved, basePath: process.cwd() });
  if (result.error) {
    console.error(`Config error (${result.path || "unknown"}): ${result.error}`);
    process.exit(1);
  }
  return result;
}

function prepareReportOptions(options, configResult, runtimeIgnorePaths = []) {
  return {
    ignorePaths: configResult.config.ignorePaths,
    ignoreRules: configResult.config.ignoreRules,
    configPath: configResult.path,
    runtimeIgnorePaths,
    basePath: process.cwd()
  };
}

function relPathIfInside(rootPath, targetPath) {
  if (!targetPath) return null;
  const rel = path.relative(rootPath, targetPath);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function collectRuntimeIgnorePaths(rootPath, options) {
  const runtimeIgnores = [];
  const outDir = resolveOptionalPath(options.outDir) || path.join(process.cwd(), "reports");
  const jsonPath = resolveOptionalPath(options.jsonFile);
  const mdPath = resolveOptionalPath(options.mdFile);
  const saveBaseline = resolveOptionalPath(options.saveBaseline);
  const baselinePath = resolveOptionalPath(options.baselinePath);

  const outRel = relPathIfInside(rootPath, outDir);
  if (outRel) runtimeIgnores.push(`${outRel}/`);
  for (const filePath of [jsonPath, mdPath, saveBaseline, baselinePath]) {
    const rel = relPathIfInside(rootPath, filePath);
    if (rel) runtimeIgnores.push(rel);
  }

  return Array.from(new Set(runtimeIgnores));
}

function exitCodeForRisk(report) {
  if (!report) return 1;
  if (report.verdict && typeof report.verdict.exitCode === "number") {
    return report.verdict.exitCode;
  }
  if (!report.risk) return 1;
  if (report.risk.level === "low") return 0;
  if (report.risk.level === "medium") return 1;
  return 2;
}

function exitCodeForLevel(level) {
  if (level === "low") return 0;
  if (level === "medium") return 1;
  return 2;
}

function hasSkillFile(dirPath) {
  return (
    fs.existsSync(path.join(dirPath, "SKILL.md")) ||
    fs.existsSync(path.join(dirPath, "skill.md"))
  );
}

const DEFAULT_SKILL_IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".cache"
]);

function discoverSkillDirs(rootPath) {
  const skills = [];
  const visited = new Set();
  const stack = [rootPath];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const baseName = path.basename(current);
    if (DEFAULT_SKILL_IGNORE_DIRS.has(baseName)) continue;

    if (hasSkillFile(current)) {
      if (!visited.has(current)) {
        visited.add(current);
        skills.push({
          name: path.basename(current),
          fullPath: current,
          relPath: path.relative(process.cwd(), current) || "."
        });
      }
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      stack.push(path.join(current, entry.name));
    }
  }

  return skills;
}

function renderSkillsSummary(rootPath, summaries, overall) {
  const lines = [];
  lines.push("Driftguard Skills Summary");
  lines.push(`Root: ${path.relative(process.cwd(), rootPath) || "."}`);
  lines.push(`Skills scanned: ${summaries.length}`);
  lines.push(
    `Overall risk: ${overall.level.toUpperCase()} (score ${overall.score})`
  );
  lines.push("");
  for (const summary of summaries) {
    lines.push(
      `- ${summary.name} (${summary.relPath}): risk=${summary.risk.level.toUpperCase()} score=${summary.risk.score} findings=${summary.stats.findings} combos=${summary.stats.comboFindings || 0} files=${summary.stats.scannedFiles}/${summary.stats.totalFiles}`
    );
  }
  lines.push("");
  lines.push("Tip: run a full scan on a single skill for detailed findings and reports.");
  return lines.join("\n");
}

function runSkillsSummary(rootPath, options) {
  const skillDirs = discoverSkillDirs(rootPath);
  if (!skillDirs.length) {
    console.error("No SKILL.md files found in the provided skills directory.");
    process.exit(1);
  }

  const summaries = [];
  let overallLevel = "low";
  let overallScore = 0;

  for (const skill of skillDirs) {
    const configResult = resolveConfig(skill.fullPath, options.configPath);
    const report = scanPath(skill.fullPath, prepareReportOptions(options, configResult));
    summaries.push({
      name: skill.name,
      relPath: skill.relPath,
      risk: report.risk,
      stats: report.stats
    });
    overallScore += report.risk.score || 0;
    if (riskRank(report.risk.level) > riskRank(overallLevel)) {
      overallLevel = report.risk.level;
    }
  }

  summaries.sort((a, b) => {
    const rank = riskRank(b.risk.level) - riskRank(a.risk.level);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });

  console.log(
    renderSkillsSummary(rootPath, summaries, { level: overallLevel, score: overallScore })
  );
  process.exit(exitCodeForLevel(overallLevel));
}

function runScan(rootPath, options) {
  if (options.skillsSummary) {
    runSkillsSummary(rootPath, options);
    return;
  }

  const configResult = resolveConfig(rootPath, options.configPath);
  const runtimeIgnorePaths = collectRuntimeIgnorePaths(rootPath, options);
  const report = attachVerdict(
    scanPath(rootPath, prepareReportOptions(options, configResult, runtimeIgnorePaths))
  );

  const outDir = resolveOptionalPath(options.outDir) || path.join(process.cwd(), "reports");
  const jsonPath = resolveOptionalPath(options.jsonFile);
  const mdPath = resolveOptionalPath(options.mdFile);
  const { jsonPath: writtenJson, mdPath: writtenMd } = writeReports(
    report,
    outDir,
    jsonPath,
    mdPath
  );

  if (options.saveBaseline) {
    const baselinePath = resolveOptionalPath(options.saveBaseline);
    requireValue("--save-baseline", baselinePath);
    saveBaseline(baselinePath, report);
    console.log(`Trusted baseline saved: ${baselinePath}`);
  }

  console.log(printSummary(report));
  console.log(`Reports written:\n- ${writtenJson}\n- ${writtenMd}`);

  process.exit(exitCodeForRisk(report));
}

function runCompare(rootPath, options) {
  requireValue("--baseline", options.baselinePath);
  const baselinePath = resolveOptionalPath(options.baselinePath);
  ensurePathExists("Baseline file", baselinePath);

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.error(`Failed to parse baseline: ${err.message}`);
    process.exit(1);
  }
  if (!baseline || typeof baseline !== "object") {
    console.error("Baseline file is not a valid JSON object.");
    process.exit(1);
  }
  if (!baseline.hashes) {
    console.error("Baseline file missing hashes.");
    process.exit(1);
  }
  if (typeof baseline.hashes !== "object" || Array.isArray(baseline.hashes)) {
    console.error("Baseline hashes must be an object.");
    process.exit(1);
  }

  const configResult = resolveConfig(rootPath, options.configPath);
  const runtimeIgnorePaths = collectRuntimeIgnorePaths(rootPath, options);
  const report = attachVerdict(
    scanPath(rootPath, prepareReportOptions(options, configResult, runtimeIgnorePaths))
  );
  const drift = compareHashes(report.hashes, baseline.hashes);
  const symlinkDrift = compareSymlinks(report.symlinks, baseline.symlinks);
  const hasBaselineManifests = Object.prototype.hasOwnProperty.call(baseline, "manifests");
  const manifestDrift = hasBaselineManifests
    ? buildManifestDrift(report.manifests, baseline.manifests)
    : null;
  report.drift = {
    baselinePath: path.relative(process.cwd(), baselinePath),
    ...drift,
    symlinks: symlinkDrift,
    manifests: manifestDrift
  };

  const baselineConfig = baseline.config || { ignorePaths: [], ignoreRules: [] };
  const currentConfig = {
    ignorePaths: configResult.config.ignorePaths,
    ignoreRules: configResult.config.ignoreRules
  };
  const normalizeList = (values) => {
    if (!Array.isArray(values)) return [];
    return Array.from(
      new Set(values.map((value) => String(value).trim()).filter(Boolean))
    ).sort();
  };
  const normalizeConfig = (config) => ({
    ignorePaths: normalizeList(config.ignorePaths),
    ignoreRules: normalizeList(config.ignoreRules)
  });
  const normalizedBaselineConfig = normalizeConfig(baselineConfig);
  const normalizedCurrentConfig = normalizeConfig(currentConfig);
  const configChanged =
    JSON.stringify(normalizedBaselineConfig) !== JSON.stringify(normalizedCurrentConfig);

  const baselineRootId =
    baseline.rootId || baseline.rootRealPath || baseline.rootPath || null;
  const currentRootId = report.rootId || (report.meta && report.meta.rootPath) || report.rootPath;
  report.drift.baselineRoot = baselineRootId;
  report.drift.currentRoot = currentRootId;
  report.drift.rootMismatch =
    Boolean(report.drift.baselineRoot) &&
    Boolean(report.drift.currentRoot) &&
    report.drift.baselineRoot !== report.drift.currentRoot;
  report.drift.baselineVersion = baseline.version || null;
  report.drift.configChanged = configChanged;
  report.drift.baselineConfig = normalizedBaselineConfig;
  report.drift.currentConfig = normalizedCurrentConfig;

  const trustByHashes =
    !report.drift.rootMismatch &&
    !report.drift.configChanged &&
    Boolean(report.drift.baselineVersion) &&
    report.drift.baselineVersion === report.version;

  report.drift.trustMode = trustByHashes ? "hashes" : "all-findings";

  if (trustByHashes && drift.unchanged && drift.unchanged.length) {
    const driftFiles = new Set([
      ...drift.added,
      ...drift.changed.map((item) => item.file)
    ]);
    const trustedFiles = new Set(drift.unchanged);
    const driftFindings = [];
    const trustedFindings = [];
    for (const finding of report.findings) {
      if (driftFiles.has(finding.file)) {
        driftFindings.push(finding);
      } else if (trustedFiles.has(finding.file)) {
        trustedFindings.push(finding);
      } else {
        driftFindings.push(finding);
      }
    }
    const driftProfile = buildRiskProfile(driftFindings);
    const scoredDriftFindings = driftFindings.filter((finding) => finding.scored !== false);
    report.findings = driftFindings;
    report.trustedFindings = trustedFindings;
    report.risk = driftProfile.risk;
    report.comboRisks = driftProfile.comboRisks;
    const unscoredDrift = driftFindings.filter((finding) => finding.scored === false).length;
    const unscoredTrusted = trustedFindings.filter((finding) => finding.scored === false).length;
    report.stats.totalFindings = driftFindings.length + trustedFindings.length;
    report.stats.unscoredFindings = unscoredDrift + unscoredTrusted;
    report.stats.trustedFindings = trustedFindings.length;
    report.stats.findings = scoredDriftFindings.length;
    report.stats.comboFindings = driftProfile.comboRisks.length;
  } else {
    report.stats.totalFindings = report.findings.length;
    report.stats.unscoredFindings =
      report.findings.filter((finding) => finding.scored === false).length;
    report.stats.trustedFindings = 0;
  }

  report.drift.highlights = buildDriftHighlights(
    report,
    manifestDrift,
    hasBaselineManifests
  );

  attachVerdict(report);

  const outDir = resolveOptionalPath(options.outDir) || path.join(process.cwd(), "reports");
  const jsonPath = resolveOptionalPath(options.jsonFile);
  const mdPath = resolveOptionalPath(options.mdFile);
  const { jsonPath: writtenJson, mdPath: writtenMd } = writeReports(
    report,
    outDir,
    jsonPath,
    mdPath
  );

  console.log(printSummary(report));
  console.log(`Reports written:\n- ${writtenJson}\n- ${writtenMd}`);

  process.exit(exitCodeForRisk(report));
}

function main() {
  const { command, target, options, unknown, errors } = parseArgs(process.argv);
  if (!command || options.help) {
    printHelp();
    process.exit(0);
  }

  if (errors.length) {
    console.error(errors.join("\n"));
    printHelp();
    process.exit(1);
  }

  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(", ")}`);
    printHelp();
    process.exit(1);
  }

  if (!target) {
    console.error("Missing path to scan or compare.");
    printHelp();
    process.exit(1);
  }

  if (command !== "scan" && command !== "compare") {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const rootPath = resolveTarget(target);
  ensurePathExists("Path", rootPath);

  if (command === "scan") {
    runScan(rootPath, options);
  } else {
    runCompare(rootPath, options);
  }
}

main();
