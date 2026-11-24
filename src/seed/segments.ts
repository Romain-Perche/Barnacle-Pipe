// Fake segments (SF-120 data-model.md § Fake data, FR-015): one of each kind of choice, with clearly fake names.
// Idempotent: a segment is added only when no segment has its name (ignoring case). Ids are looked up by name from the
// other seeders' pipelines, stages, lead sources, users and custom fields; a segment whose parts are missing is skipped
// quietly. Created and last changed by the first fake user.
import type { Sql } from "@/server/db";
import type { Condition, Definition } from "@/server/segments/rules";

type Lookup = {
  pipeline: (name: string) => Promise<number | null>;
  stage: (pipeline: string, name: string) => Promise<number | null>;
  leadSource: (name: string) => Promise<number | null>;
  user: (email: string) => Promise<number | null>;
  choice: (field: string, choice: string) => Promise<{ fieldId: number; id: number } | null>;
};

type SegmentSeed = { name: string; build: (l: Lookup) => Promise<Definition | null> };

const all = <T,>(xs: (T | null)[]): T[] | null => (xs.some((x) => x === null) ? null : (xs as T[]));

const SEGMENTS: SegmentSeed[] = [
  { name: "Fake — everyone", build: async () => ({ who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [] }) },
  {
    name: "Fake — Exec Dinner, all deals",
    build: async (l) => {
      const p = await l.pipeline("Exec Dinner");
      return p === null ? null : { who: "pipeline", pipelineId: p, stageId: null, dealStatus: "all", conditions: [] };
    },
  },
  {
    name: "Fake — Sales Proposal, open deals",
    build: async (l) => {
      const [p, s] = [await l.pipeline("Sales"), await l.stage("Sales", "Proposal")];
      const sources = all([await l.leadSource("Inbound"), await l.leadSource("Event")]);
      if (p === null || s === null || !sources) return null;
      return { who: "stage", pipelineId: p, stageId: s, dealStatus: "open", conditions: [{ field: "lead_source", ids: sources }] };
    },
  },
  {
    name: "Fake — Inbound owned by Ada Fake",
    build: async (l) => {
      const [source, ada, vegan] = [await l.leadSource("Inbound"), await l.user("ada@barnacle.ai"), await l.choice("Diet (fake)", "Vegan")];
      if (source === null || ada === null) return null;
      const conditions: Condition[] = [{ field: "lead_source", ids: [source] }, { field: "owner", ids: [ada] }];
      if (vegan) conditions.push({ field: "custom", fieldId: vegan.fieldId, type: "single_choice", ids: [vegan.id], empty: false });
      return { who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions };
    },
  },
];

export async function seedSegments(sql: Sql): Promise<string[]> {
  const one = async (q: Promise<{ id: number }[]>) => (await q)[0]?.id ?? null;
  const lookup: Lookup = {
    pipeline: (name) => one(sql<{ id: number }[]>`select id::int as id from pipelines where name = ${name} order by id limit 1`),
    stage: (pipeline, name) => one(sql<{ id: number }[]>`
      select s.id::int as id from stages s join pipelines p on p.id = s.pipeline_id where p.name = ${pipeline} and s.name = ${name} order by s.id limit 1`),
    leadSource: (name) => one(sql<{ id: number }[]>`select id::int as id from lead_sources where name = ${name} limit 1`),
    user: (email) => one(sql<{ id: number }[]>`select id::int as id from users where email = ${email}`),
    choice: async (field, choice) => {
      const [r] = await sql<{ fieldId: number; id: number }[]>`
        select f.id::int as "fieldId", c.id::int as id from custom_fields f join custom_field_choices c on c.field_id = f.id
        where f.kind = 'person' and f.type = 'single_choice' and f.name = ${field} and c.name = ${choice} limit 1`;
      return r ?? null;
    },
  };
  const author = await one(sql<{ id: number }[]>`select id::int as id from users where email like '%@barnacle.ai' order by id limit 1`);
  if (author === null) return [];
  const lines: string[] = [];
  for (const s of SEGMENTS) {
    const def = await s.build(lookup);
    if (!def) continue;
    const added = await sql`
      insert into segments (name, who, pipeline_id, stage_id, deal_status, conditions, created_by, updated_by)
      values (${s.name}, ${def.who}, ${def.pipelineId}, ${def.stageId}, ${def.dealStatus}, ${sql.json(def.conditions as never)}, ${author}, ${author})
      on conflict ((lower(name))) do nothing returning id`;
    lines.push(added.length > 0 ? `added segment ${s.name}` : `already there segment ${s.name}`);
  }
  return lines;
}
