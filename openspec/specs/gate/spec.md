# Gate

## Requirements

### Requirement: Coverage gate
`specgate check` SHALL exit 1 unless the sign-off is valid and every requirement has at least one tagged test that passed in the supplied JUnit results.

#### Scenario: Missing and failing tests
- **WHEN** one requirement's test failed and another's never ran
- **THEN** check exits 1 and lists both problems

### Requirement: Plan requires sign-off
`specgate plan` MUST refuse to write a plan for a change that is not approved, and generated plans SHALL name only skills that exist.

#### Scenario: Unapproved change
- **WHEN** plan runs before sign-off
- **THEN** it exits 2 and writes nothing

### Requirement: Valid specs
SpecGate SHALL report spec problems (no SHALL/MUST, no scenarios, duplicate ids, TODO placeholders) and MUST refuse sign-off while any exist.

#### Scenario: Fresh scaffold
- **WHEN** a change is scaffolded with `specgate new`
- **THEN** validate reports the TODO placeholders and approve refuses

### Requirement: Config validation
Invalid settings in specgate.json or on the command line MUST be rejected with an error rather than ignored.

#### Scenario: Bad quorum
- **WHEN** requiredApprovals is null or --required is abc
- **THEN** the command exits 2 with an explanation

