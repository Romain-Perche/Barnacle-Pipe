// SF-121 (pure): the unsubscribe token's shape, the page link and the two List-Unsubscribe headers (RFC 2369 /
// RFC 8058) built from the app's base address, and the one-click body check.

export type UnsubscribeVia = "link" | "mail_app";
export type UnsubscribeLinks = { pageUrl: string; listUnsubscribe: string; listUnsubscribePost: "List-Unsubscribe=One-Click" };

const TOKEN = /^[0-9a-f]{64}$/;

export function isTokenShape(s: string): boolean {
  return TOKEN.test(s);
}

export function unsubscribeLinks(baseUrl: string, token: string): UnsubscribeLinks {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    pageUrl: `${base}/unsubscribe/${token}`,
    listUnsubscribe: `<${base}/unsubscribe/${token}/one-click>`,
    listUnsubscribePost: "List-Unsubscribe=One-Click",
  };
}

// RFC 8058 §3.1: the mail app POSTs exactly "List-Unsubscribe=One-Click".
export function isOneClickBody(form: URLSearchParams | FormData): boolean {
  return form.get("List-Unsubscribe") === "One-Click";
}
