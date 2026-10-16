# Traceability

## Requirements

### Requirement: Full-name matching
A JUnit result SHALL count for a tagged test only when its full name matches the test's title (optionally qualified by suites from the same file) and any file it records is the test's file; a name that merely ends with the title MUST NOT match.

#### Scenario: Suffix collision
- **WHEN** the report contains "other thing works" and the tagged test is "works"
- **THEN** the tagged test is not run

### Requirement: Ambiguous results
When several results could belong to a tagged test and cannot be told apart, SpecGate SHALL report the test as ambiguous and fail the gate.

#### Scenario: Duplicate names without files
- **WHEN** two results named "works" carry no file information
- **THEN** check reports Ambiguous and exits 1

### Requirement: Tag placement
A @req tag SHALL count only in a comment line, a trailing comment or a test title, and a tag on a describe block MUST be reported as misplaced.

#### Scenario: Tag on a suite
- **WHEN** a tag sits above describe()
- **THEN** check reports a misplaced tag and the requirement stays untested

### Requirement: XML parsing
JUnit reports SHALL be read with a real XML parser; malformed XML MUST be an error.

#### Scenario: Malformed report
- **WHEN** the report has mismatched tags
- **THEN** loading it throws a parse error

### Requirement: Test runners
Result matching SHALL work with the JUnit output of Jest, Vitest, pytest, Go (go-junit-report) and Java (Surefire, Gradle).

#### Scenario: Go package names
- **WHEN** the report names tests by package import path
- **THEN** results are attributed to test files in that package's directory only

### Requirement: Node test reporter
SpecGate SHALL ship a node:test reporter that records each test's file, line and suites so same-named tests in different files are told apart.

#### Scenario: Same name, two files
- **WHEN** test/a and test/b both define "works" and only a's is tagged
- **THEN** only a's result counts

