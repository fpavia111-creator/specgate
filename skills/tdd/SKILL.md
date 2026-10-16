---
name: tdd
description: Use when implementing a SpecGate plan or any signed-off requirement. Enforces test-first development where every test is tagged with the requirement it proves.
---

# Test-first implementation with traceability

Every line of production code exists because a tagged test demanded it.

## The loop, per plan step

1. **Red.** Write one test for one scenario. Tag it:
   - JS/TS: `// @req todos/due-date#invalid-date-rejected` above `it(...)` or `test(...)`, or put `[@req todos/due-date]` in the title.
   - Python: `# @req ...` above `def test_...`. Go: `// @req ...` above `func Test...`. Other languages: a comment directly above the test.
   - Use the requirement id, or `<requirement id>#<scenario>` for a specific scenario. Get exact ids from `show_change`; never invent one.
2. **Run it and watch it fail** for the reason you expect (missing behaviour, not a typo or import error). If it passes already, the test is wrong or the behaviour exists; find out which before moving on.
3. **Green.** Write the smallest code that passes. No extra options, no speculative abstractions.
4. **Run the whole suite.** Everything passes before you continue.
5. **Refactor** with tests green, then commit with the requirement id in the message.
6. Tick the step in `plan.md`.

## Rules

- No production code without a failing test first. If you wrote code first, delete it and start from the test.
- Do not weaken, skip or delete a test to get green. Do not tag a test with a requirement it does not actually exercise; the traceability record is only worth something if the tags are true.
- If a scenario cannot be tested as written, stop and say so. The spec needs amending and re-approval.
- When all tasks are done, use the `verify` skill.
