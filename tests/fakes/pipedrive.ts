// Fake of Pipedrive for the tests (SF-117 contracts/pipedrive-api.md § Test wrapper): the app's own FakePipedrive,
// installed as the Pipedrive module's fetch, with every request and answer checked against Pipedrive's pinned OpenAPI
// files (tests/fakes/pipedrive-schema.ts):
// - /api/v2/* against pipedrive_v2_openapi.json: the path and method exist, every query parameter is declared, an enum
//   value is in its enum (sort_by, sort_direction, each item of include_fields), `limit` ≤ the declared maximum, every
//   property of a 200 answer's `data[]` items (plus the fields asked for with include_fields) and of `additional_data`
//   is declared with its type, and the `x-api-token` header (the v2 `api_key` scheme) is there;
// - /v1/* against pipedrive_v1_openapi.yml: the path and method exist, every query parameter is declared (the app never
//   sends `api_token` in the address: research.md §9), every property of the 200 answer's `data` is declared, and the
//   `x-api-token` header is there.
// A request or answer the schema does not allow throws, and the test fails. Uninstalled after each test.
import { afterEach } from "vitest";
import { usePipedriveFetchForTests } from "@/server/pipedrive/api";
import { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { answerProperties, findOperation, loadPipedriveV1, loadPipedriveV2, queryParameters, type OpenApi, type Schema } from "./pipedrive-schema";

// A fixed test key (32 bytes, base64) for sealing tokens; tests never use a real Pipedrive token.
export const TEST_PIPEDRIVE_KEY = Buffer.alloc(32, 9).toString("base64");

let v1: OpenApi | null = null;
let v2: OpenApi | null = null;

function typeOk(value: unknown, s: Schema): boolean {
  // Pipedrive's files leave many nullable values undeclared: null is accepted for any property.
  if (value === null) return true;
  switch (s.type) {
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}

function checkProps(where: string, value: unknown, props: Record<string, Schema>, file: string, extra: string[] = []) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} must be an object`);
  for (const [k, v] of Object.entries(value)) {
    if (extra.includes(k)) continue;
    const p = props[k];
    if (!p) throw new Error(`${where} has no property "${k}" in ${file}`);
    if (!typeOk(v, p)) throw new Error(`${where}.${k} must be ${p.type}`);
  }
}

async function check(req: Request, fake: FakePipedrive): Promise<Response> {
  const url = new URL(req.url);
  const isV2 = url.pathname.startsWith("/api/v2/");
  const isV1 = url.pathname.startsWith("/v1/");
  if (!isV1 && !isV2) throw new Error(`not a Pipedrive address: ${url.pathname}`);
  const api = isV2 ? (v2 ??= loadPipedriveV2()) : (v1 ??= loadPipedriveV1());
  const file = isV2 ? "pipedrive_v2_openapi.json" : "pipedrive_v1_openapi.yml";
  const route = url.pathname.slice(isV2 ? "/api/v2".length : "/v1".length);
  if (!req.headers.get("x-api-token")) throw new Error(`${req.method} ${url.pathname}: no x-api-token header`);
  if (url.searchParams.has("api_token")) throw new Error(`${req.method} ${url.pathname}: the token must never be in the address`);
  const op = findOperation(api, req.method, route);
  const params = queryParameters(api, op);
  let included: string[] = [];
  for (const [name, value] of url.searchParams) {
    const p = params.get(name);
    if (!p) throw new Error(`${req.method} ${url.pathname}: query parameter "${name}" is not in ${file}`);
    const values = p.type === "array" ? value.split(",") : [value];
    const allowed = p.type === "array" ? p.items?.enum : p.enum;
    for (const v of values) if (allowed && !allowed.includes(v)) throw new Error(`${req.method} ${url.pathname}: ${name}=${v} is not in its enum`);
    if (p.maximum !== undefined && Number(value) > p.maximum) throw new Error(`${req.method} ${url.pathname}: ${name}=${value} is over ${p.maximum}`);
    if (name === "include_fields") included = values;
  }
  const res = await fake.fetch(req);
  if (res.status !== 200) return res;
  const body = (await res.clone().json()) as { data?: unknown; additional_data?: unknown };
  const shape = answerProperties(api, op);
  const where = `${req.method} ${url.pathname} answer`;
  if (shape.dataIsArray) {
    if (!Array.isArray(body.data)) throw new Error(`${where}: data must be an array`);
    body.data.forEach((item, i) => checkProps(`${where} data[${i}]`, item, shape.data, file, included));
  } else {
    checkProps(`${where} data`, body.data, shape.data, file);
  }
  if (body.additional_data !== undefined) checkProps(`${where} additional_data`, body.additional_data, shape.additional, file);
  return res;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
let installed: Fetch | null = null;

// A fresh FakePipedrive (or the one given), installed for the current test (and uninstalled after it).
export function installFakePipedrive(fake: FakePipedrive = new FakePipedrive()): FakePipedrive {
  if (!process.env.PIPEDRIVE_TOKEN_KEY) process.env.PIPEDRIVE_TOKEN_KEY = TEST_PIPEDRIVE_KEY;
  installed = async (input, init) => check(new Request(input, init), fake);
  usePipedriveFetchForTests(installed);
  return fake;
}

// A request of the test's own making through the installed, checking fetch (to show what the schema refuses).
export function checkedFetch(pathAndQuery: string, headers: Record<string, string> = {}): Promise<Response> {
  if (!installed) throw new Error("installFakePipedrive() first");
  return installed(`https://fake.pipedrive.invalid${pathAndQuery}`, { method: "GET", headers });
}

afterEach(() => {
  if (installed) usePipedriveFetchForTests(null);
  installed = null;
});
