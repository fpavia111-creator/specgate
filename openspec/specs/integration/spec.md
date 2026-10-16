# Integration

## Requirements

### Requirement: MCP server
The MCP server SHALL offer no sign-off tool and MUST refuse roots outside SPECGATE_ROOT, JUnit paths outside the root, and change ids that are not slugs.

#### Scenario: Path escape
- **WHEN** a tool is called with root /etc
- **THEN** the call returns an error

### Requirement: GitHub Action
The Action MUST pass inputs to its script only through environment variables, validate them, and pin the SpecGate version.

#### Scenario: Hostile input
- **WHEN** the change input contains shell syntax
- **THEN** the step exits 2 and runs nothing

### Requirement: CLI arguments
The CLI SHALL accept --key value and --key=value, keeping everything after the first =.

#### Scenario: Value with equals
- **WHEN** --note=a=b=c is passed
- **THEN** the note is a=b=c

