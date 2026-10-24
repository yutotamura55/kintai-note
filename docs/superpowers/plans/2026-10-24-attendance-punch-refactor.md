# Attendance Punch Workflow Implementation Plan

> **For agentic workers:** Implement this plan in the dedicated `chore/4-punch-workflow` worktree. Keep all existing attendance behavior and error messages. Do not merge the pull request.

## Goal and scope

Issue #4 asks for maintainability after several feature additions. The current `clock.post.ts` mixes HTTP input, four punch operations, and D1 SQL, and repeats the oldest unfinished shift selection in three writes. Extract the punch operations into one D1-specific module and define the ordering rule once. Keep the SQL guards atomic, the HTTP contract, and the UI unchanged. A database-independent Repository/Application service design is tracked separately in #11.

## Files and responsibilities

- `scripts/test-local.mjs`: assert that break start/end cannot skip an older unfinished legacy shift; this protects the boundary being moved.
- `server/utils/attendance.ts`: keep the shared open-shift predicate and expose a single oldest-open ordering/query fragment; let `openAttendance` accept a D1 database.
- `server/utils/attendance-punch.ts`: own the four D1 punch writes and their existing failure messages. Accept the database, user ID, action, optional record ID, and one clock instant.
- `server/api/attendance/clock.post.ts`: authenticate, parse/validate the request, call the punch workflow, and return `{ ok: true }`.
- `server/api/attendance/today.get.ts`: pass its D1 binding to `openAttendance`.

## Steps

1. Add the oldest-first break scenario to the existing local Worker/D1 integration flow. Run `npm run test:local` and confirm it passes against the current behavior. Its assertions must fail if the break write no longer checks the oldest open ID.
2. Add a named SQL fragment for oldest-open ordering/ID selection to `server/utils/attendance.ts`. Reuse it in `openAttendance` and the punch writes. Preserve SQL parameter indexes and compare the generated statements with the originals.
3. Move each punch operation into a small function in `attendance-punch.ts`; dispatch from `recordPunch`. Keep conditional writes in the same SQL statements so concurrent requests cannot bypass state checks.
4. Reduce the endpoint to HTTP handling and update `today.get.ts`. Run `npm run test:unit`, `npm run test:local`, and `git diff --check origin/main...HEAD`.
5. Review the full diff independently against `origin/main` for correctness, security, regressions, and maintainability. Fix material findings and recheck. Push the branch, open a PR to `main` with `Closes #4` if the scoped refactor and validation are complete, then inspect required CI.

## Review focus

- Repeated `in` requests create at most one open shift.
- A supplied stale or newer record ID never falls back to another open shift.
- Break start/end and clock-out still require the oldest open shift and retain their atomic guards.
- A tracked shift remains closed by its original punch even when editable times change.
- Error status and Japanese message remain the same for invalid/repeated operations.
