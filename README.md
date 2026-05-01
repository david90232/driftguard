# DriftGuard

Local-first security drift scanner for repos and AI agent skills. DriftGuard tracks trusted baselines, file hashes, dependency drift, install hooks, symlinks, prompt-injection signals, and risky capability changes so you can answer one question: **"what changed since I last trusted this?"**

Scan a codebase for risky patterns, save a trusted baseline when you're satisfied, then compare later to see exactly what drifted.

## Quickstart

```bash
# Scan a repo and review findings
driftguard scan ./my-repo

# If the findings are acceptable, trust it (saves a baseline)
driftguard trust ./my-repo

# After changes, compare against the trusted baseline
driftguard compare ./my-repo --baseline ./reports/baseline.json
```

Requires Node.js >= 20. No external dependencies.

Run it directly from the repo with `node ./src/cli.js ...`.
If you install it globally, link it locally, or publish it to npm later, you can use the shorter `driftguard ...` form.

## Commands

| Command | What it does |
|---------|-------------|
| `driftguard scan <path>` | Scan and report findings, hashes, and risk level |
| `driftguard trust <path>` | Scan + save a trusted baseline (defaults to `./reports/baseline.json`) |
| `driftguard compare <path> --baseline <file>` | Compare current state against a trusted baseline |

### Options

```
--out <dir>             Output directory for reports (default: ./reports)
--json <file>           JSON report path
--md <file>             Markdown report path
--config <file>         Config path (default: <root>/.driftguard.json)
--save-baseline <file>  Write baseline hash file after scan
--baseline <file>       Baseline hash file (compare/trust mode)
--trusted-by <name>     Record who approved a trusted baseline
--note <text>           Record an approval note on a trusted baseline
--skills-summary        Concise summary when scanning a directory of skills
--help, -h              Show help
```

## The Trust Workflow

```
  scan ──► review findings ──► trust (save baseline)
                                     │
                         (time passes, code changes)
                                     │
                               compare ──► "what changed since trust?"
                                     │
                         review drift ──► re-trust or reject
```

1. **Scan** a repo or skill to get findings, risk level, and file hashes.
2. **Review** the findings. If acceptable, **trust** it to save a baseline.
3. After updates, **compare** to see what drifted — new files, changed files, new capabilities, dependency changes.
4. The verdict tells you whether to re-trust or investigate further.

Trusted baselines include approval metadata: timestamp, approver, optional note,
git commit, package version, risk summary, and finding capability summary. Example:

```bash
driftguard trust ./my-repo --trusted-by David --note "Reviewed before v0.2.6 publish"
```

## What It Detects

- **Shell execution** — `eval()`, `child_process`, `subprocess`, `curl | sh`, etc.
- **Network calls** — `fetch()`, `axios`, `requests`, `curl`, webhooks
- **Sensitive paths** — `.env`, SSH keys, config files
- **Prompt injection** — instruction-override attempts, roleplay coercion, and tool-pressure language
- **Obfuscation** — base64, long hex strings
- **Combo risks** — shell + network = RCE risk; network + sensitive = exfiltration risk
- **Dependency drift** — added/removed deps in `package.json`, `requirements.txt`, `pyproject.toml`
- **Install hooks** — `preinstall`, `postinstall`, `prepare` scripts in `package.json`

## Config

Create a `.driftguard.json` in the scan root (or pass `--config <file>`):

```json
{
  "ignorePaths": ["dist/", "node_modules/", "fixtures/ignored.txt"],
  "ignoreRules": ["net.fetch", "shell.exec_generic", "shell.*"]
}
```

- `ignorePaths`: Relative paths with simple glob support (`*`, `**`). Patterns without `/` match any path segment.
- `ignoreRules`: Rule IDs or prefixes with `*` wildcards.

## Output

- **Terminal summary** with risk level, severity breakdown, and drift status
- **Risk diff** showing baseline risk vs current drift risk, score delta, finding delta, and new capability categories
- **`VERDICT_JSON`** line for machine parsing (status, level, exit code, next steps)
- **`reports/report.json`** — full structured report
- **`reports/report.md`** — human-readable Markdown report

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Low risk, no drift |
| `1` | Medium risk or drift detected |
| `2` | High or critical risk |

## Skills Summary

Scan a directory of skills (identified by `SKILL.md`) with a concise per-skill breakdown:

```bash
driftguard scan ./skills --skills-summary
```

## Notes

- Zero dependencies — uses only Node.js built-ins.
- Integrity hashes cover all files (including binaries); content scanning is limited to text.
- Symlinks are tracked for drift but never followed.
- Prompt files (`SKILL.md`, `SOUL.md`, `MEMORY.md`) are scanned for prompt injection only.
- Documentation files (`.md`, `.txt`, etc.) only surface prompt-injection patterns and are marked unscored.
- Code scanning strips string literals to reduce false positives. `package.json` scripts are scanned verbatim to catch risky install hooks.
- Reports/baselines written under the scan root are auto-ignored to avoid contaminating future scans.
- Extend coverage by adding rules in `src/rules.js`.

## Fixtures

Test against included examples:

```bash
node ./scripts/run-fixtures.js
```

- `fixtures/sample-repo` — tiny repo with JS and Python
- `fixtures/sample-skill` — minimal skill with prompt injection test
- `fixtures/ignore-config` — demonstrates ignore rules
- `fixtures/hash-drift` — demonstrates baseline comparison
