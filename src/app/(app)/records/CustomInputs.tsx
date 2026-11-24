// The custom fields of the person, organisation and deal forms (SF-115 data-model.md § Custom value): under a
// "// MORE DETAILS" heading after the built-in fields, one input per field in the admin's order, named `cf.<id>`, the
// error under each, and `cfShown` listing the fields shown (a field added later is left alone). No state of its own:
// rendered inside the client forms. Names and choices are text nodes.
import type { FormField } from "@/server/custom-fields/values";
import type { CustomForm, FieldErrors } from "@/server/records/rules";
import { FieldError } from "./FieldError";

export function CustomInputs({ fields, values, errors }: { fields: FormField[]; values: CustomForm | undefined; errors: FieldErrors }) {
  if (fields.length === 0) return null;
  // As typed after a refusal, else the record's stored values.
  const valueOf = (f: FormField) => (values ? (values.values[f.id] ?? []) : f.value);
  return (
    <section aria-label="More details" className="more-details">
      <div className="label sect">
        <span className="c">//</span> MORE DETAILS
      </div>
      <input type="hidden" name="cfShown" value={fields.map((f) => f.id).join(",")} />
      <div className="grid2">
        {fields.map((f) => {
          const name = `cf.${f.id}`;
          const error = errors[name];
          const raw = valueOf(f);
          const first = raw[0] ?? "";
          const invalid = error ? { "aria-invalid": true as const, "aria-describedby": `${name}-err` } : {};
          if (f.type === "multiple_choice") {
            return (
              <fieldset key={f.id} className="field choices">
                <legend>{f.name}</legend>
                {f.choices.map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" name={name} value={c.id} defaultChecked={raw.includes(String(c.id))} /> {c.name}
                  </label>
                ))}
                <FieldError error={error} id={`${name}-err`} />
              </fieldset>
            );
          }
          let input;
          switch (f.type) {
            case "long_text":
              input = <textarea className="input" name={name} rows={4} defaultValue={first} {...invalid} />;
              break;
            case "number":
              input = <input className="input" type="text" inputMode="decimal" name={name} defaultValue={first} {...invalid} />;
              break;
            case "money":
              input = (
                <span className="money-input">
                  <span aria-hidden="true">£</span>
                  <input className="input" type="text" inputMode="decimal" name={name} defaultValue={first} aria-label={f.name} {...invalid} />
                </span>
              );
              break;
            case "date":
              input = <input className="input" type="date" name={name} defaultValue={first} {...invalid} />;
              break;
            case "single_choice":
              input = (
                <select className="input" name={name} defaultValue={first} {...invalid}>
                  <option value="" />
                  {f.choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              );
              break;
            case "yes_no":
              input = (
                <select className="input" name={name} defaultValue={first} {...invalid}>
                  <option value="" />
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              );
              break;
            default:
              input = <input className="input" type="text" name={name} defaultValue={first} {...invalid} />;
          }
          return (
            <div key={f.id} className={f.type === "long_text" ? "field wide" : "field"}>
              <label className="field">
                <span>{f.name}</span>
                {input}
              </label>
              <FieldError error={error} id={`${name}-err`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
