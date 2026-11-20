// The record a note form posts to: `target` (deal / person / organisation) and `targetId` (SF-102 contracts/routes.md).
import type { NoteTarget } from "@/server/records/notes";

export type TargetKind = "deal" | "person" | "organisation";

export function noteTarget(kind: string, id: number): NoteTarget | null {
  if (kind === "deal") return { dealId: id };
  if (kind === "person") return { personId: id };
  if (kind === "organisation") return { organisationId: id };
  return null;
}

export function targetKind(target: NoteTarget): TargetKind {
  return "dealId" in target ? "deal" : "personId" in target ? "person" : "organisation";
}

export function targetId(target: NoteTarget): number {
  return "dealId" in target ? target.dealId : "personId" in target ? target.personId : target.organisationId;
}

// The record's page, built from the numeric id only.
export function targetPath(target: NoteTarget): string {
  if ("dealId" in target) return `/deals/${target.dealId}`;
  if ("personId" in target) return `/people/${target.personId}`;
  return `/organisations/${target.organisationId}`;
}
