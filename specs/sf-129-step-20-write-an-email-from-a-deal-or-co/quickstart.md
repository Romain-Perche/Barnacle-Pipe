# Quickstart: Write an email from a deal or contact (SF-129)

## Prerequisites

- Local Postgres; `npm install`; settings as in `README.md` with the fake Gmail (`GMAIL_MODE`/settings of SF-118 set to
  fake) and the fake Storage (no `SUPABASE_URL`, `isFakeAllowed()` true).
- `npm run migrate` (applies `0021_email_send.sql`, after SF-127's and SF-128's `0020_*`), `npm run seed` (Ada Fake connected to the fake Gmail; the seed adds
  one sent email on a fake deal — run it twice: still one).

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run typecheck
```

What they must prove (one test per line, each naming what it covers):

| scenario | expected |
|---|---|
| US1-1/2: deal with Ana Fake (two addresses), `emailBox` then `sendFromRecord` | To = first address only; fake Sent has one message from Ada's address, the subject, the text with line breaks; deal timeline's newest entry is EMAIL |
| US1-3/5: person page / organisation page box | To = person's first address / empty |
| US1-6: To/Cc/Bcc changed | the fake's message has exactly those recipients; Ana not among them, no link to Ana |
| US2-1: deal → Ana (To) + Ben (Cc) | one EMAIL entry (SF-127's `timelineEmails`) on deal, Ana and Ben; the deal's link is `how = 'manual'` by the sender; the conversation page lists deal, Ana, Ben |
| US2-2: written from Ana's page (one open deal, an organisation) | the entry on Ana, her organisation and her one open deal (SF-127 automatic links) |
| US2-3/4: from an organisation; to a non-CRM address | the entry on the organisation (and Ana); no person created |
| US2-5: `syncConnection` after the send | each timeline still one entry; Settings conversations +1 only |
| Edge: the sync stores it first (`storeMessage` before the send path's) | the hand link to the written-from record is still added; one entry |
| US2-6 / SC-005: a private recipient the teammate cannot see | no entry for that teammate on any timeline (`visibleConversation`) |
| US2-7: Last contacted | raised to the send time, never lowered; the written-from person not in the email: unchanged |
| US2-8: the deal unlinked by hand, then the sync | not on the deal's timeline; not linked back |
| US3: record file + computer upload | fake message attachments byte-equal, names and types kept; `// FILES` unchanged; upload path due in `file_cleanup` |
| US3-3, big file: > 25 MB total | `email_attachments_too_large`, nothing in fake Sent, no ledger row left |
| US3-5: record file deleted before send | `email_attachment_gone`, nothing sent |
| US4-1/2/4: none / needs reconnect / Gmail off | box data says so; action refuses with no Google request in the fake's `requests` |
| US4-3: key refused at send | `needs_reconnect`, connection marked, nothing recorded |
| FR-009: fake Gmail down | `email_send_failed`, ledger row deleted, the same `sendKey` can send afterwards |
| FR-010: the same `sendKey` twice (also concurrently) | one fake message, one entry |
| Sent but not recorded (`onRecordSentForTests` throws) | result `sent`; after `syncConnection`, the email is on the written-from record's and the CRM people's timelines once |
| US5: Unsubscribed Ana | sent, no warning, Consent unchanged |
| Edge: archived / deleted / made private while open | the matching message; nothing sent |
| Edge: addresses, limits, duplicates, pasted list | the matching messages; "Ana@Example.test" + "ana@example.test " → once, in To |
| Edge: `<b>prix</b> 🎉` text | in the fake's message exactly; the conversation page renders the characters as text |
| Unit: `buildMime` with attachments | multipart/mixed, RFC 2231 file names, 76-char base64 lines, Message-ID, From display name, CR/LF refused |
| Unit: `compose-rules.ts` | `splitAddresses`, dedupe order, limits in code points, total bytes, `sentNotice` |
| Fake vs schema | upload path, `uploadType=media`, `message/rfc822` in `accept`, size ≤ `maxSize`, answer = `Message` |

## By hand (`npm run dev`)

1. Sign in as Ada Fake (fake Google). Open a fake deal with a main person → `[ WRITE EMAIL ]` in // TIMELINE: the right
   panel, To filled. Type a subject and two lines, attach a deal file and a file from the computer, `[ SEND ]`.
2. The page shows "Email sent to …" once; the EMAIL entry is newest; its subject opens the conversation page with the whole text and files.
3. `/dev/fake-gmail`: the message is in Ada's Sent with both attachments.
4. Open the main person's page: the entry is there; Last contacted is now.
5. On the board, open the deal's drawer → `[ WRITE EMAIL ]` → send: the drawer is open again with the entry.
6. Settings → Disconnect Gmail → `[ WRITE EMAIL ]`: "Connect your Gmail in Settings…" and `[ GO TO SETTINGS ]`.
