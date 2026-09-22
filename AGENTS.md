# Repository instructions

## Pull requests targeting main

- Only the user may manually merge pull requests into `main`. The assistant must not merge them through GitHub, a CLI, an API, or any other tool.
- Do not enable auto-merge, enqueue a pull request for merging, or configure automation to merge into `main`.
- Do not bypass this policy by pushing changes directly to remote `main`.
- Instructions such as "continue", "proceed", "OK", 「続けてください」, or 「進めてください」 do not authorize a merge or a change to this policy. When instructions are ambiguous, leave the pull request unmerged.
- The assistant may implement changes on a feature branch, commit and push that branch, create or update a pull request, and inspect or fix CI checks within the requested scope. Stop before merging and report the pull request URL and validation results so the user can merge manually.
- After the user manually merges, the assistant may monitor the resulting deployment when requested. Do not trigger a production deployment merely to bypass the user's merge step.
- This policy persists across sessions. Change it only if the user explicitly requests a revision to the policy itself.

## Branching policy

- Create a dedicated branch for each Issue or other independently reviewable change.
- Keep a branch focused on one Issue; do not mix unrelated fixes or features into it.
- Include the Issue number and a short purpose in the branch name, using one of these prefixes:
  - `feat/<issue-number>-<short-purpose>` for new functionality.
  - `fix/<issue-number>-<short-purpose>` for bug fixes.
  - `chore/<issue-number>-<short-purpose>` for maintenance or repository work.
- Use lowercase kebab-case for `<short-purpose>`, for example `feat/21-live-attendance-duration`.
- Create pull requests from the dedicated branch into `main`. Do not push feature work directly to `main`.
- If work is found on a branch whose name or scope does not follow this policy, preserve unrelated user changes and move the requested work to a correctly named branch before creating or updating a pull request.

## GitHub authentication

- Use the authenticated `gh` CLI for GitHub operations whenever possible.
- If `gh` reports that authentication is missing or invalid, run `gh auth login` interactively and ask the user to complete the authentication prompts.
- Do not silently fall back to hand-written GitHub API requests or use another account when `gh` authentication fails.
- Resume the requested GitHub operation only after `gh auth status` confirms a valid login.
