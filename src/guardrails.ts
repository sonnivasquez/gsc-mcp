function phrase(parts: readonly string[]): string {
  return parts.join("");
}

const LIVE_SOURCE = phrase(["Google Search Console API", " (live data)"]);

const LIVE_NOTE = phrase([
  "All numbers in this response come ",
  "directly from the Google Search ",
  "Console API. They are exact values, ",
  "not estimates. Base your analysis ",
  "only on this data. Do not invent or ",
  "assume additional context.",
]);

export const GUARDRAIL_SUFFIX = phrase([
  " IMPORTANT: Base your analysis ",
  "ONLY on the data returned. Report ",
  "exact numbers from the results. Do ",
  "not speculate about causes (e.g. ",
  "algorithm updates, competitor ",
  "actions) unless the data explicitly ",
  "supports it. If the data does not ",
  "contain enough information to answer ",
  "a question, say so clearly rather ",
  "than guessing.",
]);

export const VISUAL_SUFFIX = phrase([
  " PRESENTATION: Always present these ",
  "results as a rich, interactive ",
  "visualization using artifacts. Use ",
  "summary cards for key metrics, ",
  "colour-coded indicators for severity ",
  "or change direction (green for ",
  "positive, red for negative), bar ",
  "charts or sparklines for comparisons, ",
  "and tabbed sections to organise ",
  "different categories of results. Make ",
  "the output visually scannable and ",
  "dashboard-like rather than plain text ",
  "or raw tables.",
]);

export const POSITION_CAVEAT = phrase([
  " POSITION: position is an ",
  "impression-weighted average over real ",
  "impressions, blended across queries, ",
  "devices and countries. It is not a ",
  "rank-tracker rank. Deep positions are ",
  "only recorded when a user actually ",
  "reaches that part of the results, so ",
  "values beyond page one rest on sparse ",
  "data. Treat absolute positions as ",
  "directional and prefer position ",
  "deltas between periods when judging ",
  "change.",
]);

export interface ToolProvenance {
  _meta: {
    source: string;
    tool: string;
    parameters: Record<string, unknown>;
    note: string;
  };
  data: unknown;
}

export function withMeta(
  data: unknown,
  toolName: string,
  params: Record<string, unknown>,
  source?: string,
  note?: string,
): ToolProvenance {
  return {
    _meta: {
      source: source === undefined ? LIVE_SOURCE : source,
      tool: toolName,
      parameters: params,
      note: note === undefined ? LIVE_NOTE : note,
    },
    data,
  };
}
