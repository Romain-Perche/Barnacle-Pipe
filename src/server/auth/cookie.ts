// Cookie names and options, shared by proxy.ts (which cannot import the database code) and the server.
export const SESSION_COOKIE = "crm_session";
export const OAUTH_COOKIE = "crm_oauth";
export const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure, maxAge: SESSION_MAX_AGE };
}
