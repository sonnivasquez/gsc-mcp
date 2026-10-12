import { FAQS } from "@/components/home-faq";
import { MAINTAINER, PKG_NAME, SITE_NAME, SITE_ORIGIN, siteOgImage } from "@/lib/site";

/**
 * JSON-LD for the homepage, mirroring what production already serves.
 *
 * Two independent blocks rather than one @graph: the FAQPage entity is
 * validated by a different Google pipeline than the product entity, and
 * keeping them apart means a FAQ edit cannot invalidate the rich result
 * for the product.
 *
 * The FAQ questions and answers come from the same FAQS array the page
 * renders, so the markup can never claim an answer the visitor cannot read.
 * Google treats that mismatch as a manual-action risk.
 */
export function homeStructuredData(): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          name: SITE_NAME,
          url: SITE_ORIGIN,
        },
        {
          "@type": "SoftwareApplication",
          name: SITE_NAME,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "macOS, Linux, Windows",
          offers: {
            "@type": "Offer",
            price: 0,
            priceCurrency: "USD",
          },
          url: SITE_ORIGIN,
          image: siteOgImage(),
          description:
            "Connect your AI assistant with a local Google Search Console MCP server. Analyze traffic, find search opportunities, and inspect indexing. Read-only by default.",
          author: {
            "@type": "Person",
            name: MAINTAINER.name,
            url: MAINTAINER.site,
          },
          isAccessibleForFree: true,
          license: `https://www.apache.org/licenses/LICENSE-2.0`,
          softwareRequirements: `${PKG_NAME} running on Bun >= 1 or Node >= 22`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answerText,
        },
      })),
    },
  ];
}

/** Serialize JSON-LD for a <script type="application/ld+json"> tag. */
export function toJsonLd(data: unknown): string {
  return JSON.stringify(data);
}
