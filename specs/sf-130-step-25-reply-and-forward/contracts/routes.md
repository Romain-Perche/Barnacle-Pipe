# Contract: pages, addresses and server actions (SF-130)

## Buttons (design B)

- **Timeline EMAIL entry** (`records/EmailEntry.tsx`): the "sender → recipients" line becomes a flex row (`.eh`): the
  line at the left, then at the right `<span class="acts mini">` with three `next/link` `.btn` links:
  `[ REPLY ]` → `<emailBase>reply-<messageId>`, `[ REPLY ALL ]` → `<emailBase>reply-all-<messageId>`,
  `[ FORWARD ]` → `<emailBase>forward-<messageId>`, `scroll={false}`.
  - `replyState` `connect` / `reconnect`: one link `[ CONNECT GMAIL TO REPLY ]` / `[ RECONNECT GMAIL TO REPLY ]` to
    `/settings` in the same place. `off`, an archived record, or no `emailBase` (deal list drawer): nothing.
- **Conversation page** (`emails/EmailBody.tsx`): the same `.eh` row holds the "To …" line (empty when the email has
  no To) and the same buttons / link, `emailBase` = `/emails/<id>?` + (`from=<from>&` when shown) + `email=`.
- `globals.css`: `.eh` (flex, space-between, align baseline) and `.acts.mini .btn` (the small framed button of
  `design-options.html` B, using DESIGN.md's tokens).

## Address parameter `email`

| value | opens |
|---|---|
| `new` | SF-129's box (record pages only, unchanged) |
| `reply-<id>` / `reply-all-<id>` / `forward-<id>` | the box filled for `email_messages.id = <id>` |
| anything else | nothing |

Pages that read it: `deals/[id]/page.tsx`, `deals/page.tsx` (drawer open), `people/[id]/page.tsx`,
`organisations/[id]/page.tsx`, **new** `emails/[id]/page.tsx`. All five export `maxDuration = 60`.

`EmailOverlay({ viewerId, target: Target | null, email, back })`:
- record page, record hidden / archived → nothing (SF-129);
- `new` without a target → nothing;
- reply modes → `replyBox(viewerId, { mode, messageId }, target)`:
  - email missing, or its conversation hidden → the box with `email_not_found` and `[ CLOSE ]` only (no form);
  - else the box (below).
- Conversation page target = the `?from=` record when `fromRecordName` finds it (visible) and it is not archived; else
  null (no record files offered).

## `replyBox` → `EmailBox` props

SF-129's `EmailBox` type, extended:

```ts
type EmailBox = {
  gmail: GmailState; from: string | null; to: string[]; cc: string[];            // cc new ([] for `new`)
  names: Record<string, string>;                                                  // lower-cased address → CRM name (prefill only)
  files: BoxFile[]; sendKey: string;
  record: { kind: ComposeKind; id: number; name: string } | null;                 // null: no record files
  reply: null | {
    mode: "reply" | "reply_all" | "forward"; messageId: number;
    heading: string;                                                              // "// REPLY · Pricing"
    subject: string;                                                              // prefilled, editable
    quote: string;                                                                // shown read-only, never sent back
    forwarded: { id: number; name: string; size: number }[];                     // forward only
  };
  missing?: true;                                                                 // email_not_found view
};
```

`EmailBox` (client): when `reply` is set, it shows the heading, prefilled To / Cc / Subject, the quote under the text
area in a read-only `<pre class="quote">` (text node) labelled `reply_quote_label`, and the forwarded attachments as
removable chips in the attachments list (counted in `used`). The footer is `reply_footer`. Send calls `sendEmailReply`.
Chips show `names[address.toLowerCase()] ?? address` (the address in `title`). Everything else is SF-129's box,
including `panelView`, the opened Gmail state kept in client state, the size message and the double press.

## Server action `sendEmailReply` (`records/email-actions.ts`)

```ts
sendEmailReply(input: {
  mode: "reply" | "reply_all" | "forward"; messageId: number;
  record: { target: "deal" | "person" | "organisation"; id: number } | null;
  sendKey: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string;
  fileIds: number[]; uploadIds: number[]; forwardIds: number[]; back: string;
}): Promise<SendAnswer>
```

- `requireUser()` first; shapes checked as `sendEmailFromRecord` (same limits; `forwardIds` ≤ 100 ids); a bad shape →
  `compose_send_failed`.
- `compose`/`reply.ts` `sendReply(user.id, …, now)` in this order (research §8):
  1. Gmail usable (else `{ status: "gmail", state }`); send key a UUID.
  2. `normaliseRecipients` + `validateCompose` on the typed text.
  3. Answered email + conversation through `visibleConversation` (else refused `email_not_found`).
  4. Record context (optional): visible and not archived, else any `fileIds` → `compose_attachment_gone`.
  5. Record files, uploads (SF-129); forwarded ids ⊆ the answered email's `email_attachments` (else
     `compose_attachment_gone`); total ≤ 25 MB.
  6. Names, quote, In-Reply-To / References, `threadId`.
  7. `deliver`: ledger claim (`reply_message_id`, record columns null) → a second press answers `sent` without sending
     → Storage reads → forwarded bytes (`fetchAttachment`, own mailbox first; `"unavailable"` → unclaim, refused
     `reply_forward_unavailable`) → `sendGmail` (SF-129 errors unchanged) → `storeMessage` (failure logged, sync started)
     → uploads cleaned.
- `sent` → flash `email_sent` (SF-129), `revalidatePath(back path)`, `{ status: "sent", back }` with `back` through
  `isSafeNext`.
- Never shown: anything from the request or from Google; the answer is codes only.

## Conversation page additions

- `readFlash(["email_sent"])` shown as `.notice` (role status) under the heading.
- `export const maxDuration = 60`.
- `EmailOverlay` rendered last, `back` = `/emails/<id>` (+ `?from=` when shown).

## Fake mailbox page (`/dev/fake-gmail`)

Each listed message also shows `thread <threadId>` and, when present, `In-Reply-To <value>` and `References <value>`
as text.
