// "// MORE DETAILS" of the person, organisation and deal pages and the deal drawer (SF-115 design B): every custom field
// of the kind in the admin's order with its value or "—", in the // DETAILS look. Nothing when the kind has no field.
// Names and values are text nodes; long text keeps its line breaks.
import type { CustomDetail } from "@/server/custom-fields/values";

export function MoreDetails({ details, drawer = false }: { details: CustomDetail[]; drawer?: boolean }) {
  if (details.length === 0) return null;
  const list = (
    <dl className={drawer ? undefined : "details"}>
      {details.map((d) => (
        <div key={d.field.id}>
          <dt>{d.field.name}</dt>
          <dd className={d.field.type === "long_text" ? "custom-value" : undefined}>{d.text}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section aria-label="More details">
      <div className="label sect">
        <span className="c">//</span> MORE DETAILS
      </div>
      {list}
    </section>
  );
}
