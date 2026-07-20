---
name: codebase-explorer
description: Understand unfamiliar repositories before making code changes.
---

# Codebase Explorer

## Goal

Understand repository structure before editing code.

## Workflow

### Step 1

Inspect root structure:

```bash
tree -L 2
```

or

```bash
find . -maxdepth 2
```

### Step 2

Identify:

- language
- package manager
- framework

Examples:

- package.json → Node.js
- pyproject.toml → Python
- pom.xml → Java
- Cargo.toml → Rust

### Step 3

Locate entry points

Examples:

- src/index.ts
- main.py
- app.ts
- server.ts

### Step 4

Build dependency graph

Identify:

- API layer
- service layer
- data layer

### Step 5

Only then modify code.

## Rules

Never edit files before understanding:

- call chain
- dependencies
- configuration

Always explain discovered architecture.