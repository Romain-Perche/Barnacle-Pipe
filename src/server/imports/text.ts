// The text of a row not imported and of a warning, from the codes a plan or report stores (SF-103 research.md §9).
// Pure. Names of existing records are passed in: people only when the viewer can see them (namesForReport).
import { messageFor, messages, templates } from "@/server/messages";
import type { Skip, Warning } from "@/server/imports/plan";

export type Names = { people: Map<number, string>; organisations: Map<number, string> };
export type Reason = { text: string; href?: string };

const arg = (skip: Skip, key: string) => skip.args?.[key];

export function skipReason(skip: Skip, names: Names): Reason {
  switch (skip.code) {
    case "import_duplicate_email": {
      const name = skip.personId === undefined ? undefined : names.people.get(skip.personId);
      return name === undefined ? { text: messages.duplicate_email_hidden } : { text: templates.duplicate_email(name), href: `/people/${skip.personId}` };
    }
    case "organisation_exists": {
      const name = skip.organisationId === undefined ? undefined : names.organisations.get(skip.organisationId);
      return name === undefined ? { text: templates.organisation_exists("This organisation") } : { text: templates.organisation_exists(name), href: `/organisations/${skip.organisationId}` };
    }
    case "import_too_long":
      return { text: templates.import_too_long(String(arg(skip, "field")), Number(arg(skip, "max"))) };
    case "import_consent_unknown":
      return { text: templates.import_consent_unknown(String(arg(skip, "value"))) };
    case "import_duplicate_in_file":
      return { text: templates.import_duplicate_in_file(Number(arg(skip, "row"))) };
    case "import_duplicate_in_file_org":
      return { text: templates.import_duplicate_in_file_org(Number(arg(skip, "row"))) };
    default:
      return { text: messageFor(skip.code) ?? messages.import_failed };
  }
}

export function warningText(w: Warning): Reason {
  const value = w.value ?? "";
  switch (w.code) {
    case "import_lead_source_unknown":
      return { text: templates.import_lead_source_unknown(value, w.rows) };
    case "import_label_unknown":
      return { text: templates.import_label_unknown(value, w.rows) };
    case "import_owner_unknown":
      return { text: templates.import_owner_unknown(value, w.rows) };
    case "import_size_unknown":
      return { text: templates.import_size_unknown(value, w.rows) };
    case "import_custom_unreadable":
      return { text: templates.import_custom_unreadable(w.field ?? "", value, w.rows) };
    case "import_organisation_archived":
      return { text: templates.import_organisation_archived(value, w.rows), href: w.organisationId ? `/organisations/${w.organisationId}` : undefined };
    default:
      return { text: messageFor(w.code) ?? "" };
  }
}
