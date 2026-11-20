import { createFileRoute } from "@tanstack/react-router";
import { H2, Lead, Note, TopicLinks } from "@/components/doc";
import { McpExample } from "@/components/mcp-example";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/docs/analytics")({
  head: () => pageHead({
    path: "/docs/analytics",
    title: "Search Analytics queries and timelines | gsc-mcp",
    description: "Query Search Console brand classification, web multimodal traffic, country and device lists, hourly data and search appearances.",
  }),
  component: AnalyticsPage,
});

const paragraph = "mt-3 text-base leading-relaxed text-ink-soft";
const referenceLink = "text-cobalt-deep underline";

function AnalyticsPage() {
  return (
    <article>
      <h1 className="mt-0 font-display font-semibold tracking-[-0.02em] text-balance text-ink">Analytics and timelines</h1>
      <Lead>Use these inputs with the named MCP tool. Replace the example property, dates and appearance value with your own.</Lead>
      <Note tone="info" label="Release availability">
        Brand classification, country and device lists, and web multimodal reports require gsc-mcp 1.2.0 or later.{" "}
        <a href="https://github.com/sonnivasquez/gsc-mcp/blob/main/CHANGELOG.md" className={referenceLink}>See the changelog</a>.
      </Note>

      <H2 id="brand">Brand classification</H2>
      <p className={paragraph}>
        Group by <code>brandedClassification</code> to see both classifications. To report on branded searches
        for individual pages, group by <code>page</code> and filter by <code>BRANDED</code> with <code>equals</code>.
        Use <code>NON_BRANDED</code> for the other classification.
      </p>
      <p className={paragraph}>
        You can group by <code>query</code>. Omit <code>query</code> filters whenever you group or filter by
        brand classification. The API provides this data from February 21, 2026 for top-level properties with
        sufficient query and impression volume. An empty report leaves traffic and classification unknown.{" "}
        <a href="https://developers.google.com/webmaster-tools/v1/searchanalytics/query" className={referenceLink}>Search Analytics API reference</a>.
      </p>
      <McpExample example="brandedPages" />

      <H2 id="filter-lists">Country and device lists</H2>
      <p className={paragraph}>
        For <code>filterLists</code>, use three-letter ISO country codes and the device values <code>DESKTOP</code>,{" "}
        <code>MOBILE</code> and <code>TABLET</code>. A row matches a list if it matches any value in that list.
        It must satisfy every list and filter in the request. Put each dimension in either <code>filters</code> or{" "}
        <code>filterLists</code> and provide at least one value per list.
      </p>
      <p className={paragraph}>
        This example groups traffic by brand classification for searches in Peru or Mexico on mobile or tablet.
      </p>
      <McpExample example="brandWithLists" />

      <H2 id="multimodal">Web multimodal performance</H2>
      <p className={paragraph}>
        Set <code>searchType</code> to <code>webMultimodal</code> to see clicks and impressions from Google
        Lens, Circle to Search and image uploads in Google Search. Group by <code>page</code>, <code>country</code>{" "}
        or <code>date</code>. Omit <code>query</code> from dimensions and filters.{" "}
        <a href="https://developers.google.com/search/blog/2026/11/search-analytics-api-update" className={referenceLink}>Google’s Search Analytics API update</a>.
      </p>
      <McpExample example="webMultimodal" />

      <H2 id="hourly">Hourly data</H2>
      <p className={paragraph}>
        Use the <code>hour</code> dimension and <code>dataState=hourly_all</code> together. Google provides
        hourly data for up to the last ten days. Replace the illustrative dates below with dates inside that window.
        Hour values retain their offsets. When Google returns <code>metadata.first_incomplete_date</code> or{" "}
        <code>metadata.first_incomplete_hour</code>, use it to identify provisional data.{" "}
        <a href="https://developers.google.com/search/blog/2025/04/san-hourly-data" className={referenceLink}>Google’s hourly API guidance</a>.
      </p>
      <McpExample example="hourly" />

      <H2 id="appearance">Search appearance</H2>
      <p className={paragraph}>
        First query <code>searchAppearance</code> as the only dimension. Then use a returned appearance as an{" "}
        <code>equals</code> filter in a second query grouped by page, query or another supported dimension.
        The filter value below is a placeholder.
      </p>
      <McpExample example="appearance" />
      <McpExample example="appearanceDetail" />

      <H2 id="report-rules">Report rules</H2>
      <p className={paragraph}>
        The MCP input <code>searchType</code> maps to Google’s <code>type</code> field. Discover excludes{" "}
        <code>query</code> and <code>device</code>. Google News excludes <code>query</code>. The News search
        tab supports it.
      </p>
      <p className={paragraph}>
        Use <code>aggregationType</code> to choose <code>auto</code>, <code>byPage</code>, <code>byProperty</code>
        {" "}or <code>byNewsShowcasePanel</code>. Use property aggregation with reports that omit page grouping
        and filters and use a search type outside Discover and Google News. Showcase aggregation requires
        Discover or Google News, an <code>equals</code> filter for <code>NEWS_SHOWCASE</code>, and a query
        that omits page grouping and filters. The response reports Google’s aggregation and the compatibility
        field separately.
      </p>

      <H2 id="timeline">Cannibalization timeline</H2>
      <p className={paragraph}>
        Use <code>includeTimeline=true</code> on <code>gsc_detect_cannibalization</code> to see daily evidence.
        {" "}<code>timelineQueryLimit</code> defaults to 5 (range 1–10) and <code>minDailyImpressions</code> defaults
        to 10. A summary requires seven observed days. A sustained change requires three consecutive calendar days.
        Use shared daily traffic to identify candidates. Assess simultaneous SERP presence or harm with separate evidence.
      </p>
      <McpExample example="timeline" />

      <H2 id="evidence">Coverage and full evidence</H2>
      <p className={paragraph}>
        Search Console returns the top rows it has available. Review <code>meta.coverage</code> before comparing
        results and treat missing rows as unknown. If <code>maxFetchRows</code> discards rows in 1.2.0 or later,
        it appears in <code>meta.coverage.stoppedBecause</code>. <code>meta.googleDataAttempts</code> counts
        Google data attempts for this request, including retries. Local validation errors show zero attempts.
      </p>
      <p className={paragraph}>
        Use <code>meta.datasetId</code> with <code>gsc_get_dataset</code> to retrieve all recovered timeline
        candidates when the preview is trimmed. Group by <code>index</code>, order by <code>part</code>,
        check the count against <code>parts</code>, then join the <code>evidenceBase64</code> strings. Decode the base64 as UTF-8 and parse the JSON. Audit evidence uses the plain-text <code>evidence</code> field.
      </p>

      <H2 id="next">Related guides</H2>
      <TopicLinks items={[
        { to: "/docs/audits", label: "On-demand audits" },
        { to: "/docs/tools", label: "All MCP tools" },
      ]} />
    </article>
  );
}
