/**
 * CI check: every sign-off added to an approvals.json in a pull request must be
 * backed by an APPROVED review on that pull request from the GitHub login that
 * the base branch's specgate.json maps to the approver's email. The mapping is
 * read from the base branch so a PR cannot add its own mapping.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CONFIG_FILE, parseConfig } from "./config.js";
import { findFiles } from "./fsutil.js";
function gitShow(root, ref, path) {
    try {
        return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    }
    catch {
        return null;
    }
}
const key = (a) => `${String(a.email).toLowerCase()}\0${a.specHash}\0${a.at}`;
/** Sign-offs present now that were not on the base ref. */
export function addedApprovals(root, cfg, baseRef) {
    if (!/^[A-Za-z0-9_./~^-]+$/.test(baseRef) || baseRef.startsWith("-"))
        throw new Error(`Invalid --base ref ${JSON.stringify(baseRef)}`);
    try {
        execFileSync("git", ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], { cwd: root, stdio: "ignore" });
    }
    catch {
        throw new Error(`Base ref ${baseRef} not found. Fetch it first (actions/checkout with fetch-depth: 0).`);
    }
    const files = findFiles(root, [`${cfg.openspecDir}/changes/**/approvals.json`], ["**/node_modules/**"]);
    const added = [];
    for (const file of files) {
        const now = JSON.parse(readFileSync(`${root}/${file}`, "utf8")).approvals ?? [];
        const baseText = gitShow(root, baseRef, file);
        const before = new Set((baseText ? JSON.parse(baseText).approvals ?? [] : []).map(key));
        for (const a of now)
            if (!before.has(key(a)))
                added.push({ file, approval: a });
    }
    return added;
}
/** Latest review state per login, as GitHub shows it (COMMENTED does not change a prior state). */
export function approvedLogins(reviews, headSha) {
    const latest = new Map();
    for (const r of [...reviews].sort((x, y) => String(x.submitted_at).localeCompare(String(y.submitted_at)))) {
        const login = r.user?.login?.toLowerCase();
        if (!login || r.state === "COMMENTED" || r.state === "PENDING")
            continue;
        latest.set(login, r);
    }
    const ok = new Set();
    for (const [login, r] of latest)
        if (r.state === "APPROVED" && (!headSha || r.commit_id === headSha))
            ok.add(login);
    return ok;
}
export async function fetchReviews({ repo, pr, token, fetchImpl = fetch }) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`, {
            headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (!res.ok)
            throw new Error(`GitHub API returned ${res.status} listing reviews for ${repo}#${pr}`);
        const batch = await res.json();
        out.push(...batch);
        if (batch.length < 100)
            break;
    }
    return out;
}
export function verifyApprovals({ root, baseRef, reviews, headSha, cfg }) {
    if (!/^[A-Za-z0-9_./~^-]+$/.test(baseRef) || baseRef.startsWith("-"))
        throw new Error(`Invalid --base ref ${JSON.stringify(baseRef)}`);
    if (!Array.isArray(reviews))
        throw new Error("Reviews must be a JSON array of GitHub pull request reviews");
    const baseCfgText = gitShow(root, baseRef, CONFIG_FILE);
    const baseCfg = baseCfgText ? parseConfig(baseCfgText, `${baseRef}:${CONFIG_FILE}`) : cfg;
    const logins = Object.fromEntries(Object.entries(baseCfg.github.approverLogins).map(([e, l]) => [e.toLowerCase(), l.toLowerCase()]));
    const ok = approvedLogins(reviews, baseCfg.github.requireReviewOnHead ? headSha : undefined);
    const added = addedApprovals(root, cfg, baseRef);
    const problems = [];
    for (const { file, approval } of added) {
        const email = String(approval.email).toLowerCase();
        const login = logins[email];
        if (!login)
            problems.push(`${file}: sign-off by ${email} has no GitHub login in the base branch's ${CONFIG_FILE} github.approverLogins`);
        else if (!ok.has(login))
            problems.push(`${file}: sign-off by ${email} needs an approving review on this pull request from @${login}${baseCfg.github.requireReviewOnHead ? " on the latest commit" : ""}`);
    }
    return { added: added.length, problems, passed: problems.length === 0 };
}
