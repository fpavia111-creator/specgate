/**
 * Best-effort detection of an AI agent or automated context. This is a
 * speed bump, not a security boundary: the CI check (`verify-approvals`) is
 * what proves a human approved.
 */
export const AGENT_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CURSOR_AGENT", "CODEX_SANDBOX", "GEMINI_CLI", "CI", "GITHUB_ACTIONS"];
export function detectAutomation(env = process.env, stdin = process.stdin) {
    const reasons = [];
    for (const k of AGENT_ENV_VARS)
        if (env[k] && env[k] !== "0" && env[k] !== "false")
            reasons.push(`${k} is set`);
    if (!stdin.isTTY)
        reasons.push("stdin is not a terminal");
    // Only stdin matters: piping or redirecting output (e.g. `| tee`) is fine for a person at a terminal.
    return reasons;
}
