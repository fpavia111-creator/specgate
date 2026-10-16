# Sign-off

## Requirements

### Requirement: Sign-off record
SpecGate SHALL record each sign-off with the approver's name and email, optional role and note, a timestamp, and a SHA-256 hash of the change's proposal and specs.

#### Scenario: Approve a valid change
- **WHEN** a listed approver runs `specgate approve` on a change with no spec problems
- **THEN** approvals.json gains an entry carrying the current spec hash and the change reports `approved`

### Requirement: Stale on change
A sign-off MUST stop counting once the signed files change; the change SHALL report `stale`.

#### Scenario: Edit after approval
- **WHEN** proposal.md is edited after sign-off
- **THEN** status exits 1 and reports the change as stale

### Requirement: Email-only approvers
Approvers SHALL be matched by email address only; display names MUST NOT authorize a sign-off.

#### Scenario: Spoofed name
- **WHEN** someone signs off with an approver's name but a different email
- **THEN** the sign-off is rejected

### Requirement: Quorum
A change SHALL be approved only when the configured number of distinct approver emails have valid sign-offs.

#### Scenario: Same approver twice
- **WHEN** one approver signs off twice and two are required
- **THEN** the change is still not approved

### Requirement: Refuse automation
`specgate approve` MUST refuse to run when stdin is not a terminal or a known agent or CI environment variable is set, unless `--i-am-human` is passed; piping output SHALL NOT trigger the refusal.

#### Scenario: Agent context
- **WHEN** approve runs with CLAUDECODE set
- **THEN** it exits 2 without writing a sign-off

### Requirement: Review-backed approvals
`specgate verify-approvals` SHALL fail when a sign-off added since the base ref has no approving pull-request review from the GitHub login mapped to its email in the base branch's configuration.

#### Scenario: Forged sign-off
- **WHEN** approvals.json gains an entry and the mapped login has not approved the PR
- **THEN** verify-approvals exits 1

