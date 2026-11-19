// Fake of Google Sign-In for unit tests: an in-process `fetch` for
//   POST https://oauth2.googleapis.com/token            (OAuth 2.0 token endpoint, RFC 6749 §4.1.3 / §5, PKCE RFC 7636)
//   GET  https://www.googleapis.com/oauth2/v2/userinfo  (checked against .factory/schemas/oauth2-api.json)
// The userinfo method, path, query parameters and response properties come from the schema file:
// a request or a response that the schema does not allow fails.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const SCHEMA_PATH = path.join(process.cwd(), ".factory/schemas/oauth2-api.json");

type JsonSchemaProp = { type: string };
type Discovery = {
  rootUrl: string;
  servicePath: string;
  parameters: Record<string, { location: string }>;
  schemas: { Userinfo: { properties: Record<string, JsonSchemaProp> } };
  resources: { userinfo: { methods: { get: { httpMethod: string; path: string } } } };
};

// Throws when the schema is missing: the tests fail, never skip.
export function loadSchema(): Discovery {
  if (!existsSync(SCHEMA_PATH)) throw new Error(`${SCHEMA_PATH} is missing: run "npm run test:schemas" to download it.`);
  const text = readFileSync(SCHEMA_PATH, "utf8");
  if (text.trim() === "") throw new Error(`${SCHEMA_PATH} is empty`);
  return JSON.parse(text) as Discovery;
}

const schema = loadSchema();
const userinfoMethod = schema.resources.userinfo.methods.get;
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = `${schema.rootUrl}${schema.servicePath.replace(/^\//, "")}${userinfoMethod.path}`;

export type Userinfo = Partial<Record<string, string | boolean>>;

// Builds a userinfo body; throws on any property that the schema's Userinfo object does not have,
// or on a value of the wrong type.
export function userinfoBody(info: Userinfo): Userinfo {
  const props = schema.schemas.Userinfo.properties;
  for (const [key, value] of Object.entries(info)) {
    const prop = props[key];
    if (!prop) throw new Error(`Userinfo has no property "${key}" in oauth2-api.json`);
    if (typeof value !== prop.type) throw new Error(`Userinfo.${key} must be ${prop.type}, got ${typeof value}`);
  }
  return info;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Grant = { verifier: string; redirectUri: string; clientId: string; userinfo: Userinfo };

export class GoogleFake {
  private grants = new Map<string, Grant>();
  private tokens = new Map<string, Userinfo>();
  readonly requests: { method: string; url: string }[] = [];
  constructor(private clientSecret = "fake-secret") {}

  // Registers the authorization code Google would give for this user after consent.
  issueCode(code: string, grant: { verifier: string; redirectUri: string; clientId: string; userinfo: Userinfo }) {
    this.grants.set(code, { ...grant, userinfo: userinfoBody(grant.userinfo) });
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    this.requests.push({ method: req.method, url: req.url });
    const url = new URL(req.url);
    const base = `${url.origin}${url.pathname}`;
    if (base === TOKEN_URL) return this.token(req);
    if (url.origin === new URL(USERINFO_URL).origin) return this.userinfo(req, url);
    return json(404, { error: "not_found" });
  };

  private async token(req: Request) {
    if (req.method !== "POST") return json(405, { error: "invalid_request" });
    if (!(req.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      return json(400, { error: "invalid_request", error_description: "form body required" });
    }
    const form = new URLSearchParams(await req.text());
    for (const name of ["grant_type", "code", "redirect_uri", "client_id", "client_secret", "code_verifier"]) {
      if (!form.get(name)) return json(400, { error: "invalid_request", error_description: `missing ${name}` });
    }
    if (form.get("grant_type") !== "authorization_code") return json(400, { error: "unsupported_grant_type" });
    if (form.get("client_secret") !== this.clientSecret) return json(401, { error: "invalid_client" });
    const grant = this.grants.get(form.get("code")!);
    if (!grant || grant.clientId !== form.get("client_id") || grant.redirectUri !== form.get("redirect_uri")) {
      return json(400, { error: "invalid_grant" });
    }
    // PKCE S256: the stored challenge is derived from the verifier the app sent to /auth.
    if (grant.verifier !== form.get("code_verifier")) return json(400, { error: "invalid_grant" });
    this.grants.delete(form.get("code")!); // codes are single-use
    const accessToken = `ya29.fake-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(accessToken, grant.userinfo);
    return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 3599, scope: "openid email profile" });
  }

  private userinfo(req: Request, url: URL) {
    if (url.toString().split("?")[0] !== USERINFO_URL) return json(404, { error: { code: 404, message: "Not Found" } });
    if (req.method !== userinfoMethod.httpMethod) return json(405, { error: { code: 405 } });
    for (const key of url.searchParams.keys()) {
      if (!schema.parameters[key] || schema.parameters[key].location !== "query") {
        return json(400, { error: { code: 400, message: `Unknown parameter "${key}"` } });
      }
    }
    const auth = req.headers.get("authorization") ?? "";
    const info = auth.startsWith("Bearer ") ? this.tokens.get(auth.slice(7)) : undefined;
    if (!info) return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    return json(200, info);
  }
}

export function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
