# Quickstart: check SF-108

Prerequisites: as in `README.md` (local Postgres, `npm install`), fake Google sign-in allowed (`isFakeAllowed()`).

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npx playwright test tests/e2e/notification-count.spec.ts   # FR-007
npx playwright test tests/e2e/mentions.spec.ts tests/e2e/layout.spec.ts  # SF-102 count and sidebar still right
npm run typecheck
```

Manual check (two browsers, fake sign-in):

1. Window A: sign in as Bob Fake, open `/deals`. Window B: sign in as Ada Fake, add a note on a deal mentioning
   "@Bob Fake".
2. Window A, no reload: click "People" → sidebar shows "Notifications (1)".
3. Click "People" again → still "(1)"; Ada adds a second mention; click "People" again → "(2)".
4. Open a person from the list, then press Back → the people list shows the current count.
5. Ada deletes one note; Bob clicks any link → "(1)". Bob presses `[ MARK ALL AS READ ]` → no badge.
6. Throughout, the page never fully reloads (the browser tab's loading indicator does not spin; in the e2e test a
   `window` marker survives).
