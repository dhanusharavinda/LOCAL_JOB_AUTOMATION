/**
 * Link-aware resume parsing.
 *
 * Problem: resumes routinely carry contact links as HYPERLINKS — the
 * visible text says "GitHub" or "LinkedIn" while the URL lives in a PDF
 * link annotation or a DOCX hyperlink relationship. The default
 * extractors throw those targets away:
 *   - pdf-parse's default page renderer only calls getTextContent()
 *     (never getAnnotations()), so PDF link targets are dropped.
 *   - mammoth.extractRawText() strips all formatting including hrefs.
 * Downstream, the tailoring LLM is ordered to output FULL https:// URLs
 * it never saw, so personalInfo.github/linkedin end up as dead labels
 * (or worse, hallucinated URLs) in the generated PDF.
 *
 * Fix: extract the embedded link targets alongside the text and append
 * them in a clearly-delimited "EMBEDDED HYPERLINKS" section the LLM can
 * use to resolve label-only links. The prompts (server free-tailor +
 * pipeline resume) both reference this section by name.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth");

export interface ParsedDoc {
  /** Extracted text with the EMBEDDED HYPERLINKS section appended (when any). */
  text: string;
  /** Extracted text WITHOUT the appended links section (for length checks). */
  rawText: string;
  /** True total page count (PDF only; null for DOCX). */
  pages: number | null;
  /** Unique http(s) link targets found in the document, in encounter order. */
  links: string[];
}

const MAX_LINKS = 30; // a resume with more embedded links than this is noise
const MAX_LINK_LENGTH = 500; // guard against pathological data: URIs etc.

/** Append the embedded-links section the tailoring prompts know about. */
function withLinksSection(rawText: string, links: string[]): string {
  if (links.length === 0) return rawText;
  const list = links.slice(0, MAX_LINKS).map((u) => `- ${u}`);
  return (
    rawText +
    "\n\n=== EMBEDDED HYPERLINKS (extracted from the document's link annotations; use to resolve link labels like \"GitHub\" or \"LinkedIn\" to full URLs) ===\n" +
    list.join("\n")
  );
}

function isUsableLink(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.length === 0 || url.length > MAX_LINK_LENGTH) return false;
  // Reject any whitespace (space/newline/tab): a URL containing a newline
  // could smuggle arbitrary non-URL text into the EMBEDDED HYPERLINKS block,
  // which flows into the LLM prompt — a prompt-injection vector. Legitimate
  // profile URLs never contain whitespace.
  if (/\s/.test(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse a PDF buffer, extracting both text AND link-annotation targets.
 *
 * Uses pdf-parse's `pagerender` hook, which hands us the underlying
 * pdf.js page proxy — so we can call getAnnotations() (link targets)
 * alongside getTextContent() (visible text). The text assembly below
 * replicates pdf-parse's default renderer line-joining behavior so the
 * extracted text is byte-identical to what the previous code produced.
 */
export async function parsePdfWithLinks(
  buffer: Buffer,
  opts?: { maxPages?: number },
): Promise<ParsedDoc> {
  const links: string[] = [];
  const seen = new Set<string>();

  const pagerender = async (pageData: any): Promise<string> => {
    const [textContent, annotations] = await Promise.all([
      pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }),
      // Annotation extraction is best-effort: a malformed annotation
      // dictionary must never take down text extraction with it.
      pageData.getAnnotations().catch(() => []),
    ]);

    for (const a of annotations || []) {
      // Stop accumulating once the cap is hit — a hostile PDF with tens of
      // thousands of link annotations must not grow `links`/`seen` unbounded.
      if (links.length >= MAX_LINKS) break;
      // pdf.js exposes Link annotations with a resolved `url` for
      // external URI actions. Internal jumps (`dest`) have no url and
      // are skipped. mailto:/tel: are skipped too — emails and phones
      // are visible text on any sane resume, and the LLM prompt only
      // needs http(s) targets to resolve label-only profile links.
      const url = a && a.subtype === "Link" ? a.url : undefined;
      if (isUsableLink(url) && !seen.has(url)) {
        seen.add(url);
        links.push(url);
      }
    }

    // Replicate pdf-parse's default text assembly (same Y-coordinate
    // heuristic for line breaks) so behavior matches the old path.
    let lastY: number | undefined;
    let text = "";
    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += "\n" + item.str;
      }
      lastY = item.transform[5];
    }
    return text;
  };

  const options: Record<string, unknown> = { pagerender };
  if (opts?.maxPages && opts.maxPages > 0) options.max = opts.maxPages;

  const data = await pdfParse(buffer, options);
  const rawText = String(data?.text || "");
  return {
    text: withLinksSection(rawText, links),
    rawText,
    pages: data?.numpages || null,
    links,
  };
}

/** Minimal HTML entity decode for href attribute values out of mammoth. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parse a DOCX buffer, extracting raw text AND hyperlink targets.
 *
 * extractRawText() stays the canonical text source (its output feeds
 * length checks and the LLM exactly as before); convertToHtml() runs
 * alongside purely to harvest <a href="..."> targets, which raw text
 * extraction discards. HTML conversion failures are non-fatal — we
 * just lose the links, same as the old behavior.
 */
export async function parseDocxWithLinks(buffer: Buffer): Promise<ParsedDoc> {
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }).catch(() => null),
  ]);

  const rawText = String(raw?.value || "").trim();
  const links: string[] = [];
  const seen = new Set<string>();

  const htmlValue: string = html && typeof html.value === "string" ? html.value : "";
  if (htmlValue) {
    const hrefRe = /href="([^"]+)"/g;
    let m: RegExpExecArray | null;
    // Bounded by MAX_LINKS so a hostile DOCX with thousands of hyperlinks
    // can't inflate the accumulator.
    while (links.length < MAX_LINKS && (m = hrefRe.exec(htmlValue)) !== null) {
      const url = decodeEntities(m[1]);
      if (isUsableLink(url) && !seen.has(url)) {
        seen.add(url);
        links.push(url);
      }
    }
  }

  return {
    text: withLinksSection(rawText, links),
    rawText,
    pages: null,
    links,
  };
}
