import { requireUser } from "@/server/auth/session";
import { personFormChoices } from "@/server/records/people";
import { PersonForm } from "../../records/PersonForm";
import { createPerson } from "../actions";
import { newFormFields } from "@/server/custom-fields/values";

export default async function NewPersonPage() {
  const user = await requireUser();
  const choices = await personFormChoices(user.id, null);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CONTACTS
          </div>
          <h1>Add person</h1>
        </div>
      </div>
      <PersonForm
        action={createPerson}
        choices={choices}
        canSetPrivate
        customFields={await newFormFields("person")}
        cancelHref="/people"
        initial={{
          firstName: "",
          lastName: "",
          emails: [{ value: "", kind: "work" }],
          phones: [{ value: "", kind: "work" }],
          organisationId: "",
          newOrganisationName: "",
          role: "",
          leadSourceId: "",
          linkedin: "",
          ownerId: String(user.id),
          labelIds: [],
          consent: "subscribed",
          private: false,
          ambassador: false,
          referredBy: "",
        }}
      />
    </>
  );
}
