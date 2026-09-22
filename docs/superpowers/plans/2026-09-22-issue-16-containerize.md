# Containerized Development Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reproducible Node.js 22 development environment for Kintai Note through Docker Compose without changing the Cloudflare deployment path.

**Architecture:** A Node.js 22 slim image installs the locked npm dependencies and runs Nuxt in development mode. Compose exposes the Nuxt port, bind-mounts source files for hot reload, keeps container `node_modules` separate from the host, and persists Wrangler's local state in a named volume. Production deployment remains the existing Wrangler-based CI flow.

**Tech Stack:** Docker, Docker Compose, Node.js 22, npm, Nuxt 3, Wrangler.

**Spec:** GitHub Issue #16 (`環境のコンテナ化`).

## Global Constraints

- Use Node.js 22, matching `.nvmrc`, CI, and the documented local environment.
- Install dependencies with `npm ci` from the committed lockfile.
- Do not copy `.dev.vars`, `.env`, or other secrets into the image.
- Keep the Cloudflare Worker deployment and D1 production configuration unchanged.

## Review Focus

- A fresh checkout can start with only Docker and Docker Compose installed.
- Host `node_modules` and platform-specific binaries do not leak into the container.
- Source edits are visible to the Nuxt process without rebuilding the image.
- Wrangler local state survives container recreation but remains isolated from production.
- Secret files are excluded from the build context and are not baked into image layers.

### Task 1: Add the development container

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`

- [ ] **Step 1: Add the Node.js 22 image definition**

  Use `node:22-bookworm-slim`, set `/app` as the working directory, copy only `package.json` and `package-lock.json` first, run `npm ci`, then copy the application source. Start Nuxt with `npm run dev -- --host 0.0.0.0`.

- [ ] **Step 2: Exclude generated files and secrets**

  Ignore `node_modules`, Nuxt/Wrangler outputs and state, local environment files, Terraform state, and VCS metadata in `.dockerignore`.

- [ ] **Step 3: Define the Compose development service**

  Build the image from the repository root, publish port `3000`, bind-mount the source tree at `/app`, use an anonymous `/app/node_modules` volume, and persist `/app/.wrangler` in a named volume. Set `CHOKIDAR_USEPOLLING=true` for reliable file watching across host platforms.

### Task 2: Document and verify the workflow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document build and startup commands**

  Add prerequisites and commands for `docker compose up --build`, opening `http://localhost:3000`, stopping with `docker compose down`, and running unit tests with `docker compose run --rm app npm run test:unit`.

- [ ] **Step 2: Document local secrets and D1 scope**

  Explain that `.dev.vars` remains a host-only file supplied to the container when needed, and that the Compose setup is for development; production still uses Wrangler/CI.

- [ ] **Step 3: Verify the container configuration**

  Run `docker compose config` and, when Docker is available, build the image and run the documented unit test command. Run the existing host unit test suite as a regression check.
