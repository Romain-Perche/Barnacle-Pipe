import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseId } from "@/server/records/list-query";
import { getOrganisation, organisationFormChoices, organisationToForm } from "@/server/records/organisations";
import { OrganisationForm } from "../../../records/OrganisationForm";
import { updateOrganisation } from "../../actions";
import { formFields } from "@/server/custom-fields/values";

export default async function EditOrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const org = await getOrganisation(user.id, id);
  if (!org) notFound();
  const { owners } = await organisationFormChoices(org);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ORGANISATION
          </div>
          <h1>Edit {org.name}</h1>
        </div>
      </div>
      <OrganisationForm action={updateOrganisation} owners={owners} initial={organisationToForm(org)} customFields={formFields(org.custom)} archived={org.archived} id={id} version={org.version} cancelHref={`/organisations/${id}`} />
    </>
  );
}
