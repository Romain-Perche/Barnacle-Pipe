// The delete confirmation of a custom field (SF-115 US4, ?delete=<id>) in a box over the page: how many records of the
// kind have a value (private and archived ones included, a number only), [ DELETE FIELD ] and [ CANCEL ].
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import type { RecordKind } from "@/server/custom-fields/rules";
import { deleteCustomField } from "./actions";

export function FieldDeleteConfirm({ id, name, kind, tab, count, back }: { id: number; name: string; kind: RecordKind; tab: string; count: number; back: string }) {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="field-delete-q">
        <p id="field-delete-q">{count > 0 ? templates.custom_delete_count(count, kind, name) : templates.custom_delete_none(name)}</p>
        <div className="form-acts">
          <form action={deleteCustomField}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value={tab} />
            <button className="btn danger-solid" type="submit">
              [ DELETE FIELD ]
            </button>
          </form>
          <Link className="btn" href={back} scroll={false}>
            {messages.delete_cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
