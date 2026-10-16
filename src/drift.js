/**
 * Drift detection, deterministic and rule-based:
 *  - requirement drift: which requirements changed since the last sign-off, with a line diff;
 *  - code drift: files changed in a diff that sit in a capability's area while no spec for
 *    that capability changed, plus changed files that no area covers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globToRegExp, matchesAny } from "./fsutil.js";
const norm = (t) => t.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
/** Canonical text of one requirement as written in the spec. */
export function requirementText(r) {
    const out = [`### Requirement: ${r.title}`];
    if (r.renamedFrom)
        out.push(`(renamed from: ${r.renamedFrom})`);
    if (r.body)
        out.push(r.body);
    for (const s of r.scenarios)
        out.push(`#### Scenario: ${s.title}`, ...(s.body ? [s.body] : []));
    return norm(out.join("\n"));
}
export function snapshotChange(root, change) {
    const requirements = {};
    for (const r of change.requirements)
        requirements[r.id] = `[${r.op}]\n${requirementText(r)}`;
    const proposal = change.hasProposal ? norm(readFileSync(join(change.dir, "proposal.md"), "utf8")) : null;
    return { requirements, proposal };
}
/** Minimal LCS line diff; specs are small. Returns lines prefixed with " ", "-" or "+". */
export function lineDiff(a, b) {
    const x = a ? a.split("\n") : [];
    const y = b ? b.split("\n") : [];
    const n = x.length, m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (x[i] === y[j]) {
            out.push(`  ${x[i]}`);
            i++;
            j++;
        }
        else if (L[i + 1][j] >= L[i][j + 1])
            out.push(`- ${x[i++]}`);
        else
            out.push(`+ ${y[j++]}`);
    }
    while (i < n)
        out.push(`- ${x[i++]}`);
    while (j < m)
        out.push(`+ ${y[j++]}`);
    return out;
}
/**
 * Compare the change now with what its most recent sign-off approved.
 * `approvals` are the authorized approvals; returns null when nothing was ever approved.
 */
export function requirementDrift(root, change, approvals) {
    if (!approvals.length)
        return null;
    const last = [...approvals].sort((p, q) => String(p.at).localeCompare(String(q.at))).at(-1);
    if (!last.snapshot)
        return { approval: last, detailed: false, changed: [], added: [], removed: [], proposalChanged: false };
    const now = snapshotChange(root, change);
    const before = last.snapshot.requirements ?? {};
    const changed = [], added = [], removed = [];
    for (const [id, text] of Object.entries(now.requirements)) {
        if (!(id in before))
            added.push({ id, diff: lineDiff("", text) });
        else if (before[id] !== text)
            changed.push({ id, diff: lineDiff(before[id], text) });
    }
    for (const [id, text] of Object.entries(before))
        if (!(id in now.requirements))
            removed.push({ id, diff: lineDiff(text, "") });
    const proposalChanged = (last.snapshot.proposal ?? null) !== now.proposal;
    return {
        approval: last,
        detailed: true,
        changed,
        added,
        removed,
        proposalChanged,
        proposalDiff: proposalChanged ? lineDiff(last.snapshot.proposal ?? "", now.proposal ?? "") : [],
    };
}
export function hasRequirementDrift(d) {
    return !!d && (d.changed.length + d.added.length + d.removed.length > 0 || d.proposalChanged);
}
export function renderRequirementDrift(changeId, d) {
    if (!d)
        return `${changeId}: never signed off; nothing to compare.`;
    if (!d.detailed)
        return `${changeId}: last sign-off (${d.approval.email}, ${d.approval.at}) was recorded before SpecGate 0.3.0 and has no snapshot; only whole-change staleness is known. Re-approve to enable requirement-level drift.`;
    if (!hasRequirementDrift(d))
        return `${changeId}: no drift since the sign-off by ${d.approval.email} at ${d.approval.at}.`;
    const out = [`${changeId}: changed since the sign-off by ${d.approval.email} at ${d.approval.at}`];
    const section = (label, items) => {
        for (const it of items) {
            out.push("", `${label}: ${it.id}`, "```diff", ...it.diff, "```");
        }
    };
    section("Changed", d.changed);
    section("Added", d.added);
    section("Removed", d.removed);
    if (d.proposalChanged)
        out.push("", "Changed: proposal.md", "```diff", ...d.proposalDiff, "```");
    return out.join("\n");
}
function git(root, args) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
/** Changed files between `base` and the working tree (committed and uncommitted). */
export function changedFiles(root, base) {
    if (!/^[A-Za-z0-9_./~^-]+$/.test(base) || base.startsWith("-"))
        throw new Error(`Invalid --base ref ${JSON.stringify(base)}`);
    try {
        git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    }
    catch {
        throw new Error(`Base ref ${base} not found. Fetch it first (actions/checkout with fetch-depth: 0).`);
    }
    const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
    const tracked = git(root, ["diff", "--name-only", "-z", mergeBase, "--"]).split("\0");
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0");
    return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
}
/**
 * Code drift for a diff. Uses `areas` in specgate.json: { "<capability>": ["src/todos/**"] }.
 * - error  `code-drift`: a changed file is in a capability's area and no spec for that capability changed.
 * - warning `unmapped-code`: a changed non-test, non-spec file is in no area (error if requireAreaCoverage).
 * - warning `untagged-test`: a changed test file carries no @req tag.
 */
export function codeDrift(root, cfg, base, files = changedFiles(root, base)) {
    const spec = `${cfg.openspecDir}/`;
    const testRes = cfg.testGlobs.map(globToRegExp);
    const ignoreRes = cfg.ignoreGlobs.map(globToRegExp);
    const areaRes = Object.entries(cfg.areas).map(([cap, globs]) => [cap, globs.map(globToRegExp)]);
    const specTouched = new Set();
    for (const f of files) {
        const m = new RegExp(`^${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:changes/[^/]+/)?specs/(.+)/spec\\.md$`).exec(f);
        if (m)
            specTouched.add(m[1]);
    }
    const findings = [];
    for (const f of files) {
        if (f.startsWith(spec) || matchesAny(f, ignoreRes))
            continue;
        const isTest = matchesAny(f, testRes);
        if (isTest) {
            const abs = join(root, f);
            if (existsSync(abs) && !readFileSync(abs, "utf8").includes("@req"))
                findings.push({ rule: "untagged-test", level: "warning", file: f, message: `Untagged test: ${f} changed but carries no @req tag` });
            continue;
        }
        const caps = areaRes.filter(([, res]) => matchesAny(f, res)).map(([cap]) => cap);
        if (!caps.length) {
            if (areaRes.length)
                findings.push({ rule: "unmapped-code", level: cfg.requireAreaCoverage ? "error" : "warning", file: f, message: `Unmapped code: ${f} is not in any capability area in specgate.json` });
            continue;
        }
        const untouched = caps.filter((c) => !specTouched.has(c));
        if (untouched.length === caps.length)
            findings.push({ rule: "code-drift", level: "error", file: f, message: `Code drift: ${f} is in the area of ${caps.join(", ")} but no spec for ${caps.length > 1 ? "those capabilities" : "it"} changed in this diff` });
    }
    return { files: files.length, findings, passed: !findings.some((x) => x.level === "error") };
}
