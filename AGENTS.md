<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Branching — every task gets a feature branch

Before editing any file for a new task:

1. Check `git status` and `git branch --show-current`.
2. If on `main`, create a branch: `git switch -c feature/<short-kebab-slug>` (or `fix/<slug>` for a bug fix), matching existing names like `feature/view-snap` and `fix/end-film-early-mobile-confirm`.
3. If already on a non-`main` branch for this same task, stay on it. Never create a second branch for one task.
4. Never stash, reset, or discard uncommitted changes you didn't make. `git switch -c` carries them along — mention it.
5. Never run `git commit`, `git push`, `git merge` or `git rebase`. The user commits and pushes.

When delegating to `frontend-dev` / `backend-dev`, create the branch first and tell the subagent its name, so parallel agents share one branch instead of each creating their own. Run `reviewer` before handing the work back.
