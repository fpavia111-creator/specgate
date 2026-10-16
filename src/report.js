/** Output formats for gate results: HTML, PR comment, SARIF 2.1.0 and GitHub workflow annotations. */
import { toJSON } from "./gate.js";
const VERSION = "0.3.0";
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { verified: "verified", failing: "failing", untested: "untested", unrun: "not run", ambiguous: "ambiguous" };
/** Self-contained HTML traceability report (no scripts, no external assets). */
export function renderHTML(reports, { title = "SpecGate traceability report" } = {}) {
    const parts = [];
    for (const r of reports) {
        const j = toJSON(r);
        parts.push(`<section><h2>${esc(r.scope)} <span class="${r.passed ? "pass" : "fail"}">${r.passed ? "PASS" : "FAIL"}</span></h2>`);
        if (r.approval) {
            parts.push(`<p>Sign-off: <b>${esc(r.approval.state)}</b>. ${esc(r.approval.summary)} Spec hash <code>${esc(r.approval.currentHash.slice(0, 16))}</code>.</p>`);
            if (j.approval.approvers.length)
                parts.push(`<table><tr><th>Approver</th><th>Role</th><th>When</th><th>Note</th></tr>${j.approval.approvers.map((a) => `<tr><td>${esc(a.name)} &lt;${esc(a.email)}&gt;</td><td>${esc(a.role)}</td><td>${esc(a.at)}</td><td>${esc(a.note)}</td></tr>`).join("")}</table>`);
        }
        parts.push(`<table><tr><th>Status</th><th>Requirement</th><th>Change</th><th>Tests</th><th>Result</th></tr>`);
        for (const q of j.requirements) {
            const tests = q.tests.length ? q.tests.map((t) => `<code>${esc(t.file)}:${t.line}</code> ${esc(t.name)}${t.scenario ? ` (${esc(t.scenario.split("#")[1])})` : ""}`).join("<br>") : "none";
            parts.push(`<tr class="${esc(q.status)}"><td>${esc(LABEL[q.status])}</td><td><code>${esc(q.id)}</code><br>${esc(q.title)}</td><td>${q.op === "BASE" ? "" : esc(q.op)}</td><td>${tests}</td><td>${q.tests.map((t) => esc(t.result)).join("<br>")}</td></tr>`);
        }
        parts.push("</table>");
        if (r.problems.length)
            parts.push(`<h3>Problems</h3><ul>${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`);
        parts.push("</section>");
    }
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui,sans-serif;margin:2em;max-width:1100px}table{border-collapse:collapse;margin:1em 0;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}.pass{color:#1a7f37}.fail{color:#cf222e}tr.failing td:first-child,tr.untested td:first-child,tr.ambiguous td:first-child{color:#cf222e}tr.verified td:first-child{color:#1a7f37}code{font-size:12px}</style>
</head><body><h1>${esc(title)}</h1><p>Generated ${esc(new Date().toISOString())} by SpecGate ${VERSION}.</p>
${parts.join("\n")}
</body></html>
`;
}
export const COMMENT_MARKER = "<!-- specgate:summary -->";
/** Short Markdown summary for a PR comment or job summary. Starts with a marker so a bot can update it in place. */
export function renderPRComment(reports, { codeDrift } = {}) {
    const passed = reports.every((r) => r.passed) && (!codeDrift || codeDrift.passed);
    const out = [COMMENT_MARKER, `### SpecGate: ${passed ? "✅ PASS" : "❌ FAIL"}`, "", "| Scope | Verdict | Requirements verified | Sign-off |", "|---|---|---|---|"];
    for (const r of reports) {
        const v = r.rows.filter((x) => x.status === "verified").length;
        out.push(`| ${r.scope} | ${r.passed ? "PASS" : "FAIL"} | ${v}/${r.rows.length} | ${r.approval ? r.approval.state : "n/a"} |`);
    }
    const problems = reports.flatMap((r) => r.problems.map((p) => `${r.scope}: ${p}`));
    const driftItems = codeDrift?.findings ?? [];
    if (problems.length || driftItems.length) {
        out.push("", "<details><summary>" + `${problems.length + driftItems.length} finding(s)` + "</summary>", "");
        for (const p of problems.slice(0, 50))
            out.push(`- ${p.replace(/\r?\n/g, " ")}`);
        for (const f of driftItems.slice(0, 50))
            out.push(`- ${f.level === "warning" ? "(warning) " : ""}${f.message}`);
        if (problems.length > 50 || driftItems.length > 50)
            out.push("- …more in the full report");
        out.push("", "</details>");
    }
    return out.join("\n") + "\n";
}
const allFindings = (reports, codeDrift) => [...reports.flatMap((r) => r.findings), ...(codeDrift?.findings ?? [])];
/** SARIF 2.1.0, for GitHub code scanning or any SARIF viewer. */
export function toSARIF(reports, { codeDrift } = {}) {
    const findings = allFindings(reports, codeDrift);
    const ruleIds = [...new Set(findings.map((f) => f.rule))].sort();
    return {
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
        runs: [{
                tool: { driver: { name: "SpecGate", version: VERSION, informationUri: "https://www.npmjs.com/package/specgate", rules: ruleIds.map((id) => ({ id, shortDescription: { text: id } })) } },
                results: findings.map((f) => ({
                    ruleId: f.rule,
                    level: f.level === "warning" ? "warning" : "error",
                    message: { text: f.message },
                    ...(f.file ? { locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: Math.max(1, f.line ?? 1) } } }] } : {}),
                    ...(f.requirement ? { properties: { requirement: f.requirement } } : {}),
                })),
            }],
    };
}
const escData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
/** GitHub Actions workflow commands, one per finding (`::error file=…,line=…::message`). */
export function toGitHubAnnotations(reports, { codeDrift } = {}) {
    return allFindings(reports, codeDrift).map((f) => {
        const props = [f.file ? `file=${escProp(f.file)}` : null, f.file && f.line ? `line=${f.line}` : null, `title=${escProp(`SpecGate ${f.rule}`)}`].filter(Boolean).join(",");
        return `::${f.level === "warning" ? "warning" : "error"} ${props}::${escData(f.message)}`;
    }).join("\n");
}
