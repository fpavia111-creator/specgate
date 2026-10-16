/**
 * Parser for OpenSpec-format Markdown specs.
 *
 * A living spec (`openspec/specs/<capability>/spec.md`) lists requirements
 * under `## Requirements`. A change's delta spec
 * (`openspec/changes/<id>/specs/<capability>/spec.md`) groups them under
 * `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`.
 *
 * Every requirement gets a stable id `<capability>/<slug-of-title>`, which is
 * what tests reference with `@req <id>`.
 */
export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
const SECTION_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)?\s*Requirements\s*$/i;
const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCEN_RE = /^####\s+Scenario:\s*(.+?)\s*$/;
const RENAME_FROM_RE = /^\s*-\s*FROM:\s*`?###\s+Requirement:\s*(.+?)`?\s*$/;
const RENAME_TO_RE = /^\s*-\s*TO:\s*`?###\s+Requirement:\s*(.+?)`?\s*$/;
export function parseSpec(markdown, capability, file) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const requirements = [];
    const issues = [];
    let op = "BASE";
    let req = null;
    let scen = null;
    let inFence = false;
    let pendingRenameFrom = null;
    const closeScenario = () => {
        if (req && scen) {
            scen.body = scen.body.trim();
            req.scenarios.push(scen);
        }
        scen = null;
    };
    const closeRequirement = () => {
        closeScenario();
        if (req) {
            req.body = req.body.trim();
            requirements.push(req);
        }
        req = null;
    };
    lines.forEach((line, i) => {
        if (/^\s*```/.test(line))
            inFence = !inFence;
        if (inFence) {
            if (scen)
                scen.body += line + "\n";
            else if (req)
                req.body += line + "\n";
            return;
        }
        const section = SECTION_RE.exec(line);
        if (section) {
            closeRequirement();
            op = section[1]?.toUpperCase() ?? "BASE";
            return;
        }
        if (/^#{1,2}\s/.test(line)) {
            // Any other top-level heading ends the requirements block.
            closeRequirement();
            return;
        }
        if (op === "RENAMED") {
            const from = RENAME_FROM_RE.exec(line);
            if (from) {
                pendingRenameFrom = from[1];
                return;
            }
            const to = RENAME_TO_RE.exec(line);
            if (to) {
                if (!pendingRenameFrom) {
                    issues.push({ file, line: i + 1, message: "RENAMED entry has TO without a preceding FROM" });
                }
                requirements.push({
                    id: `${capability}/${slugify(to[1])}`,
                    capability,
                    title: to[1],
                    op: "RENAMED",
                    body: "",
                    scenarios: [],
                    line: i + 1,
                    file,
                    renamedFrom: pendingRenameFrom ?? undefined,
                });
                pendingRenameFrom = null;
                return;
            }
        }
        const r = REQ_RE.exec(line);
        if (r) {
            closeRequirement();
            req = {
                id: `${capability}/${slugify(r[1])}`,
                capability,
                title: r[1],
                op,
                body: "",
                scenarios: [],
                line: i + 1,
                file,
            };
            return;
        }
        const s = SCEN_RE.exec(line);
        if (s) {
            if (!req) {
                issues.push({ file, line: i + 1, message: `Scenario "${s[1]}" is not under a requirement` });
                return;
            }
            closeScenario();
            const current = req;
            scen = { id: `${current.id}#${slugify(s[1])}`, title: s[1], body: "" };
            return;
        }
        if (scen)
            scen.body += line + "\n";
        else if (req)
            req.body += line + "\n";
    });
    closeRequirement();
    const seen = new Map();
    for (const q of requirements) {
        const prior = seen.get(q.id);
        if (prior) {
            issues.push({ file, line: q.line, message: `Duplicate requirement id "${q.id}" (first at line ${prior.line})` });
        }
        seen.set(q.id, q);
        if (q.op === "ADDED" || q.op === "MODIFIED" || q.op === "BASE") {
            if (!/\b(SHALL|MUST)\b/.test(q.body)) {
                issues.push({ file, line: q.line, message: `Requirement "${q.title}" has no SHALL or MUST statement` });
            }
            if (q.scenarios.length === 0) {
                issues.push({ file, line: q.line, message: `Requirement "${q.title}" has no scenarios` });
            }
        }
    }
    return { requirements, issues };
}
