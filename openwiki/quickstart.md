---
type: guide
title: Quickstart
description: Start here — what the Barnacle CRM is, how to run and test it locally with no Google, Vercel or Supabase account, and which wiki page answers which question.
tags: [quickstart, overview, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Quickstart

The Barnacle CRM is a Next.js (App Router, TypeScript) app on Postgres. Barnacle staff sign in with
their barnacle.ai Google account; admins decide who has access on the Users page. It is hosted on Vercel
with Supabase Postgres, but local work needs only Node.js and a local Postgres: a fake Google login and
fake data stand in for the outside services.

## Run it

```bash
npm install
cp .env.example .env.local   # APP_ENV=development, DATABASE_URL=…/crm_dev, FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate           # apply migrations/*.sql
npm run db:seed              # fake users (Ada Fake and Grace Fake are admins)
npm run dev                  # http://localhost:3000 → [ FAKE GOOGLE LOGIN ] → Ada Fake
```

Test: `export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`, then
`npm test && npm run test:e2e && npm run typecheck`. Full command and settings tables are in the README.

## Where to look

| Question | Page |
|---|---|
| How is the app put together? | [Architecture overview](./architecture/overview.md) |
| How does Google sign-in work, and who may sign in? | [Google sign-in flow](./auth/google-sign-in.md) |
| How are sessions, cookies and page/action guards handled? | [Sessions and access control](./auth/sessions-and-access-control.md) |
| How do I sign in locally or in tests? | [Fake Google login](./auth/fake-google-login.md) |
| How do admins add, promote or deactivate users? | [User management](./features/user-management.md) |
| What does the sidebar shell show; where do messages live? | [Signed-in layout, pages and messages](./features/signed-in-layout-and-pages.md) |
| What tables exist and how does the app connect? | [Database schema and access](./data/database-schema.md) |
| How do migrations and fake data run? | [Migrations and fake data](./operations/migrations-and-seeding.md) |
| Which settings exist; how do preview and production differ? | [Configuration and environments](./operations/configuration-and-environments.md) |
| How are tests organised; what is faked? | [Testing](./testing/testing.md) |
| I'm adding a page, link, seeder or table | [Adding a feature](./workflows/adding-a-feature.md) |
| How are features specified and documented? | [Development process](./workflows/development-process.md) |

How data moves between the browser, the app, Postgres and Google is drawn in
[`dataflow/DATAFLOW.md`](../dataflow/DATAFLOW.md). Dependencies and their versions are in
[`sbom/SBOM.md`](../sbom/SBOM.md). Product rules, design and team decisions are in `docs/PRODUCT.md`,
`docs/DESIGN.md` and `docs/DECISIONS.md`.
