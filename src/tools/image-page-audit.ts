import {
  parse,
  type HTMLElement,
} from "node-html-parser";
import { imageSize } from "image-size";
import { CLI_VERSION } from "../version.js";
import exifr from "exifr";
import { getInstanceAllowlist, isPageUrlAllowedByAllowlist } from "../profiles.js";
import { guardedFetch, readBoundedBody, type ResolveHost } from "../fetch-guard.js";
import { GscError, propertyNotAllowed } from "../gsc/errors.js";

export interface ImagePageAuditOpts {
  resolveHost?: ResolveHost;
  allowlistOverride?: string[] | null;
}

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const USER_AGENT = phrase(["@sonnivasquez/gsc-mcp/", CLI_VERSION, " gsc_image_page_audit"]);
const PAGE_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20_971_520;
const PAGE_LIMIT = 5;
const INDEX_MIN_WIDTH = 250;
const INDEX_MIN_HEIGHT = 200;
const INDEX_MIN_AREA = 50_000;
const HEAVY_BYTES = 300 * 1024;
const OVERSIZED_BYTES = 500 * 1024;
const PNG_PHOTO_BYTES = 150 * 1024;

const GENERIC_ALTS = new Set([
  "image", "img", "photo", "picture", "pic", "icon", "logo", "graphic",
  "banner", "screenshot", "untitled", "alt", "thumbnail",
]);

const GENERIC_STEMS = [
  "img", "image", "dsc[fn]?", "mvimg", "pxl", "screen[-_ ]?shot", "screenshot",
  "photo", "unnamed", "untitled", "capture", "whatsapp[-_ ]image",
  "signal[-_]attachment", "hero", "thumbnail", "default", "placeholder", "final", "new",
];
const GENERIC_FILENAME = new RegExp(`^(${GENERIC_STEMS.join("|")})[\\-_ ]?\\d*$`, "i");
const STOCK_STEMS = [
  "shutterstock", "istock(photo)?", "getty(images)?", "adobestock", "stock-photo",
  "depositphotos", "dreamstime", "bigstock", "123rf", "alamy", "pexels", "unsplash",
];
const STOCK_FILENAME = new RegExp(`^(${STOCK_STEMS.join("|")})[-_]`, "i");

type AltStatus = "missing" | "empty" | "generic" | "filename_as_alt" | "duplicate" | "ok";
type FilenameStatus = "generic_or_nondescriptive" | "hash_or_id" | "ok";
type WeightStatus = "ok" | "heavy" | "oversized";

interface ImageMetadata {
  camera_exif_present: boolean;
  gps_present: boolean;
  iptc_creator: boolean;
  iptc_copyright: boolean;
  iptc_caption: boolean;
  digital_source_type: string | null;
}

interface ImageFinding {
  src: string;
  alt: string | null;
  alt_status: AltStatus;
  filename_status: FilenameStatus;
  has_width_height_attrs: boolean;
  loading: string | null;
  fetchpriority: string | null;
  has_srcset: boolean;
  fetched: boolean;
  format: string | null;
  bytes: number | null;
  intrinsic_width: number | null;
  intrinsic_height: number | null;
  below_indexing_minimum: boolean | null;
  weight_status: WeightStatus | null;
  png_likely_photo: boolean | null;
  metadata: ImageMetadata | null;
  issues: string[];
}

type Maybe<T> = T | null;

interface PageChecks {
  total_img_tags: number;
  content_images: number;
  images_fetched: number;
  lcp_candidate_src: Maybe<string>;
  lcp_candidate_lazy_loaded: Maybe<boolean>;
  lcp_candidate_fetchpriority: Maybe<string>;
  inline_background_images: number;
  max_image_preview: string | "not_set";
  image_object_schema_count: number;
  has_licensable_fields: boolean;
  has_primary_image_of_page: boolean;
  images_with_srcset: number;
  modern_format_sources: boolean;
}

interface PageAudit {
  url: string;
  status: "ok" | "fetch_failed";
  http_status: number | null;
  error?: string;
  page_checks?: PageChecks;
  images?: ImageFinding[];
  images_not_reported?: number;
  issue_counts?: Record<string, number>;
  top_fixes?: string[];
}

interface Candidate {
  el: HTMLElement;
  src: string;
  jsLazy: boolean;
}

function stemOf(src: string): string {
  try {
    const pathname = new URL(src).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const leaf = segments.at(-1) ?? "";
    const withoutExt = leaf.replace(/\.[a-z0-9]+$/i, "");
    return decodeURIComponent(withoutExt);
  } catch {
    return "";
  }
}

function filenameStatus(src: string): FilenameStatus {
  const stem = stemOf(src);
  if (!stem) return "ok";
  if (GENERIC_FILENAME.test(stem) || STOCK_FILENAME.test(stem) || /^\d+$/.test(stem)) {
    return "generic_or_nondescriptive";
  }
  if (/^[0-9a-f]{16,}$/i.test(stem.replace(/-/g, ""))) return "hash_or_id";
  return "ok";
}

function altStatus(alt: string | null, src: string, duplicates: Set<string>): AltStatus {
  if (alt === null) return "missing";
  const trimmed = alt.trim();
  if (trimmed === "") return "empty";
  const lower = trimmed.toLowerCase();
  if (GENERIC_ALTS.has(lower)) {
    return "generic";
  }
  const stem = stemOf(src).toLowerCase().replace(/[-_]+/g, " ").trim();
  if (stem && lower === stem) return "filename_as_alt";
  if (duplicates.has(lower)) return "duplicate";
  return "ok";
}

function collectImageObjects(node: unknown, hits: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectImageObjects(item, hits);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const declared = record["@type"];
  const types = Array.isArray(declared) ? declared : [declared];
  if (types.includes("ImageObject")) hits.push(record);
  for (const value of Object.values(record)) collectImageObjects(value, hits);
}

function requestHeaders(): Record<string, string> {
  return { "User-Agent": USER_AGENT, Accept: "*/*" };
}

function weightOf(bytes: number): WeightStatus {
  if (bytes > OVERSIZED_BYTES) return "oversized";
  if (bytes > HEAVY_BYTES) return "heavy";
  return "ok";
}

function readMetadata(meta: Record<string, unknown>): ImageMetadata {
  const digital = meta.DigitalSourceType;
  const camera = [meta.Make, meta.Model, meta.ISO].some(Boolean);
  const gps = [meta.latitude, meta.longitude, meta.GPSLatitude].some(Boolean);
  const creator = [meta.Creator, meta["By-line"], meta.Byline, meta.creator].some(Boolean);
  const copyright = [meta.Copyright, meta.CopyrightNotice, meta.rights].some(Boolean);
  const caption = [meta.Caption, meta["Caption-Abstract"], meta.description].some(Boolean);
  const source = typeof digital === "string" ? digital.split("/").pop() ?? null : null;
  return {
    camera_exif_present: camera,
    gps_present: gps,
    iptc_creator: creator,
    iptc_copyright: copyright,
    iptc_caption: caption,
    digital_source_type: source,
  };
}

async function inspectImage(src: string, fetchMetadata: boolean, resolveHost?: ResolveHost): Promise<Partial<ImageFinding>> {
  const measured: Partial<ImageFinding> = { fetched: false };
  const { response } = await guardedFetch(src, {
    timeoutMs: IMAGE_TIMEOUT_MS,
    headers: requestHeaders(),
    resolveHost,
  });
  if (!response.ok) return measured;
  let buffer: Buffer;
  try {
    buffer = await readBoundedBody(response, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS });
  } catch {
    return measured;
  }
  if (buffer.length === 0) return measured;

  measured.fetched = true;
  measured.bytes = buffer.length;
  const header = response.headers.get("content-type");
  const contentType = header ?? "";
  measured.format = contentType.split(";")[0].trim() || null;
  try {
    const dims = imageSize(buffer);
    measured.intrinsic_width = dims.width ?? null;
    measured.intrinsic_height = dims.height ?? null;
    if (dims.width && dims.height) {
      const area = dims.width * dims.height;
      measured.below_indexing_minimum = area < INDEX_MIN_AREA || dims.width < INDEX_MIN_WIDTH || dims.height < INDEX_MIN_HEIGHT;
    }
  } catch {
    measured.intrinsic_width = null;
    measured.intrinsic_height = null;
  }
  measured.weight_status = weightOf(buffer.length);
  measured.png_likely_photo = measured.format === "image/png" && buffer.length > PNG_PHOTO_BYTES;
  if (!fetchMetadata) return measured;
  try {
    const meta = await exifr.parse(buffer, { tiff: true, exif: true, gps: true, iptc: true, xmp: true });
    measured.metadata = meta ? readMetadata(meta as Record<string, unknown>) : null;
  } catch {
    measured.metadata = null;
  }
  return measured;
}

function pushIssue(issues: string[], when: boolean, label: string): void {
  if (when) issues.push(label);
}

function findingIssues(finding: ImageFinding): string[] {
  const issues: string[] = [];
  pushIssue(issues, finding.alt_status === "missing", "alt attribute missing");
  pushIssue(issues, finding.alt_status === "generic", "generic alt text");
  pushIssue(issues, finding.alt_status === "filename_as_alt", "alt text is just the filename");
  pushIssue(issues, finding.alt_status === "duplicate", "alt text duplicated on this page");
  pushIssue(issues, finding.filename_status !== "ok", "non-descriptive filename");
  pushIssue(issues, !finding.has_width_height_attrs, phrase([
    "no width/height attributes ",
    "(layout shift)",
  ]));
  pushIssue(issues, Boolean(finding.below_indexing_minimum), phrase([
    "below Google's ~250x200 ",
    "indexing minimum",
  ]));
  pushIssue(issues, finding.weight_status === "oversized", "over 500KB");
  pushIssue(issues, Boolean(finding.png_likely_photo), phrase([
    "photo shipped as PNG ",
    "(use WebP/AVIF)",
  ]));
  pushIssue(issues, Boolean(finding.metadata?.gps_present), phrase([
    "GPS coordinates in EXIF ",
    "(privacy)",
  ]));
  return issues;
}

function plainError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function nonDataSrc(value: string | undefined): string | null {
  if (!value || value.startsWith("data:")) return null;
  return value;
}
function absoluteUrl(raw: string, pageUrl: string): string | null {
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return null;
  }
}

function chosenSrc(el: HTMLElement): { src: string; jsLazy: boolean } | null {
  const directSrc = nonDataSrc(el.getAttribute("src") ?? undefined);
  const lazySrc = el.getAttribute("data-src")
    ?? el.getAttribute("data-lazy-src")
    ?? el.getAttribute("data-original");
  const srcset = el.getAttribute("srcset") ?? "";
  const fromSet = srcset.split(/[\s,]+/)[0] ?? "";
  const src = directSrc ?? lazySrc ?? fromSet;
  if (!src || src.startsWith("data:")) return null;
  const jsLazy = directSrc === null && lazySrc !== null;
  return { src, jsLazy };
}

function iconLike(candidate: Candidate): boolean {
  const width = Number(candidate.el.getAttribute("width") ?? "0");
  const height = Number(candidate.el.getAttribute("height") ?? "0");
  if ((width && width < 100) || (height && height < 100)) return true;
  return /logo|icon|avatar|favicon|badge|emoji/i.test(candidate.src);
}

function duplicateAlts(content: Candidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const candidate of content) {
    const alt = candidate.el.getAttribute("alt");
    if (!alt || !alt.trim()) continue;
    const key = alt.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function blankFinding(candidate: Candidate, duplicates: Set<string>): ImageFinding {
  const alt = candidate.el.hasAttribute("alt") ? (candidate.el.getAttribute("alt") ?? "") : null;
  return {
    src: candidate.src,
    alt,
    alt_status: altStatus(alt, candidate.src, duplicates),
    filename_status: filenameStatus(candidate.src),
    has_width_height_attrs: candidate.el.hasAttribute("width") && candidate.el.hasAttribute("height"),
    loading: candidate.el.getAttribute("loading") ?? (candidate.jsLazy ? "lazy" : null),
    fetchpriority: candidate.el.getAttribute("fetchpriority") ?? null,
    has_srcset: candidate.el.hasAttribute("srcset") || candidate.el.hasAttribute("data-srcset"),
    fetched: false,
    format: null,
    bytes: null,
    intrinsic_width: null,
    intrinsic_height: null,
    below_indexing_minimum: null,
    weight_status: null,
    png_likely_photo: null,
    metadata: null,
    issues: [],
  };
}

function schemaFacts(root: HTMLElement): { objects: Record<string, unknown>[]; primary: boolean } {
  const objects: Record<string, unknown>[] = [];
  let primary = false;
  for (const block of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const rawJson = block.textContent;
      const json = JSON.parse(rawJson);
      collectImageObjects(json, objects);
      if (JSON.stringify(json).includes("primaryImageOfPage")) primary = true;
    } catch {
      // Malformed JSON-LD is ignored here.
    }
  }
  return { objects, primary };
}

function topFixes(
  issueCounts: Record<string, number>,
  lcpLazy: boolean | null,
  imageObjectCount: number,
  previewSet: boolean,
): string[] {
  const fixes: string[] = [];
  if (lcpLazy) {
    fixes.push(phrase([
      "Remove loading=\"lazy\" from the LCP ",
      "image and add fetchpriority=\"high\"",
    ]));
  }
  const altBroken = (issueCounts["alt attribute missing"] ?? 0)
    + (issueCounts["generic alt text"] ?? 0)
    + (issueCounts["alt text is just the filename"] ?? 0);
  if (altBroken > 0) {
    fixes.push(phrase([
      "Rewrite alt text on ",
      String(altBroken),
      " image(s) to describe what the image shows",
    ]));
  }
  const tooSmall = issueCounts["below Google's ~250x200 indexing minimum"] ?? 0;
  if (tooSmall) {
    fixes.push(phrase([
      "Re-export ",
      String(tooSmall),
      " image(s) above 250x200; below that Google skips them",
    ]));
  }
  const heavy = (issueCounts["over 500KB"] ?? 0) + (issueCounts["photo shipped as PNG (use WebP/AVIF)"] ?? 0);
  if (heavy > 0) fixes.push("Convert heavy PNG/oversized images to WebP or AVIF");
  const unnamed = issueCounts["non-descriptive filename"] ?? 0;
  if (unnamed) {
    fixes.push(phrase([
      "Rename ",
      String(unnamed),
      " image file(s) to subject-modifier-context form",
    ]));
  }
  if (imageObjectCount === 0) {
    fixes.push(phrase([
      "Add ImageObject schema (with ",
      "about/mainEntity) for the page's key images",
    ]));
  }
  if (!previewSet) {
    fixes.push(phrase([
      "Add max-image-preview:large to the ",
      "robots meta for full-size previews",
    ]));
  }
  return fixes;
}

function countIssues(findings: ImageFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    for (const issue of finding.issues) counts[issue] = (counts[issue] ?? 0) + 1;
  }
  return counts;
}

async function auditPage(
  rawUrl: string,
  fetchMetadata: boolean,
  maxImagesPerPage: number,
  maxImagesReported: number,
  resolveHost: ResolveHost | undefined,
  allowUrl: ((hopUrl: string) => boolean) | undefined,
): Promise<PageAudit> {
  const audit: PageAudit = {
    url: rawUrl,
    status: "ok",
    http_status: null,
  };
  let response: Response;
  let pageUrl = rawUrl;
  try {
    const fetched = await guardedFetch(rawUrl, {
      timeoutMs: PAGE_TIMEOUT_MS,
      headers: requestHeaders(),
      resolveHost,
      allowUrl,
    });
    response = fetched.response;
    pageUrl = fetched.finalUrl;
  } catch (error) {
    audit.status = "fetch_failed";
    audit.error = plainError(error);
    return audit;
  }
  audit.http_status = response.status;
  if (!response.ok) {
    audit.status = "fetch_failed";
    audit.error = "HTTP " + String(response.status);
    return audit;
  }

  let root: HTMLElement;
  try {
    const pageBody = await readBoundedBody(response, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
    root = parse(pageBody.toString("utf8"));
  } catch (error) {
    audit.status = "fetch_failed";
    audit.error = plainError(error);
    return audit;
  }

  const robots = root.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')
    .map((meta) => meta.getAttribute("content") ?? "")
    .join(",");
  const previewMatch = robots.match(/max-image-preview:\s*(\w+)/i);
  const schema = schemaFacts(root);
  const backgroundPattern = /background(-image)?\s*:\s*url\(/i;
  const styledBackgrounds = root.querySelectorAll("[style]").filter((el) => (
    backgroundPattern.test(el.getAttribute("style") ?? "")
  )).length;
  const modernSources = root.querySelectorAll("picture source").some((source) => (
    /image\/(avif|webp)/i.test(source.getAttribute("type") ?? "")
  ));

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const imgSelector = "img";
  const imgElements = root.querySelectorAll(imgSelector);
  for (const el of imgElements) {
    const picked = chosenSrc(el);
    if (!picked) continue;
    const resolved = absoluteUrl(picked.src, pageUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    candidates.push({ el, src: resolved, jsLazy: picked.jsLazy });
  }

  const contentImages = candidates.filter((candidate) => !iconLike(candidate));
  const fetchable = new Set(contentImages.filter((candidate) => !/\.svg(\?|$)/i.test(candidate.src)).map((candidate) => candidate.src));
  const lcpCandidate = contentImages.length === 0 ? null : contentImages[0];
  const duplicates = duplicateAlts(contentImages);
  const findings = contentImages.map((candidate) => blankFinding(candidate, duplicates));
  const toFetch = findings.filter((finding) => fetchable.has(finding.src)).slice(0, maxImagesPerPage);
  const policyBlocked = new Set<string>();
  for (const finding of toFetch) {
    try {
      Object.assign(finding, await inspectImage(finding.src, fetchMetadata, resolveHost));
    } catch (error) {
      if (error instanceof GscError) policyBlocked.add(finding.src);
    }
  }
  for (const finding of findings) {
    finding.issues = findingIssues(finding);
    if (!policyBlocked.has(finding.src)) continue;
    finding.fetched = false;
    finding.bytes = null;
    finding.issues.push(phrase([
      "image fetch blocked by ",
      "fetch policy",
    ]));
  }

  const issueCounts = countIssues(findings);
  const lazyAttr = (lcpCandidate?.el.getAttribute("loading") ?? "").toLowerCase();
  const lcpLazy = lcpCandidate ? lazyAttr === "lazy" || lcpCandidate.jsLazy : null;
  const lcpPriority = lcpCandidate?.el.getAttribute("fetchpriority") ?? null;
  const previewValue = previewMatch ? previewMatch[1].toLowerCase() : "not_set";
  const hiddenImages = findings.length - maxImagesReported;
  audit.page_checks = {
    total_img_tags: imgElements.length,
    content_images: contentImages.length,
    images_fetched: toFetch.length,
    lcp_candidate_src: lcpCandidate ? lcpCandidate.src : null,
    lcp_candidate_lazy_loaded: lcpLazy,
    lcp_candidate_fetchpriority: lcpPriority,
    inline_background_images: styledBackgrounds,
    max_image_preview: previewValue,
    image_object_schema_count: schema.objects.length,
    has_licensable_fields: schema.objects.some((object) => Boolean(
      object.license || object.acquireLicensePage || object.creditText || object.copyrightNotice
    )),
    has_primary_image_of_page: schema.primary,
    images_with_srcset: findings.filter((finding) => finding.has_srcset).length,
    modern_format_sources: modernSources,
  };
  const reported = findings.slice(0, maxImagesReported);
  audit.images = reported;
  audit.images_not_reported = hiddenImages > 0 ? hiddenImages : 0;
  audit.issue_counts = issueCounts;
  audit.top_fixes = topFixes(issueCounts, lcpLazy, schema.objects.length, Boolean(previewMatch));
  return audit;
}

export async function imagePageAudit(
  urls: string[],
  fetchMetadata: boolean = true,
  maxImagesPerPage: number = 12,
  maxImagesReported: number = 20,
  opts: ImagePageAuditOpts = {},
): Promise<{
  audits: PageAudit[];
  overall: Record<string, unknown>;
}> {
  const allowlist = opts.allowlistOverride !== undefined ? opts.allowlistOverride : getInstanceAllowlist();
  const selected = urls.slice(0, PAGE_LIMIT);
  if (allowlist !== null) {
    for (const rawUrl of selected) {
      if (!isPageUrlAllowedByAllowlist(rawUrl, allowlist)) throw propertyNotAllowed(rawUrl, allowlist.length);
    }
  }
  const allowUrl = allowlist !== null
    ? (hopUrl: string) => isPageUrlAllowedByAllowlist(hopUrl, allowlist)
    : undefined;
  const audits: PageAudit[] = [];
  for (const rawUrl of selected) {
    audits.push(await auditPage(rawUrl, fetchMetadata, maxImagesPerPage, maxImagesReported, opts.resolveHost, allowUrl));
  }
  const overall = {
    pages_audited: audits.filter((audit) => audit.status === "ok").length,
    pages_failed: audits.filter((audit) => audit.status !== "ok").length,
    total_issues: audits.reduce((sum, audit) => (
      sum + Object.values(audit.issue_counts ?? {}).reduce((inner, count) => inner + count, 0)
    ), 0),
    note: phrase([
      "empty alt (alt=\"\") is correct for ",
      "decorative images; it is reported but ",
      "not counted as an issue.",
    ]),
  };
  return { audits, overall };
}
