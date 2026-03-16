# Driftguard

Driftguard is a dependency-light, local-first scanner for integrity and drift detection in repos and skills. It flags risky patterns, hashes files, and compares against a trusted baseline so you can answer "what changed since trust?"

## What It Does
- Local-first recursive scans with ignore support
- Risky pattern detection (shell execution, network calls, sensitive paths, prompt injection, obfuscation)
- SHA-256 file hashes for integrity checks
- Baseline compare to detect drift over time
- JSON and Markdown reports
- Optional concise summary when scanning a directory of skills
- Prompt/documentation awareness to reduce false positives

## Quickstart

```bash
node ./src/cli.js scan <path>
```

Requirements:
- Node.js >= 20

Example: repo integrity scan

```bash
node ./src/cli.js scan ./fixtures/sample-repo
```

Example: trust + compare workflow

```bash
node ./src/cli.js scan ./skills --save-baseline ./reports/skills-baseline.json
node ./src/cli.js compare ./skills --baseline ./reports/skills-baseline.json
```

Example: concise skills summary

```bash
node ./src/cli.js scan ./skills --skills-summary
```

## Agent Workflow (Suggested)
1. Scan the target with `scan` to get a verdict and report artifacts.
2. If risk is low and you trust the state, save a baseline.
3. On subsequent runs, use `compare` to detect drift and focus on new findings since trust.
4. Act on `VERDICT_JSON` in terminal output or the `verdict` block in `report.json`.

Example: agent-friendly loop

```bash
node ./src/cli.js scan ./repo --save-baseline ./reports/baseline.json
node ./src/cli.js compare ./repo --baseline ./reports/baseline.json
```

## Config

Create a `.driftguard.json` in the root (or pass `--config <file>`):

```json
{
  "ignorePaths": ["dist/", "node_modules/", "fixtures/ignored.txt"],
  "ignoreRules": ["net.fetch", "shell.exec_generic", "shell.*"]
}
```

Supported keys:
- `ignorePaths`: Paths relative to the scan root. Simple globbing is supported with `*` and `**`.
  - Patterns without a `/` match any path segment (`node_modules/` matches nested `node_modules` directories).
  - Trailing `/` limits the match to directories (and their contents).
- `ignoreRules`: Rule IDs or prefixes with `*` wildcards.

## Output
- Terminal summary with overall risk, severity counts, and combo risks
- `VERDICT_JSON` line for machine parsing (status, level, exit code, next steps)
- Compare mode highlights what changed since the trusted baseline
- Compare only auto-trusts unchanged files when the baseline version and ignore config match the current scan
- Baseline trust checks use a canonical root identity, not the current working directory
- Reports/baselines written under the scan root are auto-ignored to avoid contaminating future scans
- Symlinks are recorded (not followed) and included in drift reporting
- `reports/report.json`
- `reports/report.md`

## Exit Codes
- `0`: low risk and no drift detected (compare mode)
- `1`: drift detected or medium risk
- `2`: high or critical risk

## Fixtures

```bash
node ./scripts/run-fixtures.js
```

## Notes
- This is a pragmatic scanner. It favors fast heuristics over deep static analysis.
- Integrity hashes cover all files (including binaries); content scanning is limited to text and skips obvious binaries or oversized files.
- Symlinks are never followed; their paths and targets are tracked for integrity/drift.
- Prompt files (`SKILL.md`, `SOUL.md`, `MEMORY.md`) are scanned for prompt-injection patterns only.
- Documentation files (`.md`, `.txt`, etc.) only surface prompt-injection patterns and are marked unscored to avoid treating docs as executable code.
- Code scanning ignores string literals to reduce false positives from embedded examples/help text, except `package.json` scripts which are scanned verbatim to catch risky install hooks.
- Add more rules in `src/rules.js` to extend coverage.

## Minimal References
- `fixtures/sample-repo` contains a tiny repo to test against.
- `fixtures/sample-skill` contains a minimal skill example.
