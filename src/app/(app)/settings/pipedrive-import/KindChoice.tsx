"use client";
// "// WHAT TO IMPORT" (SF-122 FR-001, FR-002, contracts/routes.md § Step 1): six checkboxes, all unticked. Ticking Deals,
// Notes, Activities or Files ticks People and Organisations and locks them (a disabled box is not posted, so a hidden
// input posts `on`); unticking all four frees them, still ticked. The server enforces the same rule without JavaScript.
import { useState } from "react";

const RECORDS = [
  ["deals", "Deals"],
  ["notes", "Notes"],
  ["activities", "Activities"],
  ["files", "Files"],
] as const;
type Record4 = (typeof RECORDS)[number][0];

export function KindChoice() {
  const [people, setPeople] = useState(false);
  const [organisations, setOrganisations] = useState(false);
  const [records, setRecords] = useState<Record<Record4, boolean>>({ deals: false, notes: false, activities: false, files: false });
  const locked = Object.values(records).some(Boolean);
  const tick = (k: Record4, on: boolean) => {
    setRecords((r) => ({ ...r, [k]: on }));
    if (on) {
      setPeople(true);
      setOrganisations(true);
    }
  };
  const base = (name: "people" | "organisations", label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="check">
      <input type="checkbox" name={name} checked={value || locked} disabled={locked} aria-disabled={locked} onChange={(e) => set(e.target.checked)} />{" "}
      {label}
      {locked && <input type="hidden" name={name} value="on" />}
    </label>
  );
  return (
    <div className="radios">
      {base("people", "People", people, setPeople)}
      {base("organisations", "Organisations", organisations, setOrganisations)}
      {RECORDS.map(([name, label]) => (
        <label key={name} className="check">
          <input type="checkbox" name={name} checked={records[name]} onChange={(e) => tick(name, e.target.checked)} /> {label}
        </label>
      ))}
    </div>
  );
}
