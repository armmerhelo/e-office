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

## Deployment update history

- Every successful production deployment must include a user-facing update in `data/system-updates.json`, displayed at `index.php?view=updates`.
- Review the actual deployed commits and their diffs (`git log` / `git show`), then write concise Thai descriptions of what changed and how users benefit. Include each deployed commit's full hash and a reviewed summary; never infer deployment from a commit or push alone.
- Use `node scripts/release-updates.cjs prepare --from <previous-commit> --to <deployed-commit> --output <notes.json>` to collect commits and changed paths for review. For targeted releases, use the exact deployed commit hashes with `--commits <hash1,hash2>` instead of a range; exclude unrelated work.
- Complete the draft's title, summary and each commit's summary/category (`added`, `improved`, `fixed`). After deployment and verification succeed, run `node scripts/release-updates.cjs record --notes <notes.json> --deployed-at <ISO-8601-with-offset>`, publish the updated feed, and verify the production updates page/feed. The deployment is not complete until its history is published and checked.
- Preserve existing history and stable release IDs. Do not announce undeployed changes, failed deployments, private configuration, personal data, or internal operational details. If feed publication fails, report the deployment as incomplete and finish publishing it before claiming completion.
