import type { HtmlTagDescriptor, Plugin } from "vite";

const TITLE = "Canton Lens";
const DESCRIPTION =
  "Explore your private Canton ledger. Inspect transactions, contracts, parties, and tokens within your identity's permissions.";
const IMAGE_ALT = "Canton Lens — Explore your private Canton ledger.";

// Emit metadata into the HTML: sharing crawlers do not need to run the React app.
export function socialMeta(publicUrl: string | undefined): Plugin {
  let canonical: URL | undefined;
  if (publicUrl?.trim()) {
    canonical = new URL(publicUrl.trim());
    if (
      !["http:", "https:"].includes(canonical.protocol) ||
      canonical.username ||
      canonical.password ||
      canonical.search ||
      canonical.hash
    ) {
      throw new Error(
        "VITE_PUBLIC_URL must be an HTTP(S) app URL without credentials, query or hash",
      );
    }
    if (!canonical.pathname.endsWith("/")) canonical.pathname += "/";
  }
  const image = canonical ? new URL("og-image.png", canonical).href : "./og-image.png";
  const meta = (key: "name" | "property", value: string, content: string): HtmlTagDescriptor => ({
    tag: "meta",
    attrs: { [key]: value, content },
    injectTo: "head",
  });
  return {
    name: "social-meta",
    transformIndexHtml() {
      const tags = [
        meta("name", "description", DESCRIPTION),
        meta("property", "og:type", "website"),
        meta("property", "og:site_name", TITLE),
        meta("property", "og:title", TITLE),
        meta("property", "og:description", DESCRIPTION),
        meta("property", "og:image", image),
        meta("property", "og:image:type", "image/png"),
        meta("property", "og:image:width", "1730"),
        meta("property", "og:image:height", "909"),
        meta("property", "og:image:alt", IMAGE_ALT),
        meta("name", "twitter:card", "summary_large_image"),
        meta("name", "twitter:title", TITLE),
        meta("name", "twitter:description", DESCRIPTION),
        meta("name", "twitter:image", image),
        meta("name", "twitter:image:alt", IMAGE_ALT),
      ];
      if (canonical) {
        tags.push(meta("property", "og:url", canonical.href));
        tags.push({
          tag: "link",
          attrs: { rel: "canonical", href: canonical.href },
          injectTo: "head",
        });
      }
      return tags;
    },
  };
}
