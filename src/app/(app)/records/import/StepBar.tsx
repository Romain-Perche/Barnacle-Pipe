// 1 FILE · 2 COLUMNS · 3 PREVIEW · 4 REPORT (design B): the current step highlighted, finished steps ticked.
// SF-117: `steps` gives another import's steps (the Pipedrive import: 1 CHOOSE · 2 IMPORTING · 3 REPORT).
const CSV_STEPS = ["1 FILE", "2 COLUMNS", "3 PREVIEW", "4 REPORT"];

export function StepBar({ step, steps = CSV_STEPS }: { step: number; steps?: readonly string[] }) {
  return (
    <ol className="steps" aria-label="Steps">
      {steps.map((name, i) => {
        const n = i + 1;
        return (
          <li key={name} className={n === step ? "on" : n < step ? "done" : undefined} aria-current={n === step ? "step" : undefined}>
            {n < step ? `${name} ✓` : name}
          </li>
        );
      })}
    </ol>
  );
}
