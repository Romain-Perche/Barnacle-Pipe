// The two pinned Pipedrive OpenAPI files the test fake is checked against (SF-117 T011): v2 (JSON) and v1 (YAML),
// downloaded by `npm run test:schemas` into .factory/schemas/. A missing or empty file throws (never a skip).
// Helpers: the operation of a method and path (server prefix stripped, `{id}` templates matched), its declared query
// parameters (with `enum` and `maximum`), and the declared properties of the `data` of its 200 answer (array items or
// object) and of `additional_data`, following `$ref` and `allOf`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export type Schema = {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  maximum?: number;
  nullable?: boolean;
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
};
type Parameter = { $ref?: string; name: string; in: string; schema?: Schema };
type Operation = { parameters?: Parameter[]; responses: Record<string, { content?: Record<string, { schema: Schema }> }> };
export type OpenApi = { paths: Record<string, Record<string, Operation>>; components?: Record<string, Record<string, unknown>> };

export const PIPEDRIVE_V2_PATH = path.join(process.cwd(), ".factory/schemas/pipedrive_v2_openapi.json");
export const PIPEDRIVE_V1_PATH = path.join(process.cwd(), ".factory/schemas/pipedrive_v1_openapi.yml");

function readSchemaFile(file: string): string {
  if (!existsSync(file)) throw new Error(`${file} is missing: run "npm run test:schemas" to download it.`);
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") throw new Error(`${file} is empty: run "npm run test:schemas" to download it again.`);
  return text;
}

export function loadPipedriveV2(file = PIPEDRIVE_V2_PATH): OpenApi {
  return JSON.parse(readSchemaFile(file)) as OpenApi;
}

export function loadPipedriveV1(file = PIPEDRIVE_V1_PATH): OpenApi {
  return parse(readSchemaFile(file)) as OpenApi;
}

export function resolve<T extends { $ref?: string }>(api: OpenApi, x: T | undefined): T | undefined {
  let cur: unknown = x;
  for (let i = 0; i < 20 && cur && typeof cur === "object" && "$ref" in cur && typeof (cur as { $ref: unknown }).$ref === "string"; i++) {
    const parts = (cur as { $ref: string }).$ref.replace(/^#\//, "").split("/");
    cur = parts.reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], api);
  }
  return cur as T | undefined;
}

// Every declared property of an object schema, through $ref, allOf, oneOf and anyOf.
export function propertiesOf(api: OpenApi, s: Schema | undefined): Record<string, Schema> {
  const r = resolve(api, s);
  if (!r) return {};
  const out: Record<string, Schema> = {};
  for (const part of [...(r.allOf ?? []), ...(r.oneOf ?? []), ...(r.anyOf ?? [])]) Object.assign(out, propertiesOf(api, part));
  for (const [k, v] of Object.entries(r.properties ?? {})) out[k] = resolve(api, v) ?? v;
  return out;
}

export function findOperation(api: OpenApi, method: string, route: string): Operation {
  const matches = Object.entries(api.paths)
    .filter(([p, ops]) => new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(route) && ops[method.toLowerCase()])
    .sort((a, b) => b[0].replace(/\{[^}]+\}/g, "").length - a[0].replace(/\{[^}]+\}/g, "").length);
  if (matches.length === 0) throw new Error(`Pipedrive schema has no ${method} ${route}`);
  return matches[0][1][method.toLowerCase()];
}

export function queryParameters(api: OpenApi, op: Operation): Map<string, Schema> {
  const out = new Map<string, Schema>();
  for (const raw of op.parameters ?? []) {
    const p = resolve(api, raw);
    if (p && p.in === "query") out.set(p.name, resolve(api, p.schema) ?? {});
  }
  return out;
}

// The declared properties of the 200 answer's `data` (array items or object) and of `additional_data`.
export function answerProperties(api: OpenApi, op: Operation): { data: Record<string, Schema>; dataIsArray: boolean; additional: Record<string, Schema> } {
  const schema = op.responses["200"]?.content?.["application/json"]?.schema;
  const top = propertiesOf(api, schema);
  const data = resolve(api, top.data);
  const dataIsArray = data?.type === "array";
  return {
    data: dataIsArray ? propertiesOf(api, data?.items) : propertiesOf(api, data),
    dataIsArray,
    additional: propertiesOf(api, top.additional_data),
  };
}
