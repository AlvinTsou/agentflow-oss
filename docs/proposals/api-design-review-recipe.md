# Proposal: API Design Review Recipe

This proposal outlines the design and implementation details for the `api-design-review` workflow recipe.

## Context and Motivation

As API surfaces grow, maintaining consistent RESTful design patterns, preventing accidental breaking changes, and enforcing design guidelines becomes challenging. 
The `api-design-review` recipe automates the audit of API design changes, ensuring they align with organizational standards before they are committed or released.

## Scope and Objectives

- **Automatic Surface Detection**: Parse git diffs to detect changes to HTTP routes, payload schemas, and query parameters.
- **Guideline Compliance**: Check for naming consistency (e.g., REST URL conventions), proper HTTP status codes, structured error payloads, and authentication gates.
- **Breaking Change Audit**: Spot potential backward-compatibility issues (e.g., removing a field, changing a type) and flag them.

### Non-Goals
- Generating API clients or SDKs.
- Verifying backend logic execution or database integration (only the design is audited).
- Executing functional integration or smoke tests against live endpoints.

## Proposed Steps

The workflow consists of three steps, similar to the security audit design:

1. **`map-api-changes`**
   - **Purpose**: Map touched API routes and payload models.
   - **Input**: Git diff showing changes in routing files or controller schemas.
   - **Output**: An API change map highlighting added, modified, or deleted endpoints.
   - **Rubric**: Evaluates the completeness of the mapped route matrix.

2. **`audit-api-standards`**
   - **Purpose**: Verify design quality and compliance with API standards.
   - **Input**: The change map and raw file contents.
   - **Output**: Detailed review findings categorized by severity (high, medium, low).
   - **Checkpoints**: RESTful compliance, camelCase fields, mandatory authentication, error code structures.

3. **`generate-api-verdict`**
   - **Purpose**: Roll up findings and yield a definitive verdict.
   - **Output**: A Markdown report ending with `PASS`, `PASS WITH FOLLOW-UP`, or `BLOCK`.
   - **Verdicts**:
     - `PASS`: Design adheres to guidelines.
     - `PASS WITH FOLLOW-UP`: Minor issues or non-breaking deviations found, requiring maintainer validation.
     - `BLOCK`: Breaking changes detected or high-severity guidelines violated (e.g., unauthenticated write endpoints).

## Offline Test Fixtures Requirements

To support offline mock validation, the following test fixtures will be introduced:

1. **`clean-rest-api`**:
   - A clean REST API controller with proper routes, auth headers, and standard camelCase payload schemas.
   - Expected Verdict: `PASS`.
2. **`breaking-change`**:
   - Modifies an existing payload schema by removing a mandatory response field or changing its type from `string` to `number`.
   - Expected Verdict: `BLOCK` (Breaking change).
3. **`non-standard-naming`**:
   - Modifies an API payload using snake_case instead of camelCase and returns unstructured error messages.
   - Expected Verdict: `PASS WITH FOLLOW-UP` or `BLOCK` (based on policy strictness).
