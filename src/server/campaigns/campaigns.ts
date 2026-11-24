// Campaign drafts (SF-119 research.md §4, §10, data-model.md): list, open, create, save, duplicate, delete. Drafts are
// shared by the whole team, so any signed-in user may change any draft (the caller checks the user first). Every change
// runs in one sql.begin() transaction; no session state (Supabase's transaction-mode pooler).
import { sql, type Sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import { contentTexts, mapContentTexts, validateContent, type Block, type Content } from "@/server/campaigns/content";
import { linksToStore, mergeFields, rewriteNames, shownLinks, type Link, type StoredLink } from "@/server/campaigns/merge";
import { copyName, validateDraft, type DraftForm } from "@/server/campaigns/rules";
import { formatDate, formatDateTime, formatTime } from "@/server/format";
import { messages, templates } from "@/server/messages";

type Row = {
  id: number; name: string; sender_name: string; reply_to: string; subject: string; preview_text: string;
  content_kind: "blocks" | "html" | null; blocks: Block[] | null; html: string | null; merge_links: StoredLink[];
  created_by_name: string; updated_by_name: string; updated_at: Date; version: number;
};

export type CampaignView = {
  id: number; name: string; senderName: string; replyTo: string; subject: string; previewText: string; content: Content;
  links: Link[]; version: number; lastEdited: string;
};
export type CampaignListRow = { id: number; name: string; subject: string; createdBy: string; lastEditedBy: string; lastEdited: string };
export type CampaignForm = DraftForm & { contentKind: string; blocks: string; html: string };
// `errors`: by input (name, senderName, replyTo, subject, previewText, fallback, content, block.<n>) or `form`.
export type SaveResult =
  | { ok: true; version: number; lastEdited: string; links: Link[]; message: string }
  | { ok: false; errors: Record<string, string>; gone?: true };

type Custom = { id: number; name: string }[];

const SELECT = (db: Sql) => db`
  select c.id::int as id, c.name, c.sender_name, c.reply_to, c.subject, c.preview_text, c.content_kind, c.blocks, c.html,
         c.merge_links, c.updated_at, c.version, cu.name as created_by_name, uu.name as updated_by_name
  from campaigns c join users cu on cu.id = c.created_by join users uu on uu.id = c.updated_by`;

function contentOf(row: Pick<Row, "content_kind" | "blocks" | "html">): Content {
  if (row.content_kind === "blocks" && row.blocks) return { kind: "blocks", blocks: row.blocks };
  if (row.content_kind === "html" && row.html !== null) return { kind: "html", html: row.html };
  return null;
}

const lastEditedLine = (name: string, at: Date) => templates.campaign_last_edited(name, formatDateTime(at));

// The editor's view: every tag-bearing text with linked tags renamed to their field's current name (research.md §4).
export function toView(row: Row, custom: Custom): CampaignView {
  const rename = (text: string) => rewriteNames(text, row.merge_links, custom);
  return {
    id: row.id,
    name: row.name,
    senderName: row.sender_name,
    replyTo: row.reply_to,
    subject: rename(row.subject),
    previewText: rename(row.preview_text),
    content: mapContentTexts(contentOf(row), rename),
    links: shownLinks(row.merge_links, custom),
    version: row.version,
    lastEdited: lastEditedLine(row.updated_by_name, row.updated_at),
  };
}

// Every draft, most recently edited first; "Last edited" as "Ada Fake · 24 Nov 14:05".
export async function listCampaigns(): Promise<CampaignListRow[]> {
  const custom = await listFields("person");
  const rows = await sql<Row[]>`${SELECT(sql)} order by c.updated_at desc, c.id desc`;
  return rows.map((r) => {
    const at = formatDate(r.updated_at).split(" ").slice(0, 2).join(" ");
    return {
      id: r.id,
      name: r.name,
      subject: rewriteNames(r.subject, r.merge_links, custom),
      createdBy: r.created_by_name,
      lastEditedBy: r.updated_by_name,
      lastEdited: `${r.updated_by_name} · ${at} ${formatTime(r.updated_at)}`,
    };
  });
}

export async function getCampaignById(id: number): Promise<CampaignView | null> {
  const [row] = await sql<Row[]>`${SELECT(sql)} where c.id = ${id}`;
  if (!row) return null;
  return toView(row, await listFields("person"));
}

export async function createCampaign(actorId: number, rawName: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const v = validateDraft({ name: rawName, senderName: "", replyTo: "", subject: "", previewText: "" });
  if (!v.ok) return { ok: false, error: v.errors.name ?? messages.campaign_name_required };
  const [row] = await sql<{ id: number }[]>`
    insert into campaigns (name, sender_name, created_by, updated_by)
    select ${v.value.name}, left(u.name, 100), u.id, u.id from users u where u.id = ${actorId}
    returning id::int as id`;
  return { ok: true, id: row.id };
}

// Locks the row; refuses a gone draft or one saved since `version` (naming who saved it), then checks every field and
// the content, all errors at once. `merge_links` is worked out here from the texts, never taken from the browser.
export async function saveCampaign(actorId: number, id: number, version: number, form: CampaignForm): Promise<SaveResult> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    const [row] = await tx<Row[]>`${SELECT(tx)} where c.id = ${id} for update of c`;
    if (!row) return { ok: false, gone: true, errors: { form: messages.campaign_gone } } as const;
    if (row.version !== version) return { ok: false, errors: { form: templates.campaign_edit_conflict(row.updated_by_name) } } as const;
    const custom = await listFields("person", tx);
    const fields = mergeFields(custom);
    const links = shownLinks(row.merge_links, custom);
    const content = validateContent(form.contentKind, form.blocks, form.html);
    const texts = content.ok ? contentTexts(content.content) : [];
    const draft = validateDraft({ ...form, contentTexts: texts }, fields, links);
    if (!draft.ok || !content.ok) {
      return { ok: false, errors: { ...(draft.ok ? {} : draft.errors), ...(content.ok ? {} : content.errors) } as Record<string, string> } as const;
    }
    const d = draft.value;
    const c = content.content;
    const toStore = linksToStore([d.subject, d.previewText, ...texts], links, fields);
    const [saved] = await tx<{ version: number; updated_at: Date; name: string }[]>`
      update campaigns c set name = ${d.name}, sender_name = ${d.senderName}, reply_to = ${d.replyTo}, subject = ${d.subject},
        preview_text = ${d.previewText}, content_kind = ${c?.kind ?? null},
        blocks = ${c?.kind === "blocks" ? tx.json(c.blocks as unknown as postgresJson) : null},
        html = ${c?.kind === "html" ? c.html : null}, merge_links = ${tx.json(toStore as unknown as postgresJson)},
        updated_by = ${actorId}, updated_at = now(), version = c.version + 1
      from users u where c.id = ${id} and u.id = ${actorId}
      returning c.version, c.updated_at, u.name`;
    return {
      ok: true, version: saved.version, lastEdited: lastEditedLine(saved.name, saved.updated_at), links: shownLinks(toStore, custom),
      message: messages.campaign_saved,
    } as const;
  });
}
type postgresJson = Parameters<Sql["json"]>[0];

// A new draft from the stored row (never unsaved changes), named "Copy of <name>", by the user who duplicates.
export async function duplicateCampaign(actorId: number, id: number): Promise<{ ok: true; id: number } | { ok: false; code: "campaign_gone" }> {
  return sql.begin(async (tx) => {
    const [src] = await tx<{ name: string }[]>`select name from campaigns where id = ${id} for share`;
    if (!src) return { ok: false, code: "campaign_gone" } as const;
    const [row] = await tx<{ id: number }[]>`
      insert into campaigns (name, sender_name, reply_to, subject, preview_text, content_kind, blocks, html, merge_links, created_by, updated_by)
      select ${copyName(src.name)}, sender_name, reply_to, subject, preview_text, content_kind, blocks, html, merge_links, ${actorId}, ${actorId}
      from campaigns where id = ${id}
      returning id::int as id`;
    return { ok: true, id: row.id } as const;
  });
}

export async function deleteCampaign(_actorId: number, id: number): Promise<{ ok: true; name: string } | { ok: false; code: "campaign_gone" }> {
  const [row] = await sql<{ name: string }[]>`delete from campaigns where id = ${id} returning name`;
  return row ? { ok: true, name: row.name } : { ok: false, code: "campaign_gone" };
}
