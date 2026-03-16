# Driftguard Code Review

**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-16
**Scope:** Full codebase review of all src/, tests/, fixtures/, scripts/, CLI, and README
**Method:** Static analysis, behavioral probing with crafted inputs, self-scan, all tests passing (14/14)

---

## 1. Overall Verdict

Solid v0 prototype. Architecture is clean, scanner logic is coherent, tests pass, and the README is substantively honest. The core claims — hashing, heuristic scanning, baseline compare, symlink tracking, output contamination avoidance — all work as advertised.

Two trust-breaking problems need to be fixed before a credible first commit. Several medium issues weaken the security signal but are acceptable as known limitations for a prototype.

---

## 2. Critical Issues (Trust-Breaking)

### C1. `#` comment stripping causes false negatives in JS/TS/JSON files

**Location:** `scanner.js:430-435` (`stripCommentsForScan`)

`stripCommentsForScan()` treats `#` as a line-comment delimiter for all file types. This is correct for Python/shell but wrong for JS/TS/JSON, where `#` is not a comment character.

**Repro:**

```js
// file: sneaky.js
x = 1 # child_process.exec("whoami")
```

Everything after `#` is silently discarded before pattern matching. The `exec` call is invisible to the scanner.

**Verified:** Scanner returns 0 findings for dangerous code placed after `#` in `.js` files.

**Why it's trust-breaking:** A deliberately adversarial skill author could use `#` to hide payloads in JS files. The scanner promises to detect shell exec and network calls; this creates a documented bypass.

**Fix:** Make comment stripping language-aware. Only apply `#` stripping to extensions where it's valid: `.py`, `.sh`, `.bash`, `.zsh`, `.rb`, `.toml`, `.yaml`, `.yml`, `.cfg`, `.conf`, `.ini`. For JS/TS/JSON, only strip `//` and `/* */`. This is ~10 lines of code (pass the file extension into `stripCommentsForScan` and conditionally skip `#`).

---

### C2. Self-scan produces false positives on its own source code

**Repro:**

```bash
node ./src/cli.js scan ./src
# => HIGH shell.shell_true scanner.js:781
```

The regex `/shell\s*=\s*True/i` (defined in `rules.js`) has the case-insensitive `/i` flag. It matches `has.shell = true` at `scanner.js:781`, which is a normal JavaScript boolean assignment — not a Python `shell=True` subprocess flag.

The `isRuleDefinitionFile()` heuristic at `scanner.js:472-479` is supposed to suppress self-referential matches, but it only guards `rules.js` itself. `scanner.js` imports rules but doesn't define them, so the heuristic misses.

**Why it's trust-breaking:** If you ship this tool and the first thing someone does is self-scan, they get a HIGH finding on your own code. "Physician, heal thyself."

**Fix:** Remove the `/i` flag from the `shell.shell_true` regex in `rules.js`. Python's `True` is always capitalized; matching case-insensitively only adds false positives. Change:

```js
// rules.js, shell.shell_true
regex: /shell\s*=\s*True/i
// to:
regex: /shell\s*=\s*True/
```

Verify with `node ./src/cli.js scan ./src` — the false positive should disappear.

---

## 3. Medium Issues

### M1. `sensitive.env` regex is far too broad

**Location:** `rules.js:122` — regex `/\.env\b/i`

**Repro:**

```js
const env = process.env.NODE_ENV;
```

This matches `.env` inside `process.env`, producing a HIGH `sensitive.env` finding on virtually every Node.js project that reads environment variables.

**Impact:** Inflates risk scores, trains users to ignore findings.

**Fix:** Make the regex more specific to file path references (e.g., `/(?:['"\s\/])\.env(?:\.\w+)?(?:['"\s]|$)/`) or downgrade to `medium` severity with `low` confidence.

---

### M2. `net.webhook` regex matches any mention of the word "webhook"

**Location:** `rules.js:108` — regex `/\bwebhook\b/i`

Fires on comments, variable names, documentation. `// Configure the webhook URL in settings` triggers a MEDIUM network finding.

**Fix:** Require more context: `/webhook[_\s]*(url|endpoint|secret)/i` or match only in function-call/assignment context.

---

### M3. Dynamic property access and computed `require()` bypass detection

**Repro (0 scored findings):**

```js
const cp = require("child_process");
const method = "exec";
cp[method]("whoami");  // bracket access — not detected

const mod = "child" + "_process";
require(mod).exec("id");  // computed require — not detected
```

`extractChildProcessAliases` correctly identifies `cp` as an alias, but `buildAliasRules` only generates regexes for dot-access (`cp.exec(`), not bracket-access (`cp["exec"](`).

**Fix (for v0):** Document this limitation explicitly. Optionally add a low-confidence rule that flags `require(` with non-string-literal arguments.

---

### M4. `stripStringLiterals` doesn't handle template literal expressions

**Location:** `scanner.js:482-518`

```js
const cmd = `${child_process.exec("whoami")}`;
```

The backtick stripping treats the entire template literal as a string and removes it, including `${...}` expressions which contain real executable code.

**Fix:** When inside a template literal and encountering `${`, switch back to "code mode" until the matching `}`. A simple depth counter handles the common case.

---

### M5. Compare mode silently suppresses all findings from unchanged files

When `trustMode: "hashes"` is active (matching version + config + root), findings in unchanged files are moved to `trustedFindings` and excluded from the risk score. If a baseline was saved without reviewing findings, compare mode will permanently suppress them — including CRITICAL ones.

**Repro:**

```bash
# Save baseline over a file with critical findings (no review)
node ./src/cli.js scan ./dangerous-repo --save-baseline baseline.json
# Compare with no changes — reports risk: LOW, findings: 0
node ./src/cli.js compare ./dangerous-repo --baseline baseline.json
```

This is by design, but there's no warning when trusted findings contain high-severity items.

**Fix:** Add a warning when `trustedFindings` contains high/critical items: *"Warning: N trusted findings include high/critical severity items from your baseline. Re-review with a full scan."*

---

### M6. No test for compare mode with changed ignore config

The CLI correctly detects `configChanged` and falls back to `all-findings` trust mode (`cli.js:426-428`). But there's no test for this path. If the logic regresses, trust could be granted when it shouldn't be.

**Fix:** Add a test that saves a baseline with one config, changes the config, runs compare, and asserts `trustMode: "all-findings"`.

---

### M7. Self-scan fires `sensitive.driftguard` on CLI help text

`node ./src/cli.js scan ./src` also produces `LOW sensitive.driftguard cli.js:30` because the help text mentions `.driftguard.json`. This is low-severity noise, but it's another self-scan blemish.

---

## 4. Nice-to-Have Improvements

### N1. Hash-drift fixture baseline version mismatch

`fixtures/hash-drift/baseline.json` has `"version": "1.1"` while the tool is `0.1.0`. The `run-fixtures.js` drift demo never exercises the `trustMode: "hashes"` path (falls back to `all-findings` due to version mismatch).

### N2. `totalFiles` stat name is misleading

`stats.totalFiles = files.length + ignoredFiles.length` doesn't count files in `DEFAULT_IGNORE_DIRS` (`.git`, `node_modules`). "Total" means "total eligible files before ignore patterns." Consider renaming or documenting.

### N3. No `--quiet` or `--json-only` output mode

For CI integration, a `--quiet` mode (only VERDICT_JSON) or `--stdout` (JSON to stdout, no file writes) would be useful.

### N4. `toPosix()` defined in both `scanner.js` and `cli.js`

Minor duplication.

### N5. TASK*.md files should not be committed

Six task-tracking files (`TASK5.md` through `TASK10.md`) are internal iteration artifacts. Add to `.gitignore` or remove before first commit.

### N6. `package.json` script detection works but context label is confusing

`package.json` gets `context = "manifest"` but falls into the `code || manifest` branch of `scanText()`. The README correctly describes the behavior, but someone reading the code might expect a separate manifest-specific rule set.

---

## 5. Ship / No-Ship Recommendation

**Conditional ship.** Fix C1, C2, and remove TASK files before the first commit.

| Item | Effort | Blocking? |
|------|--------|-----------|
| C1: Language-aware `#` stripping | ~10 lines | Yes |
| C2: Remove `/i` from `shell.shell_true` | 1 character | Yes |
| Remove TASK*.md files | Trivial | Yes (hygiene) |
| M1-M7 | Small-medium each | No (fast follow) |
| N1-N6 | Trivial each | No |

After those three fixes, this is a credible v0 that does what it says. The false-negative paths (M3, M4) are inherent to heuristic scanning and don't misrepresent the tool. The false-positive issues (M1, M2) are tuning work for the first weeks of real use.

The compare/baseline integrity semantics are well-designed: root identity, config change detection, version-gated trust, and symlink tracking are the right architectural choices. Output contamination auto-ignore works. Test suite (14 tests) covers the important behavioral contracts.

---

## Appendix: What the README Gets Right

- "Pragmatic scanner... favors fast heuristics over deep static analysis" — accurate and appropriately modest
- "Symlinks are never followed" — verified correct
- "Code scanning ignores string literals... except package.json scripts" — verified correct
- "Reports/baselines written under the scan root are auto-ignored" — verified correct
- "Baseline trust checks use a canonical root identity, not the current working directory" — verified correct
- "Documentation files only surface prompt-injection patterns and are marked unscored" — verified correct
