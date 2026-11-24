// Settings (SF-117 FR-001, design B): "// YOU", "Settings", then "// PIPEDRIVE" (the user's own token and connection,
// an open import's line), then (SF-118) the Gmail card. requireUser() first; notices come from fixed codes only, never
// text from the address: SF-117's parameters touch only Pipedrive, the Gmail card reads only `gmail` and `disconnect`.
import { requireUser } from "@/server/auth/session";
import { gmailSettings } from "@/server/gmail/connections";
import { messages, templates } from "@/server/messages";
import { getConnection } from "@/server/pipedrive/connection";
import { getImportView } from "@/server/pipedrive/imports";
import { readFlash } from "@/server/records/flash";
import { GmailCard } from "./GmailCard";
import { PipedriveSection } from "./PipedriveSection";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const ERRORS = ["pipedrive_not_set_up", "pipedrive_token_required", "pipedrive_token_refused", "pipedrive_unreachable"] as const;
// SF-118: ?gmail=<code> → a fixed message (wrong_account is built from the user's own sign-in address).
const GMAIL_ERRORS = {
  not_connected: messages.gmail_cancelled,
  missing_scopes: messages.gmail_missing_scopes,
  unavailable: messages.gmail_unavailable,
  test_failed: messages.gmail_test_failed,
} as const;

export default async function SettingsPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const query = await searchParams;
  const state = await getConnection(user.id);
  const open = state.ready ? await getImportView(user.id) : null;
  const code = one(query.error);
  const error = (ERRORS as readonly string[]).includes(code) ? messages[code as (typeof ERRORS)[number]] : null;
  const notice = one(query.saved) === "1" ? messages.pipedrive_saved : one(query.removed) === "1" ? messages.pipedrive_removed : null;
  const gmail = await gmailSettings(user.id);
  const gmailCode = one(query.gmail);
  const gmailError =
    gmailCode === "wrong_account" ? templates.gmail_wrong_account(user.email) : Object.hasOwn(GMAIL_ERRORS, gmailCode) ? GMAIL_ERRORS[gmailCode as keyof typeof GMAIL_ERRORS] : null;
  const gmailNotice = (await readFlash(["gmail_connected", "gmail_reconnected", "gmail_disconnected", "gmail_test_sent"]))?.text ?? null;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> YOU
          </div>
          <h1>Settings</h1>
        </div>
      </div>
      <PipedriveSection
        state={state}
        openImport={open && (open.state === "running" || open.state === "waiting" || open.state === "paused") ? open : null}
        replace={one(query.replace) === "1"}
        confirmRemove={one(query["remove-token"]) === "1"}
        error={error}
        notice={notice}
      />
      <GmailCard gmail={gmail} notice={gmailNotice} error={gmailError} confirmDisconnect={one(query.disconnect) === "1"} />
    </>
  );
}
