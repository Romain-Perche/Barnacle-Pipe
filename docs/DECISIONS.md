# Decisions

The choices people made for this repo, one line each, newest last: `- <the choice> (<issue key>)`.
Product rules are in `docs/PRODUCT.md`, the look and feel in `docs/DESIGN.md`.
Only choices people made: how the code works is in the wiki (`openwiki/`), how to run it in the README.
- The CRM is built in steps, one Linear issue per feature, not in one task (kickoff)
- TypeScript, with Postgres as the database (kickoff)
- The app is hosted on Vercel, and its database is Postgres on Supabase (kickoff)
- Local runs and tests use a local Postgres: developing and testing needs no Vercel or Supabase account (kickoff)
- The production database has a daily backup (kickoff)
- No staging site before the first go-live; tests, local runs and Vercel preview deployments use generated fake data, never the production database (kickoff)
- Sign-in is Google only, through an Internal OAuth app in the barnacle.ai Google Workspace: only barnacle.ai accounts can sign in (kickoff)
- The OAuth client secret and every other secret stay out of the repo and out of issues; tests use a fake Google login (kickoff)
- The first admin is Alexis; an admin can make another user an admin (kickoff)
- Ambassadors are contacts, not users: they never sign in (kickoff)
- A private contact or deal hides it, its emails and its notes from everyone but its creator, admins included (kickoff)
- Money is in GBP only (kickoff)
- A deal has one main contact plus any number of other linked people; teammates can follow a deal to get its updates (kickoff)
- Anyone can archive a deal, person or organisation; only an admin can delete one for good (kickoff)
- Any user can import from Pipedrive: they save their Pipedrive API token in their settings, tick what to import (people, organisations, deals, notes, activities, files…) and press Import (kickoff)
- An import never creates a copy of a record it already imported: each imported record keeps its Pipedrive ID (kickoff)
- The import is built and tested with fake Pipedrive data only; the factory never gets a real token (kickoff)
- A saved Pipedrive token is stored encrypted and never shown again (kickoff)
- Each ticked type is imported with all the information the CRM uses for it, not just names; a person's unsubscribed status always comes with them (kickoff)
- A record already imported is left as it is on a new import; the import ends with a report of what was not imported and why (kickoff)
- A Pipedrive record that matches one already in the CRM (a person by email, an organisation by name) is linked to it, never copied (kickoff)
- Pipedrive custom fields with no matching CRM field are not imported: the import report lists them (kickoff)
- Every outside service (Google sign-in, Gmail, Google Calendar, Pipedrive, email sending) is reached through settings and has a fake: the whole app is built and tested without real accounts, and the real ones are set up before go-live (kickoff)
- Open and click tracking is off by default and switched on per email or campaign (kickoff)
