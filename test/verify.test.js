import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { approvedLogins, fetchReviews } from "../dist/src/verify.js";
import { cli, git, makeRepo, write } from "./helpers.js";
const CONFIG = { approvers: ["lead@x.com"], github: { approverLogins: { "lead@x.com": "lead-gh" } } };
/** Base commit on main, then a PR branch that adds a sign-off. */
async function prWithSignoff(config = CONFIG) {
    const root = makeRepo({ config });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    git(root, "checkout", "-qb", "pr");
    assert.equal((await cli(root, ["approve", "add-due-dates"])).code, 0);
    git(root, "commit", "-qam", "x", "--allow-empty");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "sign off");
    return root;
}
const review = (login, state, at, commit_id = "head1") => ({ user: { login }, state, submitted_at: at, commit_id });
async function verify(root, reviews, extra = []) {
    const f = join(root, "..", `reviews-${Math.random()}.json`);
    writeFileSync(f, JSON.stringify(reviews));
    return cli(root, ["verify-approvals", "--base", "main", "--reviews", f, ...extra]);
}
// @req signoff/review-backed-approvals
test("bug 2/3: a sign-off with no approving PR review fails verify-approvals", async () => {
    const root = await prWithSignoff();
    const r = await verify(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /needs an approving review on this pull request from @lead-gh/);
});
// @req signoff/review-backed-approvals
test("bug 2/3: an approving review by the mapped login passes", async () => {
    const root = await prWithSignoff();
    const r = await verify(root, [review("Lead-GH", "APPROVED", "2026-10-01T00:00:00Z")]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASS {2}verify-approvals: 1 sign-off/);
});
// @req signoff/review-backed-approvals
test("bug 2/3: an approval by someone else, or later changes requested, fails", async () => {
    const root = await prWithSignoff();
    assert.equal((await verify(root, [review("mallory", "APPROVED", "2026-10-01T00:00:00Z")])).code, 1);
    assert.equal((await verify(root, [review("lead-gh", "APPROVED", "2026-10-01T00:00:00Z"), review("lead-gh", "CHANGES_REQUESTED", "2026-10-02T00:00:00Z")])).code, 1);
    assert.equal((await verify(root, [review("lead-gh", "APPROVED", "2026-10-01T00:00:00Z"), review("lead-gh", "COMMENTED", "2026-10-02T00:00:00Z")])).code, 0);
});
// @req signoff/review-backed-approvals
test("bug 3: a hand-forged approvals.json entry is caught", async () => {
    const root = makeRepo({ config: CONFIG });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    write(root, "openspec/changes/add-due-dates/approvals.json", JSON.stringify({ approvals: [{ name: "Lead", email: "lead@x.com", at: "2026-01-01T00:00:00.000Z", specHash: "abc" }] }));
    const r = await verify(root, []);
    assert.equal(r.code, 1);
    assert.match(r.out, /lead@x.com needs an approving review/);
});
// @req signoff/review-backed-approvals
test("bug 3: a login mapping added in the PR itself is ignored (base config is used)", async () => {
    const root = makeRepo({ config: { approvers: ["lead@x.com"] } });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    writeFileSync(join(root, "specgate.json"), JSON.stringify({ approvers: ["lead@x.com"], github: { approverLogins: { "lead@x.com": "mallory" } } }));
    await cli(root, ["approve", "add-due-dates"]);
    const r = await verify(root, [review("mallory", "APPROVED", "2026-10-01T00:00:00Z")]);
    assert.equal(r.code, 1);
    assert.match(r.out, /has no GitHub login in the base branch/);
});
// @req signoff/review-backed-approvals
test("requireReviewOnHead demands the review is on the PR head commit", async () => {
    const root = await prWithSignoff({ ...CONFIG, github: { ...CONFIG.github, requireReviewOnHead: true } });
    assert.equal((await verify(root, [review("lead-gh", "APPROVED", "2026-10-01T00:00:00Z", "old")], ["--head", "head1"])).code, 1);
    assert.equal((await verify(root, [review("lead-gh", "APPROVED", "2026-10-01T00:00:00Z", "head1")], ["--head", "head1"])).code, 0);
});
// @req signoff/review-backed-approvals
test("no new sign-offs passes; bad base ref is an error", async () => {
    const root = makeRepo({ config: CONFIG });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    assert.equal((await verify(root, [])).code, 0);
    const empty = join(root, "..", `empty-${Math.random()}.json`);
    writeFileSync(empty, "[]");
    assert.match((await cli(root, ["verify-approvals", "--base=-x", "--reviews", empty])).err, /Invalid --base/);
    assert.match((await cli(root, ["verify-approvals", "--base", "nosuch", "--reviews", empty])).err, /not found/);
    assert.match((await cli(root, ["verify-approvals", "--base", "main", "--reviews", join(root, "specgate.json")])).err, /JSON array/);
});
// @req signoff/review-backed-approvals
test("fetchReviews paginates and sends the token only to api.github.com", async () => {
    const calls = [];
    const fake = async (url, opts) => {
        calls.push({ url, auth: opts.headers.Authorization });
        const page = Number(new URL(url).searchParams.get("page"));
        return { ok: true, json: async () => (page === 1 ? Array(100).fill(review("a", "COMMENTED", "x")) : [review("lead-gh", "APPROVED", "y")]) };
    };
    const reviews = await fetchReviews({ repo: "o/r", pr: 7, token: "t0k", fetchImpl: fake });
    assert.equal(reviews.length, 101);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.url.startsWith("https://api.github.com/repos/o/r/pulls/7/reviews") && c.auth === "Bearer t0k"));
    assert.deepEqual([...approvedLogins(reviews)], ["lead-gh"]);
    const failing = async () => ({ ok: false, status: 403 });
    await assert.rejects(fetchReviews({ repo: "o/r", pr: 7, token: "t", fetchImpl: failing }), /403/);
});
