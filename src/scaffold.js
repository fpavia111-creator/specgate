import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { approvalStatus } from "./approval.js";
import { loadChange, testableRequirements } from "./changes.js";
import { CONFIG_FILE, DEFAULT_CONFIG } from "./config.js";
import { slugify } from "./spec.js";
import { assertChangeId, isEmail } from "./ids.js";
function writeIfMissing(path, content, created, root) {
    if (existsSync(path))
        return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    created.push(path.slice(root.length + 1));
}
const WORKFLOW = `name: SpecGate
on:
  pull_request:
  pull_request_review:
    types: [submitted, dismissed]
permissions:
  contents: read
  pull-requests: read
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Run your tests so they write a JUnit XML report, for example:
      #   npx vitest run --reporter=junit --outputFile=reports/junit.xml
      #   pytest --junitxml=reports/junit.xml
      - run: npm ci && npm test
      # Every sign-off added in this PR must match an approving PR review by
      # the GitHub login mapped to that email in the base branch's specgate.json.
      - run: npx specgate verify-approvals --base "origin/$BASE_REF"
        env:
          BASE_REF: \${{ github.event.pull_request.base.ref }}
          GITHUB_TOKEN: \${{ github.token }}
      - run: npx specgate check --all --junit reports/junit.xml --write --sarif specgate.sarif --summary specgate-summary.md --annotations specgate-annotations.txt
      - if: always()
        run: |
          [ -f specgate-annotations.txt ] && cat specgate-annotations.txt
          [ -f specgate-summary.md ] && cat specgate-summary.md >> "$GITHUB_STEP_SUMMARY"
          true
`;
/** Set up SpecGate in a repository: config, OpenSpec folders, CI workflow and CODEOWNERS guidance. */
export function init(root, opts = {}) {
    const created = [];
    const required = opts.requiredApprovals ?? 1;
    if (!Number.isInteger(required) || required < 1)
        throw new Error(`--required must be a whole number of at least 1 (got ${JSON.stringify(opts.requiredApprovals)})`);
    for (const a of opts.approvers ?? [])
        if (!isEmail(a))
            throw new Error(`--approver must be an email address (got ${JSON.stringify(a)})`);
    const cfg = {
        ...DEFAULT_CONFIG,
        approvers: opts.approvers ?? [],
        requiredApprovals: opts.requiredApprovals ?? 1,
    };
    writeIfMissing(join(root, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n", created, root);
    writeIfMissing(join(root, cfg.openspecDir, "specs", ".gitkeep"), "", created, root);
    writeIfMissing(join(root, cfg.openspecDir, "changes", ".gitkeep"), "", created, root);
    writeIfMissing(join(root, ".github", "workflows", "specgate.yml"), WORKFLOW, created, root);
    // CODEOWNERS accepts emails of users with verified emails on GitHub, or @user / @org/team.
    const owners = cfg.approvers.length ? cfg.approvers.join(" ") : "@your-org/spec-approvers";
    writeIfMissing(join(root, ".github", "CODEOWNERS.specgate"), `# Merge these lines into .github/CODEOWNERS so recording a sign-off needs a reviewer's approval.\n/${cfg.openspecDir}/changes/*/approvals.json ${owners}\n/${CONFIG_FILE} ${owners}\n`, created, root);
    return created;
}
/** Create an OpenSpec-format change folder (for teams not running the OpenSpec CLI). */
export function newChange(root, cfg, id, capability, why = "") {
    const slug = assertChangeId(slugify(id));
    if (!slugify(capability))
        throw new Error("Capability must contain letters or numbers");
    const dir = join(root, cfg.openspecDir, "changes", slug);
    if (existsSync(dir))
        throw new Error(`Change "${slug}" already exists`);
    const created = [];
    writeIfMissing(join(dir, "proposal.md"), `# Change: ${id}\n\n## Why\n${why || "TODO: the problem this solves and who asked for it"}\n\n## What Changes\n- TODO: behaviour changes\n\n## Impact\n- Affected specs: ${capability}\n- Affected code: TODO\n`, created, root);
    writeIfMissing(join(dir, "specs", slugify(capability), "spec.md"), `## ADDED Requirements\n\n### Requirement: TODO short name\nThe system SHALL TODO observable behaviour.\n\n#### Scenario: TODO happy path\n- **WHEN** TODO trigger\n- **THEN** TODO outcome\n`, created, root);
    writeIfMissing(join(dir, "tasks.md"), `## 1. Implementation\n- [ ] 1.1 Sign off the spec (\`specgate approve ${slug}\`)\n- [ ] 1.2 Generate the plan (\`specgate plan ${slug}\`)\n`, created, root);
    return created;
}
/**
 * Write a test-first implementation plan for an approved change. The plan
 * follows the Superpowers plan format, with one task per requirement and the
 * `@req` tag each test must carry.
 */
export function writePlan(root, cfg, id, opts = {}) {
    const change = loadChange(root, cfg, id);
    const status = approvalStatus(root, cfg, change);
    if (status.state !== "approved") {
        throw new Error(`Change "${id}" is not signed off. ${status.summary} Ask an approver to run \`specgate approve ${id}\`.`);
    }
    const path = join(change.dir, "plan.md");
    if (existsSync(path) && !opts.force)
        throw new Error(`${change.relDir}/plan.md already exists (use --force to overwrite)`);
    const reqs = testableRequirements(change);
    const lines = [];
    lines.push(`# ${id} Implementation Plan`, "");
    lines.push("> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended), superpowers:executing-plans or specgate:tdd to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.", "");
    lines.push(`**Goal:** Implement the signed-off spec for \`${id}\` (spec hash \`${status.currentHash.slice(0, 16)}\`).`, "");
    lines.push(`**Signed off by:** ${status.valid.map((a) => `${a.name}${a.role ? ` (${a.role})` : ""}`).join(", ")}`, "");
    lines.push("**Traceability rule:** every test written for this plan carries a `@req <id>` tag (in a comment above the test or in its title). `specgate check " +
        id +
        "` fails until every requirement below has a passing tagged test.", "");
    lines.push("---", "");
    reqs.forEach((r, i) => {
        const n = i + 1;
        lines.push(`### Task ${n}: ${r.title}`, "");
        lines.push(`**Requirement:** \`${r.id}\` (${r.op === "BASE" ? "existing" : r.op.toLowerCase()})`, "");
        if (r.body)
            lines.push(r.body.split("\n").map((l) => `> ${l}`).join("\n"), "");
        lines.push("**Files:** <fill in: files to create or modify, and the test file>", "");
        const scenarios = r.scenarios.length ? r.scenarios : [{ id: r.id, title: r.title, body: "" }];
        let step = 1;
        for (const s of scenarios) {
            const tag = s.id === r.id ? r.id : s.id;
            lines.push(`- [ ] **Step ${step++}: Write the failing test for "${s.title}"** tagged \`@req ${tag}\``);
            if (s.body)
                lines.push(s.body.split("\n").map((l) => `  ${l}`).join("\n"));
            lines.push(`- [ ] **Step ${step++}: Run it and confirm it fails for the expected reason**`);
        }
        lines.push(`- [ ] **Step ${step++}: Write the minimal code that makes the test(s) pass**`);
        lines.push(`- [ ] **Step ${step++}: Run the full test suite and confirm it passes**`);
        lines.push(`- [ ] **Step ${step++}: Commit** (\`git commit -m "feat(${r.capability}): ${r.title.toLowerCase()} [${r.id}]"\`)`, "");
    });
    lines.push("### Final task: Verify traceability", "");
    lines.push(`- [ ] Run the tests with a JUnit report, then \`specgate check ${id} --junit <report.xml> --write\``);
    lines.push(`- [ ] Commit \`${change.relDir}/traceability.md\` and \`traceability.json\` with the change`, "");
    const content = lines.join("\n");
    writeFileSync(path, content);
    return { path: `${change.relDir}/plan.md`, content };
}
