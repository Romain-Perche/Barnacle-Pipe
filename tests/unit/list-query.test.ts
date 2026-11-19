// covers FR-012, FR-013, FR-014, contracts/list-query.md (both lists), edge cases "page beyond the last" and
// "search text is never echoed as a message"
import { describe, expect, it } from "vitest";
import { parseId, parseOrganisationsQuery, parsePeopleQuery, withParams } from "@/server/records/list-query";

describe("parsePeopleQuery", () => {
  it("has the defaults: sort by name A–Z, page 1, no filter", () => {
    expect(parsePeopleQuery({})).toEqual({
      q: "", owner: null, label: null, source: null, org: null, consent: null,
      sort: "name", dir: "asc", page: 1, archived: false, open: null,
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
      sort: "contacted", dir: "desc", page: 3, archived: true, open: 7,
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
      q: "", owner: null, sector: null, size: null, sort: "name", dir: "asc", page: 1, archived: false, open: null,
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
