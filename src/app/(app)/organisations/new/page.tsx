import { requireUser } from "@/server/auth/session";
import { organisationFormChoices } from "@/server/records/organisations";
import { OrganisationForm } from "../../records/OrganisationForm";
import { createOrganisation } from "../actions";
import { newFormFields } from "@/server/custom-fields/values";

export default async function NewOrganisationPage() {
  const user = await requireUser();
  const { owners } = await organisationFormChoices(null);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CONTACTS
          </div>
          <h1>Add organisation</h1>
        </div>
      </div>
      <OrganisationForm
        customFields={await newFormFields("organisation")}
        action={createOrganisation}
        owners={owners}
        cancelHref="/organisations"
        initial={{ name: "", website: "", sector: "", size: "", location: "", ownerId: String(user.id) }}
      />
    </>
  );
}
