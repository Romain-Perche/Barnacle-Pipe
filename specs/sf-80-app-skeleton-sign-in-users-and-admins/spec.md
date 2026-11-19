# Feature Specification: App skeleton — sign-in, users and admins

**Feature Branch**: `factory/sf-80-app-skeleton-sign-in-users-and-admins`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "App skeleton: sign-in, users and admins. The first piece of the CRM described in `docs/PRODUCT.md`: the app itself, Google sign-in for the team, and an admin page to manage users (section 7). Set it up so later features slot in easily, with a command to load fake data."

## Clarifications

### Session 2026-11-19

- Q: Which design do you want for the Users page? → A: Design: A, a table with the actions on each row ([ MAKE ADMIN ] / [ REMOVE ADMIN ], [ DEACTIVATE ] / [ REACTIVATE ]) and an add field with [ ADD USER ] above it (see `design-options.html`).
- Q: Which time zone and format does the Users page use for last sign-in? → A: UK time (Europe/London), written like "19 Nov 2026, 09:12", or "Never" (decided by the factory, to confirm)
- Q: Are the user change records (who added, promoted, demoted, deactivated or reactivated whom) shown anywhere? → A: No: they are kept in the database only, never deleted, and no page shows them in this feature (decided by the factory, to confirm)
- Q: Should a barnacle.ai Google account whose email address Google has not verified be allowed to sign in? → A: No: it is refused with "Only barnacle.ai Google accounts can sign in." (decided by the factory, to confirm)
- Q: Does `[ Sign out ]` end the session on every browser or only the current one? → A: Only the current browser; deactivation ends all of the user's sessions (decided by the factory, to confirm)
- Q: In development and test, what does the sign-in page offer? → A: The normal "Sign in with Google" button plus a `[ FAKE GOOGLE LOGIN ]` link; the link never appears in any other environment (decided by the factory, to confirm)
- Q: Which fake users does the fake data command create? → A: Clearly fake names, not the real team: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated), all @barnacle.ai (decided by the factory, to confirm)
- Q: How must the migration command lock against a second run, given that production reaches the database through Supabase's transaction pooler? → A: Not with a session-level lock, which can stay held on a pooled server connection after the command exits and make the next deploy's migration wait forever. Each migration takes a transaction-level lock inside its own transaction, and a test shows that two migration runs in a row both finish. (alexis@barnacle.ai)
- Q: Can Supabase's Data API read or write the app's tables? → A: No. Row Level Security is enabled, with no policies, on every table the migrations create; the app's own database user owns the tables and is not affected. (alexis@barnacle.ai)
- Q: Can the fake Google login and the fake data command work on a Vercel deployment? → A: No. They are refused when VERCEL_ENV is "production" or "preview", whatever APP_ENV says. (alexis@barnacle.ai)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Team member signs in with their barnacle.ai Google account (Priority: P1)

A Barnacle team member (for example Mikey, JD or Duncan) opens the CRM, is sent to a sign-in page, chooses "Sign in with Google", picks their barnacle.ai account and lands on the signed-in home page. The home page has the shared layout every later feature will use: a blue left sidebar with the wordmark, the main navigation, an "// Admin" group (shown to admins only), and the user's name with `[ Sign out ]` at the bottom. They stay signed in across visits until they sign out or their access is removed.

**Why this priority**: Nothing else in the CRM can be used or built on until people can get in securely. This is the minimum viable slice: a running app that only the team can enter.

**Independent Test**: With a user already on the access list, sign in through the (fake, in tests) Google login and confirm the signed-in home page with the sidebar appears; sign out and confirm the pages are no longer reachable.

**Acceptance Scenarios**:

1. **Given** a person who is not signed in, **When** they open any page of the app, **Then** the sign-in page with a "Sign in with Google" button is shown, and after signing in the browser shows the page they first asked for (the home page if they asked for none).
2. **Given** a barnacle.ai account that an admin has added on the Users page, **When** its owner signs in with Google, **Then** the home page shows "Hello, <their first name>" and the sidebar shows their full name above `[ Sign out ]`.
3. **Given** the first admin's barnacle.ai address named in the app's settings, **When** that person signs in for the very first time on an empty system, **Then** the home page is shown and the sidebar shows the "// Admin" group with a Users link.
4. **Given** a barnacle.ai account that is not on the Users list (and is not the first admin), **When** its owner signs in with Google, **Then** the sign-in page shows "This account doesn't have access yet. Ask an admin to add you." and opening the home page still shows the sign-in page.
5. **Given** a Google account outside barnacle.ai (e.g. a personal Gmail), **When** someone tries to sign in with it, **Then** the sign-in page shows "Only barnacle.ai Google accounts can sign in." and opening the home page still shows the sign-in page.
6. **Given** a signed-in user, **When** they press `[ Sign out ]`, **Then** the sign-in page is shown, and opening the home page or the Users page shows the sign-in page.
7. **Given** a signed-in user, **When** they close the browser completely, reopen it and open the app, **Then** the home page is shown without signing in again.

---

### User Story 2 - Admin manages who can use the CRM (Priority: P2)

An admin opens the Users page from the "// Admin" group in the sidebar. They see everyone with access: name, email, role (admin or user), status (active or deactivated), and when they last signed in. They can add a new teammate by barnacle.ai email address, make a user an admin or remove admin rights, and deactivate or reactivate a user. A deactivated user can no longer sign in and is signed out straight away.

**Why this priority**: The team today is three people with room to add more (PRODUCT §7). Without this page, nobody beyond the first admin could get in, so it is needed before the app is useful to the team, but it depends on sign-in existing first.

**Independent Test**: Sign in as an admin, add a new barnacle.ai address, make it an admin, then sign in as that person and confirm they see the Users page; deactivate them and confirm they are signed out and refused on their next sign-in.

**Acceptance Scenarios**:

1. **Given** a signed-in admin, **When** they open the Users page, **Then** each user is one row showing name, email, role ("Admin" or "User"), status ("Active" or "Deactivated") and last sign-in time ("Never" if they have not signed in).
2. **Given** a signed-in admin, **When** they add `newperson@barnacle.ai`, **Then** a row for `newperson@barnacle.ai` appears with role "User" and status "Active", and that person can sign in.
3. **Given** a signed-in admin, **When** they try to add an address outside barnacle.ai, or one already on the list, **Then** the message "Only barnacle.ai addresses can be added." (outside address) or "This person is already a user." (existing address) is shown and the number of rows is unchanged.
4. **Given** a signed-in admin and another active user, **When** the admin makes that user an admin, **Then** the row shows role "Admin", and when that user reloads any page their sidebar shows the "// Admin" group and they can open the Users page.
5. **Given** two or more admins, **When** an admin removes admin rights from another admin (or from themselves), **Then** the row shows role "User", and that person's next page load hides the "// Admin" group and opening the Users page shows "You don't have access to this page."
6. **Given** a signed-in admin and an active user who is currently signed in, **When** the admin deactivates that user, **Then** the row shows status "Deactivated"; the user's next page load shows the sign-in page with "Your access has been removed. Ask an admin if this is a mistake.", and signing in again shows the same message.
7. **Given** a deactivated user, **When** an admin reactivates them, **Then** the row shows status "Active" with the role they had before, and they can sign in.
8. **Given** only one active admin, **When** anyone tries to remove that admin's rights or deactivate them, **Then** the message "The CRM must always have at least one active admin." is shown and the row still shows "Admin" and "Active".
9. **Given** a signed-in user who is not an admin, **When** they try to open the Users page or perform any admin action directly, **Then** the page shows "You don't have access to this page.", no user row changes, and their sidebar has no "// Admin" group.

---

### User Story 3 - Developer loads fake data to work on the app (Priority: P3)

A developer (or the automated build factory) runs a single command on a local or test copy of the app that fills it with realistic fake data: a set of fake barnacle.ai users including admins, regular users and a deactivated user. They can then sign in as any of those fake users through the fake Google login and try the app, without any real Google account or production data. Later features add their own fake records (pipelines, deals, contacts…) to the same command.

**Why this priority**: It speeds up every later feature and keeps real data out of tests and previews (DECISIONS), but the team can use the CRM without it.

**Independent Test**: On an empty local copy, run the fake data command, then sign in as a fake admin and a fake user through the fake login and confirm each sees what their role allows.

**Acceptance Scenarios**:

1. **Given** an empty local or test copy of the app, **When** the developer runs the fake data command, **Then** the command prints the users it created (at least two admins, at least two regular users and one deactivated user, all @barnacle.ai), and signed in as a fake admin the Users page shows those rows.
2. **Given** a copy that already has fake data, **When** the command is run again, **Then** it ends without an error and the Users page shows the same number of rows as before.
3. **Given** a running local or test copy with fake data, **When** the developer uses the fake Google login, **Then** they can pick a fake user from a list or type any email address and name; picking an active user shows the home page, and picking the deactivated user or typing an unlisted address shows the same messages as real sign-in.
4. **Given** an app copy whose environment is anything other than exactly "development" or "test" (including when the environment is not set), or a Vercel production or preview deployment whatever its environment says, **When** someone runs the fake data command or tries the fake Google login, **Then** the command prints "Fake data can only be loaded when APP_ENV is development or test." and changes nothing, and the sign-in page shows no fake login option (opening the fake login address directly shows "Page not found.").

---

### User Story 4 - Later features slot into the skeleton (Priority: P3)

A developer building the next feature (for example Pipelines and deals) adds a new page and a sidebar entry, protected by sign-in, and — if admin-only — listed under "// Admin", without having to rebuild sign-in, the layout or access checks.

**Why this priority**: The request explicitly asks for a skeleton that later features slot into. It is checked through the pages that exist today, which all use the same shared pieces.

**Independent Test**: Open every page of the app signed out, as a user and as an admin, and confirm the same layout and the same access rules apply everywhere; follow the README on a fresh checkout.

**Acceptance Scenarios**:

1. **Given** a person who is not signed in, **When** they open the home page, the Users page or any other app address directly, **Then** the sign-in page is shown each time.
2. **Given** a signed-in user, **When** they open the home page and then any other signed-in page, **Then** both show the same blue sidebar with the wordmark, a Home link, and their name above `[ Sign out ]`; the current page's sidebar link is highlighted.
3. **Given** a developer with a fresh checkout and a local database, **When** they follow the README, **Then** they can update the database, load fake data, start the app, sign in as a fake admin, and run the automated tests and the browser tests, all without any Google, Vercel or Supabase account, and the test commands report no failures.

---

### Edge Cases

- A person signs in as `Mikey@Barnacle.ai` when the admin added `mikey@barnacle.ai`: the home page is shown (addresses are compared without regard to letter case).
- An admin adds `  jd@barnacle.ai  ` with spaces around it: the new row shows `jd@barnacle.ai` without spaces.
- The first admin named in settings has been deactivated by another admin and tries to sign in: the sign-in page shows "Your access has been removed. Ask an admin if this is a mistake."
- No first admin is set in settings and the Users list is empty: the sign-in page shows "The CRM isn't set up yet. No first admin has been named." and no sign-in button.
- A user signs in with a different name on their Google account (with the fake login: the same email, a new name): the sidebar and their Users row show the new name.
- A user added by an admin has never signed in: their row shows the part of the email before `@` as the name and "Never" as the last sign-in.
- Google sign-in is cancelled or fails part-way (with the fake login: press Cancel): the sign-in page shows "Sign-in was cancelled or failed. Please try again." with the "Sign in with Google" button.
- An admin looks at their own row on the Users page: it shows `[ REMOVE ADMIN ]` but no `[ DEACTIVATE ]` button.
- An admin removes their own admin rights while another active admin exists: the home page is shown and their sidebar has no "// Admin" group.
- Admins A and B both have the Users page open. A removes B's admin rights; B, without reloading, then presses the button to remove A's admin rights: B sees "You don't have access to this page." and A's row still shows "Admin".
- A preview deployment is opened: the sign-in page shows "Sign-in is turned off on preview deployments." and no sign-in button.
- The fake data command is run with APP_ENV "development" but VERCEL_ENV "production" (or "preview"): it prints "Fake data can only be loaded when APP_ENV is development or test." and changes nothing; the app started with the same settings shows no `[ FAKE GOOGLE LOGIN ]` link, and opening the fake login address shows "Page not found.".
- The migration command is run twice in a row on the same database: both runs finish within 30 seconds; the second prints "Database is up to date.".
- Two migration commands start at the same time on an empty database: both finish within 30 seconds, each migration is applied exactly once, and no database lock is still held after both have exited.
- A database role other than the app's own (as Supabase's Data API uses) reads any app table: it gets no rows; it tries to add a row: the database refuses it.
- Someone opens an app address that does not exist while signed in: the page shows "Page not found." inside the normal sidebar layout, with a link back to Home.

## Requirements *(mandatory)*

### Functional Requirements

**Sign-in and sessions**

- **FR-001**: The app MUST require sign-in for every page except the sign-in page and its error/notice pages.
- **FR-002**: The app MUST offer Google as the only way to sign in, and MUST only accept Google accounts on the barnacle.ai domain.
- **FR-003**: The app MUST let a barnacle.ai account sign in only if it belongs to an active user on the Users list, or it is the first-admin address named in the app's settings and no user record exists yet for it.
- **FR-004**: When the first admin named in settings signs in for the first time, the app MUST create their user record as an active admin.
- **FR-005**: The app MUST refuse every other sign-in attempt with a clear, non-technical message and MUST NOT create a session for it.
- **FR-006**: The app MUST keep a signed-in user's session across browser restarts until they sign out, their session expires after 30 days without use, or they are deactivated.
- **FR-007**: The app MUST end the session on sign-out, and MUST end all of a user's sessions immediately when they are deactivated.
- **FR-008**: The app MUST record each user's name (from their Google account) and the time of their latest sign-in.
- **FR-009**: After signing in, the app MUST return the person to the page they originally asked for, if it is a page within the app; otherwise to the home page.

**Users and admins**

- **FR-010**: Each user MUST have exactly one role, admin or user, and a status, active or deactivated.
- **FR-011**: Only admins MUST be able to open the Users page and perform any user management action; the app MUST enforce this on every action, not only by hiding links.
- **FR-012**: The Users page MUST list all users with name, email, role, status and last sign-in time. It MUST follow design A in `design-options.html`: one table row per user, a field and an `[ ADD USER ]` button above the table, error messages shown above the table, and each row's actions shown on the row itself: `[ MAKE ADMIN ]` or `[ REMOVE ADMIN ]`, and `[ DEACTIVATE ]` or `[ REACTIVATE ]`. Deactivated rows are greyed out.
- **FR-013**: Admins MUST be able to add a user by barnacle.ai email address; new users start as active, non-admin users. Addresses MUST be trimmed, compared case-insensitively, restricted to barnacle.ai, and unique.
- **FR-014**: Admins MUST be able to give admin rights to a user and remove them from a user (including themselves).
- **FR-015**: Admins MUST be able to deactivate and reactivate users. Users are never deleted, so their name stays attached to anything they created in later features. An admin cannot deactivate themselves: their own row has no `[ DEACTIVATE ]` button, and a direct request to do so shows "You can't deactivate yourself."
- **FR-016**: The app MUST refuse any change that would leave the CRM with no active admin.
- **FR-017**: Changes to a user's role or status MUST take effect on that user's next request, without them having to sign out.
- **FR-018**: The app MUST record who made each change to a user (added, role changed, deactivated, reactivated) and when.

**Layout and navigation**

- **FR-019**: Every signed-in page MUST use one shared layout following design B in `docs/DESIGN.md` / DECISIONS: a blue left sidebar with the wordmark, the main navigation, an "// Admin" group, and the signed-in user's name with `[ Sign out ]` at the bottom.
- **FR-020**: The "// Admin" group MUST be shown only to admins and, in this feature, MUST contain the Users page.
- **FR-021**: The main navigation MUST contain a Home entry; later features add their own entries in the same place.
- **FR-022**: The home page MUST greet the signed-in user by name and act as the landing page until later features (e.g. pipelines) replace it.
- **FR-023**: The sign-in page, "not allowed" page and "not found" page MUST follow the app's visual design.

**Development, testing and fake data**

- **FR-024**: The app MUST provide a fake Google login that lets a developer or test sign in as a chosen user without a real Google account, applying the same access rules as real sign-in.
- **FR-025**: The app MUST provide a single command that loads fake data; in this feature it creates fake users (at least two admins, at least two regular users and one deactivated user) and later features extend it. Running it twice MUST NOT create duplicates.
- **FR-026**: The fake Google login and the fake data command MUST work only when the app environment setting is exactly "development" or "test", and MUST be refused everywhere else, including when the setting is missing. They MUST also be refused on a Vercel production or preview deployment (VERCEL_ENV "production" or "preview"), whatever the app environment setting says.
- **FR-027**: The app MUST provide an explicit command to bring the database structure up to date, separate from starting the app; it MUST NOT happen automatically when the app starts. Its lock against a second run MUST be released when each migration's transaction ends (never held by a pooled connection after the command exits), so a run started after another has finished, or alongside it, always finishes.
- **FR-028**: Preview deployments MUST only build the app: no database is used and nobody can sign in.
- **FR-029**: All secrets (Google client secret, database credentials, session secrets) MUST come from settings outside the repository; none may be committed.
- **FR-030**: The repository MUST include automated tests for the sign-in rules and user management, browser tests covering sign-in, sign-out and the Users page, and a single command to run each.
- **FR-031**: The README MUST explain how to set up a local copy, update the database, load fake data, run the app and run the tests, and list every setting the app reads.
- **FR-032**: Every table the migrations create MUST have Row Level Security enabled with no policies, so Supabase's Data API cannot read or write it. The app's own database user owns the tables and keeps full access.

### Key Entities

- **User**: A Barnacle team member who can sign in. Email (barnacle.ai, unique, case-insensitive), display name, role (admin or user), status (active or deactivated), when they were added and by whom, latest sign-in time. Ambassadors are not users.
- **Session**: A signed-in browser for one user. Belongs to a user, has a creation time and an expiry, and ends on sign-out, expiry or deactivation.
- **User change record**: A record of an admin action on a user — who did it, to whom, what changed (added, made admin, admin removed, deactivated, reactivated) and when.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A listed team member can go from opening the app to the signed-in home page in under 30 seconds, in no more than 3 clicks.
- **SC-002**: 100% of sign-in attempts from non-barnacle.ai accounts, unlisted barnacle.ai accounts and deactivated users are refused in automated tests.
- **SC-003**: 100% of admin pages and admin actions are refused to non-admins in automated tests, including direct requests that bypass the sidebar.
- **SC-004**: An admin can add a new teammate and that person can sign in, in under 1 minute in total.
- **SC-005**: A deactivated user loses access on their very next action, with no wait.
- **SC-006**: A new developer with no Google, Vercel or Supabase account can go from a fresh checkout to a running local app with fake data, signed in as a fake admin, by following the README in under 15 minutes.
- **SC-007**: The fake login and fake data command are refused in 100% of tested environments other than "development" and "test", including an unset environment, and on every tested Vercel production or preview setting.
- **SC-009**: Two migration runs in a row, and two at the same time, both finish in 100% of automated test runs.
- **SC-010**: 100% of the tables the migrations create have Row Level Security enabled, checked by an automated test that covers tables added by later features too.
- **SC-008**: The CRM can never reach a state with zero active admins through the app.

## Assumptions

- The first admin is Alexis, whose address is given in the app's settings (DECISIONS); Mikey, JD and Duncan are then added by an admin on the Users page.
- Removing access means deactivating, not deleting, so later records (deals, notes, emails) keep their author.
- Sessions last 30 days without use; this is a standard web default and can be tuned later.
- Users can't edit their own profile in this feature; their name comes from Google.
- Admin management of pipelines, stages and custom fields (PRODUCT §7) belongs to the features that introduce those things; this feature only provides the "// Admin" group they will be added to.
- Private contacts and deals, and team-wide sharing of records (PRODUCT §7), arrive with the features that introduce those records.
- Gmail and Google Calendar permissions are not requested at sign-in; they are asked for when those features connect each user's account.
- Email notifications to newly added users are out of scope; the admin tells them in person.
- The app is used on desktop browsers; a basic usable layout on smaller screens is enough for this feature.
- Technical choices already made in `docs/DECISIONS.md` (hosting, database, framework, own sessions rather than a hosted auth service, browser test tool) apply and are not repeated as requirements.
