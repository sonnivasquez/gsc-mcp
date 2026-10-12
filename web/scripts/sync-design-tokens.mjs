import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const tokenSource = read("web/src/styles/tokens.css");
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim().replace(/\s+/g, " ")]));
const theme = declarations(tokenSource.match(/@theme \{([\s\S]*?)\n\}/)[1]);
const geometry = declarations(tokenSource.match(/:root \{([\s\S]*?)\n\}/)[1]);
const home = declarations(tokenSource.match(/html:has\(\[data-home-theme\]\) \{\n  color-scheme: dark;([\s\S]*?)\n\}/)[1]);
const colors = {};
const tokenValues = { ...theme, ...geometry, ...home };
const colorValue = (value) => {
  if (value.startsWith("#")) return value;
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  const resolved = reference ? tokenValues[reference] : undefined;
  return resolved?.startsWith("#") ? resolved : undefined;
};

// The semantic midnight palette is shared across the homepage and internal docs.
for (const [name, value] of Object.entries(theme)) {
  const color = colorValue(value);
  if (name.startsWith("--color-") && color) {
    colors[name.replace(/^--color-/, "")] = color;
  }
}
for (const [name, value] of Object.entries(geometry)) {
  const color = colorValue(value);
  if (name.startsWith("--ds-action-") && color) {
    colors[name.replace(/^--ds-/, "")] = color;
  }
}
// Homepage-only prompt, table and status tokens extend the shared palette.
for (const [name, value] of Object.entries(home)) {
  const color = colorValue(value);
  if (name.startsWith("--home-") && color) {
    colors[name.replace(/^--/, "")] = color;
  }
}

const sans = theme["--font-sans"];
const mono = theme["--font-mono"];
const spec = {
  name: "GSC MCP — Terminal SEO",
  description: "A sober, clear and trustworthy system for Search Console questions and evidence.",
  colors,
  typography: {
    "display": { fontFamily: sans, fontSize: geometry["--ds-type-display"], fontWeight: 600, lineHeight: Number(geometry["--ds-leading-heading"]) },
    "page": { fontFamily: sans, fontSize: geometry["--ds-type-page"], fontWeight: 600, lineHeight: Number(geometry["--ds-leading-heading"]) },
    "headline": { fontFamily: sans, fontSize: geometry["--ds-type-heading"], fontWeight: 600, lineHeight: Number(geometry["--ds-leading-heading"]) },
    "title": { fontFamily: sans, fontSize: geometry["--ds-type-title"], fontWeight: 600, lineHeight: Number(geometry["--ds-leading-heading"]) },
    "lead": { fontFamily: sans, fontSize: geometry["--ds-type-lead"], fontWeight: 400, lineHeight: Number(geometry["--ds-leading-body"]) },
    "body": { fontFamily: sans, fontSize: geometry["--ds-type-body"], fontWeight: 400, lineHeight: Number(geometry["--ds-leading-body"]) },
    "body-compact": { fontFamily: sans, fontSize: geometry["--ds-type-body-sm"], fontWeight: 400, lineHeight: Number(geometry["--ds-leading-body"]) },
    "label": { fontFamily: sans, fontSize: geometry["--ds-type-label"], fontWeight: 500, lineHeight: Number(geometry["--ds-leading-label"]) },
    "caption": { fontFamily: sans, fontSize: geometry["--ds-type-caption"], fontWeight: 400, lineHeight: Number(geometry["--ds-leading-label"]) },
    "code": { fontFamily: mono, fontSize: geometry["--ds-type-code"], fontWeight: 400, lineHeight: Number(geometry["--ds-leading-body"]) },
  },
  rounded: {
    sm: geometry["--ds-radius-sm"],
    md: geometry["--ds-radius-md"],
    lg: geometry["--ds-radius-lg"],
    code: "4px",
    demo: "12px",
    pill: "999px",
  },
  spacing: Object.fromEntries(Object.entries(geometry).filter(([name]) => name.startsWith("--ds-space-")).map(([name, value]) => [name.slice(5), value])),
  components: {
    "button-primary": { backgroundColor: "{colors.action-surface}", textColor: "{colors.action-ink}", rounded: "{rounded.sm}", padding: "0px 16px", height: "36px" },
    "button-primary-hover": { backgroundColor: "{colors.action-hover}" },
    "button-secondary": { backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "{rounded.sm}", padding: "0px 16px", height: "36px" },
    "button-command-copy": { backgroundColor: "transparent", textColor: "{colors.bright}", rounded: "{rounded.sm}", padding: "0px 16px", height: "44px" },
    "navigation-link": { backgroundColor: "transparent", textColor: "{colors.ink-soft}", padding: "8px 12px", height: "44px" },
    "guide-navigation-link": { backgroundColor: "transparent", textColor: "{colors.ink-soft}", padding: "12px 20px", height: "48px" },
    "command-panel": { backgroundColor: "{colors.panel}", textColor: "{colors.ink}", rounded: "{rounded.lg}" },
    "tab-underline": { backgroundColor: "transparent", textColor: "{colors.ink-soft}", height: "44px", typography: "{typography.label}" },
    "conversation-card": { backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "{rounded.lg}", padding: "18px" },
    "prompt-bubble": { backgroundColor: "{colors.home-prompt-surface}", textColor: "{colors.home-prompt-ink}", typography: "{typography.code}", padding: "11px 13px" },
    "warning-note": { backgroundColor: "{colors.warn-bg}", textColor: "{colors.warn-ink}", rounded: "{rounded.md}", padding: "12px 16px" },
  },
};

const yaml = (object, depth = 0) => Object.entries(object).map(([key, value]) => `${"  ".repeat(depth)}${key}:${typeof value === "object" ? `\n${yaml(value, depth + 1)}` : ` ${JSON.stringify(value)}\n`}`).join("");
const frontmatter = `---\n${yaml(spec)}---`;
const design = read("DESIGN.md");
const nextDesign = design.replace(/^---\n[\s\S]*?\n---/, frontmatter);
if (nextDesign === design && !design.startsWith("---\n")) throw new Error("DESIGN.md must start with YAML frontmatter.");
const sidecar = JSON.parse(read(".impeccable/design.json"));
const displayNames = {
  paper: "Midnight Canvas",
  card: "Raised Midnight Surface",
  ink: "Ice Text",
  "ink-soft": "Muted Ice Text",
  "ink-faint": "Quiet Ice Text",
  line: "Midnight Divider",
  "line-strong": "Structural Blue Gray",
  cobalt: "Cyan Signal",
  "cobalt-deep": "Bright Cyan",
  "cobalt-wash": "Cyan Wash",
  "ink-on-cobalt": "Ink on Cyan Signal",
  bright: "Bright Surface Text",
  panel: "Terminal Panel",
  "panel-raised": "Raised Terminal Panel",
  "panel-line": "Panel Divider",
  "panel-soft": "Terminal Supporting Text",
  "panel-faint": "Terminal Muted Text",
  "warn-bg": "Warning Night Surface",
  "warn-line": "Warning Divider",
  "warn-ink": "Warm Warning Text",
  "warn-on-dark": "Warning Text on Dark",
  "focus-on-dark": "Ice Focus Ring",
  "action-surface": "Ice Action Surface",
  "action-ink": "Ink on Ice",
  "action-hover": "Ice Action Hover",
  "home-prompt-surface": "Prompt Blue Surface",
  "home-prompt-ink": "Prompt Ice Text",
  "home-button-surface": "Homepage Ice Action",
  "home-button-ink": "Ink on Homepage Action",
  "home-button-hover": "Homepage Ice Hover",
  "home-row-surface": "Alternate Data Row",
  "home-data-ink": "Table Values",
  "home-data-muted": "Table Headings",
  "home-tool-ink": "Tool Identifier",
  "home-conversation-label": "Conversation Label",
  "home-success-surface": "Success Surface",
  "home-success-ink": "Success Text",
  "home-positive": "Positive Value",
  "home-link-hover": "Bright Cyan Link Hover",
  "home-badge-line": "Hero Badge Edge",
  "home-badge-ink": "Hero Badge Text",
  "home-command-ink": "Command Code Text",
  "home-copy-hover": "Copy Action Hover",
  "home-secondary-hover-line": "Secondary Hover Edge",
  "home-icon-accent": "Pale Icon Accent",
  "home-client-ink": "Client Resting Text",
  "home-trust-code": "Trust Code Text",
  "home-hero-glow-a": "Hero Glow West",
  "home-hero-glow-b": "Hero Glow East",
  "home-primary-highlight": "Primary Top Highlight",
  "home-chip-surface": "Overflow Chip Surface",
  "home-numeral-surface": "Numeral Chip Surface",
  "home-close-line": "Closing Band Edge",
  "home-close-surface": "Closing Band Surface",
  "home-close-mark": "Closing Mark Surface",
};
const colorMeta = Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, {
  role: name.includes("warn") ? "warning" : name.includes("success") || name.endsWith("positive") ? "success" : name.startsWith("action-") || name.startsWith("cobalt") ? "primary" : "neutral",
  displayName: displayNames[name] ?? name,
  tonalRamp: [[.15,.35],[.26,.65],[.37,.85],[.48,1],[.59,1],[.70,.85],[.83,.60],[.95,.25]].map(([lightness, chroma]) => `oklch(from ${color} ${lightness} calc(c * ${chroma}) h)`),
}]));
const nextSidecar = { ...sidecar, extensions: { ...sidecar.extensions, colorMeta } };
const nextJSON = `${JSON.stringify(nextSidecar, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (nextDesign !== design || nextJSON !== read(".impeccable/design.json")) {
    console.error("Design token exports are stale. Run npm run design:sync in web/.");
    process.exitCode = 1;
  } else console.log(`Design exports match runtime: ${Object.keys(colors).length} colors, ${Object.keys(spec.typography).length} type roles, ${Object.keys(spec.spacing).length} spacing steps.`);
} else {
  writeFileSync(`${root}DESIGN.md`, nextDesign);
  writeFileSync(`${root}.impeccable/design.json`, nextJSON);
  console.log("Updated DESIGN.md token frontmatter and Impeccable palette metadata.");
}
