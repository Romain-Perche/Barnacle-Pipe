// Step 1 CHOOSE (SF-117 US2 scenario 1, FR-004, FR-005): People and Organisations only (both unticked); the consent
// radios show only when People is ticked (CSS :has(), no JavaScript), with nothing chosen; the server checks again.
import { messages } from "@/server/messages";
import { startPipedriveImportAction } from "./actions";

export function ChooseStep({ error }: { error: string | null }) {
  return (
    <form action={startPipedriveImportAction} className="pd-choose">
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <fieldset className="pd-what">
        <legend className="label sect">
          <span className="c">//</span> WHAT TO IMPORT
        </legend>
        <div className="radios">
          <label className="check">
            <input type="checkbox" name="people" /> People
          </label>
          <label className="check">
            <input type="checkbox" name="organisations" /> Organisations
          </label>
        </div>
      </fieldset>
      <fieldset className="consent pd-consent">
        <legend className="label sect">
          <span className="c">//</span> CONSENT
        </legend>
        <p className="hint">{messages.pipedrive_consent_required}</p>
        <div className="radios">
          <label className="check">
            <input type="radio" name="consent" value="subscribed" /> Subscribed
          </label>
          <label className="check">
            <input type="radio" name="consent" value="unsubscribed" /> Unsubscribed
          </label>
        </div>
      </fieldset>
      <p className="hint">{messages.pipedrive_existing_note}</p>
      <div className="import-acts">
        <button className="btn solid" type="submit">
          [ IMPORT ]
        </button>
      </div>
    </form>
  );
}
