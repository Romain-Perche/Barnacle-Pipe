// The two kinds of import and their fixed paths and words (SF-103 contracts/routes.md § Pages).
import type { ImportKind } from "@/server/imports/columns";

export const KIND = {
  people: { path: "/people", list: "People", title: "Import people", section: "CONTACTS", records: "People" },
  organisations: { path: "/organisations", list: "Organisations", title: "Import organisations", section: "CONTACTS", records: "Organisations" },
} as const satisfies Record<ImportKind, unknown>;

export const isImportKind = (k: unknown): k is ImportKind => k === "people" || k === "organisations";

export const importPath = (kind: ImportKind, id?: number, step?: "columns" | "preview" | "report") =>
  id === undefined ? `${KIND[kind].path}/import` : `${KIND[kind].path}/import/${id}/${step}`;
