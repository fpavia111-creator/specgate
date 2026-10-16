import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashChange } from "./changes.js";
import { isEmail } from "./ids.js";
import { snapshotChange } from "./drift.js";
export const APPROVALS_FILE = "approvals.json";
export function readApprovals(change) {
    const path = join(change.dir, APPROVALS_FILE);
    if (!existsSync(path))
        return [];
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data.approvals ?? [];
}
function writeApprovals(change, approvals) {
    const body = {
        $comment: "Written by `specgate approve`. Protect this file with CODEOWNERS so sign-off needs a reviewer.",
        change: change.id,
        approvals,
    };
    writeFileSync(join(change.dir, APPROVALS_FILE), JSON.stringify(body, null, 2) + "\n");
}
export function isAuthorized(cfg, a) {
    if (cfg.approvers.length === 0)
        return true;
    // Email only: display names are free text and prove nothing.
    return cfg.approvers.map((x) => x.toLowerCase()).includes(String(a.email).toLowerCase());
}
export function approvalStatus(root, cfg, change) {
    const currentHash = hashChange(root, change);
    const all = readApprovals(change);
    const unauthorized = all.filter((a) => !isAuthorized(cfg, a));
    const authorized = all.filter((a) => isAuthorized(cfg, a));
    const valid = dedupe(authorized.filter((a) => a.specHash === currentHash));
    const outdated = authorized.filter((a) => a.specHash !== currentHash);
    const required = Math.max(1, cfg.requiredApprovals);
    let state;
    if (valid.length >= required)
        state = "approved";
    else if (outdated.length > 0)
        state = "stale";
    else if (valid.length > 0)
        state = "pending";
    else
        state = "draft";
    const summary = state === "approved"
        ? `Approved by ${valid.map((a) => a.name).join(", ")} (${valid.length}/${required}).`
        : state === "stale"
            ? `Spec changed after sign-off by ${outdated.map((a) => a.name).join(", ")}; it needs re-approval (${valid.length}/${required} valid).`
            : state === "pending"
                ? `Needs ${required - valid.length} more approval(s) (${valid.length}/${required}).`
                : `Not yet signed off (0/${required}).`;
    return { state, currentHash, required, valid, outdated, unauthorized, summary };
}
/** One approval per person counts toward the quorum. */
function dedupe(list) {
    const byEmail = new Map();
    for (const a of list)
        byEmail.set(a.email.toLowerCase(), a);
    return [...byEmail.values()];
}
export function gitIdentity(root) {
    try {
        const get = (k) => execFileSync("git", ["config", k], { cwd: root, encoding: "utf8" }).trim();
        const name = get("user.name");
        const email = get("user.email");
        return name && email ? { name, email } : null;
    }
    catch {
        return null;
    }
}
/**
 * Record a sign-off for the change's current content. Refuses when the spec
 * has validation errors, so nobody signs off on something malformed.
 */
export function approve(root, cfg, change, opts) {
    if (!isEmail(opts.email))
        throw new Error(`Approver email ${JSON.stringify(opts.email)} is not a valid email address.`);
    if (change.issues.length > 0) {
        throw new Error(`Cannot approve "${change.id}": the spec has ${change.issues.length} problem(s). Run \`specgate validate ${change.id}\`.`);
    }
    const approval = {
        name: opts.name,
        email: opts.email,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.note ? { note: opts.note } : {}),
        at: (opts.now ?? new Date()).toISOString(),
        specHash: hashChange(root, change),
        // What was approved, requirement by requirement, so later drift can be shown as a diff (0.3.0+).
        snapshot: snapshotChange(root, change),
    };
    if (!isAuthorized(cfg, approval)) {
        throw new Error(`${opts.email} is not in the approvers list in specgate.json.`);
    }
    const existing = readApprovals(change).filter((a) => !(a.email.toLowerCase() === approval.email.toLowerCase() && a.specHash === approval.specHash));
    writeApprovals(change, [...existing, approval]);
    return approval;
}
export function revoke(change, email) {
    const before = readApprovals(change);
    const after = before.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
    writeApprovals(change, after);
    return before.length - after.length;
}
