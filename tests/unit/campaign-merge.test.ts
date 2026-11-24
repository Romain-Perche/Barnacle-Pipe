// covers SF-119 FR-007, FR-008, FR-009, FR-009a, US2 scenarios 1–5, Edge Cases "tags" (T020) and FR-014, FR-016,
// US5 scenarios 1, 4, 6, SC-002, SC-003, Edge Cases "no first name", "multiple choice" (T038): the merge tag grammar,
// the fields, links that follow renames, unknown tags and filling a tag for no person, a value, a fallback or nothing.
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_MERGE_FIELDS, fillHtml, fillText, insertTag, linksToStore, mergeFields, parseTags, resolveTag, resolver, rewriteNames,
  shownLinks, tagsIn, unknownTags, type Link, type PreviewValues,
} from "@/server/campaigns/merge";
import { validateDraft } from "@/server/campaigns/rules";

const custom = [{ id: 7, name: "Dietary needs" }, { id: 9, name: "Birthday" }];
const fields = mergeFields(custom);
const tags = (text: string) => tagsIn([text]);

describe("merge fields", () => {
  it("lists the 11 built-ins in FR-008 order with stable keys, then people custom fields as cf:<id>", () => {
    expect(BUILT_IN_MERGE_FIELDS.map((f) => f.name)).toEqual([
      "First name", "Last name", "Full name", "Email", "Phone", "Organisation", "Role", "Lead source", "LinkedIn", "Owner", "Labels",
    ]);
    expect(BUILT_IN_MERGE_FIELDS.map((f) => f.key)).toEqual([
      "first_name", "last_name", "full_name", "email", "phone", "organisation", "role", "lead_source", "linkedin", "owner", "labels",
    ]);
    expect(fields.slice(11)).toEqual([{ key: "cf:7", name: "Dietary needs" }, { key: "cf:9", name: "Birthday" }]);
  });
});

describe("parseTags", () => {
  it("reads the name and the If empty text", () => {
    expect(tags("Hi {{First name | there}}!")).toMatchObject([{ raw: "{{First name | there}}", name: "First name", fallback: "there" }]);
    expect(resolveTag(tags("{{ first NAME }}")[0].name, [], fields)).toEqual({ key: "first_name", name: "First name" });
    expect(tags("{{ First name|  }}")).toMatchObject([{ name: "First name", fallback: "" }]);
    expect(tags("{{a | b | c}}")).toMatchObject([{ name: "a", fallback: "b | c" }]);
  });
  it("treats {{}} as a tag with an empty name and an unclosed tag as text", () => {
    expect(tags("{{}}")).toMatchObject([{ raw: "{{}}", name: "" }]);
    expect(resolveTag("", [], fields)).toBe("unknown");
    expect(tags("{{First name")).toEqual([]);
    expect(parseTags("{{First name")).toEqual([{ text: "{{First name" }]);
  });
  it("gives the offsets of the name characters", () => {
    const text = "x {{  Diet | none }}";
    const [t] = tags(text);
    expect(text.slice(t.nameStart, t.nameEnd)).toBe("Diet");
  });
});

describe("links and renames", () => {
  const stored = [{ field: 7, name: "Diet" }, { field: 3, name: "Gone field" }];
  const links = shownLinks(stored, custom);
  it("shows a live link with the field's current name and a dead one with its last name", () => {
    expect(links).toEqual([{ field: 7, name: "Dietary needs", live: true }, { field: 3, name: "Gone field", live: false }]);
  });
  it("shows a deleted field's last name (kept on delete) before the name stored at the last save (fix round 1)", () => {
    // covers SF-119 FR-009a
    const renamedThenDeleted = [{ field: 3, name: "Diet", last: "Dietary needs" }];
    expect(shownLinks(renamedThenDeleted, custom)).toEqual([{ field: 3, name: "Dietary needs", live: false }]);
    expect(rewriteNames("{{Diet | x}}", renamedThenDeleted, custom)).toBe("{{Dietary needs | x}}");
    expect(shownLinks([{ field: 7, name: "Diet", last: "Old" }], custom)).toEqual([{ field: 7, name: "Dietary needs", live: true }]);
  });
  it("rewrites only the name characters of linked tags", () => {
    const html = '<p style="x">{{Diet | none given}}</p> {{ diet|x }} {{Diets}} Diet {{Gone field}}';
    expect(rewriteNames(html, stored, custom)).toBe('<p style="x">{{Dietary needs | none given}}</p> {{ Dietary needs|x }} {{Diets}} Diet {{Gone field}}');
  });
  it("resolves link → built-in → custom → unknown; a dead link is unknown even when a current field has its name", () => {
    expect(resolveTag("dietary needs", links, fields)).toEqual({ key: "cf:7", name: "Dietary needs" });
    expect(resolveTag("Email", links, fields)).toEqual({ key: "email", name: "Email" });
    expect(resolveTag("birthday", links, fields)).toEqual({ key: "cf:9", name: "Birthday" });
    expect(resolveTag("Favourite colour", links, fields)).toBe("unknown");
    const dead: Link[] = [{ field: 3, name: "Birthday", live: false }];
    expect(resolveTag("Birthday", dead, fields)).toBe("unknown");
  });
  it("lists unknown tags as typed, first seen, without repeats", () => {
    expect(unknownTags(["{{Favourite colour}} {{First name}}", "{{}} {{Favourite colour}} {{Gone field}}"], links, fields)).toEqual([
      "{{Favourite colour}}", "{{}}", "{{Gone field}}",
    ]);
  });
  it("stores the custom fields the tags use; a dead link stays while a tag uses its name", () => {
    expect(linksToStore(["{{Dietary needs}} {{Gone field}} {{birthday}} {{First name}}"], links, fields)).toEqual([
      { field: 7, name: "Dietary needs" }, { field: 3, name: "Gone field" }, { field: 9, name: "Birthday" },
    ]);
    expect(linksToStore(["{{Something else}}"], links, fields)).toEqual([]);
  });
});

describe("insertTag", () => {
  it("writes the tag with or without If empty text", () => {
    expect(insertTag({ name: "First name" }, "")).toBe("{{First name}}");
    expect(insertTag({ name: "First name" }, "  there ")).toBe("{{First name | there}}");
  });
});

describe("fallback limit (FR-008)", () => {
  const form = { name: "Fake", senderName: "", replyTo: "", subject: "", previewText: "" };
  it("refuses a 101-character fallback on a known tag and accepts it on an unknown tag", () => {
    const long = "x".repeat(101);
    expect(validateDraft({ ...form, subject: `{{First name | ${long}}}` }, fields, [])).toEqual({
      ok: false, errors: { fallback: "If empty, show: at most 100 characters." },
    });
    expect(validateDraft({ ...form, subject: `{{Favourite colour | ${long}}}` }, fields, []).ok).toBe(true);
    expect(validateDraft({ ...form, contentTexts: [`{{Email | ${long}}}`] }, fields, []).ok).toBe(false);
    expect(validateDraft({ ...form, subject: `{{First name | ${"x".repeat(100)}}}` }, fields, []).ok).toBe(true);
  });
});

describe("filling tags", () => {
  const resolve = resolver([], fields);
  const fakey: PreviewValues = { first_name: "Fakey", organisation: null, "cf:7": "Vegan, Halal", last_name: "<b>Fake</b>", role: "" };
  it("shows [Field name] for every known tag with no person, unknown tags as typed", () => {
    expect(fillText("{{ first name | there }}, {{Dietary needs}} {{Favourite colour}}", { resolve, values: null })).toBe(
      "[First name], [Dietary needs] {{Favourite colour}}",
    );
  });
  it("shows the value, else the fallback, else nothing; never [First name] or undefined", () => {
    expect(fillText("{{First name}}, news for {{Organisation | your team}}", { resolve, values: fakey })).toBe("Fakey, news for your team");
    expect(fillText("[{{Organisation}}][{{Role}}][{{Phone}}][{{Dietary needs | none}}]", { resolve, values: fakey })).toBe("[][][][Vegan, Halal]");
    expect(fillText("Hi {{First name | there}}", { resolve, values: {} })).toBe("Hi there");
  });
  it("escapes values in HTML, in text and inside an attribute", () => {
    const html = '<p title="{{Last name}}">{{Last name}}</p>';
    expect(fillHtml(html, { resolve, values: { last_name: '<b>Fake</b> "q"' } })).toBe(
      '<p title="&lt;b&gt;Fake&lt;/b&gt; &quot;q&quot;">&lt;b&gt;Fake&lt;/b&gt; &quot;q&quot;</p>',
    );
  });
  it("tints a fallback in the frame, outside attributes only", () => {
    const html = '<a title="{{Organisation | team}}">{{Organisation | your team}}</a>';
    expect(fillHtml(html, { resolve, values: fakey, tint: true })).toBe(
      '<a title="team"><span style="background:#FFF1E6">your team</span></a>',
    );
    expect(fillHtml(html, { resolve, values: fakey })).toBe('<a title="team">your team</a>');
  });
  it("fills 500,000 characters with 1,000 tags in under 200 ms (SC-002)", () => {
    const chunk = "<p>" + "x".repeat(471) + "{{First name | there}}</p>"; // 500 characters with its tag
    const html = chunk.repeat(1000);
    expect([html.length, tagsIn([html]).length]).toEqual([500_000, 1000]);
    const start = performance.now();
    const out = fillHtml(html, { resolve, values: fakey, tint: true });
    expect(performance.now() - start).toBeLessThan(200);
    expect(out).toContain("Fakey");
  });
});
