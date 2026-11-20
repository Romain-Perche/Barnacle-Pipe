const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function ukParts(date: Date): Record<string, string> {
  return Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
}

// UK date: "19 Nov 2026" ("Date added", "Last contacted").
export function formatDate(date: Date): string {
  const p = ukParts(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

// UK date and time: "19 Nov 2026, 09:12" (timelines, last sign-in).
export function formatDateTime(date: Date): string {
  const p = ukParts(date);
  return `${formatDate(date)}, ${p.hour}:${p.minute}`;
}

// Last sign-in on the Users page: UK time, "19 Nov 2026, 09:12", or "Never".
export function formatLastSignIn(date: Date | null): string {
  return date ? formatDateTime(date) : "Never";
}

// Header counts: "1 USER", "2 USERS", "0 ADMINS"; an irregular plural is given: "132 PEOPLE".
export function countLabel(n: number, word: string, plural = `${word}S`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

const POUNDS = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const PENCE = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// GBP from whole pence (research.md §2): "£4,000" for whole pounds, "£4,000.50" otherwise, "—" for no value.
export function formatMoney(pence: number | null): string {
  if (pence === null) return "—";
  return pence % 100 === 0 ? POUNDS.format(pence / 100) : PENCE.format(pence / 100);
}
