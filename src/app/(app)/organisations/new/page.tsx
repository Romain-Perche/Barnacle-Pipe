import { requireUser } from "@/server/auth/session";
import { organisationFormChoices } from "@/server/records/organisations";
import { OrganisationForm } from "../../records/OrganisationForm";
import { createOrganisation } from "../actions";

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
        action={createOrganisation}
        owners={owners}
        cancelHref="/organisations"
        initial={{ name: "", website: "", sector: "", size: "", location: "", ownerId: String(user.id) }}
      />
    </>
  );
}
