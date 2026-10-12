import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Task-oriented prompt templates (P1). They carry no calculations: the
// client executes them by calling the deterministic tools. Nothing here
// runs on a schedule or inside this server.

const SITE = { siteUrl: z.string().describe("Exact GSC property identifier") };

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "seo_weekly_report",
    "Weekly SEO summary: range, KPIs, observed movers, opportunities, limits.",
    { ...SITE },
    ({ siteUrl }) => ({
      description: "Assemble a weekly report for one property using tools only.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Build a weekly SEO report for ${siteUrl}.`,
              "1. Call gsc_performance_overview with last_28_days and includeTimeline.",
              "2. Call gsc_compare_periods (dimension page, previous_period) for movers.",
              "3. Call gsc_find_opportunities kind striking_distance for candidates.",
              "Rules: report observed facts, hypotheses and pending checks in three",
              "separate blocks. Never invent missing sections. Quote coverage and",
              "warnings from every tool response.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "investigate_traffic_drop",
    "Decompose a traffic drop by pages, queries and segments.",
    { ...SITE },
    ({ siteUrl }) => ({
      description: "Decompose a traffic drop without asserting causes.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Investigate the traffic drop on ${siteUrl}.`,
              "1. Call gsc_compare_periods (dimension page, then query) for the affected window.",
              "2. Separate ranking changes (deltaPosition), CTR changes (deltaCtrPp) and",
              "   impression changes. Keys absent from a window are not observed, not zero.",
              "3. Only with explicit URLs, call gsc_inspect_urls for indexation evidence.",
              "Close with observed signals, hypotheses and missing evidence. A time",
              "correlation is not causation.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "page_performance_review",
    "Performance of one page plus its observed queries.",
    { ...SITE, pageUrl: z.string().describe("Exact page URL") },
    ({ siteUrl, pageUrl }) => ({
      description: "Review one page and the queries observed for it.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Review page ${pageUrl} on ${siteUrl}.`,
              "1. Call gsc_page_queries for its observed queries over last_28_days.",
              "2. Call gsc_compare_periods (dimension query) only if a change is in scope.",
              "Do not call this 'all keywords', do not infer title/H1/editorial intent,",
              "and do not prescribe canonicals or redirects from this data alone.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
