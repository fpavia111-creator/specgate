import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findFiles } from "./fsutil.js";
import { parseSpec } from "./spec.js";
import { assertChangeId } from "./ids.js";
export function changesDir(root, cfg) {
    return join(root, cfg.openspecDir, "changes");
}
export function listChangeIds(root, cfg) {
    const dir = changesDir(root, cfg);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((n) => n !== "archive" && !n.startsWith(".") && statSync(join(dir, n)).isDirectory())
        .sort();
}
/** Parse every `specs/<capability>/spec.md` under `specsRoot` (repo-relative). */
function loadSpecTree(root, specsRootRel) {
    const files = findFiles(root, [`${specsRootRel}/**/spec.md`], []);
    const requirements = [];
    const issues = [];
    for (const file of files) {
        const capability = file.slice(specsRootRel.length + 1).replace(/\/spec\.md$/, "");
        const parsed = parseSpec(readFileSync(join(root, file), "utf8"), capability, file);
        requirements.push(...parsed.requirements);
        issues.push(...parsed.issues);
    }
    return { requirements, issues, files };
}
export function loadChange(root, cfg, id) {
    assertChangeId(id);
    const rel = `${cfg.openspecDir}/changes/${id}`;
    const dir = join(root, rel);
    if (!existsSync(dir))
        throw new Error(`Change "${id}" not found at ${rel}`);
    const tree = loadSpecTree(root, `${rel}/specs`);
    const signedFiles = [...tree.files];
    const hasProposal = existsSync(join(dir, "proposal.md"));
    if (hasProposal)
        signedFiles.push(`${rel}/proposal.md`);
    const issues = [...tree.issues];
    if (!hasProposal)
        issues.push({ file: rel, line: 0, message: "Change has no proposal.md" });
    for (const file of signedFiles) {
        const text = readFileSync(join(root, file), "utf8");
        const line = text.split(/\r?\n/).findIndex((l) => /\bTODO\b/.test(l));
        if (line >= 0)
            issues.push({ file, line: line + 1, message: "Contains a TODO placeholder" });
    }
    if (tree.requirements.length === 0)
        issues.push({ file: rel, line: 0, message: "Change has no requirements under specs/" });
    return { id, dir, relDir: rel, signedFiles: signedFiles.sort(), requirements: tree.requirements, issues, hasProposal };
}
/** Requirements currently in force across the living specs. */
export function loadLivingSpecs(root, cfg) {
    return loadSpecTree(root, `${cfg.openspecDir}/specs`);
}
/** Requirements a change obliges tests for: everything it adds, modifies or renames. */
export function testableRequirements(change) {
    return change.requirements.filter((r) => r.op !== "REMOVED");
}
/**
 * Content hash of what reviewers sign off on. Whitespace at line ends and
 * line-ending style are normalised so editors don't invalidate approvals.
 */
export function hashChange(root, change) {
    const h = createHash("sha256");
    for (const file of change.signedFiles) {
        const text = readFileSync(join(root, file), "utf8")
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((l) => l.trimEnd())
            .join("\n")
            .trim();
        // Hash paths relative to the change folder so archiving the change keeps the hash.
        h.update(file.slice(change.relDir.length + 1));
        h.update("\0");
        h.update(text);
        h.update("\0");
    }
    return h.digest("hex");
}
