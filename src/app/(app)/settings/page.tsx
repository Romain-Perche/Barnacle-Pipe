// Settings (SF-117 FR-001, design B): "// YOU", "Settings", then "// PIPEDRIVE" (the user's own token and connection,
// an open import's line). requireUser() first; notices come from fixed codes only, never text from the address.
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";
import { getConnection } from "@/server/pipedrive/connection";
import { getImportView } from "@/server/pipedrive/imports";
import { PipedriveSection } from "./PipedriveSection";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const ERRORS = ["pipedrive_not_set_up", "pipedrive_token_required", "pipedrive_token_refused", "pipedrive_unreachable"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const query = await searchParams;
  const state = await getConnection(user.id);
  const open = state.ready ? await getImportView(user.id) : null;
  const code = one(query.error);
  const error = (ERRORS as readonly string[]).includes(code) ? messages[code as (typeof ERRORS)[number]] : null;
  const notice = one(query.saved) === "1" ? messages.pipedrive_saved : one(query.removed) === "1" ? messages.pipedrive_removed : null;
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
    </>
  );
}
