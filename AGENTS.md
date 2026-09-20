# Repository instructions

## Pull requests targeting main

- Only the user may manually merge pull requests into `main`. The assistant must not merge them through GitHub, a CLI, an API, or any other tool.
- Do not enable auto-merge, enqueue a pull request for merging, or configure automation to merge into `main`.
- Do not bypass this policy by pushing changes directly to remote `main`.
- Instructions such as "continue", "proceed", "OK", 「続けてください」, or 「進めてください」 do not authorize a merge or a change to this policy. When instructions are ambiguous, leave the pull request unmerged.
- The assistant may implement changes on a feature branch, commit and push that branch, create or update a pull request, and inspect or fix CI checks within the requested scope. Stop before merging and report the pull request URL and validation results so the user can merge manually.
- After the user manually merges, the assistant may monitor the resulting deployment when requested. Do not trigger a production deployment merely to bypass the user's merge step.
- This policy persists across sessions. Change it only if the user explicitly requests a revision to the policy itself.
