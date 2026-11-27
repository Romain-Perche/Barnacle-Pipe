# Quickstart: Reply and forward (SF-130)

How to see the feature work and what the tests must prove. Setup, commands and settings: `README.md`; the test recipe
is `.factory/test-env.md` (written by Build / the AI review).

## Prerequisites

- Local Postgres, `npm run migrate` (applies `0022_email_reply.sql`), `npm run seed` (fake data, `isFakeAllowed()`).
- Fake Gmail (as in SF-118's README section) and fake Storage (no `SUPABASE_URL`).

## Tests

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run typecheck
```

What they must prove (each test names what it covers, e.g. `// covers FR-005, US3 scenario 3`):

| area | proof |
|---|---|
| `reply-rules.ts` (unit) | Reply / Reply all / Forward prefill incl. own-sender, self-only, unknown sender, case and duplicates; `replySubject` / `forwardSubject` (`RE:`, `Re: Re:`, `Fw:`, empty); quote lines (`> `, `>` on empty lines, HTML-only text via `emailText`, emoji and `<b>` kept as text); UK date "27 Nov 2026 at 14:05"; References order, dedupe, invalid ids dropped; `parseEmailParam` |
| `buildMime` (unit) | In-Reply-To / References written, folded under 998 octets, absent when empty |
| send (integration, fake Gmail) | US1 2/4/7, US2 1–6, US3 1–4, US4 2–8, FR-013, FR-016: the fake's `sentMessages` holds exactly one message with recipients, subject, body = text + blank line + quote, headers, `threadId` (same thread when the user's mailbox holds it, new otherwise), forwarded bytes equal; CRM: same conversation id, links unchanged, auto links for a new CC'd person, Last contacted, no hand link, ledger `sent` with `reply_message_id` |
| double press / failures | same send key twice → one message; Gmail down → `compose_send_failed`, ledger row gone; key refused → `needs_reconnect`; attachment unavailable → `reply_forward_unavailable`, nothing sent |
| catch-up | `onRecordSentForTests` throws → sync stores it (including a forward to a non-CRM address) in the same conversation, once; SF-128 `copied` unchanged |
| UI (component, happy-dom) | buttons vs Settings link vs nothing (`ok` / `connect` / `reconnect` / `off`, archived); box prefilled, quote read-only, forwarded chips removable, total "2.3 MB of 25 MB", over-limit message |
| fake check | multipart request and answer against `gmail-api.json` |

## Manual run (fake data)

1. `npm run dev`, sign in with the fake Google as Ada Fake.
2. Open the fake deal with the seeded conversation: each EMAIL entry shows `[ REPLY ]` `[ REPLY ALL ]` `[ FORWARD ]`.
3. `[ REPLY ]` → box "// REPLY · <subject>", To filled, "Re: …", quote under the text. Type, `[ SEND ]` → "Email sent
   to …", the reply is the newest EMAIL entry; open the conversation page: same page, one more email.
4. `/dev/fake-gmail` → Ada's mailbox: the sent message shows its thread, In-Reply-To and References.
5. Put a received message with an attachment (`/dev/fake-gmail`), run the check, `[ FORWARD ]` it, remove nothing,
   send to `ed@example.test` → the fake shows the attachment on the sent message.
6. Sign in as a fake user with no Gmail → `[ CONNECT GMAIL TO REPLY ]` on each email instead of the buttons.
