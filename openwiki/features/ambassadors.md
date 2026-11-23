---
type: feature
title: Ambassadors and referrals (SF-114)
description: The Ambassadors page and ambassador page, the ambassador flag on people, the Referred by field on people and deals, referral events on timelines, and the rule that hides private referrers.
tags: [ambassadors, referrals, people, deals, timeline, private]
sources:
  - id: sf114-src-ambassadors
    resource: repo://src/server/records/ambassadors.ts
  - id: sf114-src-rules
    resource: repo://src/server/records/referral-rules.ts
  - id: sf114-src-migration
    resource: repo://migrations/0008_ambassadors.sql
  - id: sf114-src-list-page
    resource: repo://src/app/(app)/ambassadors/page.tsx
  - id: sf114-src-page
    resource: repo://src/app/(app)/ambassadors/[id]/page.tsx
  - id: sf114-src-seed
    resource: repo://src/seed/ambassadors.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-23T16:36:16.962Z
generated: { by: "claude-code", at: "2026-11-23T16:36:16.962Z" }
---

# Ambassadors and referrals

A person can be marked as an ambassador. A person or a deal can say who referred it. The tables are in
[Database schema](../data/database-schema.md) (migration 0008); how data moves is drawn in
[`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md) (process "Ambassadors pages and referrals", group "Records").
The people and deal pages themselves are in [People and organisations](people-and-organisations.md) and
[Pipelines, deals and the board](pipelines-and-deals.md).

## Pages

- `src/app/(app)/ambassadors/page.tsx`: the Ambassadors page (sidebar entry added in `nav.ts`), one row per visible
  ambassador with counts of referred people and deals and open, won and lost values.
- `src/app/(app)/ambassadors/[id]/page.tsx`: the ambassador page, with `LatestUpdates.tsx` (paged referral updates) and
  its own `not-found.tsx`.
- `src/app/(app)/records/ReferrerPicker.tsx` (client) is the "Referred by" picker of the person and deal forms;
  `ReferredBy.tsx` shows the line on the person page, deal page and drawer. The People and deal lists get a referrer filter.

## Server code

- `src/server/records/ambassadors.ts`: `listAmbassadors`, `getAmbassadorPage`, `readAmbassadorUpdates`, the picker
  options (`ambassadorOptions`, `referrerOptions`), `isOfferedAmbassador` and `referrerOf`. Counts come from one shared
  summary fragment.
- `src/server/records/referral-rules.ts` (pure): `parseReferredBy`, `decideReferrer` and `referralEvent`, which decide
  whether a referrer is kept, set, changed or cleared and which event to record.
- `people.ts` holds `resolveReferrer` / `recordReferral`, shared with `deals.ts`.

## Rules worth knowing

- Only ticked, non-archived ambassadors the viewer can see are offered and accepted as a new referrer.
- Every read goes through the private-person rule in `visibility.ts`; a referrer the viewer cannot see is shown as hidden,
  and the People list keeps a referrer filter only when it is one of the viewer's options.
- Referral changes are timeline events (`ambassador_added`, `ambassador_removed`, `referrer_set`, `referrer_changed`,
  `referrer_cleared`); `from_person_id` keeps the previous referrer on a change.
- Deleting a person sets `referred_by_id` to null on the people and deals they referred.

## Fake data

`src/seed/ambassadors.ts` seeds fake ambassadors and referrals through the seeder registry in `src/seed/index.ts`.
