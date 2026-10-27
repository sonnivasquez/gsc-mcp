---
name: "GSC MCP — Terminal SEO"
description: "A sober, clear and trustworthy system for Search Console questions and evidence."
colors:
  paper: "#03090f"
  card: "#0b161f"
  ink: "#e8eef4"
  ink-soft: "#a3afbc"
  ink-faint: "#879aac"
  line: "#1b2d3a"
  line-strong: "#304657"
  cobalt: "#1da9ef"
  cobalt-deep: "#70cdff"
  cobalt-wash: "#102b3d"
  ink-on-cobalt: "#06121d"
  bright: "#ffffff"
  panel: "#08141e"
  panel-raised: "#10222f"
  panel-line: "#233a4b"
  panel-soft: "#a9bfd1"
  panel-faint: "#8fa6b8"
  warn-bg: "#0e1c25"
  warn-line: "#304657"
  warn-ink: "#f0cd7e"
  warn-on-dark: "#f0cd7e"
  focus-on-dark: "#e9ecff"
  action-surface: "#d5e6f4"
  action-ink: "#0a1b29"
  action-hover: "#bfdced"
  home-prompt-surface: "#142735"
  home-prompt-ink: "#bdcddc"
  home-button-surface: "#d5e6f4"
  home-button-ink: "#0a1b29"
  home-button-hover: "#bfdced"
  home-row-surface: "#101f2a"
  home-data-ink: "#c5d8e6"
  home-data-muted: "#96adc0"
  home-tool-ink: "#d6e5ef"
  home-conversation-label: "#d1dfe9"
  home-success-surface: "#7bdd99"
  home-success-ink: "#0d2a19"
  home-positive: "#84dc9f"
  home-link-hover: "#99dcff"
  home-badge-line: "#1a3345"
  home-badge-ink: "#b7d0e2"
  home-command-ink: "#d7e4ef"
  home-copy-hover: "#142736"
  home-secondary-hover-line: "#698599"
  home-icon-accent: "#a9d1eb"
  home-client-ink: "#d8e2ea"
  home-trust-code: "#c7d9e7"
  home-hero-glow-a: "#072c4838"
  home-hero-glow-b: "#082a4338"
  home-primary-highlight: "#ffffff70"
  home-chip-surface: "#122531"
  home-numeral-surface: "#112c3e"
  home-close-line: "#244056"
  home-close-surface: "#0b1c29"
  home-close-mark: "#102f43"
typography:
  display:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.2
  page:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "clamp(1.75rem, 2.5vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.2
  headline:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  lead:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  body-compact:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "\"Archivo Variable\", \"Archivo\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  code:
    fontFamily: "\"JetBrains Mono Variable\", \"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "7px"
  md: "9px"
  lg: "10px"
  code: "4px"
  demo: "12px"
  pill: "999px"
spacing:
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-16: "64px"
  space-18: "72px"
  space-24: "96px"
components:
  button-primary:
    backgroundColor: "{colors.action-surface}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.sm}"
    padding: "0px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0px 16px"
    height: "36px"
  button-command-copy:
    backgroundColor: "transparent"
    textColor: "{colors.bright}"
    rounded: "{rounded.sm}"
    padding: "0px 16px"
    height: "44px"
  navigation-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    padding: "8px 12px"
    height: "44px"
  guide-navigation-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    padding: "12px 20px"
    height: "48px"
  command-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  tab-underline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    height: "44px"
    typography: "{typography.label}"
  conversation-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px"
  prompt-bubble:
    backgroundColor: "{colors.home-prompt-surface}"
    textColor: "{colors.home-prompt-ink}"
    typography: "{typography.code}"
    padding: "11px 13px"
  warning-note:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: GSC MCP — Terminal SEO

## Overview

**Creative North Star: "Terminal SEO"**

Terminal SEO makes Search Console work feel inspectable and calm. The homepage and internal guides share the same midnight canvas, cyan signals and ice actions. The guides extend that visual language with clear reading columns, persistent section navigation and terminal-like command panels.

Archivo carries explanation, headings and navigation. JetBrains Mono marks commands, tool names and measured data. Keep prose conversational and readable; reserve monospaced type for material that benefits from a precise, fixed-width shape.

**Key Characteristics:**
- Midnight surfaces with a cyan signal and high-contrast ice actions.
- Archivo for explanation; JetBrains Mono for commands and measurements.
- Clear guide navigation and inspectable evidence close to its explanation.
- Rectangular controls, quiet borders and explicit keyboard focus.

## Colors

Runtime palette values live in `web/src/styles/tokens.css`; this document describes their roles and usage. The shared palette pairs a midnight canvas and ice text with a restrained cyan signal. Ice is the action surface; cyan identifies links, selected steps and active states.

### Primary
- **Cyan Signal** (`cobalt`): links, active tabs and steps, product marks, and the hero's changing agent name. The brighter cyan role is reserved for text on dark surfaces; the tinted role marks supporting surfaces. Text selections use the cyan signal with `ink-on-cobalt` text.
- **Ice Action** (`action-surface`, `action-ink`, `action-hover`): the primary action treatment uses a pale surface with dark text, then shifts to its hover ice tone.
- **Ink on Cyan** (`ink-on-cobalt`): dark text on cyan selections and the home skip-link focus state.

### Neutral
- **Midnight Canvas** (`paper`): the page background across the homepage and internal routes.
- **Raised Midnight Surface** (`card`): code, guide disclosures and conversation examples.
- **Ice Text** (`ink`): primary copy; `ink-soft` and `ink-faint` establish quieter reading and metadata levels.
- **Blue-gray Dividers** (`line`, `line-strong`): separate controls and content without boxing every group.
- **Terminal Surfaces** (`panel`, `panel-raised`, `panel-line`): command output and their header strips; the accompanying `panel-soft` and `panel-faint` roles label them.
- **Bright Surface Text** (`bright`): white text on dark surfaces for client hover states and command output.

### Status and focus
Warnings use `warn-bg`, `warn-line` and `warn-on-dark`; successful or positive sample values use the homepage success roles. Preserve an icon or explicit wording with every status color. The global cyan focus ring changes to the pale `focus-on-dark` role inside dark terminal surfaces.

Homepage aliases in the `home-*` namespace carry the remaining resting states at their exact values: badge edge/text, command code text, copy hover, secondary hover edge, a shared pale icon accent, client resting text, and trust code text. Local atmosphere is also tokenized without rounding: the two hero-glow hex8 tints, the primary top highlight, the overflow/numeral chip surfaces, and the closing-band edge/surface/mark. Exact duplicates resolve to their canonical roles (`panel-raised`, `warn-bg`). The install-workbench card shadow is the composite home-scoped `home-workbench-shadow` token (the workbench renders under `data-home-theme`), preserving its exact `rgba(...)` alpha.

**The Shared Canvas Rule.** Homepage and internal routes use the same semantic canvas, card, text, line and cyan values. The home selector remains for prompt, table and status details that belong to its examples.

## Typography

**Display Font:** Archivo Variable (with Archivo and system sans fallbacks)

**Body Font:** Archivo Variable (with Archivo and system sans fallbacks)

**Label/Mono Font:** JetBrains Mono Variable (with JetBrains Mono and system monospace fallbacks)

**Character:** Archivo is direct and composed, with enough warmth for explanatory material. JetBrains Mono makes commands and numerical evidence easy to scan without making the whole interface look like a terminal transcript.

### Hierarchy

The root uses `100%`: 1rem is 16px at browser defaults and respects user font preferences. Sizes live in `web/src/styles/tokens.css`; use those roles rather than component-specific sizes.

- **Display:** responsive 2.25–4rem, weight 600, homepage hero only.
- **Page title:** responsive 1.75–2rem, weight 600, internal H1.
- **Section heading:** 1.5rem, weight 600, H2.
- **Subheading:** 1.25rem, weight 600, H3 and card titles.
- **Lead:** 1.125rem, weight 400, homepage introduction.
- **Body/navigation:** 1rem; prose weight 400, navigation weight 500.
- **Supporting text/controls/code:** 0.875rem; controls weight 500, text and code weight 400.
- **Caption:** 0.75rem, secondary metadata only.

Use line-height 1.2 for headings, 1.6 for prose/code and 1.4 for labels. Use weights 400, 500 and 600. Archivo serves prose and headings; JetBrains Mono serves commands and data. Keep the same role sizes on mobile; adjust layout and spacing instead.

## Layout

The homepage uses a centered 1120px content container, a 4px-based spacing rhythm and generous separation between use cases. Section padding uses `--home-section-pad` (64px desktop, 40px below 768px); use-case groups use `--home-case-gap` (96px desktop, 72px below 768px), while each case keeps a 20px text/evidence gap on mobile. Keep copy and its evidence together as one task.

Internal documentation uses a centered shell capped at 86rem. At wide widths, the guide rail and page index flank a readable article capped at 52.5rem, with 13.75rem and 12.5rem side columns. Below 1280px, the side rails become native mobile disclosures above the article. The collapse decision reads full-viewport inline size in rem through the scoped `docs-page` container (79.99rem), so enlarged root fonts reach the disclosure layout while the normal breakpoints stay exact. The two critical Latin variable fonts preload from the root head with hash-imported URLs, anonymous cross-origin, and high priority, matching the same faces the CSS already serves. Keep the article at full available width within the shell and retain the existing narrow-screen gutters.

Homepage tools move from four columns to two, then one below 480px. Use-case evidence stacks below 768px. Documentation keeps its article measure and swaps its side navigation to the disclosures described above. Breakpoints in the sidecar reflect the current layout rules; adjust component content for available width rather than device categories.

## Elevation & Depth

The system is flat at rest. Surface tone, thin borders, spacing and typography establish hierarchy; there is no exterior drop-shadow vocabulary beyond the raised install-workbench card. Command panels gain depth from their darker inset surface and header divider. The homepage hero's restrained blue atmosphere is a local radial wash whose two glow tints are tokens, not a surface shadow. The install-workbench card is the deliberate exception: it carries the composite `home-workbench-shadow` token with its exact alpha preserved.

**The Border-and-Tone Rule.** Preserve tonal and border separation before adding any raised treatment.

## Shapes

Use the small, medium and large radius tokens for controls, disclosures and evidence surfaces. The signature form is rectangular with gently softened corners. The homepage demo keeps its local larger radius; prompt bubbles, pills and circular status or step markers remain local shapes with their current meaning.

Borders are quiet and consistent. Underline navigation and tabs; use a rail border for guide navigation and small filled surfaces for disclosures. Avoid enclosing every section in a card.

## Components

### Buttons
- **Shape:** gently softened corners using `rounded.sm`.
- **Primary:** ice surface and dark text; the shared `Button` primitive uses its compact control size by default.
- **Hover / Focus:** the ice surface shifts to its hover tone; a visible cyan outline appears on the page and a pale outline appears on terminal surfaces.
- **Secondary / Copy:** dark surface or transparent terminal-panel surface with a restrained border. The command copy control stays a 44px target and does not become a pill.
- **Recovery wrapping:** docs 404 recovery actions wrap their full labels within the container at automatic height with a 44px minimum.
- **Hero CTA wrapping:** the homepage hero actions reuse the recovery-wrapping treatment so full labels wrap without clipping at 200% root text, keeping the 44px minimum and the normal single-line layout.
- **Workbench wrapping:** the install-workbench note and panel headers give flexible text `min-width: 0` with anywhere wrapping and let header rows flex-wrap, so full pinned metadata and the Copy control stay inside the rounded panels under text enlargement; wide layouts keep the single row.
- **Rotator pause:** the hero's agent-name rotator (four words, 12s cycle, inline-grid reservation) ships an in-page `home-rotator-toggle` action outside the `h1` (44px minimum, `Pause animation` / `Resume animation`, no `aria-pressed`). Pausing pins the fully legible canonical word `Codex.`; the accessible `h1` name stays stable with an `aria-hidden` visual. The loop suspends offscreen or when the document is hidden and resumes on return; the manual choice survives focus, hover, and offscreen transitions. `prefers-reduced-motion` is independent: the control disables with an explanation, CSS keeps the static first word (SSR-safe), and preference changes never overwrite the manual choice.

### Navigation
- **Header:** the GSC MCP mark leads into Use cases, Tools and Docs on desktop across all routes. Hover and current-page feedback use an underline; the install action uses the rectangular ice treatment. All internal pages (docs routes, Privacy, Terms, 404s) share one header gutter and max width through the internal header variant; the homepage header keeps its own treatment. The shared header adapts through a 48rem inline-size container, so enlarged root fonts enter the compact disclosure layout at the same breakpoint while normal widths are unchanged.
- **Guide rail:** muted guide titles and blurbs sit beside a thin rail. The current guide uses primary text and a cyan rail marker.
- **Page index:** text links stay unboxed and underline on hover or focus. On narrow screens, guide and section links use native disclosures with keyboard behavior intact.
- **Footer:** reuse the same brand, link, divider and attribution roles on the homepage and internal pages. The footer brand keeps a 44px hit area while the mark stays 25px, with the brand block left and grouped navigation right on desktop. Groups are Product (Use cases, Tools via the homepage anchors), Get started (first three canonical `DOC_NAV` guides) and Reference (last three), reusing `DOC_NAV` labels and hrefs with exact active matching so Installation never reads current on child guides. Groups lay out on an intrinsic `auto-fit` grid with `9rem` minimums, so enlarged root text stacks them without spill. A utility row separated by the line token carries Privacy and Terms (draft) beside the maintainer credit, version, unpublished status and Apache-2.0 copyright; every footer link keeps a 44px target with visible focus.

### Tabs and step navigation
Guide runtime tabs and homepage use-case tabs use an underline to signal selection. The detailed homepage install workbench keeps its filled ice active state. Guide stage links connect numbered steps with a subtle rule and keep their text labels visible at every width.

### Command panels and copy controls
Command panels use `panel`, a `panel-line` border and a large radius. Their header separates the command label from a dark outlined Copy button. The install-workbench headers wrap the same way: flexible labels shrink and break anywhere while Copy keeps its 44px target, so nothing leaves the rounded panel at large text. Keep command text horizontally scrollable and keyboard reachable; the copy action reports success only after the clipboard write succeeds.

### Notes and disclosures
Warnings use the dark warning surface with readable warm text and a visible label. Homepage FAQ rows remain unboxed with subtle separators and native `details`/`summary` behavior. Mobile documentation navigation also uses native disclosures.

### Evidence cards and tables
Homepage conversation examples use the raised midnight surface, a prompt bubble and a clear separation between the answer, tool call and evidence table. Label sample evidence as illustrative. Use JetBrains Mono and tabular numerals for measurements, right-align numeric columns, and keep wide tables scrollable without shrinking their text.

## Do's and Don'ts

### Do:
- **Do** use the shared midnight, cyan and ice palette on homepage and internal routes.
- **Do** use Archivo for explanation and navigation, and JetBrains Mono for commands, tool names and measured data.
- **Do** keep guide prose within the article measure and place section navigation beside it on wide screens.
- **Do** preserve underlines for text-link state, visible focus, 44px copy targets and native keyboard behavior.
- **Do** label examples as illustrative and retain complete content when reduced motion is enabled.
- **Do** group each homepage use case with its evidence and let wide data scroll.
- **Do** keep the hero rotator pausable in-page with a pinned legible word, and keep reduced-motion static without erasing the manual pause/resume choice.
- **Do** label the `/docs/commands` `--help` block as an abridged summary and keep the installed `gsc-mcp --help` as the authoritative text.
- **Do** use the `bright` token utilities (`text-bright`, `bg-bright/10`, `decoration-bright`) for white on dark panels — never raw `white` — and `ink-on-cobalt` for text on the cobalt signal.
- **Do** keep standalone targets (client brand links, docs heading anchors, the focused skip link) at a 44px minimum without enlarging inline prose links.

### Don't:
- **Don't** assign internal routes a separate page palette; they continue the shared Terminal SEO midnight system.
- **Don't** use white text on the cyan link color for primary actions; use the ice action surface with dark text.
- **Don't** turn command-copy controls into pills or add shadows to resting cards.
- **Don't** put an exterior card around the homepage FAQ or split an explanation from its evidence.
- **Don't** make status depend on color alone, shrink table data to force a fit, or hide full answers for motion effects.
- **Don't** change factual claims, publication status, privacy boundaries or permissions as a visual effect.
- **Don't** freeze the hero rotator mid-fade on user pause; pin the canonical word instead.
