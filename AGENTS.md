# Project Agent Instructions

## Git workflow

- Repository: `https://github.com/armmerhelo/e-office.git` (`origin`).
- Default branch: `main`; use the current branch and its configured upstream.
- **Every successful commit must be followed immediately by a push.** This is the user's standing instruction; no additional push confirmation is needed unless the user explicitly changes it.
- If the branch has an upstream, run `git push`. If it does not, run `git push -u origin <current-branch>`.
- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`. Stage only the intended changes and run `node scripts/check-staged.cjs` to check the staged files for secrets.
- Never commit real credentials, `config/local.php`, staff data, uploaded documents, or private test-account files.
- Do not force-push, bypass hooks, or change Git configuration to complete a push.
- After pushing, verify that the local branch and its upstream are synchronized; include the commit hash and push result in the final response.
- If the push fails, report the cause and the unpushed commit instead of claiming the task is complete.

## Additional instructions

Follow any applicable nested `AGENTS.md` files, including `e-sign/AGENTS.md`.
