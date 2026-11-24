# Research: Campaigns: writing the content (SF-119)

Every open point of the spec, decided. Nothing is left as NEEDS CLARIFICATION. Choices a person may want to change are
also in spec.md § Clarifications, marked "decided by the factory, to confirm".

## §1 Dependencies: none added

- **Decision**: no new package. Pasted HTML is made safe by where it is shown (a sandboxed frame, §5), not by cleaning
  it, so no HTML sanitiser (DOMPurify, sanitize-html) and no DOM library on the server. Merge tags, layouts to HTML,
  escaping and links are a few small pure functions.
- **Rationale**: FR-012 wants the HTML kept exactly as pasted; a sanitiser would change it and still be a second line of
  defence at best. The browser's sandbox is the defence the spec's tests (FR-017) describe: scripts don't run, forms
  don't send, the app page can't be reached.
- **Alternatives**: DOMPurify on the client before showing → rejected (changes the email the user will send, and needs
  jsdom to test on the server); a mail-template engine (MJML, Handlebars) → rejected (the merge grammar is one regex,
  the layouts are five block types).

## §2 Where campaigns live

- **Decision**: a new domain folder `src/server/campaigns/` like `activities/`: `merge.ts` (pure: tag grammar, fields,
  links, rename rewrite, fill), `content.ts` (pure: blocks, layouts, validation, blocks → HTML, the preview frame
  document), `rules.ts` (pure: draft fields, limits, "Still empty"), `campaigns.ts` (database: list, open, create,
  save, duplicate, delete), `preview.ts` (database: picker search and one person's merge values). Pages under
  `src/app/(app)/campaigns/`. The pure files import nothing from the server side, so the client editor imports them to
  render the live preview.
- **Rationale**: same split as the other features (pure rules unit-tested, database code integration-tested). A draft
  is not a CRM record (spec § Assumptions), so it is not under `records/`.

## §3 Merge tag grammar

- **Decision**: a tag is `{{` + any characters except `{` and `}` + `}}` — regex `/\{\{([^{}]*)\}\}/g`. Inside, the text
  before the first `|` is the field name, the text after it the "If empty, show" text; both are trimmed; an empty
  fallback is "no fallback". A field name matches a merge field when `trim().toLowerCase()` are equal. `{{}}` and
  `{{ |x}}` are tags with an empty name: unknown. `{{First name` has no `}}`: plain text.
  The parser returns segments `{ text } | { tag: { raw, name, fallback, nameStart, nameEnd } }` so a rename can replace
  only the name characters (§4) and everything else stays byte for byte.
- **Built-in merge fields** (FR-008, in this order, with a stable key): First name `first_name`, Last name `last_name`,
  Full name `full_name`, Email `email`, Phone `phone`, Organisation `organisation`, Role `role`, Lead source
  `lead_source`, LinkedIn `linkedin`, Owner `owner`, Labels `labels`; then every people custom field `cf:<id>` by its
  current name in the admin's order. A custom field can never take one of these names (`BUILT_IN_NAMES.person` already
  holds them), so a name matches at most one field.
- **"If empty, show" limit**: 100 characters, checked on save only for tags that match a merge field (a long `{{…}}`
  from another tool's HTML is an unknown tag and is not refused). Message `campaign_fallback_too_long`.
  → spec.md § Clarifications (factory).

## §4 Custom field tags follow renames (FR-009a)

- **Decision**: the texts are stored as typed (with the field names of the last save), plus a column `merge_links`:
  `[{ "field": <custom field id>, "name": "<the field's name at the last save>" }]`, one entry per custom field the
  draft's tags use. No foreign key (the field may be deleted; the entry must survive to say "unknown").
  - **Opening** (`openCampaign`, the Campaigns list's Subject too): for each link, the *shown name* is the field's
    current name, or the saved `name` when the field is gone. Every tag in the subject, preview text, block texts and
    the HTML whose name matches a link's saved `name` gets its name characters replaced by the shown name
    (`rewriteNames`); nothing else changes. The editor receives the links as `{ name: shownName, field, live }`.
  - **Resolving a tag** (client preview and server save, the same pure `resolveTag`): 1) a link whose shown name
    matches → that custom field when live, *unknown* when dead; 2) a built-in field by name; 3) a current people custom
    field by name; 4) unknown.
  - **Saving**: inside the transaction the row is locked, the stored links and the current fields are read, the
    submitted texts are resolved with the same rule, and `merge_links` becomes the list of the custom fields (live or
    dead) the submitted tags resolved to, each with its shown name. A dead link stays until no tag uses its name
    ("until the user changes it", US2 scenario 5).
- **Rationale**: keeps pasted HTML exactly as pasted except the renamed names (FR-012); one id per name is enough
  because a draft's tag name maps to exactly one field. Rewriting on open (not when the admin renames) means
  `fields.ts` of SF-115 is untouched and no admin action has to scan campaigns.
- **Alternatives**: store ids inside the text (`{{cf:12|…}}`) → rejected: the HTML box would no longer show what was
  pasted, and every read would need a reverse rewrite; rewrite all campaigns on rename → rejected: touches SF-115 code
  and still needs the dead-field rule.

## §5 Showing pasted HTML safely (FR-017, SC-004)

- **Decision**: the email content (layout or HTML) is shown only inside
  `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} referrerPolicy="no-referrer" title="Email preview">`.
  - No `allow-scripts`: no script, `on…` handler or `javascript:` link runs (no alert, no title change).
  - No `allow-same-origin`: the frame has an opaque origin, so it cannot read the app's cookies, storage or page.
  - No `allow-forms`: a form button sends nothing. No `allow-top-navigation`: the app tab cannot be moved.
  - `allow-popups` + `allow-popups-to-escape-sandbox`: links open a normal new tab.
  - `doc` is built by the pure `frameDocument(contentHtml)`:
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank">` +
    content + the unsubscribe line (§9). The CSP is a second lock (no script, frame, form action or fetch even if a
    sandbox flag were ever added) and still lets images, inline and remote styles and fonts show (spec edge case).
    The first `<base target>` wins, so pasted `<base>` tags cannot change it.
  - Before the doc is set, the client runs `openLinksInNewTab(html)` (in `CampaignPreview.tsx`, browser only):
    `new DOMParser().parseFromString(html, "text/html")` (parsing runs no script), set `target="_blank"` and
    `rel="noopener noreferrer"` on every `a[href]` and `area[href]` (overriding `_self`, `_top`, `_parent` and named
    targets), serialise with `documentElement.outerHTML`. So "a link opens in a new tab" holds even for links with their
    own target.
  - The app itself has no Content-Security-Policy (`next.config.ts` and `src/proxy.ts` set none), so the `srcdoc`
    document inherits nothing that would block the images.
- **Everywhere else** pasted HTML appears it is text: the HTML box is a `<textarea>` value; names, subject, preview text,
  fallbacks and person values are React text nodes or HTML-escaped (§6). `dangerouslySetInnerHTML` is never used.
- **Remote images and styles** load from their own addresses in the user's browser, with no referrer → spec.md
  § Clarifications (factory).
- **Alternatives**: a separate origin serving the preview → rejected (a second host to run for no gain over an opaque
  origin); Shadow DOM → rejected (does not stop scripts or forms).

## §6 Filling merge tags (FR-014, FR-016, US5)

- **Decision**: pure `fillText(text, ctx)` for plain texts (subject, preview text: returns a string shown as a React
  text node) and `fillHtml(html, ctx)` for HTML (pasted HTML and block HTML: each tag replaced by the HTML-escaped
  value, so person values with markup show as text, also inside attributes). `ctx` = `{ resolve, values | null }`:
  - no person chosen (`values` null): a known tag shows `[<field name>]` (the field's current name);
  - a person: the value when not empty, else the fallback, else nothing;
  - an unknown tag shows as typed (it is listed under "Unknown merge tags").
  In the preview frame a fallback text is wrapped in `<span style="background:#FFF1E6">` (the orange tint of design A).
- **Person values** come from the server, never computed from data the page already holds: server action
  `previewPerson(personId)` → `previewValues(viewerId, personId)`: `getPerson` (visibility rule inside) and not
  archived, else `null`. The map: `first_name`, `last_name`, `full_name` (`name`), `email` (first by position),
  `phone` (first), `organisation` (name), `role`, `lead_source` (name), `linkedin`, `owner` (name), `labels`
  (names joined `", "`, person-page order), `cf:<id>` → `formatValue` when the value exists (Yes/No false is "No"),
  else `null`. Empty strings become `null`.
- **Live preview**: the client keeps the values and re-fills on every change (no server trip), so typing shows within
  the 2 s of US5 scenario 2. The frame's `srcDoc` is updated at most every 300 ms (debounced) to stay smooth with
  500,000 characters (SC-002).
- **A person who becomes hidden or archived**: `previewPerson` is called when the person is chosen and again after every
  save (the save action returns the values for the posted `previewPersonId`); a reload starts with no person
  (US5 scenario 7). When it returns `null` the values are dropped and the preview shows "Choose a person to preview."
  (`campaign_preview_choose`). Archived people are treated like hidden ones (FR-015 excludes them from the picker).

## §7 The person picker (US5 scenario 3)

- **Decision**: server action `findPreviewPeople(query)` → `searchPreviewPeople(viewerId, query)`: trimmed query of
  1–100 characters, `visiblePerson`, `archived_at is null`, name (`first_name || ' ' || last_name`) or any
  `person_emails.email` `ilike '%' || escapeLike(q) || '%'`, ordered by name then id, `limit 20`; returns
  `{ id, name, detail }` (detail = organisation name · first email, as `ReferrerPicker` shows). The client
  `PreviewPersonPicker.tsx` calls it 250 ms after typing stops.
- **Rationale**: the existing pickers embed every visible person in the page; a campaign may be previewed against any
  of thousands, so it searches instead. The rule (visible, not archived, ≤ 20) is in one SQL query, integration-tested.

## §8 Layout blocks and their HTML

- **Decision**: content is `null` (none yet), `{ kind: "blocks", blocks }` or `{ kind: "html", html }`.
  Blocks (JSON, at most 50): `{ type: "heading", text }` (≤ 200, line breaks turned into spaces),
  `{ type: "text", text }` (≤ 10,000), `{ type: "button", label, url }` (label ≤ 60), `{ type: "image", src, alt, url }`
  (alt ≤ 200), `{ type: "divider" }`. Addresses ≤ 2,000 characters; may be empty in a draft; when filled, `url` must parse
  with `new URL()` and use `https:`, `http:` or `mailto:`, `src` only `https:`. Messages `campaign_button_url`,
  `campaign_image_url` ("<Block>: enter a web address starting with https://."), with the block's number for the
  field highlight.
- **Layouts** (`LAYOUTS` in `content.ts`): Blank `[text]`, Text `[heading, text]`, Text with a button
  `[heading, text, button]`, Newsletter `[image, heading, text, button, divider, text]`, all fields empty.
- **`blocksToHtml(blocks, fill)`**: simple email HTML with inline styles (a 600 px centred column, plain system font
  stack (Arial, Helvetica, sans-serif), `<h1>`, `<p>` with `<br>` for line breaks, a button as a styled `<a>`, `<img>` optionally in `<a>`,
  `<hr>`). Typed text is HTML-escaped first, then web addresses (`https?://` up to a space or `<`) in typed text become
  `<a href>` (text blocks only); tags are filled by `fill`. `blocksToHtml(blocks, keepTags)` gives the HTML the
  "Paste HTML" box starts with (tags left as `{{…}}`, FR-013).
- **Empty content** ("Still empty: Content"): `null`, no blocks, or HTML that is only spaces. A save normalises these to
  `null` (so the layout choice shows again).

## §9 The unsubscribe line

- **Decision**: `frameDocument` appends, under the content, `<p style="…">Don't want these emails? <a>Unsubscribe</a></p>`
  (an `<a>` with no `href`: does nothing). Text from `messages.campaign_unsubscribe_line` / `campaign_unsubscribe`. The
  real link comes with sending (spec § Assumptions).

## §10 Saving, conflicts, deletes

- **Decision**: `version int` on the row (as `persons`, `deals`). The editor posts `id` and the `version` it opened (or
  last saved). `saveCampaign` locks the row `for update`; gone → `campaign_gone` ("This campaign no longer exists.");
  version differs → template `campaign_edit_conflict(<last editor's name>)`; else validate, write, `version + 1`,
  `updated_by`, `updated_at = now()`, and return the new version, the last-edited line and the shown links. On refusal
  nothing is written and the client keeps its state (FR-004).
- Validation order follows the form (name, sender name, reply-to, subject, preview text, fallbacks, content) and
  returns every field error, like the person form.
- **Duplicate** copies the stored row (not unsaved changes in the open page: the `[ DUPLICATE ]` button posts only the
  id) → spec.md § Clarifications (factory). Name `Copy of <name>` cut to 100 code points.
- **Delete**: `?delete=1` on the edit page and `?delete=<id>` on the Campaigns page open the confirmation box (server
  rendered, as `DeleteConfirm`); the action deletes and sets the flash `campaign_deleted` with the name from the
  database, then redirects to `/campaigns`. Deleting a gone draft → flash `campaign_gone`.
- **Length counts**: every limit counts Unicode code points (`Array.from(s).length`), the same as Postgres
  `char_length`, so the app and the database checks agree.

## §11 Request size

- **Decision**: `next.config.ts` sets `experimental.serverActions.bodySizeLimit: "4mb"` (Next default 1 MB).
  500,000 characters of HTML can be up to 2 MB as UTF-8, and 50 blocks of 10,000 characters a little more as JSON; only
  the active content kind is posted. 4 MB stays under Vercel's 4.5 MB request limit.
- **Alternatives**: send the HTML in parts like the CSV import → rejected: a draft save is one transaction with a
  version check; parts would need a staging table for no benefit at this size.

## §12 Messages and the sidebar

- "Campaigns" goes in `mainNav` after "Activities" (FR-020). Every text in `messages.ts` / `templates`
  (contracts/routes.md § Messages). No query parameter text is ever shown: `delete` is read as `1` or an id, `new` as
  `1`.

## §13 Fake data

- `src/seed/campaigns.ts`, registered last (after `custom-fields`, whose "Diet (fake)" field it uses). Inserts each
  draft only when no campaign has its name (re-runnable). Drafts: "Exec dinner – March (fake)" (Text with a button,
  `{{First name | there}}`, `{{Organisation | your team}}`), "Welcome note (fake)" (Blank), "Event recap (fake)" (Text,
  `{{Diet (fake) | not given}}` with its `merge_links` entry), "Newsletter – winter (fake)" (Newsletter, image
  `https://example.test/…`), "Pasted HTML sample (fake)" (HTML with `<script>document.title='Changed (fake)'</script>`, an
  `onerror` image, a form and a link to `https://example.test/`). Created by the fake users of `seedUsers`.
