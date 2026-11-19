import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { parseId } from "@/server/records/list-query";
import { getPerson, personFormChoices, personToForm } from "@/server/records/people";
import { PersonForm } from "../../../records/PersonForm";
import { updatePerson } from "../../actions";

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const person = await getPerson(user.id, id);
  if (!person) notFound();
  const choices = await personFormChoices(user.id, person);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> PERSON
          </div>
          <h1>Edit {person.name}</h1>
        </div>
      </div>
      <PersonForm
        action={updatePerson}
        choices={choices}
        canSetPrivate={person.createdBy === user.id}
        initial={personToForm(person)}
        id={id}
        version={person.version}
        cancelHref={`/people/${id}`}
      />
    </>
  );
}
