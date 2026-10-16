import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../dist/src/cli.js";
export const SPEC = `## ADDED Requirements

### Requirement: Due date
The system SHALL store a due date on a todo.

#### Scenario: Invalid date rejected
- **WHEN** a todo is saved with an invalid date
- **THEN** it is rejected

### Requirement: Sorting
The system SHALL sort todos by due date.

#### Scenario: Sorted
- **WHEN** todos are listed
- **THEN** they are ordered by due date
`;
export function write(root, rel, text) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
}
export function git(root, ...args) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
/** A git repo with SpecGate set up and one valid change, `add-due-dates`. */
export function makeRepo({ approvers = ["lead@x.com"], config } = {}) {
    const root = mkdtempSync(join(tmpdir(), "specgate-"));
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "Lead");
    git(root, "config", "user.email", "lead@x.com");
    git(root, "config", "commit.gpgsign", "false");
    write(root, "specgate.json", JSON.stringify(config ?? { approvers }, null, 2));
    write(root, "openspec/changes/add-due-dates/proposal.md", "# Change: add due dates\n\n## Why\nUsers miss deadlines.\n");
    write(root, "openspec/changes/add-due-dates/specs/todos/spec.md", SPEC);
    return root;
}
/** Run the CLI in-process. Automation detection is off unless `detect` is given. */
export async function cli(root, argv, opts = {}) {
    const { env = {}, fetch } = opts;
    // Pass detect: "real" to use the real agent/TTY detector.
    const detect = opts.detect === "real" ? undefined : opts.detect ?? (() => []);
    let out = "";
    const stdout = { write: (s) => { out += s; } };
    try {
        const code = await main([...argv, "--root", root], { env, stdout, detect, fetch });
        return { code, out };
    }
    catch (e) {
        return { code: 2, out, err: e.message };
    }
}
export const junit = (cases) => `<?xml version="1.0"?>\n<testsuites><testsuite name="s">${cases}</testsuite></testsuites>\n`;
