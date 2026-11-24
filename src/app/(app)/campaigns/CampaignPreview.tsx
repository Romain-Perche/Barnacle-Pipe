"use client";
// The email as the chosen person would get it (SF-119 research.md §5, design A): From, Reply-to, subject and preview text
// as React text nodes, then the content inside a sandboxed frame. The frame has no scripts, no same origin, no forms and
// no top navigation, so pasted HTML cannot run, send a form, reach the app's page or cookies, or move the app's tab; its
// links open a new tab (allow-popups). The document carries its own CSP and <base target="_blank"> (frameDocument).
import { useEffect, useState } from "react";
import { frameDocument } from "@/server/campaigns/content";
import { messages, templates } from "@/server/messages";

type Props = { senderName: string; replyTo: string; subject: string; previewText: string; contentHtml: string; unknown: string[] };

// Every link opens a new tab, whatever target the HTML gives it (spec Clarifications). DOMParser runs no script.
export function openLinksInNewTab(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of doc.querySelectorAll("a[href], area[href]")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  return doc.documentElement.outerHTML;
}

const docFor = (html: string) => frameDocument(openLinksInNewTab(html));

export function CampaignPreview({ senderName, replyTo, subject, previewText, contentHtml, unknown }: Props) {
  const [doc, setDoc] = useState(() => docFor(contentHtml));
  // At most one frame update every 300 ms while typing (SC-002: 500,000 characters stay smooth).
  useEffect(() => {
    const t = setTimeout(() => setDoc(docFor(contentHtml)), 300);
    return () => clearTimeout(t);
  }, [contentHtml]);

  return (
    <div className="mail">
      <div className="mail-head">
        <p className="mail-from">
          {templates.campaign_from(senderName)}
          {replyTo && <> · {templates.campaign_reply_to(replyTo)}</>}
        </p>
        <p className="mail-subject">{subject}</p>
        {previewText && <p className="mail-pre">{previewText}</p>}
      </div>
      <iframe
        className="mail-frame"
        title="Email preview"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={doc}
      />
      {unknown.length > 0 && (
        <p className="ferr" role="status">
          {messages.campaign_unknown_tags}
          {unknown.join(", ")}
        </p>
      )}
    </div>
  );
}
