import {
  fetchAllRows,
  getDateRange,
} from "../analytics.js";
import type { QueryParams, SearchAnalyticsRow } from "../analytics.js";
import { GscError } from "../gsc/errors.js";

export const GENAI_MAX_PULL_ROWS = 50_000;

export type GenaiFetchRows = (
  params: QueryParams,
  siteUrl?: string,
) => Promise<SearchAnalyticsRow[]>;

function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const ARTEFACT_WORDS = [
  "yes", "yeah", "yep", "ok", "okay", "okey", "sure", "no", "nope",
  "go on", "continue", "keep going", "tell me more", "more", "next",
  "why not", "how so", "really", "exactly", "show me", "and then",
  "thanks", "thank you", "got it", "what else", "anything else",
];

const ARTEFACT_SRC = `^(${ARTEFACT_WORDS.join("|")})[?!.,]*$`;
const PIVOT_SRC = phrase(["^(what|how) about ", ".{1,40}$"]);
const TRACKER_SRC = phrase(["(\\. ?my location is )", "|(^evaluate the .+ on )"]);
const AGENT_SRC = phrase([
  "^(search the web for|browse the web)",
  "|do not invent|return the [0-9]+ ",
  "most relevant|include source urls",
]);
const CONV_WORDS = [
  "please", "can you", "could you", "give me", "show me", "tell me",
  "i want", "i need", "i have", "i am", "should i", "do i need",
  "is it worth", "how do i", "how can i", "help me", "walk me through",
];
const CONV_SRC = `\\b(${CONV_WORDS.join("|")})\\b`;
const DEICTIC_SRC = phrase([
  "^(what|how|why|is|does|can|will|would) ",
  "(it|that|this|they)\\b",
]);
const TEN_PLUS_WORDS_SRC = phrase(["^([^ ]+ ){9,}", "[^ ]+$"]);
const PASTED_SRC = phrase(["([^,]*,){5}", "|has been captured for this url prefix"]);

const QUESTION_START = new RegExp(phrase([
  "^(what|how|why|when|where|which|who|",
  "can|does|do|is|are|should|will|would)\\b",
]));

const SHAPE = {
  artefact: new RegExp(ARTEFACT_SRC),
  pivot: new RegExp(PIVOT_SRC),
  tracker: new RegExp(TRACKER_SRC),
  agent: new RegExp(AGENT_SRC),
  conversational: new RegExp(CONV_SRC),
  deictic: new RegExp(DEICTIC_SRC),
  pasted: new RegExp(PASTED_SRC),
};

export type Bucket =
  | "artefact"
  | "pivot"
  | "conversational"
  | "tracker_probe"
  | "agent_harness"
  | "pasted_string"
  | "long_uncategorised";

export function classifyQuery(
  query: string,
): Bucket | null {
  const normalized = query.toLowerCase().trim();
  const wordCount = normalized.split(/ +/).length;
  if (SHAPE.artefact.test(normalized)) return "artefact";
  if (SHAPE.pivot.test(normalized)) return "pivot";
  if (SHAPE.agent.test(normalized)) return "agent_harness";
  if (SHAPE.tracker.test(normalized)) return "tracker_probe";
  if (SHAPE.pasted.test(normalized)) return "pasted_string";
  if (SHAPE.conversational.test(normalized) || SHAPE.deictic.test(normalized)) return "conversational";
  if (wordCount >= 10 && QUESTION_START.test(normalized)) return "conversational";
  if (wordCount >= 10) return "long_uncategorised";
  return null;
}

interface BucketRow {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  top_pages: Array<{
    page: string;
    impressions: number;
  }>;
}

interface QueryAggregate {
  impressions: number;
  clicks: number;
  positionWeight: number;
  pages: Map<string, number>;
}

const BUCKET_ORDER: Bucket[] = [
  "artefact",
  "pivot",
  "conversational",
  "tracker_probe",
  "agent_harness",
  "pasted_string",
  "long_uncategorised",
];

const MEANING: Record<Bucket, string> = {
  artefact: phrase([
    "A person mid-conversation with Google's ",
    "AI replied ('yes', 'go on') and the ",
    "reply was logged as a query your page ",
    "appeared for. Positions here are ",
    "AI-block positions, not open-web rankings.",
  ]),
  pivot: phrase([
    "Mid-conversation comparison questions ",
    "('what about resend'). Each one names ",
    "the alternative users ask the AI about ",
    "next; a ready-made comparison-section ",
    "instruction for the landing page.",
  ]),
  conversational: phrase([
    "Human questions shaped by AI conversation. ",
    "High impressions with near-zero clicks ",
    "here means your page is being read inside ",
    "answers rather than clicked from results.",
  ]),
  tracker_probe: phrase([
    "Synthetic daily prompts from AI-visibility ",
    "tracking tools flowing through Google's ",
    "grounding layer. Not human demand: exclude ",
    "from opportunity analyses. If you run an ",
    "AI tracker, this is its probes independently ",
    "logged by Google; if you don't, third parties ",
    "are sweeping topics you rank in.",
  ]),
  agent_harness: phrase([
    "Complete agent instructions ('search the ",
    "web for… do not invent results') logged as ",
    "queries. Machine traffic; interesting for ",
    "what agents surface you for, worthless as ",
    "keyword demand.",
  ]),
  pasted_string: phrase([
    "Error messages and CSV headers entered ",
    "as searches, by people or pipelines.",
  ]),
  long_uncategorised: phrase([
    "Ten or more words without another marker. ",
    "A mix of quoted-sentence searches, agent ",
    "fragments and rare long-tail; review ",
    "manually before acting.",
  ]),
};

const CANNOT_SEE = [
  phrase([
    "Anonymised (rare) queries are excluded ",
    "by Google, so every number is a floor, ",
    "not a total.",
  ]),
  phrase([
    "AI Overviews and AI Mode cannot be told ",
    "apart at query level; both fold into the ",
    "web search type.",
  ]),
  phrase([
    "Classification reads query shape, not ",
    "certainty. A phrase like 'is it agent ",
    "ready' can also be typed deliberately; ",
    "treat single rows as evidence, not statistics.",
  ]),
  phrase([
    "The operator behind tracker probes and ",
    "agent harnesses is not identifiable from ",
    "Search Console data alone.",
  ]),
  phrase([
    "Impressions in probe and harness buckets ",
    "are machine-generated views, not people.",
  ]),
];

function budgetExceeded(): GscError {
  return new GscError(
    "REQUEST_BUDGET_EXCEEDED",
    phrase([
      "GenAI pull exceeded ",
      String(GENAI_MAX_PULL_ROWS),
      " rows; narrow `days` and retry ",
      "(no partial data returned)",
    ]),
    { suggestedAction: phrase(["narrow `days` to a smaller window ", "and retry"]) },
  );
}

function prefilter(): string {
  return [
    ARTEFACT_SRC,
    PIVOT_SRC,
    TRACKER_SRC,
    AGENT_SRC,
    CONV_SRC,
    DEICTIC_SRC,
    TEN_PLUS_WORDS_SRC,
    PASTED_SRC,
  ].join("|");
}

function queryRequest(startDate: string, endDate: string, expression: string, dimensions: string[]): QueryParams {
  return {
    startDate,
    endDate,
    dimensions,
    dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "includingRegex", expression }] }],
    type: "web",
    rowLimit: 25000,
    maxTotalRows: GENAI_MAX_PULL_ROWS,
  };
}

function remember(groups: Map<string, QueryAggregate>, row: SearchAnalyticsRow): void {
  const [query, page] = row.keys;
  const current = groups.get(query) ?? { impressions: 0, clicks: 0, positionWeight: 0, pages: new Map() };
  current.impressions += row.impressions;
  current.clicks += row.clicks;
  current.positionWeight += row.position * row.impressions;
  current.pages.set(page, (current.pages.get(page) || 0) + row.impressions);
  groups.set(query, current);
}

function toBucketRow(query: string, aggregate: QueryAggregate): BucketRow {
  const topPages = [...aggregate.pages.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([page, impressions]) => ({
      page,
      impressions,
    }));
  const impressions = aggregate.impressions;
  return {
    query,
    impressions,
    clicks: aggregate.clicks,
    ctr: impressions ? Math.round((aggregate.clicks / impressions) * 10000) / 100 : 0,
    position: impressions ? Math.round((aggregate.positionWeight / impressions) * 10) / 10 : 0,
    top_pages: topPages,
  };
}

function monthlyTimeline(rows: SearchAnalyticsRow[]): Array<{ month: string; impressions: number; clicks: number }> {
  const months = new Map<string, { impressions: number; clicks: number }>();
  for (const row of rows) {
    const month = row.keys[0].slice(0, 7);
    const current = months.get(month) ?? { impressions: 0, clicks: 0 };
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    months.set(month, current);
  }
  return [...months.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([month, totals]) => ({ month, ...totals }));
}

type BucketTotals = { queries: number; impressions: number; clicks: number };
type MonthPoint = { month: string; impressions: number; clicks: number };

export const genaiConversationQueries = async (
  days: number = 480,
  minImpressions: number = 1,
  maxRowsPerBucket: number = 50,
  includeTimeline: boolean = true,
  siteUrl?: string,
  fetchRowsOverride?: GenaiFetchRows,
) => {
  const period = getDateRange(days);
  const startDate = period.startDate;
  const endDate = period.endDate;
  const fetchRows = fetchRowsOverride ?? fetchAllRows;
  const rows = await fetchRows(queryRequest(startDate, endDate, prefilter(), ["query", "page"]), siteUrl);
  if (rows.length > GENAI_MAX_PULL_ROWS) throw budgetExceeded();

  const grouped = new Map<string, QueryAggregate>();
  for (const row of rows) remember(grouped, row);

  const buckets = Object.fromEntries(BUCKET_ORDER.map((bucket) => [bucket, [] as BucketRow[]])) as Record<Bucket, BucketRow[]>;
  let excludedOrdinary = 0;
  for (const [query, aggregate] of grouped) {
    const bucket = classifyQuery(query);
    if (!bucket) {
      excludedOrdinary += 1;
      continue;
    }
    if (aggregate.impressions < minImpressions) continue;
    buckets[bucket].push(toBucketRow(query, aggregate));
  }

  const summary: Record<string, BucketTotals> = {};
  for (const bucket of BUCKET_ORDER) {
    buckets[bucket].sort((left, right) => right.impressions - left.impressions || left.query.localeCompare(right.query));
    summary[bucket] = {
      queries: buckets[bucket].length,
      impressions: buckets[bucket].reduce((total, row) => total + row.impressions, 0),
      clicks: buckets[bucket].reduce((total, row) => total + row.clicks, 0),
    };
  }

  let timeline: MonthPoint[] | undefined;
  if (includeTimeline) {
    const dated = await fetchRows(queryRequest(startDate, endDate, ARTEFACT_SRC, ["date"]), siteUrl);
    if (dated.length > GENAI_MAX_PULL_ROWS) throw budgetExceeded();
    timeline = monthlyTimeline(dated);
  }

  const summaryRows = Object.values(summary);
  const leftOut = excludedOrdinary;
  return {
    period: { startDate, endDate },
    summary,
    total_conversation_queries: summaryRows.reduce((total, bucket) => total + bucket.queries, 0),
    total_conversation_impressions: summaryRows.reduce((total, bucket) => total + bucket.impressions, 0),
    excluded_ordinary_matches: leftOut,
    buckets: Object.fromEntries(BUCKET_ORDER.map((bucket) => [bucket, {
      meaning: MEANING[bucket],
      total_matched: buckets[bucket].length,
      rows: buckets[bucket].slice(0, maxRowsPerBucket),
    }])),
    artefact_timeline_monthly: timeline,
    what_this_cannot_see: CANNOT_SEE,
  };
};
