# Changelog

## 0.3.0 (2026-10-15)

### Added
- **Self-hosting:** SpecGate's own requirements live in `openspec/specs/` (6 capabilities, 23 requirements). Every test is tagged, and `npm test` ends with `npm run gate`, which checks them against the suite's own JUnit results. A self-host test also asserts that every requirement has a tagged test and that no tag points at nothing.
- **node:test reporter** `specgate/junit-reporter` (`dist/src/reporter.js`): JUnit XML with `file` and `line` on every testcase, plus nested suites. This closes the node:test ambiguity gap. Line numbers pin the exact test when names repeat within a file.
- **Requirement drift:** sign-offs store a per-requirement snapshot. The new `specgate drift <change>` command and MCP tool `drift` show changed, added and removed requirements (and proposal changes) with a line diff. `check` reports `Drift:` findings on stale changes, and the Markdown record gets a "Drift since sign-off" section.
- **Code drift:** `specgate drift --base REF`, and `check --base REF`, use the new `areas` config to flag changed code in a capability's area with no spec change for it. They also warn about unmapped code (an error with `requireAreaCoverage`) and changed test files with no tags.
- **Reports:** `check --format text|json|md|html|sarif|github|pr-comment`, `--out`, `--sarif`, `--html`, `--summary` and `--annotations`. `--write` also writes `traceability.html`. Findings carry file, line and rule for SARIF 2.1.0 and GitHub annotations.
- **Action:** prints annotations, writes SARIF (`sarif` input) and the PR-comment summary (`summary-file` output), and has an optional `drift` input. The generated workflow writes the same reports.
- **Test runners:** Go package classnames are matched to the test file's directory, pytest class-based classnames to their module file, and Gradle `name()` names are accepted. Jest, Vitest, pytest, Go and Java fixtures are tested.

### Changed
- `approve`'s automation check looks only at stdin (and agent/CI variables), so `specgate approve … | tee log` works for a person at a terminal.
- `@req` tags count only in comments, trailing comments or test titles (see README, *Upgrading from 0.2*).
- Markdown table cells escape `|`.
- `package.json` has an `exports` map (`.`, `./junit-reporter`, `./dist/*`, `./src/*`, `./package.json`).
- Version 0.3.0 in `package.json`, the plugin manifest, `.mcp.json`, the Action default and the MCP server.

### Compatibility
- 0.2 `approvals.json` files remain valid. Without a snapshot, drift reports only whole-change staleness until re-approval.
- `traceability.json` and `check --json` keep every 0.2 field and add `findings` and `drift`. Default text output is unchanged.


## 0.2.0 (2026-10-15)

### Security and correctness
- **JUnit matching:** results now match only on the full test name (optionally qualified by `describe` titles from the same file) and, when the report records it, the same file. Matching on the bare end of a name is gone. Indistinguishable duplicate results are reported as `Ambiguous` and fail the gate.
- **Approvers:** matched by email only. Names in `approvers` are now a configuration error.
- **New `verify-approvals` command:** checks every sign-off added in a PR against approving PR reviews by the GitHub login mapped in the base branch's `github.approverLogins`. Optional `github.requireReviewOnHead`. Run by the Action and the generated workflow.
- **`approve` refuses** in agent, CI or non-interactive contexts (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CURSOR_AGENT`, `CODEX_SANDBOX`, `GEMINI_CLI`, `CI`, `GITHUB_ACTIONS`, or no TTY) unless `--i-am-human` is passed.
- **GitHub Action:** inputs go through `env:` and are validated. The version is pinned (default `0.2.0`, exact `x.y.z` only). Runs `verify-approvals` on PR events.
- **MCP server:** confined to `SPECGATE_ROOT` (symlink-aware), and JUnit paths are confined to the root. Change ids must be kebab-case slugs everywhere (CLI too).
- **Configuration is validated:** `requiredApprovals` must be an integer ≥ 1, approvers must be emails, `openspecDir` must stay inside the repo. `init --required` and `--approver` are validated.

### Fixes
- Generated plans name the real skill `specgate:tdd` (was `specgate:tdd-from-spec`).
- `--key=value` keeps everything after the first `=`.
- A `@req` tag above `describe`/`suite`/`context` is reported as a misplaced tag instead of being attached to the next test.
- JUnit is parsed with a real XML parser (`@xmldom/xmldom`). Malformed XML is an error, and entities and CDATA are handled.

### Project
- Source restored to `src/` (ES-module JavaScript, built by `tsc` with `allowJs`), with a `tsconfig.json` and a 41-test `node:test` suite.
- MIT licence, Copyright (c) 2026 Kurt Francisco. README rewritten to match the code; NOTICE lists the new dependency.
- Generated workflow also triggers on `pull_request_review`, sets least-privilege permissions and uses `fetch-depth: 0`.
