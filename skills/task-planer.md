---
name: task-planner
description: Break complex software engineering tasks into small executable steps before implementation.
---

# Task Planner

## Goal

Transform ambiguous or complex engineering requests into a clear execution plan.

Planning should occur before modifying code.

## When To Use

Use this skill when:

- multiple files will change
- architecture changes are required
- requirements are unclear
- refactoring is requested
- new features are implemented
- debugging spans multiple modules

Do not immediately edit code.

## Planning Workflow

### Step 1

Understand the request.

Identify:

- desired behavior
- current behavior
- constraints
- assumptions

Highlight anything unclear.

### Step 2

Understand the codebase.

Locate:

- entry points
- related modules
- existing implementations
- reusable utilities

Avoid duplicate implementations.

### Step 3

Decompose the work.

Split into independent tasks.

Each task should:

- have one objective
- be independently verifiable
- minimize side effects

Example:

Task 1

Locate API endpoint.

Task 2

Modify business logic.

Task 3

Update types.

Task 4

Update tests.

Task 5

Validate.

### Step 4

Identify risks.

Examples:

- breaking API compatibility
- database migration
- performance impact
- concurrency issues
- configuration changes

### Step 5

Determine verification strategy.

Examples:

- compile
- lint
- unit tests
- integration tests
- manual validation

## Execution Rules

Only execute one task at a time.

After completing a task:

- verify correctness
- summarize progress
- continue to the next task

Avoid making unrelated changes.

Keep commits logically grouped.

## Output Format

Produce a plan similar to:

## Objective

...

## Analysis

...

## Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

## Risks

...

## Validation

...