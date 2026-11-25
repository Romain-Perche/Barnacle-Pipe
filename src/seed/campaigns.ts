// Fake campaign drafts (SF-119 research.md §13, FR-021): one per layout with merge tags (with and without "If empty,
// show" text, one using the people custom field "Diet (fake)"), and one pasted HTML email with a harmless script, an
// onerror image, a form and a link, to show the preview runs none of it. Re-runnable: a draft is added only when no
// campaign has its name; the "Diet (fake)" draft is skipped when the field is missing.
import type { Sql } from "@/server/db";
import type { Block } from "@/server/campaigns/content";

type Draft = {
  name: string; by: string; senderName: string; replyTo: string; subject: string; previewText: string;
  blocks?: Block[]; html?: string; dietLink?: boolean;
};

const DRAFTS: Draft[] = [
  {
    name: "Exec dinner – March (fake)", by: "ada@barnacle.ai", senderName: "Ada Fake", replyTo: "ada@barnacle.ai",
    subject: "{{First name | there}}, a seat for {{Organisation | your team}}?", previewText: "Thursday 12 March, 7pm, London (fake)",
    blocks: [
      { type: "heading", text: "Our March exec dinner (fake)" },
      { type: "text", text: "Hi {{First name | there}},\nWe are hosting ten leaders for dinner in London. Details: https://example.test/dinner" },
      { type: "button", label: "Book a seat", url: "https://example.test/dinner" },
    ],
  },
  {
    name: "Welcome note (fake)", by: "grace@barnacle.ai", senderName: "Grace Fake", replyTo: "",
    subject: "Welcome, {{First name}}", previewText: "",
    blocks: [{ type: "text", text: "Hello {{Full name}},\nThanks for meeting us. This is a fake welcome note." }],
  },
  {
    name: "Event recap (fake)", by: "linus@barnacle.ai", senderName: "Linus Fake", replyTo: "linus@barnacle.ai",
    subject: "Recap of the fake event", previewText: "Diet noted: {{Diet (fake) | not given}}",
    blocks: [
      { type: "heading", text: "Thanks for coming, {{First name | friend}}" },
      { type: "text", text: "We noted your diet as {{Diet (fake) | not given}} for next time." },
    ],
    dietLink: true,
  },
  {
    name: "Newsletter – winter (fake)", by: "margaret@barnacle.ai", senderName: "Margaret Fake", replyTo: "",
    subject: "Winter news for {{Organisation | your team}}", previewText: "",
    blocks: [
      { type: "image", src: "https://example.test/winter.png", alt: "Winter (fake)", url: "https://example.test/" },
      { type: "heading", text: "Winter newsletter (fake)" },
      { type: "text", text: "Hi {{First name | there}}, here is what we did this season." },
      { type: "button", label: "Read more", url: "https://example.test/news" },
      { type: "divider" },
      { type: "text", text: "Fake footer text." },
    ],
  },
  {
    name: "Pasted HTML sample (fake)", by: "ada@barnacle.ai", senderName: "Ada Fake", replyTo: "",
    subject: "A pasted email for {{First name | you}}", previewText: "",
    html:
      `<div style="font-family:Georgia,serif;color:#1a0099;padding:24px">\n<h1>Hello {{First name | there}} (fake)</h1>\n` +
      `<script>document.title='Changed (fake)'</script>\n<img src="x" onerror="alert('fake')" alt="broken (fake)">\n` +
      `<form action="/campaigns" method="post"><input name="q" value="fake"><button>Send (fake)</button></form>\n` +
      `<p><a href="https://example.test/">A fake link</a></p>\n</div>`,
  },
];

export async function seedCampaigns(sql: Sql): Promise<string[]> {
  let added = 0;
  let skipped = false;
  const [diet] = await sql<{ id: number; name: string }[]>`
    select id::int as id, name from custom_fields where kind = 'person' and name = 'Diet (fake)'`;
  for (const d of DRAFTS) {
    if (d.dietLink && !diet) {
      skipped = true;
      continue;
    }
    const links = d.dietLink && diet ? [{ field: diet.id, name: diet.name }] : [];
    const rows = await sql`
      insert into campaigns (name, sender_name, reply_to, subject, preview_text, content_kind, blocks, html, merge_links, created_by, updated_by)
      select ${d.name}, ${d.senderName}, ${d.replyTo}, ${d.subject}, ${d.previewText}, ${d.html ? "html" : "blocks"},
             ${d.blocks ? sql.json(d.blocks as never) : null}, ${d.html ?? null}, ${sql.json(links as never)}, u.id, u.id
      from users u
      where u.email = ${d.by} and not exists (select 1 from campaigns c where c.name = ${d.name})
      returning id`;
    added += rows.length;
  }
  const note = skipped ? " (Event recap skipped: no Diet (fake) field)" : "";
  return [added === 0 ? `already there campaigns${note}` : `added ${added} fake campaign drafts${note}`];
}
