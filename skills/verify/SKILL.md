---
name: verify
description: Use when implementation of a signed-off change is finished, before saying it is done or opening a pull request. Produces the traceability record and fixes gaps.
---

# Verify and record traceability

## Steps

1. Run the project's tests with a JUnit XML report. Common forms:
   - Vitest: `npx vitest run --reporter=junit --outputFile=reports/junit.xml`
   - Jest: `npx jest --reporters=default --reporters=jest-junit` (writes `junit.xml`)
   - node:test: `node --test --test-reporter=junit --test-reporter-destination=reports/junit.xml`
   - pytest: `pytest --junitxml=reports/junit.xml`
   - Go: `go test -v ./... 2>&1 | go-junit-report > reports/junit.xml`
2. Run `npx specgate check <id> --junit reports/junit.xml --write` (or the `check` MCP tool with `junit`).
3. Fix every problem it lists:
   - **Untested:** write the missing test, test first, via the `tdd` skill.
   - **Failing:** fix the code, not the test, unless the test contradicts the spec.
   - **Not run:** the tagged test's name did not appear in the report. Check the test is collected and that the tag sits directly above the test.
   - **Ambiguous:** several results in the report share the test's name and none records a file. Give the test a unique name.
   - **Misplaced tag:** a tag sits on a `describe` block. Move it onto each test.
   - **Unknown requirement:** a tag has a typo or names a requirement that does not exist. Correct the tag.
   - **Sign-off stale:** the spec changed after approval. Tell the person; a reviewer must re-approve. Never revert spec edits just to restore a sign-off without asking.
4. Repeat until it prints `PASS`.
5. Commit `traceability.md` and `traceability.json` with the change. Report the verdict to the person in one line, with the path to `traceability.md`.
6. After merge, archive with OpenSpec (`openspec archive <id>`) so the requirements join the living specs. The record moves with the change folder and its sign-off stays valid. `npx specgate check --all` then checks every living requirement still has a passing test.
