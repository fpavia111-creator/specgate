import { approvalStatus } from "./approval.js";
import { listChangeIds, loadChange, loadLivingSpecs, testableRequirements } from "./changes.js";
import { matchResult, scanTests } from "./trace.js";
import { hasRequirementDrift, renderRequirementDrift, requirementDrift } from "./drift.js";
export function buildTrace(requirements, tests, results) {
    const rows = new Map(requirements.map((r) => [r.id, { requirement: r, tests: [], uncoveredScenarios: [], status: "untested" }]));
    const orphanRefs = [];
    const misplaced = [];
    for (const test of tests) {
        if (test.misplaced) {
            misplaced.push(test);
            continue;
        }
        for (const ref of test.refs) {
            const [reqId, scenarioSlug] = ref.split("#");
            const row = rows.get(reqId);
            if (!row) {
                orphanRefs.push({ test, ref });
                continue;
            }
            const scenario = scenarioSlug ? `${reqId}#${scenarioSlug}` : undefined;
            if (scenario && !row.requirement.scenarios.some((s) => s.id === scenario)) {
                orphanRefs.push({ test, ref });
                continue;
            }
            const m = results ? matchResult(test, results) : { result: "unknown", matches: [] };
            row.tests.push({ test, scenario, result: m.result, matchCount: m.matches.length });
        }
    }
    for (const row of rows.values()) {
        const covered = new Set(row.tests.map((t) => t.scenario).filter(Boolean));
        row.uncoveredScenarios = row.requirement.scenarios.map((s) => s.id).filter((id) => !covered.has(id));
        if (row.tests.length === 0)
            row.status = "untested";
        else if (row.tests.some((t) => t.result === "failed"))
            row.status = "failing";
        else if (row.tests.some((t) => t.result === "ambiguous"))
            row.status = "ambiguous";
        else if (!results || row.tests.every((t) => t.result !== "passed"))
            row.status = "unrun";
        else
            row.status = "verified";
    }
    return { rows: [...rows.values()], orphanRefs, misplaced };
}
function evaluate(report, cfg, checkOrphans) {
    // Each finding carries a location so it can become an annotation or SARIF result.
    const findings = [];
    const add = (rule, message, file, line, extra = {}) => findings.push({ rule, level: "error", message, ...(file ? { file } : {}), ...(line ? { line } : {}), ...extra });
    for (const i of report.specIssues)
        add("spec", `Spec: ${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`, i.file, i.line);
    if (report.approval && report.approval.state !== "approved")
        add("signoff", `Sign-off: ${report.approval.summary}`, report.proposalFile, 1);
    if (report.drift?.detailed) {
        const byId = new Map(report.rows.map((r) => [r.requirement.id, r.requirement]));
        for (const c of [...report.drift.changed, ...report.drift.added]) {
            const r = byId.get(c.id);
            add("drift", `Drift: ${c.id} ${report.drift.added.includes(c) ? "was added" : "changed"} after sign-off by ${report.drift.approval.email}`, r?.file, r?.line, { requirement: c.id });
        }
        for (const c of report.drift.removed)
            add("drift", `Drift: ${c.id} was removed after sign-off by ${report.drift.approval.email}`, report.proposalFile, 1, { requirement: c.id });
        if (report.drift.proposalChanged)
            add("drift", `Drift: proposal.md changed after sign-off by ${report.drift.approval.email}`, report.proposalFile, 1);
    }
    for (const row of report.rows) {
        const id = row.requirement.id;
        const f = row.requirement.file, l = row.requirement.line;
        if (row.status === "untested")
            add("untested", `Untested: ${id} has no test tagged @req ${id}`, f, l, { requirement: id });
        if (row.status === "failing")
            add("failing", `Failing: ${id} has failing tests`, f, l, { requirement: id });
        for (const t of row.tests)
            if (t.result === "ambiguous")
                add("ambiguous", `Ambiguous: ${t.test.file}:${t.test.line} "${t.test.name}" matches ${t.matchCount} results in the JUnit report that cannot be told apart; give the test a unique name or use a reporter that records file names`, t.test.file, t.test.line, { requirement: id });
        if (row.status === "unrun" && report.hasResults)
            add("unrun", `Not run: no test for ${id} appears in the test results`, f, l, { requirement: id });
        if (cfg.requireScenarioCoverage) {
            for (const s of row.uncoveredScenarios)
                add("untested-scenario", `Untested scenario: ${s}`, f, l, { requirement: id });
        }
    }
    for (const t of report.misplaced ?? [])
        add("misplaced-tag", `Misplaced tag: ${t.file}:${t.line} ${t.misplaced}`, t.file, t.line);
    if (checkOrphans) {
        for (const o of report.orphanRefs)
            add("unknown-requirement", `Unknown requirement: ${o.test.file}:${o.test.line} tags @req ${o.ref}`, o.test.file, o.test.line);
    }
    const problems = findings.map((x) => x.message);
    return { ...report, findings, problems, passed: problems.length === 0 };
}
export function checkChange(root, cfg, id, results) {
    const change = loadChange(root, cfg, id);
    const tests = scanTests(root, cfg);
    const { rows, orphanRefs, misplaced } = buildTrace(testableRequirements(change), tests, results);
    // Tags for requirements in other changes or living specs are fine here; only this change's ids matter.
    const ownIds = new Set(change.requirements.map((r) => r.id));
    const ownCaps = new Set(change.requirements.map((r) => r.capability));
    const known = new Set([...loadLivingSpecs(root, cfg).requirements.map((r) => r.id), ...inFlightIds(root, cfg)]);
    const relevantOrphans = orphanRefs.filter((o) => {
        const reqId = o.ref.split("#")[0];
        return ownCaps.has(reqId.split("/")[0]) && !known.has(reqId) && !ownIds.has(reqId);
    });
    const approval = approvalStatus(root, cfg, change);
    const drift = approval.state === "approved" ? null : requirementDrift(root, change, [...approval.valid, ...approval.outdated]);
    return evaluate({
        scope: `change ${id}`,
        changeId: id,
        proposalFile: `${change.relDir}/proposal.md`,
        generatedAt: new Date().toISOString(),
        approval,
        drift,
        rows,
        orphanRefs: relevantOrphans,
        misplaced: misplaced.filter((t) => t.refs.some((ref) => ownCaps.has(ref.split("/")[0]))),
        specIssues: change.issues,
        hasResults: results !== null,
    }, cfg, true);
}
/** Requirement ids proposed by changes that are still in flight. */
function inFlightIds(root, cfg) {
    return listChangeIds(root, cfg).flatMap((id) => loadChange(root, cfg, id).requirements.map((r) => r.id));
}
/** Whole-system check: every requirement in the living specs has a passing test. */
export function checkLiving(root, cfg, results) {
    const living = loadLivingSpecs(root, cfg);
    const tests = scanTests(root, cfg);
    const { rows, orphanRefs, misplaced } = buildTrace(living.requirements, tests, results);
    const extra = new Set(inFlightIds(root, cfg));
    return evaluate({
        scope: "living specs",
        generatedAt: new Date().toISOString(),
        approval: null,
        rows,
        orphanRefs: orphanRefs.filter((o) => !extra.has(o.ref.split("#")[0])),
        misplaced,
        specIssues: living.issues,
        hasResults: results !== null,
    }, cfg, true);
}
const ICON = { verified: "✅", failing: "❌", untested: "⚠️", unrun: "⏺", ambiguous: "❓" };
/** Escape text for a Markdown table cell. */
const cell = (t) => String(t).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function renderMarkdown(r) {
    const out = [];
    out.push(`# Traceability record: ${r.scope}`, "");
    out.push(`Generated ${r.generatedAt} by SpecGate. Verdict: **${r.passed ? "PASS" : "FAIL"}**.`, "");
    if (r.approval) {
        out.push("## Sign-off", "");
        out.push(`State: **${r.approval.state}**. ${r.approval.summary}`, "");
        out.push(`Spec hash: \`${r.approval.currentHash.slice(0, 16)}\``, "");
        if (r.approval.valid.length) {
            out.push("| Approver | Role | When | Note |", "|---|---|---|---|");
            for (const a of r.approval.valid)
                out.push(`| ${cell(`${a.name} <${a.email}>`)} | ${cell(a.role ?? "")} | ${a.at} | ${cell(a.note ?? "")} |`);
            out.push("");
        }
    }
    out.push("## Requirements to tests", "");
    out.push("| | Requirement | Change | Tests | Result |", "|---|---|---|---|---|");
    for (const row of r.rows) {
        const tests = row.tests.length
            ? row.tests.map((t) => `\`${t.test.file}:${t.test.line}\`${t.test.name ? ` ${t.test.name}` : ""}${t.scenario ? ` (${t.scenario.split("#")[1]})` : ""}`).join("<br>")
            : "none";
        const results = row.tests.length ? row.tests.map((t) => t.result).join("<br>") : "";
        out.push(`| ${ICON[row.status]} | \`${row.requirement.id}\`<br>${cell(row.requirement.title)} | ${row.requirement.op === "BASE" ? "" : row.requirement.op} | ${cell(tests)} | ${results} |`);
    }
    out.push("");
    const verified = r.rows.filter((x) => x.status === "verified").length;
    out.push(`${verified}/${r.rows.length} requirements verified${r.hasResults ? "" : " (no test results supplied; pass --junit to record pass/fail)"}.`, "");
    if (r.drift && hasRequirementDrift(r.drift) || r.drift && !r.drift.detailed) {
        out.push("## Drift since sign-off", "", renderRequirementDrift(r.changeId, r.drift), "");
    }
    if (r.problems.length) {
        out.push("## Problems", "");
        for (const p of r.problems)
            out.push(`- ${p}`);
        out.push("");
    }
    return out.join("\n");
}
const stripSnapshot = ({ snapshot, ...a }) => a;
export function toJSON(r) {
    return {
        scope: r.scope,
        generatedAt: r.generatedAt,
        passed: r.passed,
        approval: r.approval && {
            state: r.approval.state,
            specHash: r.approval.currentHash,
            approvers: r.approval.valid.map(stripSnapshot),
            outdated: r.approval.outdated.map(stripSnapshot),
        },
        requirements: r.rows.map((row) => ({
            id: row.requirement.id,
            title: row.requirement.title,
            op: row.requirement.op,
            status: row.status,
            tests: row.tests.map((t) => ({ file: t.test.file, line: t.test.line, name: t.test.name, scenario: t.scenario, result: t.result })),
            uncoveredScenarios: row.uncoveredScenarios,
        })),
        orphanRefs: r.orphanRefs.map((o) => ({ file: o.test.file, line: o.test.line, ref: o.ref })),
        problems: r.problems,
        findings: r.findings,
        drift: r.drift ? { detailed: r.drift.detailed, changed: r.drift.changed.map((c) => c.id), added: r.drift.added.map((c) => c.id), removed: r.drift.removed.map((c) => c.id), proposalChanged: r.drift.proposalChanged } : null,
    };
}
