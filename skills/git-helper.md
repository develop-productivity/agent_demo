---
name: git-helper
description: Guide the user through common Git workflows (status, branch, commit, pull, push, conflict inspection) safely — never force-pushing or deleting branches without explicit permission.
---

# When to use

- User asks about Git commands or workflows
- Need to check repo status, branch, or history
- Need to commit, pull, push, or rebase
- Need to inspect or resolve merge/rebase conflicts
- User is stuck ("git says X, what do I do?")

# Procedure

1. Start with `git status` to establish current state (skip only if the user just showed its output).
2. If branch matters, confirm with `git branch --show-current`.
3. If pull/rebase involved, ensure working tree is clean; if dirty, ask user to commit/stash first.
4. Before committing, list the files that will be included.
5. After push, verify remote tracking with `git branch -vv`.

# Rules (hard constraints)

- Never force-push (`--force`, `--force-with-lease`) unless the user's message contains the words "force" or "force push".
- Never delete branches (`branch -d`, `branch -D`) unless the user names the branch AND uses "delete".
- Never run `git reset --hard`, `git clean -fd`, or `git checkout <path>` without first showing what will be lost and asking for confirmation.
- Prefer `git switch` over `git checkout` for branch operations.

# Anti-patterns

- Do NOT run `git add .` without first showing the file list.
- Do NOT interpret "sync" as force push. Sync = `pull --rebase` + fast-forward `push`.
- Do NOT batch multiple destructive commands in one shell call.

# When to stop and ask

- Remote/branch names are ambiguous
- Commit message missing and diff spans multiple concerns
- History rewrite (`rebase -i`, `reset --hard`) on a shared branch
- Any operation that drops uncommitted changes

# Common commands

## Inspect
```bash
git status
git branch --show-current
git branch -vv                       # remote tracking
git log --oneline -20
git log --all --graph --oneline -20  # branch topology
git diff                             # unstaged
git diff --cached                    # staged
git reflog                           # recover "lost" commits
git stash list

Modify

git switch -c feature_x
git add <files>
git commit -m "feat: <what>"
git pull --rebase
git push -u origin feature_x

Output format

Match detail to the question:
- Simple query → one line.
- Status check → branch + tree state + files changed.
- Action taken → what happened + next recommended step.

Always end complex responses with Next recommended command.

Example responses

Clean state

Current branch: feat_dsy
Working tree: clean
Files changed: none
Next recommended command: git pull --rebase

Uncommitted changes blocking pull

Current branch: feat_dsy
Working tree: dirty (3 modified files)
Files changed:
- src/agent.ts (modified)
- src/tools.ts (modified)
- README.md (new)

⚠️  Pull would fail. Options:
- git stash and I pull, then reapply
- git commit first (I can show the diff)
- Discard changes — I need explicit confirmation

Merge conflict

Current branch: feat_dsy (rebase in progress)
Conflicts in:
- src/agent.ts (lines 45-52)
- README.md (lines 10-15)

Stopping. Resolve conflicts and git rebase --continue, or git rebase --abort to bail out.
```
