---
name: plan
description: Use when an OpenSpec change has been signed off and needs an implementation plan before any code is written.
---

# Plan from a signed-off spec

## Steps

1. Call `signoff_status` for the change. If it is not `approved`, stop and show the person the approval command it returns. Do not plan unapproved or stale specs.
2. Call `write_plan` (or run `npx specgate plan <id>`). This writes `openspec/changes/<id>/plan.md` with one task per requirement and the `@req` tag each test needs. The format is compatible with Superpowers' `executing-plans` and `subagent-driven-development` skills.
3. Read the code the change touches, then fill in each task:
   - **Files:** exact paths to create or modify, and the test file.
   - Under each failing-test step, the actual test code, with the `@req <id>` tag in a comment directly above the test or in its title.
   - Under the minimal-code step, the interfaces and signatures you decided on.
   - Keep the task order; split a task only if a reviewer could reasonably accept one half and reject the other.
4. Do not add tasks for behaviour the spec does not contain. If you find the spec is missing something, stop and tell the person: the spec needs a change and a new sign-off, which keeps the record honest.
5. Hand over to implementation: the `tdd` skill, or Superpowers' `subagent-driven-development` if it is installed.
