---
version: alpha
name: Barnacle Labs
description: Bold, engineering-forward visual identity for an enterprise AI consultancy. Electric blue and signal orange against warm cream paper, monospace UI typography, and sharp geometric edges. The aesthetic reads as "production engineering, not pitch deck".
colors:
  # Surfaces
  surface: "#FAF6F1"
  surface-inverse: "#2B00FF"
  surface-deep: "#1A0099"
  body-text: "#111827"
  on-surface-inverse: "#FFFFFF"

  # Brand
  primary: "#2B00FF"
  on-primary: "#FFFFFF"
  primary-deep: "#2000CC"
  secondary: "#FF4200"
  on-secondary: "#FFFFFF"

  # Dark / focus surface
  surface-dark: "#1A1A1A"

  # Semantic
  success: "#16A34A"
  warning: "#F59E0B"
  danger: "#DC2626"
  info: "#2B00FF"

  # Translucent borders / dividers
  border-on-light: "rgba(0, 0, 0, 0.4)"
  border-on-dark: "rgba(255, 255, 255, 0.4)"
  border-subtle: "rgba(255, 255, 255, 0.1)"
typography:
  display-xl:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 100px
    fontWeight: "900"
    lineHeight: 0.95
    letterSpacing: 0.01em
  display-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 64px
    fontWeight: "900"
    lineHeight: 1
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 48px
    fontWeight: "700"
    lineHeight: 1.05
  headline-md:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 32px
    fontWeight: "700"
    lineHeight: 1.15
  body-lg:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 18px
    fontWeight: "500"
    lineHeight: 1.625
  body-md:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 1.625
  body-sm:
    fontFamily: Geist, system-ui, sans-serif
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 1.5
  serif-editorial:
    fontFamily: Source Serif 4, ui-serif, serif
    fontSize: 20px
    fontWeight: "400"
    lineHeight: 1.6
  mono-label:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 14px
    fontWeight: "700"
    lineHeight: 1.4
    letterSpacing: 0.25em
  mono-button:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 16px
    fontWeight: "700"
    lineHeight: 1
    letterSpacing: 0.1em
  mono-xs:
    fontFamily: Geist Mono, ui-monospace, monospace
    fontSize: 12px
    fontWeight: "700"
    lineHeight: 1.2
    letterSpacing: 0.1em
rounded:
  none: 0px
  sm: 0.25rem
  DEFAULT: 0.5rem
  lg: 0.5rem
  xl: 0.75rem
  2xl: 1rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  card-gap: 16px
  block-gap: 32px
  container-padding: 24px
  section: 128px
  hero-min-height: 100dvh
  container-max: 1280px
components:
  hero-section:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-surface-inverse}"
    padding: 128px 24px
  light-section:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body-text}"
    padding: 128px 24px
  dark-section:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-surface-inverse}"
    padding: 128px 24px
  hero-display:
    textColor: "{colors.on-surface-inverse}"
    typography: "{typography.display-xl}"
  section-label:
    textColor: rgba(255, 255, 255, 0.5)
    typography: "{typography.mono-label}"
  section-label-on-light:
    textColor: rgba(0, 0, 0, 0.5)
    typography: "{typography.mono-label}"
  body-on-dark:
    textColor: "{colors.on-surface-inverse}"
    typography: "{typography.body-md}"
  body-on-light:
    textColor: "{colors.body-text}"
    typography: "{typography.body-md}"
  button-primary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.mono-button}"
    rounded: "{rounded.none}"
    padding: 16px 32px
  button-primary-hover:
    backgroundColor: "{colors.on-surface-inverse}"
    textColor: "{colors.primary}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.on-surface-inverse}"
    typography: "{typography.mono-button}"
    rounded: "{rounded.none}"
    padding: 12px 24px
  button-outline-hover:
    backgroundColor: "{colors.on-surface-inverse}"
    textColor: "{colors.secondary}"
  button-tab:
    backgroundColor: transparent
    textColor: rgba(255, 255, 255, 0.5)
    typography: "{typography.mono-xs}"
    rounded: "{rounded.none}"
    padding: 6px 12px
  button-tab-active:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.on-surface-inverse}"
    typography: "{typography.mono-button}"
    padding: 0 0 4px 0
  research-drawer:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.mono-xs}"
    rounded: "{rounded.none}"
    width: 56px
  research-drawer-expanded:
    width: 210px
  dropdown-menu:
    backgroundColor: "{colors.surface-deep}"
    textColor: "{colors.on-surface-inverse}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-photo:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-surface-inverse}"
    rounded: "{rounded.xl}"
    padding: 24px
  card-modal:
    backgroundColor: "{colors.on-surface-inverse}"
    textColor: "{colors.body-text}"
    rounded: "{rounded.xl}"
    padding: 24px
  callout-tip:
    backgroundColor: rgba(0, 0, 0, 0.03)
    textColor: "{colors.body-text}"
    rounded: "0 0.5rem 0.5rem 0"
    padding: 16px 20px
  callout-warning:
    backgroundColor: rgba(245, 158, 11, 0.1)
    textColor: "{colors.warning}"
    rounded: "0 0.5rem 0.5rem 0"
    padding: 16px 20px
  callout-danger:
    backgroundColor: rgba(220, 38, 38, 0.1)
    textColor: "{colors.danger}"
    rounded: "0 0.5rem 0.5rem 0"
    padding: 16px 20px
  callout-success:
    backgroundColor: rgba(22, 163, 74, 0.1)
    textColor: "{colors.success}"
    rounded: "0 0.5rem 0.5rem 0"
    padding: 16px 20px
  divider-on-dark:
    backgroundColor: rgba(255, 255, 255, 0.4)
    height: 0.5px
  divider-on-light:
    backgroundColor: rgba(0, 0, 0, 0.4)
    height: 0.5px
---

## Overview

Barnacle Labs is a UK-based enterprise AI consultancy. The visual system is built to feel like the work itself: pragmatic, opinionated, and unafraid of high contrast. The brand promise — *"breakthroughs, not buzzwords"* — is encoded directly into the design language.

The system rests on three deliberate tensions:

- **Three background registers in rotation** — cream paper `#FAF6F1` for editorial (essays, case studies, "who we are"), saturated electric blue `#2B00FF` for declared identity (hero, footer, manifesto), near-black `#1A1A1A` for focused / cinematic moments (photo sections, demos, video stages). Pages are *composed* between these three — the bold flips between them are how the page paces itself and keeps the reader engaged. A page that runs one colour through three sections in a row goes flat; alternation is dynamism.
- **Two typographic voices** — Geist (humanist sans) is the *content voice*: taglines, headlines, body copy — what the brand says *to* a reader. Geist Mono is the *system voice*: nav, buttons, badges, captions, section labels, metadata strips — anywhere the page is *labeling, locating, or operating itself*. The split is what makes the brand read as a working interface rather than a marketing surface; a pitch deck speaks in one voice, a working system has two.
- **Sharp edges with one softening device** — most surfaces have no border-radius at all. **Cards are the one exception** — they take `rounded-lg` / `rounded-xl` specifically to soften pages where the rest of the geometry would otherwise read as relentlessly sharp. The contrast is the point: because the rest of the system stays square, the softness reads as deliberate rather than decorative. (Modals and dropdowns also carry a radius, but as overlay surfaces they sit outside the flat-page rule.)

The intended emotional response is *credibility through specificity*: a CTO scanning the homepage should immediately read "engineers" rather than "agency".

## Colors

The palette is small on purpose. Two brand colors do the heavy lifting; everything else supports.

- **Primary — Electric Blue (`#2B00FF`)** is the brand's defining note. It owns the hero, the footer, "who we are", and any other moment of declared identity. It is never used as a small accent — when it appears, it commits the whole section.
- **Secondary — Signal Orange (`#FF4200`)** runs at **two scales** that work together:
  - **Loud orange** — solid orange *fills*: the primary CTA, the right-edge Research drawer, the reverse face of case-study flip cards, badges, large attention-grabbing surfaces. **This is the form that must stay scarce.** One or two per screen at most; if loud orange shows up three times in a single view, it's competing with itself and the attention layer collapses.
  - **Quiet orange** — small mono *accents*: the `//` lead-in glyph on list bullets, section-role tags (`// MAJOR`, `// CONNECTION`, `// SCALE & CROP`), type specimen role labels (`Display-XL`, `System-Label`), the brand mark underscore. These are part of the **system-voice typographic register**, not the attention layer. They can repeat as often as the system needs — twenty quiet orange marks on a page does not feel "competitive" in the way two loud orange blocks do, because the eye reads them as *typographic colour* (like an italic or a small caps), not as *signals*.

  The two scales coexist because they operate at different visual frequencies. Loud orange is a *single block* the eye locks onto; quiet orange is a *granular speckle* the eye reads as part of the type. Treating them as the same colour (and so subject to the same scarcity rule) is what creates the apparent contradiction — they're the same hex, but functionally different elements.
- **Surface — Cream Paper (`#FAF6F1`)** is the default page background and the canvas for editorial and trust-building sections. It softens what would otherwise be an aggressive palette and gives the brand its warmth.
- **Surface-deep (`#1A0099`)** appears as elevated overlay on top of the primary blue (notably the nav dropdown). **Primary-deep (`#2000CC`)** fills the rotating logo behind the hero, where a subtler darker blue is needed.
- **Semantic colors** are used only inside blog callouts (tip / warning / danger / success).
- **Line colours** are part of the palette, not a separate tier. Lines are always black or white at variable alpha — never a true colour, never coloured rules. Three opacity tiers form the divider language: `rgba(0,0,0,0.4)` (or `rgba(255,255,255,0.4)` on dark) for **major** dividers between sections, type specimens, and component cards; `rgba(0,0,0,0.1)` for **subtle** dividers between adjacent grid cells; `rgba(0,0,0,0.08)` for **in-list** dividers between items inside a card. See *§ Lines* for the full system and rules.
- **Functional washes** — `rgba(255, 66, 0, 0.04)` (orange) and `rgba(43, 0, 255, 0.04)` (blue) — mark a single canonical / active / brand-chosen item **inside a list-like or row-flow context where the surrounding structure is otherwise quiet** (hairline dividers, no bold outlines, no fills, no other accent colour). Their entire job is to add a faint tone of "this one" to a structure that would otherwise have *no* visual indicator at all. They are the only documented use of tinted brand colour outside callouts.

  The opacity is calibrated specifically. At ~4%, the wash is visible enough that the eye registers "this row is different" but faint enough that it doesn't compete with content; below 3% it disappears, above 6% it reads as a tint and breaks the brand's "commit or absent" colour rule.

  **Where washes belong:**

  - Comparison ladders showing several values, with the brand-chosen one highlighted (e.g. the leading / tracking ladders in the type specimen).
  - Lists where one item is the canonical answer, current selection, or active state — and the list itself is row-flow with hairline dividers, not bold cards or buttons.
  - Pricing / option tables where one column is "recommended."

  **Where washes do not belong:**

  - **Tabs, buttons, badges, navigation** — these already have a bold-contrast active pattern (orange fill, hover colour swap, animated underline). Adding a wash duplicates the signal and weakens both.
  - **Sections, panels, cards-as-a-whole** — too large a surface for a 4% wash; reads as decorative branded fill rather than functional indicator.
  - **Anywhere already marked** with an orange `_`, orange label, orange border, or any other strong attention signal — the wash becomes redundant noise.

  **Strict rules:**

  - Washes are functional only, never decorative.
  - One wash per component. If three rows in a list need highlighting, the design is wrong — washes mark *the* one, not a category.
  - Orange wash is the default. Blue wash is reserved for the rare case where orange would visually clash with surrounding orange marks.
  - The wash is the *only* indicator the row needs. If it's pulling its weight, the row probably also has an orange label or `(brand)` tag — that pairing is fine. But the wash never appears alongside a bold orange fill, border, or stripe in the same component.

Contrast targets: large display type on `#2B00FF` uses pure white. Body copy on cream uses near-black `#111827`. Muted secondary text on blue uses `rgba(255,255,255,0.5)`.

## Typography

The brand has **two voices** that run in parallel on every page, plus a third reserved for long-form editorial.

- **Content voice — [Geist](https://vercel.com/font?type=sans) (humanist sans).** This is the brand speaking *to* a reader. Display type and headlines sit at weight 700–900: hero displays scale fluidly (`9vw` on mobile, capped at ~100px on desktop) at a tight 0.95 line-height; internal headlines run weight 700 at 32–48px. Body copy is the same family at 16–18px, weight 400–500, with a generous 1.625 line-height. Headlines and body share Geist — only the weight changes — so whatever the page is *saying*, it is saying in one continuous typographic register.

  **Stylistic set: "Rounded dot" (`ss08`) is enabled globally** on Geist Sans. The set rounds the tittles on `i` and `j`, the period (`.`), the middot (`·`) used in metadata strips, `?`, `!`, `:`, `;`, and the dotted accents on Ä / Ë / Ö / Ï / Ü — softening the geometric severity of the default Geist letterforms. Without it the dots are square and the page reads as aggressively engineered; with it, the page keeps the engineering geometry but breathes a little. Apply with `font-feature-settings: "ss08" 1;` set on `<html>` so the cascade carries everywhere Geist Sans is used. The set does **not** apply to Geist Mono — mono keeps its sharper terminals.

  **Implementation note:** ss08 is only available when the *full* Geist font file is loaded. The [`geist` npm package](https://www.npmjs.com/package/geist) (used in the Next.js app via `geist/font/sans`) ships the variable woff2 with the complete GSUB table including all stylistic sets. Source font files: [vercel/geist-font releases](https://github.com/vercel/geist-font/releases) · official font pages: [Geist Sans](https://vercel.com/font?type=sans) · [Geist Mono](https://vercel.com/font?type=mono). **Google Fonts subsets Geist and strips the stylistic-set features** — loading Geist via `fonts.googleapis.com` will silently fall back to the square-dot default no matter what `font-feature-settings` you set. Self-host the npm package's `Geist-Variable.woff2` (or use the npm import) when ss08 needs to work outside the Next.js app — including on the static `/brand` page in `public/`.

- **System voice — [Geist Mono](https://vercel.com/font?type=mono).** This is the page *labeling, locating, and operating itself*. Anywhere the type is doing an interface job rather than carrying meaning, it goes to mono: navigation, buttons, badges, captions, section labels, hero metadata strips, footer chrome, dataviz axes, status text. Always uppercase, always weight 700, always wide-tracked (`0.1em` on buttons, `0.25em` on labels). The wide tracking is non-negotiable — it is what makes the mono read as *system-set* rather than *content-set*; tightening it kills the effect. The two-voice split is the brand's defining tension: a pitch deck speaks in one voice; a working system has a content register and a UI register, and Barnacle's brand mimics that.

- **Editorial / human voice — [Source Serif 4](https://adobe-fonts.github.io/source-serif/)** at 20–22px, weight 400, line-height 1.6. Geist is the brand speaking *to* a reader; Geist Mono is the system labeling and operating itself; Source Serif 4 is the **human reading voice** — what the page sounds like when a person is speaking through it, or when the reader is settling in for an extended read. Where it's used:

  - **Long-form article body** — blog posts (`/blog/*`), research paper-of-the-week summaries (`/research/paper-of-the-week/*`), and any extended editorial content where the reader is committing to several minutes of focused reading. The serif slows the eye in a way Geist body copy doesn't.
  - **Pull-quotes and attributed testimonials** — case-study quotes set in italic serif, separating the human voice of a customer from the surrounding marketing prose. The italic + serif pairing reads as *quoted speech*, not body copy.
  - **User-authored content** — chat user messages, comments, anywhere a real person's words appear *inside* the system. Serif distinguishes human input from the mono system voice and the Geist UI prose around it.
  - **Display-scale serif for soft, declarative pages** — the rare moments (a /sorry / status page, a memorial, a single-statement landing) where the page wants to feel quiet and considered rather than confident or operational.

  Where it does **not** belong: marketing pages, hero taglines, section headlines, capability blocks, navigation, buttons, or any UI surface. If the page is *talking at* the reader, it's Geist. If the page is *the system labeling itself*, it's Mono. Serif is reserved for *a person speaking through the page* — using it elsewhere blurs the three-voice system.

  Source: [adobe-fonts.github.io/source-serif](https://adobe-fonts.github.io/source-serif/) · GitHub: [adobe-fonts/source-serif](https://github.com/adobe-fonts/source-serif) · designed by Frank Grießhammer at Adobe Type, open-source under the SIL Open Font License.

### System-voice signatures

The mono register has three signature treatments. Each one is the page diegetically presenting itself as something **built**, not something pitched.

1. **`// ` code-comment lead-in.** Section labels and metadata strips open with a double-slash: `// AI FOR ENTERPRISE`, `// PRIMARY · #2B00FF`, `// VISUAL IDENTITY FOR`. The mark is borrowed from C-family comment syntax — the page annotating itself. It is part of the type, not decoration; it does not appear without the mono register behind it. (`[ LABEL ]` brackets are an alternate form for the same job.)

2. **`01 / 02 / 03` zero-padded section index.** Long pages carry a numeric index on major sections — `// 01 · COLOR`, `// 02 · TYPOGRAPHY`, `// 03 · COMPONENTS`. Two-digit zero-padded numerals (not `1.`, not `One`), separated from the label by a middot or em-space. The convention is borrowed from CLI step lists, changelog entries, and chapter markers — it tells the reader the page has *steps*, not just headings. One numbering scheme per page.

3. **`[ PRESS ]` bracket affordance.** A dev-flavoured alternate for buttons and inline interactive prompts: `[ PRESS ]`, `[ RUN ]`, `[ RESET ]`, `[ ESC ]`. The square brackets read as a keyboard or terminal cue and reinforce the engineering register. Use it for secondary or playful interactive moments — playgrounds, demos, code-adjacent pages, footer utilities — alongside, not in place of, the primary `#FF4200` block CTA. The bracket form would weaken a marketing-page hero CTA; it earns its keep where the page already feels like an interface.

### Inverted word

A hallmark of the brand: **a single word (or short phrase) inside a title is wrapped in a coloured block, inverting from the surrounding type**. Blue block + white text against black-on-cream surrounding type creates a small typographic stamp that anchors the title, gives every page a recognisable visual rhythm, and signals "this is a Barnacle page" before you've read a word.

The pattern shows up in three contextual forms:

- **Blue inverted (default)** — `bg-brand-blue text-white` on cream / white pages. The dominant form, ~95% of uses. Page titles (`Welcome — about US`), section labels (`// EXAMPLES`, `// REFERENCES`), and inline emphasis inside body copy.
- **White inverted on orange** — `bg-white text-brand-orange` on orange sections. The contextual reverse: when the surface is orange, the white-on-orange inversion preserves the *idea* of inversion while keeping clean contrast.
- **Orange inverted (rare)** — `bg-brand-orange text-white` on cream / white. Reserved for moments that want extra visual heat (manifesto-flavoured headers, the "WHO" in "Who We Are"). Quiet-orange's loudest sibling — used sparingly.

Geometry:

- **Square corners** — never rounded. The block is uncompromisingly geometric; rounding it turns it into a button or a pill, both of which it is not.
- **Tight padding** — `px-2 py-1` is the default; `px-3 py-1` when the block stands alone or needs slightly more breathing room.
- **Inline-block** so it flows inside the surrounding text and wraps cleanly.
- **No border, no shadow** — the colour block is the entire treatment.

Where it goes:

- **Page-title accent** — display-scale titles with one word highlighted, usually the most distinctive word in the phrase.
- **Section labels** — short mono-uppercase labels: `// EXAMPLES`, `// REFERENCES`, `// TAKEAWAYS`. The label *is* the inverted word.
- **Inline emphasis** — single words inside body copy when extra rhetorical weight is wanted ("**Opportunity** assessment").

Rules:

- Wrap a *word*, not a phrase. Two-word names (e.g. brand acronyms like `NanCI` or single-token words like `BREAKTHROUGHS`) are fine; sentences are not.
- One inverted word per heading. Two compete; three becomes decoration.
- The block must contrast cleanly with its surface — blue on cream/white, white on orange, orange on cream/white. Putting the blue inversion on a blue section (it disappears) or a dark section (the contrast inverts wrong) breaks the device.
- The pattern is *always* coloured. Don't recreate it as black-on-white or white-on-black — that reads as a print accent, not the brand's signature.

### Outlined display variant

A paired-line technique reserved for hero-scale typography. The **first** line of a two-line hero phrase is set **solid** in the foreground colour; the **second** line is set **hollow** — `color: transparent` with a 1–1.5px `-webkit-text-stroke` in the same hue at roughly 50% opacity. The eye lands on the solid word and reads the outlined word as the *quieter* follow-up, doing emphasis-by-contrast within a single phrase rather than between two competing colours.

On the homepage hero (blue background):

```css
/* line 1 — solid */
color: #FFFFFF;

/* line 2 — outlined */
color: transparent;
-webkit-text-stroke: 1.5px rgba(255, 255, 255, 0.5);
```

On cream-paper heroes (alternate hero pattern), the same technique uses a near-black stroke at ~`1px rgb(55, 65, 81)` with `paint-order: stroke fill;` so the stroke renders cleanly without bleeding into adjacent letters.

Rules:

- **Display scale only.** The technique requires letterforms large enough that a 1–1.5px stroke reads as a deliberate outline, not as fragile or ragged type. Below ~60px it reads as "thin or broken type"; above that it reads as a typographic device. Never apply to body, captions, buttons, or any UI surface.
- **Stroke colour echoes the fill.** The outlined line uses the *same hue* as the solid line at lower opacity — white-50% on blue, slate-50% on cream. Switching to a different colour breaks the effect and reads as a competing element.
- **Solid first, outlined second.** The pattern is always solid → outlined, top-to-bottom. The reverse (outlined → solid) reads as backwards emphasis: the page seems to *quieten* into the second word rather than *building from* the first.
- **One outlined element per page.** This is a hero device. Promoting it to multiple sections strips it of its weight — by the second appearance, the "quieter follow-up" no longer reads as quiet.

### Type scale

The brand's typographic scale is **rough modular, not strict** — sizes were chosen for legibility-at-use, not to honour a typographic ratio. The result is a small set of defined roles, each with a size *range* rather than a single number, and three load-bearing rules that keep the scale from drifting.

| Role | Family | Size | Behaviour |
|------|--------|------|-----------|
| Display-XL | Geist | 56–104px | **Fluid**: `clamp(56px, 9vw, 104px)` |
| Display-LG | Geist | 64px | Static |
| Headline-LG | Geist | 48px | Static |
| Headline-MD | Geist | 32px | Static |
| Body-LG | Geist | 18px | Static |
| Body-MD | Geist | 16px | Static |
| Body-SM | Geist | 14px | Static |
| Editorial-Serif | Source Serif 4 | 20–22px | Static |
| Mono-Button | Geist Mono | 14–16px | Static |
| Mono-Label | Geist Mono | 13–14px | Static |
| Mono-XS | Geist Mono | 9–12px | Static |

**Floors are non-negotiable.**

- **Body never goes below 14px.** Below 14px, Geist body strains the eye at normal viewing distance. Captions, footnotes, fine-print metadata — all hold the 14px floor.
- **Mono never goes below 10px.** Even with the wide tracking the system requires, mono below 10px loses letterform legibility — wide tracking can't rescue sub-10px characters.
- **Display takes fluid scaling, body and mono do not.** Hero displays run `clamp(56px, 9vw, 104px)` so the hero never crops badly on a phone or feels small on a 30″ monitor. Body and mono stay static across all breakpoints — readable bodies don't *want* to scale, because eye-to-screen distance is what dictates body size, not viewport width.

**The scale is rough modular by design.** Strict modular scales (1.25, 1.333, 1.5 ratios) produce mathematically pleasing numbers that often don't read well at use. Body-MD at 16px and Mono-Button at 16px aren't accidentally the same — they're both at 16 because that's the right size for in-flow interactive text on a marketing surface. The scale honours legibility at each role rather than ratio purity, which means roles can share sizes (16/16, 14/14) where they're *meant* to read at the same visual weight.

**Why ranges rather than single values.** Real layouts have edge cases — a slightly larger body on an editorial page, a smaller headline inside a card, a serif at 20 vs 22 depending on column width. The ranges give designers a 2–4px tuning window within a role without breaking the brand. Stepping *outside* the range (a 12px body, a 60px headline) is what breaks the scale.

### Letter spacing and leading

Both tracking (letter-spacing) and leading (line-height) are role-specific and non-negotiable in this system. Defaults are wrong almost everywhere — they have to be set deliberately.

| Role | Letter-spacing | Line-height |
|------|----------------|-------------|
| Display (Geist 56–104px, weight 900) | `0.01em` | `0.95` |
| Headlines (Geist 32–48px, weight 700) | `0` | `1.05`–`1.15` |
| Body Geist (14–18px) | `0` | `1.625` |
| **Mono buttons (14–16px)** | **`0.10em`** | `1` |
| **Mono labels (13–14px)** | **`0.20–0.25em`** | `1.4` |
| Mono xs (9–11px) | `0.10–0.20em` | `1.2` |
| Brand mark `BARNACLE_LABS` | `0.15–0.20em` | inherit |
| Editorial serif (20–22px) | `0` | `1.6` |

**Why mono runs wide-tracked.** Geist Mono at default tracking is built for code editors — letters sit in fixed-width columns and the spacing assumes a sentence-case reading flow. Set the same mono uppercase at default tracking and it collapses into a wall: letters touching, the register flattening into a generic "small caps" look. Wide tracking is what gives the mono its **system-voice** quality — each letter reads as a discrete glyph, like a character in a CLI prompt or a code label. Tracking scales with role: `0.10em` on buttons (single-line, in-flow text where over-tracking would break readability), `0.20–0.25em` on labels and section markers (where the typographic colour itself is doing the work and the wider track reads as deliberately *system-set*). **Tightening any of these is the fastest way to lose the system-voice register**, so the values are non-negotiable.

**Why display runs tight-leaded.** Multi-line hero phrases (`BREAKTHROUGHS / NOT BUZZWORDS`) need to read as a single typographic unit, not two stacked sentences. Line-height `0.95` (slightly less than 1) collapses the gap between lines just enough that the eye reads the phrase as one mark. Loose leading at display scale reads as airy and marketing-flavoured; tight leading reads as chiselled.

**Why body runs generous-leaded.** Geist body at 1.625 is the readable sweet spot for long-form. Anything tighter feels cramped; anything looser starts to read as a draft. Body never tracks — adding letter-spacing to body collapses readability for diminishing visual return.

Other things to remember:

- Mono never appears sentence-case (the wide tracking is calibrated to uppercase letterforms; lowercase mono with the same tracking reads as broken).
- Mono never goes below 10px — at smaller sizes, even `0.20em` tracking can't keep the letterforms legible.
- Body copy never goes below 14px.
- Display type uses a small *positive* letter-spacing (`0.01em`) to add just enough air at heroic scale. The default — `0` — reads as cramped at 100px.

## Layout

The grid is calm. The drama is in the type and color, so the layout stays predictable.

- **Container width** is `max-w-5xl` (64rem / 1024px) for editorial sections and `max-w-6xl` (72rem / 1152px) for grids and trust-building blocks. Both centred with `mx-auto`.
- **Section rhythm** is `pt-32 pb-32` (128px top and bottom) between major sections. Internal blocks step down through `mb-12` (48px), `mb-8` (32px), `gap-4` (16px).
- **Horizontal page padding** is a flat `px-6` (24px) at all breakpoints. The page does not breathe wider on desktop; the cream background carries the whitespace.
- **Asymmetric two-column** is the workhorse content layout: a 30% left column (label + heading) sitting next to a 70% right column (body copy). Stacks on mobile.
- **Logo grids** use `auto-fit` with a fixed `190px` cell and butted (`gap-0`) columns to read as a contact sheet rather than a list.
- **Section dividers** are hairlines — see *§ Lines* for the full divider system.
- **Hero height** is `100dvh` (dynamic viewport height) so mobile browser chrome does not crop the tagline.

## Lines

Lines do *structural* work in this system, not decoration. Every visible divider is a hairline (`0.5px`) in one of three opacity tiers — never thicker, never coloured beyond black or white at variable alpha. The line treatment is part of the engineering register: CLI output uses rules to separate steps, technical documentation uses rules to mark sections, code uses rules above tables and headings. Pitch decks tend to use thick coloured rules, decorative borders, and chunky card outlines. The Barnacle line system rejects all of that.

The three tiers:

- **Major divider — `0.5px` at `rgba(0,0,0,0.4)`** (light) / `rgba(255,255,255,0.4)` (dark). The strongest hairline. Sits above section labels (`// 01 · COLOR`), between type specimens, above each component card, and at the top of the Do's & Don'ts grid. These are the rules the eye uses to navigate the page.
- **Subtle divider — `0.5px` at `rgba(0,0,0,0.1)`** (light) / `rgba(255,255,255,0.1)` (dark). Used between adjacent cells in a grid — the Do's column and Don'ts column split, the boundary between two sibling rule blocks, the line between two cards in a comp-grid. Present enough to mark the boundary, quiet enough not to compete with content.
- **In-list divider — `0.5px` at `rgba(0,0,0,0.08)`** (light) / `rgba(255,255,255,0.08)` (dark). Used between adjacent list items *within* a card — bullet rows in the Do's list, sub-items inside a tile. Whisper-quiet — the rhythm of the list does most of the work; the line just keeps the eye from skipping rows.

Rules:

- Lines are always `0.5px`. Never `1px`, never `2px`, never thicker.
- Lines are always black or white at variable alpha. No coloured rules. The `#FF4200` left-border on callouts is the only exception, and it is a *semantic stripe*, not a divider.
- Lines mark transitions; they do not decorate. If a line isn't separating two things, it shouldn't be there.
- No drop shadows, no gradients, no double-rules, no dashed or dotted patterns. Just hairlines.
- The 4px coloured callout stripe and the hairlines are the system's only border treatments. Anything chunkier reads as a different brand.

## Section rhythm

The site is built to feel like a working surface, and a working surface stays *alive*. The way we keep the reader awake is **bold background contrast between sections** — never a gradient transition, never a tint of a previous section, never two adjacent sections in the same colour. Pages move between three registers:

- **Cream `#FAF6F1`** — the editorial canvas. Long-form copy, case studies, services, capability blocks, anything that needs to be readable for more than a beat.
- **Electric Blue `#2B00FF`** — the declared-identity register. Hero, footer, manifestos, "who we are", any moment that should feel high-stakes or carry the brand's weight.
- **Near-Black `#1A1A1A`** — the focused / cinematic register. Photo sections, demos, video stages — anywhere we want to dim the room and pull the reader's eye to a single object.

The principle is **rhythm through contrast, not transition**. Every major section break is a hard, edge-to-edge background flip — no gradient blends, no soft fades, no overlap. The reader's eye lands on a new colour, registers a new register, and re-engages. A page that runs cream-cream-cream goes flat by the third section; a page that flips cream → blue → cream → dark → cream → blue feels like it's moving even when the content isn't. **The bold colour changes signify dynamism**: the brand isn't just *talking about* engineering pace, the page itself paces.

Rules:

- Sections own the full viewport width edge-to-edge. No "card on a different background" simulating a section break — the section *is* the colour.
- Two adjacent sections never share a background. If you find yourself wanting two cream sections in a row, the second one is probably the start of a new logical block and should flip.
- Don't tint, mix, or transition. The colour the section starts on is the colour it ends on.
- The hero is always blue. The footer is always blue. What goes between is composed for rhythm.
- Cream is the workhorse and will appear most often. Blue and dark are scarce by design — using either too much makes them stop signifying.

## Elevation & Depth

This system is intentionally flat. Depth is communicated by **color blocking and borders**, not by shadow.

- **Page → section** transitions are signalled by a full-bleed background flip (cream → blue) and a hairline divider, never by a drop shadow.
- **Modal / dialog** is the one place where shadow earns its keep: `shadow-xl` on dropdowns, `shadow-2xl` on the case-study modal and chat windows. These are also the surfaces that pick up `rounded-xl` / `rounded-2xl`, so radius and elevation appear together.
- **Hover elevation** is expressed through color or border — buttons swap fill (orange → white), nav links draw an underline (`scale-x-0` to `scale-x-100`), tabs swap from transparent to solid orange. No transform-based "lift".
- **Translucent overlays** are used very sparingly. The hero stack uses an absolutely-positioned `bg-[color]/95` panel to layer text above an animated SVG without losing legibility. There is no blur or backdrop-filter on marketing surfaces.
- **Subtle text glow** (`text-shadow: 0 0 20px rgba(255,255,255,0.2)`) is used on a small number of light-on-blue headlines to lift them off the saturated background.

## Shapes

The shape language is geometric and committed.

- **Default radius is zero.** Sections, hero blocks, primary CTAs, outline buttons, the research drawer, tab buttons, logo cells, badges, inputs, dividers, and section labels are all square.
- **Cards are the one in-page exception.** Use `rounded-lg` (8px) for inline content blocks — testimonials, stat tiles, list items, anything sitting inside a flow of body copy. Use `rounded-xl` (12px) for larger feature cards or any card that needs to feel like a contained surface against a busy section (notably photo / testimonial cards on `#1A1A1A`, where the soft corner also separates them from the surrounding flat color). The radius is doing one specific job: softening the page where it would otherwise be relentlessly sharp. Without the surrounding square geometry, the softness loses its meaning, so do not extend radii to buttons, tabs, badges, inputs, sections, or dividers.
- **Modals and dropdowns** carry a radius too — `rounded-lg` for nav dropdowns, `rounded-xl` / `rounded-2xl` for case-study and chat modals — but they are overlay surfaces, not part of the in-page rule.
- **Borders** are 1–2px and high-contrast: `border-2 border-white` for outline buttons on blue, `border border-[#FF4200]` for orange-edged variants. The system avoids 4–8px chunky borders.
- **Iconography** is line-based, monolinear, paired with text rather than presented standalone.

## Components

### Buttons

- **Primary CTA** — solid `#FF4200` block, white mono-button text, square corners, `px-8 py-4`. Hover swaps the fill to white and the text to primary blue. This is the most important interactive element on the marketing site; do not weaken it with a radius or a gradient.
- **Outline / ghost** — transparent fill, 2px white border, white mono-button text. Hover fills white and recolors text to either primary blue or secondary orange depending on what's adjacent. Used for secondary actions on dark sections.
- **Bracket affordance — `[ PRESS ]`** — the third button form, in the system-voice register. Mono text wrapped in literal square brackets with an interior em-space (`[ PRESS ]`, `[ RUN ]`, `[ RESET ]`). May appear as plain text with a hover colour shift, or with a thin 1px border. Used for secondary actions in playgrounds, demos, footer utilities, and code-adjacent pages — anywhere the page already wants to read as an interface. **Never replaces the primary CTA**; it's a supporting register, not the headline action.
- **Tab / toggle** — small `px-3 py-1.5` mono-xs label inside a 1px border. Inactive: transparent on blue with `rgba(255,255,255,0.5)` text. Active: solid orange with white text. Used for in-section filters.

### Navigation

The top nav uses mono-button typography in white, no underline at rest, and an animated bottom underline on hover. The dropdown menu sits on `#1A0099` with `rounded-lg` and `shadow-xl` — one of the few places shadow is allowed.

### Wordmark

The brand wordmark is a two-part lockup: the **Barnacle logo** (`/images/barnacle-logo-red.svg`) on the left, paired with the **brand mark** `BARNACLE_LABS` on the right. The logo is the radial sunburst/barnacle form in `#FF4201` (within rounding of the brand `#FF4200`) — a 12-pointed radiating mark with a hollow centre, functioning as both icon and brand seal.

The brand mark text is set in **Geist Mono**, weight 700, **uppercase**, letter-spaced `0.2em`, with one signature treatment: the underscore `_` rendered in `#FF4200` orange while the surrounding letters take their context colour (white on blue, near-black on cream).

Why uppercase: the brand mark sits comfortably inside the system-voice register the rest of the brand commits to (mono + uppercase + wide tracking). The whole top nav speaks one typographic register; the wordmark fits in rather than fighting it. Title case would read as a brand name dressed up in code conventions; uppercase commits to the engineering register and lets `BARNACLE_LABS` read as what it is — a UPPERCASE_SNAKE_CASE identifier. The orange `_` is the part that *makes* it the brand mark; the casing should match the system around it.

Why the orange `_`:

- **It connects the words.** `BARNACLE LABS` with a space reads as two words. `BARNACLE_LABS` reads as a single, system-formatted identifier — the kind of `UPPERCASE_SNAKE_CASE` symbol you'd see on an environment variable, system constant, or feature flag. The underscore *binds* the two halves into one mark.
- **It balances the logo.** The orange logo on the left and the orange `_` in the centre of the text form a visual anchor pair, distributing the brand's accent colour across the whole lockup rather than letting the logo carry it alone. Without the orange underscore, the wordmark feels logo-heavy; with it, the eye reads the lockup as one balanced object.

Rules for the lockup:

- The brand mark is **always uppercase**: `BARNACLE_LABS`. Never `Barnacle_Labs`, never `BARNACLE LABS` (with a space), never `barnacle_labs` (lowercase).
- The underscore is **always `#FF4200`**, regardless of the surrounding text colour. This is non-negotiable — the orange `_` is the brand mark's signature.
- The logo always renders in solid orange. Never tinted, never gradiented, never on a contrasting fill plate.
- Logo size scales with the brand mark's cap-height — typically `20–24px` against 14px mono text. Larger logos may stand alone (favicon, splash, social avatar).
- Spacing between logo and brand mark is `10–12px` — tight enough to read as a single lockup, loose enough that the logo doesn't visually attach to the first letter.
- The brand mark fits naturally inside system-voice metadata strips: `// BARNACLE_LABS · DESIGN SYSTEM · v.ALPHA`. The orange `_` is what differentiates the brand mark from any other uppercase mono label around it.
- The logo may appear without the brand mark in tight spaces (favicons, social avatars, tab marks). The brand mark text may appear without the logo only in metadata strips and inline copy; at default scale they always travel together.

#### Oversized logo treatment

On primary marketing heroes, the logo also exists in a **hero-defining oversized form** — `900–1200px` on large screens, large enough that it becomes the dominant compositional element rather than a wordmark companion. The treatment is reserved for the homepage and a small number of declared-identity surfaces; promoting it elsewhere strips it of its weight.

What changes at this scale:

- **Colour shifts to `#2000CC`** (primary-deep), not the brand orange. The dark cobalt sits *underneath* the bright `#2B00FF` background as a subliminal tonal mass — present, not loud. Orange at this scale would shout; cobalt holds the composition.
- **The logo rotates with scroll** at ~`0.15× scrollY`. The 12-pointed sunburst slowly turns as the page is read. Movement is gentle and continuous — it animates the brand mark itself rather than page chrome.
- **The logo parallaxes vertically** at ~`0.8× scrollY`, slipping out of view as the reader scrolls into the next section. The hero hands content off to whatever follows through this motion, not a hard cut.
- **The logo bleeds half off-canvas to the right** so it reads as a fragment of something larger rather than a centred mark. The composition is asymmetric on purpose — the content sits in the left half, the cobalt mass anchors the right.
- **Z-index sits between background and content** (zIndex 2). Headlines, body copy, and the primary CTA sit on top of the oversized mark; the rotating SVG is the *backdrop*, not the foreground.

The cumulative effect: the brand mark *is* the hero composition. The page doesn't decorate around it; the page is *built around it*. This is the most committed use of the logo in the system and the only place it is allowed at this scale.

### Hero

Hero is its own component pattern: full-height blue surface, large rotating SVG logo behind the content (filled with `#2000CC`), and the following stack from top to bottom:

1. **Top nav strip** — wordmark on the left, secondary mono link / utility on the right.
2. **Mono section label** — leading with `// ` (e.g. `// VISUAL IDENTITY FOR`, `// AI FOR ENTERPRISE`).
3. **Display-xl tagline** — split across two lines, with the second line typically using `#FF4200` for the accented phrase.
4. **Body copy** at body-lg.
5. **Primary CTA** — a `#FF4200` block button, mono uppercase, square corners. Required on marketing-page heroes; spec / docs / about-page heroes may substitute the metadata strip below for a softer affordance, but the CTA is the default.
6. **Hero metadata strip** — a horizontal grid of small mono items (typically 4 columns), hairline-separated from the body above, each item leading with `// ` and stating a fact about the page (`// PRIMARY · #2B00FF`, `// SECONDARY · #FF4200`, `// LAST UPDATED · 2026-04-25`). The strip reinforces the system-voice register and turns metadata into part of the visual composition rather than supplementary chrome.
7. **Research drawer** — right-edge `#FF4200` panel, fixed at the viewport top-to-bottom of the hero. Collapsed: 56px wide with vertical mono caption (`READ_THE_SPEC →`, `RESEARCH →`). Expanded: 210px on hover, with a `cubic-bezier(0.16, 1, 0.3, 1)` ease over `0.6s`. The drawer is part of the hero, not chrome.

### Cards

Cards are the only in-page surface that carries a radius. The rule is deliberate: in a system that is otherwise square edge-to-edge — sections, buttons, tabs, badges, dividers — a rounded card reads as a *contained, finished* object that the eye can rest on. Use the radius to soften an otherwise sharp page; do not use it to decorate.

- **`rounded-lg` (8px)** — inline content cards: testimonials, stat tiles, list items, anything sitting inside a flow of body copy on cream paper.
- **`rounded-xl` (12px)** — feature cards and contained surfaces: photo / testimonial cards on `#1A1A1A` (where the soft corner also separates them from the surrounding flat colour), and any card that needs to read as its own surface against a busy section.

Two card patterns dominate. **Trust cards** are the deliberate exception to the exception: square, gap-less logo cells in a `190px` auto-fit grid — they're a contact sheet, not a card surface, and the negative space between adjacent edges does the work of separation. **Photo / testimonial cards** are `rounded-xl` blocks on `#1A1A1A` with white type for attributed quotes.

### Callouts

Blog post callouts (tip, warning, danger, success) carry a 4px left border in the semantic colour and a `rgba(...)/0.05–0.1` tinted fill. The radius is **asymmetric** — square on the left (`0`), `rounded-lg` (8px) on the right. This is non-negotiable: a rounded left edge turns the coloured semantic bar into a soft pill tab, which is the tired Tailwind / shadcn-ui cliché the brand explicitly rejects. The left bar must read as a flat, hard-edged semantic stripe; the right round still softens the body text. They are an editorial pattern — they belong inside long-form content, not on marketing pages.

### Dashboard inner pages

The factory dashboard's Projects, Project and Task story pages use the cream inner page, Geist Mono
labels, 0.5px hairlines and square buttons. Blue marks what waits for a person (the light blue "Your
turn" band, solid blue Answer / Review buttons, the Needs you count); orange marks only crashes, problem
flags and errors; task keys are grey. Step strips are small square boxes; chat messages are 8px cards.
The wiki entry is an outline `.btn` ("Open wiki"), never the solid blue one: blue stays for "your turn".

## Do's and Don'ts

**Do**

- Commit fully when using `#2B00FF`. If a section is blue, the whole section is blue, edge-to-edge.
- Use mono wherever the page is *labeling, locating, or operating itself* — section labels, navigation, buttons, badges, captions, metadata strips, footer chrome. All uppercase, all weight 700, always wide-tracked (0.1em on buttons, 0.25em on labels). Tightening the tracking is the fastest way to lose the system-voice register.
- Lean on the three system-voice signatures: `// ` code-comment lead-ins on labels, zero-padded `01 / 02 / 03` numbering on major sections, `[ PRESS ]`-style square brackets on dev-register affordances. They are part of the type, not optional flourishes.
- Keep the hero CTA visible and in `#FF4200`. It is the highest-priority pixel on the site.
- Default to square corners. Reach for `rounded-lg` / `rounded-xl` only on **cards** (to soften busy sections) and on overlays (modals, dropdowns).
- Use `0.5px` hairlines for all dividers — three opacity tiers (40% / 10% / 8%) carrying major, subtle, and in-list weight. See *§ Lines*. Never thicker, never coloured.
- Compose pages for rhythm. Alternate cream / blue / dark between major sections, edge-to-edge, never two adjacent sections on the same background. The bold flips are dynamism — they keep the reader moving.
- Use a ~4% orange or blue **functional wash** to mark a single canonical / brand-chosen / active row in a list-flow context (comparison ladders, option tables, lists where one item is the answer). One wash per component. Never on tabs, buttons, sections, panels, or cards-as-a-whole — list-flow rows only. See *§ Colors*.

**Don't**

- Don't dilute `#2B00FF` with tints or gradients on sections, panels, or cards-as-a-whole. The brand blue is pure and saturated, or it isn't there. (Two documented functional exceptions: the 4–10% blue tint on info callouts, and the ~4% blue wash for marking active rows in list-flow comparisons. Both are *functional, never decorative* — see *§ Colors*.)
- Don't introduce a third typeface. Geist for display, headlines and body, Geist Mono for UI, Source Serif 4 reserved for editorial accent — that's the system.
- Don't sprinkle the **loud form** of orange — solid orange fills, primary CTAs, drawers, large attention-grabbing blocks. One or two of those per screen is the limit; three is competing with itself. (Small orange accents on mono `//` markers, section-role tags, and the brand-mark underscore are the *quiet* register — they're system-voice typographic colour, not the attention layer, and they can repeat freely. See *§ Colors* for the two-scale split.)
- Don't add drop shadows to marketing surfaces. Depth comes from color blocking, not from elevation.
- Don't soften CTA buttons with a radius. The primary CTA is square. A rounded primary CTA reads as a different brand.
- Don't swap mono for humanist sans, and don't tighten its tracking. Wide-tracked mono *is* the system voice; sentence-case humanist sans on a button breaks the system, and tightened mono collapses into "small caps" and loses the system-set effect.
- Don't put `[ PRESS ]` on a marketing-page hero CTA. Bracket affordances belong to the dev register — playgrounds, demos, code-adjacent pages — not the headline action. The hero CTA is always the solid `#FF4200` block.
- Don't run two adjacent sections on the same background. If you need to, you've found a section break — flip the colour. The break *is* the colour change.
- Don't gradient or tint between sections. Hard, edge-to-edge flips only — no soft fades, no overlay blends.
- Don't round the left edge of a callout (or any element with a coloured left-border accent). The coloured semantic bar must read as a flat, hard-edged stripe — a rounded coloured pill-tab is the Tailwind / shadcn cliché this brand explicitly rejects. Keep the asymmetric `0 / lg / lg / 0` radius.
- Don't use coloured rules, thicker borders, or decorative lines. Lines are always black or white at variable alpha — `0.5px` hairlines only. The 4px `#FF4200` callout stripe is the lone exception and reads as a semantic accent, not a divider.
