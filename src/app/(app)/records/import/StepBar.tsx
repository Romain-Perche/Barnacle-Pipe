// 1 FILE · 2 COLUMNS · 3 PREVIEW · 4 REPORT (design B): the current step highlighted, finished steps ticked.
const STEPS = ["1 FILE", "2 COLUMNS", "3 PREVIEW", "4 REPORT"];

export function StepBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="steps" aria-label="Steps">
      {STEPS.map((name, i) => {
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
