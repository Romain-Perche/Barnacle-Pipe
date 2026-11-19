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

// Last sign-in on the Users page: UK time, "19 Nov 2026, 09:12", or "Never".
export function formatLastSignIn(date: Date | null): string {
  if (!date) return "Never";
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

// Users page header counts: "1 USER", "2 USERS", "0 ADMINS".
export function countLabel(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "S"}`;
}
