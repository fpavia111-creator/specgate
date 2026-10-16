# Reports

## Requirements

### Requirement: Traceability record
`check --write` SHALL write traceability.md, traceability.json and traceability.html next to the change, and the JSON MUST keep the 0.2 fields.

#### Scenario: Write the record
- **WHEN** check runs with --write
- **THEN** all three files exist and the JSON has passed, approval, requirements and problems

### Requirement: Output formats
`check` SHALL render results as text, JSON, Markdown, HTML, SARIF 2.1.0, GitHub annotations or a PR-comment summary.

#### Scenario: SARIF output
- **WHEN** check runs with --format sarif
- **THEN** the output is SARIF 2.1.0 with a located result per finding

