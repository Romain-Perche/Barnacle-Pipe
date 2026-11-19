// Form values as the person and organisation forms send them.
import type { OrganisationForm, PersonForm } from "@/server/records/rules";

export function personForm(over: Partial<PersonForm> = {}): PersonForm {
  return {
    firstName: "Ada",
    lastName: "Example",
    emails: [],
    phones: [],
    organisationId: "",
    newOrganisationName: "",
    role: "",
    leadSourceId: "",
    linkedin: "",
    ownerId: "",
    labelIds: [],
    consent: "subscribed",
    private: false,
    ...over,
  };
}

export function emails(...values: string[]) {
  return values.map((value) => ({ value, kind: "work" }));
}

export function orgForm(over: Partial<OrganisationForm> = {}): OrganisationForm {
  return { name: "Fakeco Ltd", website: "", sector: "", size: "", location: "", ownerId: "", ...over };
}

export function saved(result: { status: string; id?: number }): number {
  if (result.status !== "saved" || result.id === undefined) throw new Error(`expected saved, got ${JSON.stringify(result)}`);
  return result.id;
}
