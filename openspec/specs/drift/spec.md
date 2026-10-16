# Drift

## Requirements

### Requirement: Requirement drift
Each sign-off SHALL store a snapshot of every approved requirement, and SpecGate SHALL report which requirements changed, were added or were removed since the last sign-off, with a line diff.

#### Scenario: Requirement edited after approval
- **WHEN** a requirement's text changes after sign-off
- **THEN** drift and check name that requirement and show the diff

### Requirement: Code drift
With a base ref, SpecGate SHALL fail when a changed file lies in a capability's configured area and no spec for that capability changed, and SHALL warn about unmapped code and untagged tests.

#### Scenario: Area code without spec change
- **WHEN** src/todos/due.js changes and no todos spec changes
- **THEN** drift --base exits 1 with a code drift finding

