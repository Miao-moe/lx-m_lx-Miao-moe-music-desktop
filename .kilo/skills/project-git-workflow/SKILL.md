---
name: project-git-workflow
description: This skill should be used for every code-changing task in this repository's main worktree. It synchronizes Git before editing, keeps development on dev, and commits and pushes the completed task to origin/dev after validation.
---

# Project Git Workflow

## Overview

Synchronize the repository before each implementation task and publish each completed task to `dev`. Preserve concurrent or user-authored changes and use merge-based pulls rather than rebases.

## Start Of Task

Perform these steps before reading implementation files or editing code:

1. Inspect the current branch, working tree, upstream, and recent history with `git branch --show-current`, `git status --short`, and `git log --oneline -10`.
2. Preserve every existing staged, unstaged, and untracked change. Never reset, discard, overwrite, or silently include unrelated changes.
3. Fetch remote state with `git fetch origin --prune`.
4. Use `dev` for implementation in the main worktree. When the clean main worktree is on another branch, switch to `dev` before editing.
5. Compare `dev` with `origin/dev`. When the remote branch is ahead, inspect the incoming commits and changed files before pulling, then report the changes to the user as described in **Remote Change Reporting**.
6. Record the current local `dev` commit, then run `git pull --no-rebase origin dev` before implementation.
7. Resolve straightforward merge conflicts without removing either side's valid work. Stop and request a decision when conflict intent is ambiguous.
8. Verify and report the changes actually incorporated by the pull, then recheck `git status --short` and begin implementation only after synchronization succeeds.

When the worktree is already dirty, fetch and inspect remote changes first. Do not use automatic stash or pull through conflicting local edits. Continue only when synchronization can preserve the existing changes safely; otherwise report the blocker.

## End Of Task

Perform these steps after implementation is complete:

1. Run the relevant lint, tests, build, and `git diff --check`. Do not commit known-broken work.
2. Inspect `git status`, the complete task diff, and recent commits before staging.
3. Stage only files belonging to the completed task. Exclude unrelated or user-authored files, especially the local untracked `development model.cmd` file.
4. Commit with a concise conventional message matching repository history. Do not create an empty commit when the task produced no changes.
5. Fetch `origin` again before pushing. If `origin/dev` advanced during the task, commit local work first, inspect and report the incoming changes as described in **Remote Change Reporting**, then merge with `git pull --no-rebase origin dev`, resolve conflicts, and rerun affected validation.
6. Push with `git push origin dev`.
7. Verify the pushed commit and final working tree with `git log --oneline -5` and `git status --short`.
8. Report commit hashes, validation results, push status, and any intentionally untracked files.

## Remote Change Reporting

When `origin/dev` contains commits not present in local `dev`, identify and explain them before pulling or merging:

1. List incoming commits with `git log --oneline dev..origin/dev` or the equivalent range from the current local commit.
2. Inspect the scope with `git diff --stat dev..origin/dev` and `git diff --name-status dev..origin/dev`.
3. Report the number of incoming commits, their hashes and subjects, the main files or modules affected, and the meaningful behavior, configuration, dependency, or build changes that can be inferred from the commit and diff.
4. Call out unusually large lockfile/generated-file changes, deletions, migrations, workflow changes, or areas likely to conflict with the requested task.
5. State clearly that remote changes were found and that a pull or merge will occur. Do not silently synchronize an updated `dev` branch.
6. After synchronization, compare the recorded pre-pull commit with the updated `dev` branch using `git log --oneline <before>..dev` and `git diff --stat <before>..dev`. Confirm what was actually incorporated and whether the operation was a fast-forward or merge commit.

Keep the report concise and user-facing. Summarize intent and affected areas instead of dumping the complete diff.

## Safety Rules

- Never use `git reset --hard`, `git checkout -- <file>`, force-push, rebase, or destructive cleanup.
- Never stage or commit secrets, generated local state, or unrelated changes.
- Never amend an existing commit unless explicitly requested.
- Never merge or push `dev` into `master` unless explicitly requested.
- Treat permission prompts for fetch, pull, commit, and push as required workflow steps.
- Keep Agent Manager worktrees on their assigned branches. Do not move an isolated worktree directly onto `dev`; report its branch and integration status instead.
- Prefer one task-focused commit. Split commits only when changes are independently meaningful, such as a functional fix and a version bump.

## Completion Criteria

Consider the task complete only when synchronization succeeded, requested changes are validated, the intended commit is present on `origin/dev`, and unrelated working-tree changes remain untouched.
