import { firstName } from "@/server/auth/rules";
import { requireUser } from "@/server/auth/session";

// Home: the landing page until a later feature (pipelines) replaces it.
export default async function HomePage() {
  const user = await requireUser();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> HOME
          </div>
          <h1>Hello, {firstName(user.name)}</h1>
        </div>
      </div>
      <p>Welcome to the Barnacle CRM.</p>
    </>
  );
}
