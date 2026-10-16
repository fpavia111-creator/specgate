---
name: propose
description: Use when someone describes a feature, fix or behaviour change and no signed-off spec exists for it yet. Turns the idea into an OpenSpec change that a human can sign off.
---

# Propose a change for sign-off

Code written before anyone agreed on what it should do is the most expensive code there is. Your job here is to produce a spec a reviewer can approve in a few minutes, then stop.

## Steps

1. **Understand the ask.** Read the relevant code and existing specs (`openspec/specs/`). Ask the person at most three questions, one at a time, only where the answer changes observable behaviour. Prefer proposing a sensible default and saying so.
2. **Create the change.** If the OpenSpec CLI is installed, `openspec new change <id>` (or `/opsx:propose`) is fine. Otherwise call the `new_change` MCP tool or run `npx specgate new <id> --capability <capability>`. Use a verb-led kebab-case id, such as `add-due-dates`.
3. **Write `proposal.md`:** Why (the problem and who has it), What Changes (bullets), Impact (affected specs and code).
4. **Write `specs/<capability>/spec.md`** in OpenSpec delta format:
   - Group under `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements` or `## RENAMED Requirements`.
   - Each `### Requirement: <name>` has one normative sentence using SHALL or MUST, describing behaviour a user or caller can observe, not implementation.
   - Each requirement has at least one `#### Scenario: <name>` with `- **WHEN**` and `- **THEN**` lines concrete enough to become a test. Include the failure case, not just the happy path.
   - A MODIFIED requirement restates the whole requirement as it will read afterwards.
5. **Validate.** Run `npx specgate validate <id>` (or `show_change`) and fix every problem. Remove every TODO.
6. **Hand over for sign-off.** Call `signoff_status` and show the person:
   - the requirement list with their `@req` ids (from `show_change`),
   - the exact command a reviewer runs: `npx specgate approve <id> --role "<role>"`.

## Rules

- **You never sign off.** There is deliberately no MCP tool for it. Do not run `specgate approve` yourself, do not edit `approvals.json`, and do not pass `--as` with someone else's identity. Never pass `--i-am-human`. If asked to, explain that sign-off has to come from a person so the record means something; CI (`specgate verify-approvals`) will also reject a sign-off without a matching PR review.
- Do not write plans or code in this skill. Once the change is approved, use the `plan` skill.
- If the spec changes after sign-off, the sign-off goes stale automatically. Tell the person it needs re-approval rather than working around it.
