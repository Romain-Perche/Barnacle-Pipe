// covers FR-012, FR-013, FR-014, contracts/list-query.md (both lists), edge cases "page beyond the last" and
// "search text is never echoed as a message"
import { describe, expect, it } from "vitest";
import {
  hasDealFilters, hasFilters, knownDealsQuery, knownPeopleQuery, knownSector, parseActivitiesQuery, parseDealsQuery, parseId, parseOrganisationsQuery,
  parsePeopleQuery, withParams, knownCustomQuery,
} from "@/server/records/list-query";
import type { CustomField } from "@/server/custom-fields/rules";

describe("parsePeopleQuery", () => {
  it("has the defaults: sort by name A–Z, page 1, no filter", () => {
    expect(parsePeopleQuery({})).toEqual({
      q: "", owner: null, label: null, source: null, org: null, consent: null,
      sort: "name", dir: "asc", page: 1, archived: false, open: null, ref: null, custom: {},
    });
  });
  it("reads every parameter", () => {
    expect(
      parsePeopleQuery({
        q: "  ada ", owner: "2", label: "3", source: "4", org: "5", consent: "unsubscribed",
        sort: "contacted", dir: "desc", page: "3", archived: "1", open: "7",
      }),
    ).toEqual({
      q: "ada", owner: 2, label: 3, source: 4, org: 5, consent: "unsubscribed",
      sort: "contacted", dir: "desc", page: 3, archived: true, open: 7, ref: null, custom: {},
    });
    for (const sort of ["name", "organisation", "added", "contacted"]) expect(parsePeopleQuery({ sort }).sort).toBe(sort);
  });
  it("ignores invalid values", () => {
    const q = parsePeopleQuery({
      sort: "drop", dir: "sideways", page: "-1", owner: "abc", label: "0", source: "1.5", org: "99999999999999999999",
      consent: "maybe", archived: "yes", open: "x",
    });
    expect(q).toEqual(parsePeopleQuery({}));
    expect(parsePeopleQuery({ page: "0" }).page).toBe(1);
  });
  it("keeps the page as asked (it is clamped after counting)", () => {
    expect(parsePeopleQuery({ page: "999" }).page).toBe(999);
  });
  it("trims q and cuts it at 200 characters; takes the first of repeated values", () => {
    expect(parsePeopleQuery({ q: "x".repeat(300) }).q.length).toBe(200);
    expect(parsePeopleQuery({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("parseOrganisationsQuery", () => {
  it("has the defaults", () => {
    expect(parseOrganisationsQuery({})).toEqual({
      q: "", owner: null, sector: null, size: null, sort: "name", dir: "asc", page: 1, archived: false, open: null, custom: {},
    });
  });
  it("reads sector, size and the three sorts; ignores the rest", () => {
    const q = parseOrganisationsQuery({ sector: " Fitness ", size: "201–1,000", sort: "people", dir: "desc" });
    expect(q).toMatchObject({ sector: "Fitness", size: "201–1,000", sort: "people", dir: "desc" });
    expect(parseOrganisationsQuery({ sort: "added" }).sort).toBe("added");
    expect(parseOrganisationsQuery({ sort: "contacted", size: "huge", sector: "  " })).toMatchObject({ sort: "name", size: null, sector: null });
  });
});

describe("parseId", () => {
  it("accepts 1 to 16 digits without a leading zero, within safe integers", () => {
    expect(parseId("42")).toBe(42);
    for (const bad of ["0", "01", "abc", "-1", "1.5", "", "99999999999999999", undefined]) expect(parseId(bad), String(bad)).toBeNull();
  });
});

describe("withParams", () => {
  const current = parsePeopleQuery({ q: "ada", owner: "2", sort: "added", dir: "desc", page: "3", open: "9", archived: "1" });

  it("writes only non-default values", () => {
    expect(withParams("/people", parsePeopleQuery({}), {})).toBe("/people");
    expect(withParams("/people", current, {})).toBe("/people?q=ada&owner=2&sort=added&dir=desc&page=3&archived=1&open=9");
  });
  it("resets the page and removes open when a filter, search, sort or archived changes", () => {
    expect(withParams("/people", current, { owner: 5 })).toBe("/people?q=ada&owner=5&sort=added&dir=desc&archived=1");
    expect(withParams("/people", current, { q: "bob" })).toBe("/people?q=bob&owner=2&sort=added&dir=desc&archived=1");
    expect(withParams("/people", current, { sort: "name", dir: "asc" })).toBe("/people?q=ada&owner=2&archived=1");
    expect(withParams("/people", current, { archived: false })).toBe("/people?q=ada&owner=2&sort=added&dir=desc");
  });
  it("keeps the rest when only the page or the drawer changes", () => {
    expect(withParams("/people", current, { page: 4 })).toBe("/people?q=ada&owner=2&sort=added&dir=desc&page=4&archived=1");
    expect(withParams("/people", current, { open: null })).toBe("/people?q=ada&owner=2&sort=added&dir=desc&page=3&archived=1");
    expect(withParams("/people", current, { open: 11 })).toBe("/people?q=ada&owner=2&sort=added&dir=desc&page=3&archived=1&open=11");
  });
  it("encodes text", () => {
    expect(withParams("/organisations", parseOrganisationsQuery({ q: "50% & co", size: "1,000+" }), {})).toBe(
      "/organisations?q=50%25+%26+co&size=1%2C000%2B",
    );
  });
});

describe("knownSector", () => {
  // covers FR-025, Edge Cases: unknown sector (Fix round 1)
  it("returns the in-use sector it matches ignoring case, else null", () => {
    const inUse = ["Fitness", "Media"];
    expect(knownSector("fitness", inUse)).toBe("Fitness");
    expect(knownSector("Your account is locked, call 0800 000", inUse)).toBeNull();
    expect(knownSector(null, inUse)).toBeNull();
  });
});

// covers SF-95 FR-010, FR-011, FR-013, US3 scenario 5 (research.md §5)
describe("parseDealsQuery", () => {
  it("has the defaults: newest first, page 1, open deals only", () => {
    expect(parseDealsQuery({})).toEqual({
      q: "", pipeline: null, stage: null, owner: null, label: null, status: null,
      sort: "added", dir: "desc", page: 1, closed: false, archived: false, open: null, ref: null, custom: {},
    });
  });
  it("reads every parameter and the seven sorts", () => {
    expect(
      parseDealsQuery({
        q: " fake ", pipeline: "1", stage: "2", owner: "3", label: "4", status: "won", sort: "value", dir: "asc", page: "2",
        closed: "1", archived: "1", open: "8",
      }),
    ).toEqual({
      q: "fake", pipeline: 1, stage: 2, owner: 3, label: 4, status: "won", sort: "value", dir: "asc", page: 2,
      closed: true, archived: true, open: 8, ref: null, custom: {},
    });
    for (const sort of ["title", "value", "organisation", "stage", "owner", "close", "added"]) expect(parseDealsQuery({ sort }).sort).toBe(sort);
    for (const status of ["open", "won", "lost"]) expect(parseDealsQuery({ status }).status).toBe(status);
  });
  it("ignores invalid values", () => {
    expect(
      parseDealsQuery({
        sort: "evil", dir: "up", stage: "abc", pipeline: "0", owner: "-2", label: "1.5", status: "deleted", page: "x",
        closed: "yes", archived: "true", open: "<b>",
      }),
    ).toEqual(parseDealsQuery({}));
    expect(parseDealsQuery({ q: "x".repeat(300) }).q.length).toBe(200);
  });
  it("knows when a filter is set", () => {
    expect(hasDealFilters(parseDealsQuery({}))).toBe(false);
    expect(hasDealFilters(parseDealsQuery({ sort: "value", page: "2" }))).toBe(false);
    for (const key of ["q", "pipeline", "stage", "owner", "label"]) expect(hasDealFilters(parseDealsQuery({ [key]: "5" })), key).toBe(true);
    expect(hasDealFilters(parseDealsQuery({ closed: "1" }))).toBe(true);
    expect(hasDealFilters(parseDealsQuery({ archived: "1" }))).toBe(true);
  });
});

describe("withParams on the deal list", () => {
  it("drops the deal defaults (sort=added, dir=desc) but keeps sort=name and dir=asc", () => {
    expect(withParams("/deals/list", parseDealsQuery({}), {})).toBe("/deals/list");
    expect(withParams("/deals/list", parseDealsQuery({ sort: "title", dir: "asc" }), {})).toBe("/deals/list?sort=title&dir=asc");
  });
  it("writes the deal filters in a fixed order, closed and archived as 1", () => {
    const q = parseDealsQuery({ q: "fake", pipeline: "1", stage: "2", owner: "3", label: "4", status: "lost", closed: "1", page: "2", open: "7" });
    expect(withParams("/deals/list", q, {})).toBe("/deals/list?q=fake&pipeline=1&stage=2&owner=3&label=4&status=lost&page=2&closed=1&open=7");
  });
  it("goes back to page 1 and closes the drawer when a filter changes", () => {
    const q = parseDealsQuery({ pipeline: "1", page: "3", open: "7" });
    expect(withParams("/deals/list", q, { owner: 2 })).toBe("/deals/list?pipeline=1&owner=2");
    expect(withParams("/deals/list", q, { closed: true })).toBe("/deals/list?pipeline=1&closed=1");
    expect(withParams("/deals/list", q, { open: 9 })).toBe("/deals/list?pipeline=1&page=3&open=9");
  });
});

// covers SF-95 FR-013, US3 scenario 5, Edge Cases (unknown owner or label)
describe("knownDealsQuery", () => {
  const options = {
    pipelines: [{ id: 1, name: "Sales" }],
    stages: [{ id: 2, name: "Lead" }],
    owners: [{ id: 3, name: "Linus Fake" }],
    labels: [{ id: 4, name: "Hot" }],
    referrers: [{ id: 5, name: "Cara Example" }],
  };
  it("drops an owner or label that is not an option", () => {
    const q = knownDealsQuery(parseDealsQuery({ owner: "99999", label: "99999" }), options);
    expect(q.owner).toBeNull();
    expect(q.label).toBeNull();
    expect(hasDealFilters(knownDealsQuery(parseDealsQuery({ owner: "99999" }), options))).toBe(false);
    expect(hasDealFilters(knownDealsQuery(parseDealsQuery({ label: "99999" }), options))).toBe(false);
  });
  it("keeps known values", () => {
    const q = knownDealsQuery(parseDealsQuery({ pipeline: "1", stage: "2", owner: "3", label: "4", status: "won", closed: "1" }), options);
    expect(q).toMatchObject({ pipeline: 1, stage: 2, owner: 3, label: 4, status: "won", closed: true });
  });
  it("keeps today's pipeline, stage and status rules", () => {
    expect(knownDealsQuery(parseDealsQuery({ pipeline: "9", stage: "2" }), options)).toMatchObject({ pipeline: null, stage: null });
    expect(knownDealsQuery(parseDealsQuery({ stage: "2" }), options).stage).toBeNull();
    expect(knownDealsQuery(parseDealsQuery({ pipeline: "1", stage: "7" }), options)).toMatchObject({ pipeline: 1, stage: null });
    expect(knownDealsQuery(parseDealsQuery({ status: "won" }), options).status).toBeNull();
    expect(knownDealsQuery(parseDealsQuery({ status: "lost", archived: "1" }), options).status).toBe("lost");
    const rest = parseDealsQuery({ q: "fake", sort: "value", dir: "asc", page: "2", open: "8" });
    expect(knownDealsQuery(rest, options)).toEqual(rest);
  });
});

// covers SF-114 FR-011, US5 scenarios 1–2: the "Referred by" filter (`ref`) on the People list and the Deal list
describe("the Referred by filter", () => {
  it("is parsed on both lists and invalid values are dropped", () => {
    expect(parsePeopleQuery({ ref: "5" }).ref).toBe(5);
    expect(parseDealsQuery({ ref: "5" }).ref).toBe(5);
    expect(parsePeopleQuery({ ref: "<b>" }).ref).toBeNull();
    expect(parseDealsQuery({ ref: "0" }).ref).toBeNull();
  });
  it("is kept in the address with the other filters, and changing it goes back to page 1", () => {
    expect(withParams("/people", parsePeopleQuery({ ref: "5", owner: "2" }), {})).toBe("/people?owner=2&ref=5");
    expect(withParams("/deals/list", parseDealsQuery({ ref: "5", closed: "1" }), {})).toBe("/deals/list?closed=1&ref=5");
    expect(withParams("/people", parsePeopleQuery({ page: "3" }), { ref: 5 })).toBe("/people?ref=5");
  });
  it("counts as a filter", () => {
    expect(hasFilters(parsePeopleQuery({ ref: "5" }))).toBe(true);
    expect(hasDealFilters(parseDealsQuery({ ref: "5" }))).toBe(true);
  });
  it("is dropped from the deal list when the referrer is not an option", () => {
    const options = { pipelines: [], stages: [], owners: [], labels: [], referrers: [{ id: 5, name: "Cara Example" }] };
    expect(knownDealsQuery(parseDealsQuery({ ref: "5" }), options).ref).toBe(5);
    expect(knownDealsQuery(parseDealsQuery({ ref: "6" }), options).ref).toBeNull();
  });
});

// covers SF-114 FR-013, SC-005 (fix round 1): the People list keeps only a referrer that is one of its options
describe("knownPeopleQuery", () => {
  const options = { referrers: [{ id: 5, name: "Cara Example" }] };
  it("drops a referrer that is not an option", () => {
    const q = knownPeopleQuery(parsePeopleQuery({ ref: "37" }), options);
    expect(q.ref).toBeNull();
    expect(hasFilters(q)).toBe(false);
  });
  it("keeps a known referrer and every other field", () => {
    const rest = parsePeopleQuery({ q: "fake", owner: "3", label: "4", source: "6", org: "7", consent: "subscribed", sort: "added", dir: "desc", page: "2", archived: "1", open: "8", ref: "5" });
    expect(knownPeopleQuery(rest, options)).toEqual(rest);
  });
});

// covers SF-109 FR-008, US3 scenarios 3–4, contracts/routes.md § /activities (T006, T036)
describe("parseActivitiesQuery", () => {
  it("defaults to planned, the viewer, every type, page 1", () => {
    expect(parseActivitiesQuery({})).toEqual({ when: "planned", assignee: null, type: null, page: 1 });
    expect(parseActivitiesQuery({ when: "soon", assignee: "x", type: "email", page: "0" })).toEqual({ when: "planned", assignee: null, type: null, page: 1 });
  });
  it("reads each value", () => {
    for (const when of ["overdue", "today", "week", "planned", "done"]) expect(parseActivitiesQuery({ when }).when).toBe(when);
    expect(parseActivitiesQuery({ assignee: "all" }).assignee).toBe("all");
    expect(parseActivitiesQuery({ assignee: "7" }).assignee).toBe(7);
    expect(parseActivitiesQuery({ assignee: "-7" }).assignee).toBeNull();
    for (const type of ["call", "meeting", "task"]) expect(parseActivitiesQuery({ type }).type).toBe(type);
    expect(parseActivitiesQuery({ page: "3" }).page).toBe(3);
  });
  it("builds links that keep the other filters, drop the page, and read back the same", () => {
    const q = parseActivitiesQuery({ when: "today", assignee: "all", type: "meeting", page: "2" });
    const done = withParams("/activities", q, { when: "done" });
    expect(done).toBe("/activities?when=done&assignee=all&type=meeting");
    expect(parseActivitiesQuery(Object.fromEntries(new URL(done, "http://x").searchParams))).toEqual({ ...q, when: "done", page: 1 });
    expect(withParams("/activities", q, { page: 3 })).toBe("/activities?when=today&assignee=all&type=meeting&page=3");
    expect(withParams("/activities", parseActivitiesQuery({}), { when: "planned" })).toBe("/activities");
    const mine = withParams("/activities", q, { assignee: 5, type: null });
    expect(parseActivitiesQuery(Object.fromEntries(new URL(mine, "http://x").searchParams))).toEqual({ when: "today", assignee: 5, type: null, page: 1 });
  });
});

// covers SF-115 FR-010, FR-012, US3 scenario 4: custom filters and sorts in the list address
describe("custom fields in list addresses", () => {
  const f = (id: number, type: CustomField["type"], over: Partial<CustomField> = {}): CustomField =>
    ({ id, kind: "person", name: `F${id}`, type, position: id, inList: true, choices: [], ...over });
  const diet = f(1, "single_choice", { choices: [{ id: 11, name: "Vegan", position: 1, removed: false }, { id: 12, name: "Old", position: 2, removed: true }] });
  const shown = [diet, f(2, "text"), f(3, "number"), f(4, "money"), f(5, "date"), f(6, "yes_no"), f(7, "long_text"),
    f(8, "multiple_choice", { choices: [{ id: 81, name: "AI", position: 1, removed: false }] })];

  it("collects cf<id>, cf<id>_from and cf<id>_to (at most 24, values cut at 200) and sort=cf<id>", () => {
    const q = parsePeopleQuery({ cf1: "11", cf3_from: " 2 ", cf3_to: "9", other: "x", cfx: "y", cf2: "x".repeat(300), sort: "cf2" });
    expect(q.custom).toEqual({ cf1: "11", cf3_from: "2", cf3_to: "9", cf2: "x".repeat(200) });
    expect(q.sort).toBe("cf2");
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`cf${i + 1}`, "a"]));
    expect(Object.keys(parseDealsQuery(many).custom)).toHaveLength(24);
    expect(parseOrganisationsQuery({ cf9: "a", sort: "cf9" })).toMatchObject({ custom: { cf9: "a" }, sort: "cf9" });
  });

  it("keeps only shown fields with a valid value; drops the rest (FR-012)", () => {
    const q = parsePeopleQuery({
      cf1: "12", cf2: "vegan", cf3_from: "1,000", cf3_to: "abc", cf4_from: "£10", cf4_to: "-1", cf5_from: "2026-01-01", cf5_to: "2026-02-30",
      cf6: "maybe", cf7: "empty", cf8: "81", cf99: "x", cf2_from: "1",
    });
    expect(knownCustomQuery(q, shown).custom).toEqual({ cf1: "12", cf2: "vegan", cf3_from: "1,000", cf4_from: "£10", cf5_from: "2026-01-01", cf7: "empty", cf8: "81" });
    expect(knownCustomQuery(parsePeopleQuery({ cf1: "99" }), shown).custom).toEqual({});
    expect(knownCustomQuery(parsePeopleQuery({ cf1: "empty", cf6: "no" }), shown).custom).toEqual({ cf1: "empty", cf6: "no" });
    // A field not shown in the list (or of another kind) is dropped.
    expect(knownCustomQuery(parsePeopleQuery({ cf2: "a" }), shown.filter((x) => x.id !== 2)).custom).toEqual({});
  });

  it("drops a sort on an unknown, hidden, long text or multiple choice field", () => {
    expect(knownCustomQuery(parsePeopleQuery({ sort: "cf3", dir: "desc" }), shown)).toMatchObject({ sort: "cf3", dir: "desc" });
    for (const sort of ["cf7", "cf8", "cf99"]) expect(knownCustomQuery(parsePeopleQuery({ sort }), shown).sort).toBe("name");
    expect(knownCustomQuery(parseDealsQuery({ sort: "cf99" }), shown).sort).toBe("added");
    expect(knownCustomQuery(parseOrganisationsQuery({ sort: "cf99" }), shown).sort).toBe("name");
  });

  it("writes custom entries after the built-in keys, sorted, and goes back to page 1", () => {
    const q = knownCustomQuery(parsePeopleQuery({ cf2: "a b", cf1: "11", owner: "3", page: "2" }), shown);
    expect(withParams("/people", q, { sort: "cf3", dir: "desc" })).toBe("/people?owner=3&sort=cf3&dir=desc&cf1=11&cf2=a+b");
    expect(withParams("/people", q, { custom: {} })).toBe("/people?owner=3");
    expect(withParams("/people", q, { page: 3 })).toBe("/people?owner=3&page=3&cf1=11&cf2=a+b");
  });

  it("counts custom filters as filters", () => {
    expect(hasFilters(parsePeopleQuery({ cf1: "11" }))).toBe(true);
    expect(hasFilters(parseOrganisationsQuery({ cf1: "11" }))).toBe(true);
    expect(hasDealFilters(parseDealsQuery({ cf1: "11" }))).toBe(true);
    expect(hasFilters(parsePeopleQuery({}))).toBe(false);
  });
});
