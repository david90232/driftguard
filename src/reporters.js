const fs = require("fs");
const path = require("path");
const { VERSION } = require("./version");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatFinding(finding) {
  const extras = [];
  if (finding.context) extras.push(`context=${finding.context}`);
  if (finding.scored === false) extras.push("unscored");
  if (finding.confidence) extras.push(`confidence=${finding.confidence}`);
  const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
  return `${finding.severity.toUpperCase()} ${finding.ruleId} ${finding.file}:${finding.lineNumber || "?"}${suffix}`;
}

function renderDriftList(lines, title, items, limit = 25) {
  lines.push(`${title} (${items.length})`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  const visible = items.slice(0, limit);
  for (const item of visible) {
    const value = typeof item === "string" ? item : item.file;
    lines.push(`- ${value}`);
  }
  if (items.length > limit) {
    lines.push(`- ...and ${items.length - limit} more`);
  }
}

function renderFindingList(lines, title, items, limit = 15) {
  lines.push(`${title} (${items.length})`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  const visible = items.slice(0, limit);
  for (const finding of visible) {
    lines.push(`- ${formatFinding(finding)}`);
  }
  if (items.length > limit) {
    lines.push(`- ...and ${items.length - limit} more`);
  }
}

function renderSymlinkList(lines, items, limit = 25) {
  lines.push(`Symlinks (${items.length})`);
  if (items.length === 0) {
    lines.push("- (none)");
    return;
  }
  const visible = items.slice(0, limit);
  for (const item of visible) {
    const target = item.target === null || item.target === undefined ? "(unknown)" : item.target;
    const broken =
      item.broken === true ? " [broken]" : item.broken === false ? "" : " [unknown]";
    lines.push(`- ${item.path} -> ${target}${broken}`);
  }
  if (items.length > limit) {
    lines.push(`- ...and ${items.length - limit} more`);
  }
}

function exitCodeForLevel(level) {
  if (level === "low") return 0;
  if (level === "medium") return 1;
  return 2;
}

function buildNextSteps(report) {
  const steps = [];
  const level = report.risk ? report.risk.level : "low";
  const findings = report.stats ? report.stats.findings : 0;
  const comboFindings = report.stats ? report.stats.comboFindings || 0 : 0;
  const drift = report.drift;
  const trustedFindings = report.stats ? report.stats.trustedFindings || 0 : 0;

  if (comboFindings > 0) {
    steps.push("Review combo risks first; they indicate stacked capabilities.");
  }

  if (findings > 0) {
    steps.push("Inspect top findings in the report and confirm or suppress with ignore rules.");
  }

  if (level === "high" || level === "critical") {
    steps.push("Treat as high risk: pause automation and review suspicious files before running.");
  }

  if (drift) {
    const symlinkDrift = drift.symlinks;
    const symlinkCount = symlinkDrift
      ? symlinkDrift.added.length + symlinkDrift.removed.length + symlinkDrift.changed.length
      : 0;
    const driftCount =
      drift.added.length + drift.removed.length + drift.changed.length + symlinkCount;
    if (drift.rootMismatch) {
      steps.push("Baseline was created for a different root; confirm you are comparing the right target.");
    }
    if (drift.configChanged) {
      steps.push("Baseline config differs from the current config; reconcile ignore paths/rules before trusting drift.");
    }
    if (driftCount > 0) {
      steps.push("Diff added/removed/changed files against the baseline to explain drift.");
      if (level === "high" || level === "critical") {
        steps.push("Do not refresh the baseline until high-risk changes are fully explained.");
      }
      steps.push("If changes are trusted, regenerate the baseline with --save-baseline <file>.");
    } else {
      steps.push("No drift detected; keep the current baseline and re-scan after updates.");
    }
    if (trustedFindings > 0 && findings === 0) {
      steps.push("Findings match the trusted baseline; only re-approve if you intentionally changed those files.");
    }
  } else if (level === "low" && findings === 0) {
    steps.push("Consider saving a baseline with --save-baseline <file> for future compares.");
  } else {
    steps.push("Re-scan after fixes to confirm risk reduction.");
  }

  return Array.from(new Set(steps));
}

function buildVerdict(report) {
  const level = report.risk ? report.risk.level : "low";
  const score = report.risk ? report.risk.score : 0;
  const drift = report.drift
    ? {
        baseline: report.drift.baselinePath,
        added: report.drift.added.length,
        removed: report.drift.removed.length,
        changed: report.drift.changed.length,
        unchanged: report.drift.unchangedCount,
        symlinks: report.drift.symlinks
          ? {
              added: report.drift.symlinks.added.length,
              removed: report.drift.symlinks.removed.length,
              changed: report.drift.symlinks.changed.length,
              unchanged: report.drift.symlinks.unchangedCount
            }
          : null
      }
    : null;
  const symlinkDrift = report.drift ? report.drift.symlinks : null;
  const driftCount = report.drift
    ? report.drift.added.length +
      report.drift.removed.length +
      report.drift.changed.length +
      (symlinkDrift
        ? symlinkDrift.added.length + symlinkDrift.removed.length + symlinkDrift.changed.length
        : 0)
    : 0;
  const effectiveLevel = driftCount > 0 && level === "low" ? "medium" : level;
  const status =
    effectiveLevel === "low"
      ? "pass"
      : effectiveLevel === "medium"
        ? "warn"
        : "fail";

  return {
    status,
    level: effectiveLevel,
    score,
    exitCode: exitCodeForLevel(effectiveLevel),
    mode: report.drift ? "compare" : "scan",
    findings: report.stats ? report.stats.findings : 0,
    comboRisks: report.stats ? report.stats.comboFindings || 0 : 0,
    drift,
    nextSteps: buildNextSteps(report)
  };
}

function attachVerdict(report) {
  report.trust = buildTrustSummary(report);
  report.verdict = buildVerdict(report);
  return report;
}

function buildTrustSummary(report) {
  if (!report || !report.drift) return null;
  const highlights = report.drift.highlights || {};
  const reasons = [];
  const notes = [];
  const baselineVersion = report.drift.baselineVersion || null;
  const currentVersion = report.version || null;
  const versionMismatch =
    baselineVersion && currentVersion && baselineVersion !== currentVersion;

  if (report.drift.rootMismatch) reasons.push("Baseline root mismatch.");
  if (report.drift.configChanged) reasons.push("Baseline config changed.");
  if (versionMismatch) reasons.push("Baseline version mismatch.");
  if (highlights.newCapabilities && highlights.newCapabilities.length) {
    reasons.push(...highlights.newCapabilities);
  }
  if (highlights.dependencyChanges && highlights.dependencyChanges.length) {
    reasons.push("Dependency changes detected.");
  }
  if (
    highlights.installHooks &&
    (highlights.installHooks.added.length || highlights.installHooks.removed.length)
  ) {
    reasons.push("Install hooks changed.");
  }
  if (highlights.notes && highlights.notes.length) {
    notes.push(...highlights.notes);
  }

  const symlinkDrift = report.drift.symlinks;
  const driftCount =
    report.drift.added.length +
    report.drift.removed.length +
    report.drift.changed.length +
    (symlinkDrift
      ? symlinkDrift.added.length + symlinkDrift.removed.length + symlinkDrift.changed.length
      : 0);

  let recommendation = "review";
  if (report.drift.rootMismatch || report.drift.configChanged) {
    recommendation = "do-not-trust";
  } else if (driftCount === 0) {
    recommendation = "safe-to-trust";
  } else if (
    (highlights.newCapabilities && highlights.newCapabilities.length) ||
    (highlights.installHooks && highlights.installHooks.added.length)
  ) {
    recommendation = "do-not-trust";
  }

  if (report.drift.trustMode === "all-findings" && recommendation === "safe-to-trust") {
    recommendation = "review";
  }

  const label =
    recommendation === "safe-to-trust"
      ? "SAFE TO TRUST"
      : recommendation === "do-not-trust"
        ? "DO NOT TRUST"
        : "REVIEW";

  const summary =
    recommendation === "safe-to-trust"
      ? "No new drift detected; baseline remains trusted."
      : recommendation === "do-not-trust"
        ? "High-risk drift detected; do not refresh the baseline yet."
        : "Drift detected; review changes before trusting.";

  return {
    recommendation,
    label,
    summary,
    reasons: Array.from(new Set(reasons)),
    notes: Array.from(new Set(notes))
  };
}

function renderMarkdown(report) {
  if (!report.verdict) attachVerdict(report);
  const lines = [];
  lines.push(`# Driftguard Integrity Report`);
  lines.push("");
  lines.push(`- Version: ${report.version || VERSION}`);
  lines.push(`- Root: ${report.rootPath}`);
  lines.push(`- Overall Risk: ${report.risk.level.toUpperCase()} (score ${report.risk.score})`);
  lines.push(`- Findings: ${report.stats.findings}`);
  lines.push(`- Combo Risks: ${report.stats.comboFindings || 0}`);
  if (report.trust && report.verdict.mode === "compare") {
    lines.push(`- Trust Recommendation: ${report.trust.label}`);
  }
  lines.push("");

  if (report.trust && report.verdict.mode === "compare") {
    lines.push("## Trust Summary");
    lines.push("");
    lines.push(`- Recommendation: ${report.trust.label}`);
    lines.push(`- Summary: ${report.trust.summary}`);
    if (report.trust.reasons.length) {
      lines.push(`- Reasons: ${report.trust.reasons.join("; ")}`);
    }
    if (report.trust.notes.length) {
      lines.push(`- Notes: ${report.trust.notes.join("; ")}`);
    }
    lines.push("");
  }

  lines.push("## Verdict");
  lines.push("");
  lines.push(`- Status: ${report.verdict.status.toUpperCase()}`);
  lines.push(`- Mode: ${report.verdict.mode}`);
  lines.push(`- Exit code: ${report.verdict.exitCode}`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.verdict, null, 2));
  lines.push("```");
  lines.push("");

  if (report.config) {
    lines.push("## Config");
    lines.push("");
    lines.push(`- Config path: ${report.config.path || "(none)"}`);
    lines.push(`- Ignored paths: ${(report.config.ignorePaths || []).length}`);
    lines.push(`- Ignored rules: ${(report.config.ignoreRules || []).length}`);
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total files: ${report.stats.totalFiles}`);
  lines.push(`- Scanned files: ${report.stats.scannedFiles}`);
  lines.push(`- Skipped files: ${report.stats.skippedFiles}`);
  lines.push(`- Ignored files: ${report.stats.ignoredFiles || 0}`);
  if (report.stats.symlinks !== undefined) {
    lines.push(`- Symlinks: ${report.stats.symlinks}`);
  }
  if (report.stats.totalFindings !== undefined) {
    lines.push(`- Total findings: ${report.stats.totalFindings}`);
  }
  if (report.stats.unscoredFindings !== undefined) {
    lines.push(`- Unscored findings: ${report.stats.unscoredFindings}`);
  }
  if (report.stats.trustedFindings !== undefined) {
    lines.push(`- Trusted findings: ${report.stats.trustedFindings}`);
  }
  lines.push("");

  if (report.symlinks) {
    lines.push("## Symlinks");
    lines.push("");
    renderSymlinkList(lines, report.symlinks);
    lines.push("");
  }

  if (report.drift) {
    lines.push("## What Changed Since Trust");
    lines.push("");
    lines.push(`- Baseline: ${report.drift.baselinePath}`);
    if (report.drift.baselineRoot !== undefined) {
      lines.push(`- Baseline root: ${report.drift.baselineRoot || "(unknown)"}`);
    }
    if (report.drift.currentRoot !== undefined) {
      lines.push(`- Current root: ${report.drift.currentRoot || "(unknown)"}`);
    }
    if (report.drift.baselineVersion !== undefined) {
      lines.push(`- Baseline version: ${report.drift.baselineVersion || "(unknown)"}`);
    }
    if (report.drift.configChanged !== undefined) {
      lines.push(`- Config changed: ${report.drift.configChanged ? "yes" : "no"}`);
    }
    lines.push(`- Added files: ${report.drift.added.length}`);
    lines.push(`- Removed files: ${report.drift.removed.length}`);
    lines.push(`- Changed files: ${report.drift.changed.length}`);
    lines.push(`- Unchanged files: ${report.drift.unchangedCount}`);
    if (report.drift.symlinks) {
      lines.push(`- Symlink adds: ${report.drift.symlinks.added.length}`);
      lines.push(`- Symlink removes: ${report.drift.symlinks.removed.length}`);
      lines.push(`- Symlink changes: ${report.drift.symlinks.changed.length}`);
    }
    if (report.drift.highlights) {
      const highlights = report.drift.highlights;
      if (highlights.newCapabilities && highlights.newCapabilities.length) {
        lines.push(`- New capability signals: ${highlights.newCapabilities.join("; ")}`);
      }
      if (highlights.dependencyChanges && highlights.dependencyChanges.length) {
        lines.push(`- Dependency changes: ${highlights.dependencyChanges.join("; ")}`);
      }
      if (highlights.installHooks) {
        if (highlights.installHooks.added.length) {
          lines.push(
            `- New install hooks: ${highlights.installHooks.added.join(", ")}`
          );
        }
        if (highlights.installHooks.removed.length) {
          lines.push(
            `- Removed install hooks: ${highlights.installHooks.removed.join(", ")}`
          );
        }
      }
    }
    lines.push("");
    renderDriftList(lines, "Added files", report.drift.added);
    lines.push("");
    renderDriftList(lines, "Removed files", report.drift.removed);
    lines.push("");
    renderDriftList(lines, "Changed files", report.drift.changed);
    lines.push("");
    if (report.drift.symlinks) {
      renderDriftList(lines, "Symlink adds", report.drift.symlinks.added);
      lines.push("");
      renderDriftList(lines, "Symlink removes", report.drift.symlinks.removed);
      lines.push("");
      renderDriftList(lines, "Symlink changes", report.drift.symlinks.changed);
      lines.push("");
    }
  }

  if (report.comboRisks && report.comboRisks.length) {
    lines.push("## Combo Risks");
    lines.push("");
    for (const combo of report.comboRisks) {
      lines.push(`- ${combo.severity.toUpperCase()} ${combo.id}: ${combo.description}`);
      if (combo.evidence && combo.evidence.length) {
        lines.push(`Evidence: ${combo.evidence.join(", ")}`);
      }
      lines.push("");
    }
  }

  lines.push("## Findings");
  lines.push("");
  if (
    report.stats &&
    report.stats.unscoredFindings > 0 &&
    report.stats.findings === 0
  ) {
    lines.push("Note: unscored findings are shown for context only.");
    lines.push("");
  }
  if (report.findings.length === 0) {
    if (report.stats.trustedFindings) {
      lines.push("No new findings since the baseline.");
      lines.push(`Trusted findings: ${report.stats.trustedFindings}.`);
    } else {
      lines.push("No findings.");
    }
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${formatFinding(finding)}`);
      if (finding.line) {
        lines.push(`Description: ${finding.description}`);
        lines.push(`Line: ${finding.line}`);
      }
      lines.push("");
    }
  }

  if (report.trustedFindings && report.trustedFindings.length) {
    lines.push("");
    lines.push("## Trusted Findings");
    lines.push("");
    renderFindingList(lines, "Trusted findings", report.trustedFindings, 20);
    lines.push("");
  }

  if (report.verdict && report.verdict.nextSteps.length) {
    lines.push("");
    lines.push("## Next Steps");
    lines.push("");
    for (const step of report.verdict.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  lines.push("");
  lines.push("## Manifests");
  lines.push("");
  if (Object.keys(report.manifests).length === 0) {
    lines.push("No manifests detected.");
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(report.manifests, null, 2));
    lines.push("```");
  }

  lines.push("");
  lines.push("## File Hashes");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.hashes, null, 2));
  lines.push("```");

  return lines.join("\n");
}

function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

function writeReports(report, outDir, jsonFile, mdFile) {
  if (!report.verdict) attachVerdict(report);
  ensureDir(outDir);
  const jsonPath = jsonFile || path.join(outDir, "report.json");
  const mdPath = mdFile || path.join(outDir, "report.md");
  ensureDir(path.dirname(jsonPath));
  ensureDir(path.dirname(mdPath));
  fs.writeFileSync(jsonPath, renderJson(report));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

function printSummary(report) {
  if (!report.verdict) attachVerdict(report);
  const scoredFindings = report.findings.filter((finding) => finding.scored !== false);
  const bySeverity = scoredFindings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] || 0) + 1;
    return acc;
  }, {});

  const lines = [];
  lines.push("Driftguard Integrity Summary");
  lines.push(`Root: ${report.rootPath}`);
  lines.push(`Overall Risk: ${report.risk.level.toUpperCase()} (score ${report.risk.score})`);
  lines.push(`Findings: ${report.stats.findings}`);
  if (report.trust && report.verdict.mode === "compare") {
    lines.push(`Trust Recommendation: ${report.trust.label}`);
    if (report.trust.reasons.length) {
      lines.push(`Trust Reasons: ${report.trust.reasons.join("; ")}`);
    }
  }
  if (report.stats.symlinks !== undefined) {
    lines.push(`Symlinks: ${report.stats.symlinks}`);
  }
  if (report.stats.totalFindings !== undefined) {
    lines.push(`Total Findings: ${report.stats.totalFindings}`);
  }
  if (report.stats.unscoredFindings !== undefined) {
    lines.push(`Unscored Findings: ${report.stats.unscoredFindings}`);
  }
  if (report.stats.trustedFindings !== undefined) {
    lines.push(`Trusted Findings: ${report.stats.trustedFindings}`);
  }
  lines.push(`Combo Risks: ${report.stats.comboFindings || 0}`);
  lines.push(
    `Severity: critical=${bySeverity.critical || 0} high=${bySeverity.high || 0} medium=${bySeverity.medium || 0} low=${bySeverity.low || 0}`
  );

  if (report.drift) {
    lines.push(
      `Since trust: added=${report.drift.added.length} removed=${report.drift.removed.length} changed=${report.drift.changed.length} unchanged=${report.drift.unchangedCount}`
    );
    if (report.drift.symlinks) {
      lines.push(
        `Symlinks since trust: added=${report.drift.symlinks.added.length} removed=${report.drift.symlinks.removed.length} changed=${report.drift.symlinks.changed.length} unchanged=${report.drift.symlinks.unchangedCount}`
      );
    }
    if (report.drift.configChanged !== undefined) {
      lines.push(`Baseline config changed: ${report.drift.configChanged ? "yes" : "no"}`);
    }
    if (report.drift.rootMismatch !== undefined) {
      lines.push(`Baseline root mismatch: ${report.drift.rootMismatch ? "yes" : "no"}`);
    }
  }

  const topFindings = scoredFindings.slice(0, 5).map(formatFinding);
  if (topFindings.length) {
    lines.push("Top findings:");
    for (const line of topFindings) lines.push(`- ${line}`);
  }

  if (report.comboRisks && report.comboRisks.length) {
    lines.push("Top combo risks:");
    for (const combo of report.comboRisks.slice(0, 3)) {
      lines.push(`- ${combo.severity.toUpperCase()} ${combo.id}`);
    }
  }

  if (report.verdict && report.verdict.nextSteps.length) {
    lines.push("Next steps:");
    for (const step of report.verdict.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  lines.push(`VERDICT_JSON: ${JSON.stringify(report.verdict)}`);

  return lines.join("\n");
}

module.exports = {
  attachVerdict,
  buildVerdict,
  writeReports,
  printSummary,
  renderMarkdown,
  renderJson
};
