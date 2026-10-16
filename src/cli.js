#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAutomation } from "./agent.js";
import { approvalStatus, approve, gitIdentity, revoke } from "./approval.js";
import { listChangeIds, loadChange, loadLivingSpecs } from "./changes.js";
import { loadConfig } from "./config.js";
import { checkChange, checkLiving, renderMarkdown, toJSON } from "./gate.js";
import { init, newChange, writePlan } from "./scaffold.js";
import { loadJUnit } from "./trace.js";
import { codeDrift, hasRequirementDrift, renderRequirementDrift, requirementDrift } from "./drift.js";
import { renderHTML, renderPRComment, toGitHubAnnotations, toSARIF } from "./report.js";
import { fetchReviews, verifyApprovals } from "./verify.js";
const HELP = `SpecGate: sign-off and traceability for spec-driven development

Usage: specgate <command> [options]

  init [--approver EMAIL]... [--required N]   Set up specgate.json, OpenSpec folders and CI
  new <change> --capability NAME [--why TEXT]  Scaffold an OpenSpec change
  list                                         List in-flight changes and their sign-off state
  show <change>                                Show requirement ids to tag tests with
  validate [<change>]                          Check spec format (all changes if omitted)
  approve <change> [--as "Name <email>"] [--role ROLE] [--note TEXT] [--i-am-human]
                                               Sign off the change's current spec. Refuses in
                                               agent, CI or non-interactive contexts unless
                                               --i-am-human is given.
  revoke <change> [--email EMAIL]              Withdraw a sign-off
  status <change>                              Show sign-off state
  plan <change> [--force]                      Write a test-first plan (needs sign-off)
  check <change> | --all [--junit FILE]... [--write] [--json] [--base REF]
        [--format text|json|md|html|sarif|github|pr-comment] [--out FILE]
        [--sarif FILE] [--html FILE] [--summary FILE] [--annotations FILE]
                                               Gate: sign-off valid, no drift, every requirement
                                               has a passing @req-tagged test (and, with --base,
                                               no code drift). Exits 1 on failure.
  drift <change> [--base REF] [--json]         What changed in each requirement since sign-off
  drift --base REF [--json]                    Code changed since REF outside specced areas
  verify-approvals --base REF [--pr N] [--repo OWNER/NAME] [--head SHA] [--reviews FILE]
                                               CI: every sign-off added since REF must match an
                                               approving PR review (needs GITHUB_TOKEN unless
                                               --reviews is given). Exits 1 on failure.

Options: --root DIR (default: current directory)`;
const FORMATS = ["text", "json", "md", "html", "sarif", "github", "pr-comment"];
function renderCodeDrift(cd, base) {
    const lines = [`${cd.passed ? "PASS" : "FAIL"}  code drift since ${base}: ${cd.files} changed file(s), ${cd.findings.length} finding(s)`];
    for (const f of cd.findings)
        lines.push(`      ${f.level === "warning" ? "warning: " : ""}${f.message}`);
    return lines.join("\n");
}
export function formatReports(format, reports, drift) {
    switch (format) {
        case "json":
            return JSON.stringify(reports.map(toJSON), null, 2) + "\n";
        case "md":
            return reports.map(renderMarkdown).join("\n---\n\n") + (drift ? `\n${renderCodeDrift(drift, "base")}\n` : "");
        case "html":
            return renderHTML(reports);
        case "sarif":
            return JSON.stringify(toSARIF(reports, { codeDrift: drift }), null, 2) + "\n";
        case "github":
            return toGitHubAnnotations(reports, { codeDrift: drift }) + "\n";
        case "pr-comment":
            return renderPRComment(reports, { codeDrift: drift });
        default: {
            const lines = [];
            for (const report of reports) {
                const verified = report.rows.filter((r) => r.status === "verified").length;
                lines.push(`${report.passed ? "PASS" : "FAIL"}  ${report.scope}: ${verified}/${report.rows.length} requirements verified${report.approval ? `, sign-off ${report.approval.state}` : ""}`);
                for (const p of report.problems)
                    lines.push(`      ${p}`);
            }
            if (drift)
                lines.push(renderCodeDrift(drift, "base"));
            return lines.join("\n") + "\n";
        }
    }
}
export function parseArgs(argv) {
    const args = { _: [], flags: new Map() };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            const k = eq >= 0 ? a.slice(2, eq) : a.slice(2);
            const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
            const next = argv[i + 1];
            const value = inline ?? (next !== undefined && !next.startsWith("--") ? (i++, next) : "true");
            args.flags.set(k, [...(args.flags.get(k) ?? []), value]);
        }
        else {
            args._.push(a);
        }
    }
    return args;
}
const flag = (a, k) => a.flags.get(k)?.at(-1);
const flags = (a, k) => a.flags.get(k) ?? [];
function need(v, what) {
    if (!v)
        throw new Error(`Missing ${what}. Run \`specgate help\`.`);
    return v;
}
export function parseRequired(v) {
    if (v === undefined)
        return 1;
    if (!/^\d+$/.test(v) || Number(v) < 1)
        throw new Error(`--required must be a whole number of at least 1 (got ${JSON.stringify(v)})`);
    return Number(v);
}
export async function main(argv, io = {}) {
    const env = io.env ?? process.env;
    const out = io.stdout ?? process.stdout;
    const args = parseArgs(argv);
    const [cmd, target] = args._;
    const root = flag(args, "root") ?? process.cwd();
    const log = (s = "") => out.write(s + "\n");
    if (cmd === undefined || cmd === "help" || flag(args, "help")) {
        log(HELP);
        return 0;
    }
    if (cmd === "init") {
        const created = init(root, { approvers: flags(args, "approver"), requiredApprovals: parseRequired(flag(args, "required")) });
        log(created.length ? `Created:\n${created.map((c) => `  ${c}`).join("\n")}` : "Already set up; nothing to create.");
        log("\nNext: merge .github/CODEOWNERS.specgate into CODEOWNERS so sign-offs need review,");
        log("and map approver emails to GitHub logins under github.approverLogins for verify-approvals.");
        return 0;
    }
    const cfg = loadConfig(root);
    switch (cmd) {
        case "new": {
            const created = newChange(root, cfg, need(target, "change id"), need(flag(args, "capability"), "--capability"), flag(args, "why"));
            log(`Created:\n${created.map((c) => `  ${c}`).join("\n")}`);
            return 0;
        }
        case "list": {
            const ids = listChangeIds(root, cfg);
            if (!ids.length)
                log("No in-flight changes.");
            for (const id of ids) {
                const change = loadChange(root, cfg, id);
                const st = approvalStatus(root, cfg, change);
                log(`${id.padEnd(32)} ${st.state.padEnd(9)} ${change.requirements.length} requirement(s)`);
            }
            return 0;
        }
        case "show": {
            const change = loadChange(root, cfg, need(target, "change id"));
            for (const r of change.requirements) {
                log(`${r.op.padEnd(9)} @req ${r.id}`);
                for (const s of r.scenarios)
                    log(`            @req ${s.id}`);
            }
            return 0;
        }
        case "validate": {
            const ids = target ? [target] : listChangeIds(root, cfg);
            const issues = [...ids.flatMap((id) => loadChange(root, cfg, id).issues), ...(target ? [] : loadLivingSpecs(root, cfg).issues)];
            for (const i of issues)
                log(`${i.file}${i.line ? `:${i.line}` : ""}  ${i.message}`);
            log(issues.length ? `\n${issues.length} problem(s).` : "Specs are valid.");
            return issues.length ? 1 : 0;
        }
        case "approve": {
            const change = loadChange(root, cfg, need(target, "change id"));
            if (flag(args, "i-am-human") !== "true") {
                const reasons = (io.detect ?? detectAutomation)(env);
                if (reasons.length)
                    throw new Error(`Refusing to sign off: this looks like an agent or automated context (${reasons.join("; ")}). ` +
                        "Sign-off must be a human act. If you are a person at a terminal, re-run with --i-am-human. Agents must not do this.");
            }
            let who = gitIdentity(root);
            const as = flag(args, "as");
            if (as) {
                const m = /^\s*(.+?)\s*<([^>]+)>\s*$/.exec(as);
                if (!m)
                    throw new Error('--as must look like "Jane Doe <jane@example.com>"');
                who = { name: m[1], email: m[2] };
            }
            if (!who)
                throw new Error('No approver identity. Set git user.name/user.email or pass --as "Name <email>".');
            const a = approve(root, cfg, change, { ...who, role: flag(args, "role"), note: flag(args, "note") });
            log(`Signed off ${change.id} as ${a.name} <${a.email}> (spec ${a.specHash.slice(0, 16)}).`);
            log(approvalStatus(root, cfg, change).summary);
            log("Commit approvals.json in a pull request; CI checks it against your PR review.");
            return 0;
        }
        case "revoke": {
            const change = loadChange(root, cfg, need(target, "change id"));
            const email = flag(args, "email") ?? gitIdentity(root)?.email;
            const n = revoke(change, need(email, "--email"));
            log(`Removed ${n} sign-off(s).`);
            return 0;
        }
        case "status": {
            const change = loadChange(root, cfg, need(target, "change id"));
            const st = approvalStatus(root, cfg, change);
            log(`${change.id}: ${st.state}. ${st.summary}`);
            return st.state === "approved" ? 0 : 1;
        }
        case "plan": {
            const res = writePlan(root, cfg, need(target, "change id"), { force: flag(args, "force") === "true" });
            log(`Wrote ${res.path}`);
            return 0;
        }
        case "check": {
            const junit = flags(args, "junit");
            const results = junit.length ? loadJUnit(root, junit) : null;
            const all = flag(args, "all") === "true";
            if (!all && !target)
                throw new Error("Pass a change id or --all");
            const format = flag(args, "json") === "true" ? "json" : flag(args, "format") ?? "text";
            if (!FORMATS.includes(format))
                throw new Error(`--format must be one of ${FORMATS.join(", ")}`);
            const reports = [];
            if (all) {
                for (const id of listChangeIds(root, cfg))
                    reports.push({ report: checkChange(root, cfg, id, results), dir: loadChange(root, cfg, id).dir });
                reports.push({ report: checkLiving(root, cfg, results), dir: join(root, cfg.openspecDir) });
            }
            else {
                reports.push({ report: checkChange(root, cfg, target, results), dir: loadChange(root, cfg, target).dir });
            }
            const base = flag(args, "base");
            const drift = base ? codeDrift(root, cfg, base) : undefined;
            if (flag(args, "write") === "true") {
                for (const { report, dir } of reports) {
                    writeFileSync(join(dir, "traceability.md"), renderMarkdown(report));
                    writeFileSync(join(dir, "traceability.json"), JSON.stringify(toJSON(report), null, 2) + "\n");
                    writeFileSync(join(dir, "traceability.html"), renderHTML([report], { title: `SpecGate: ${report.scope}` }));
                }
            }
            const rs = reports.map((r) => r.report);
            const extraOut = [["sarif", "sarif"], ["html", "html"], ["summary", "pr-comment"], ["annotations", "github"]];
            for (const [k, fmt] of extraOut) {
                const f = flag(args, k);
                if (f && f !== "true")
                    writeFileSync(f, formatReports(fmt, rs, drift));
            }
            const text = formatReports(format, rs, drift);
            const outFile = flag(args, "out");
            if (outFile && outFile !== "true")
                writeFileSync(outFile, text);
            else
                log(text.replace(/\n$/, ""));
            return rs.every((r) => r.passed) && (!drift || drift.passed) ? 0 : 1;
        }
        case "drift": {
            const base = flag(args, "base");
            if (target) {
                const change = loadChange(root, cfg, target);
                const st = approvalStatus(root, cfg, change);
                const d = requirementDrift(root, change, [...st.valid, ...st.outdated]);
                if (flag(args, "json") === "true")
                    log(JSON.stringify(d, null, 2));
                else
                    log(renderRequirementDrift(change.id, d));
                const drifted = !!d && (!d.detailed ? st.state === "stale" : hasRequirementDrift(d));
                if (!base)
                    return drifted ? 1 : 0;
                const cd = codeDrift(root, cfg, base);
                log(renderCodeDrift(cd, base));
                return drifted || !cd.passed ? 1 : 0;
            }
            const cd = codeDrift(root, cfg, need(base, "a change id or --base REF"));
            if (flag(args, "json") === "true")
                log(JSON.stringify(cd, null, 2));
            else
                log(renderCodeDrift(cd, base));
            return cd.passed ? 0 : 1;
        }
        case "verify-approvals": {
            const baseRef = need(flag(args, "base"), "--base");
            const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
            const pr = flag(args, "pr") ?? event.pull_request?.number;
            const headSha = flag(args, "head") ?? event.pull_request?.head?.sha;
            const repo = flag(args, "repo") ?? env.GITHUB_REPOSITORY;
            let reviews;
            const reviewsFile = flag(args, "reviews");
            if (reviewsFile)
                reviews = JSON.parse(readFileSync(reviewsFile, "utf8"));
            else {
                if (!env.GITHUB_TOKEN)
                    throw new Error("verify-approvals needs GITHUB_TOKEN (or --reviews FILE)");
                reviews = await fetchReviews({ repo: need(repo, "--repo"), pr: need(String(pr ?? ""), "--pr"), token: env.GITHUB_TOKEN, fetchImpl: io.fetch ?? fetch });
            }
            const res = verifyApprovals({ root, baseRef, reviews, headSha, cfg });
            log(`${res.passed ? "PASS" : "FAIL"}  verify-approvals: ${res.added} sign-off(s) added since ${baseRef}`);
            for (const p of res.problems)
                log(`      ${p}`);
            return res.passed ? 0 : 1;
        }
        default:
            throw new Error(`Unknown command "${cmd}". Run \`specgate help\`.`);
    }
}
const invokedDirectly = (() => {
    try {
        return fileURLToPath(import.meta.url) === realpathSync(process.argv[1] ?? "");
    }
    catch {
        return false;
    }
})();
if (invokedDirectly) {
    try {
        process.exitCode = await main(process.argv.slice(2));
    }
    catch (e) {
        process.stderr.write(`specgate: ${e.message}\n`);
        process.exitCode = 2;
    }
}
