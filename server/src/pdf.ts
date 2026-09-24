import puppeteer, { Browser } from "puppeteer";
import { normalizeResumeData } from "./resume-shape";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

// Hard ceilings so a wedged Chromium can never hang the request forever.
// Without these, a launch that never connects (missing binary, version
// mismatch, OOM-killed child) leaves the HTTP request open until the
// platform proxy gives up and returns a 502. Failing fast turns that into
// a clean 500 with a logged cause instead.
const LAUNCH_TIMEOUT_MS = 30_000;
const PROTOCOL_TIMEOUT_MS = 60_000;

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    // Fail fast instead of hanging the request if Chromium won't come up,
    // and cap every CDP round-trip so an unresponsive renderer can't stall
    // page.evaluate()/page.pdf() indefinitely.
    timeout: LAUNCH_TIMEOUT_MS,
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    // --no-sandbox is unavoidable inside unprivileged container runtimes
    // (Railway, Fly, k8s) that can't grant SYS_ADMIN for the Chromium
    // sandbox. The other flags harden what we can:
    //   --disable-dev-shm-usage: use /tmp instead of the 64MB default
    //     /dev/shm - prevents crashes on small-shm containers.
    //   --disable-software-rasterizer + --disable-gpu: no GPU in the
    //     container, so skip the fallback rasterizer that wastes memory.
    //   --disable-extensions + --disable-background-networking: less
    //     attack surface, less background CPU.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      // In production containers (Railway et al.) memory is the scarce
      // resource and the OOM killer taking Chromium down mid-render is
      // what turns tailor requests into 502s. Single-process mode trades
      // process isolation (irrelevant for rendering our own trusted HTML)
      // for a dramatically smaller footprint: one Chromium process
      // instead of browser + renderer + utility processes.
      ...(process.env.NODE_ENV === "production"
        ? ["--no-zygote", "--single-process", "--renderer-process-limit=1"]
        : []),
    ],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
  // Collapse concurrent first-hit requests onto a single launch so two
  // tailors landing at once don't spawn two Chromiums (double the memory,
  // the fast path to an OOM kill on a small container).
  if (!launching) {
    launching = launchBrowser()
      .then((b) => { browser = b; return b; })
      .finally(() => { launching = null; });
  }
  return launching;
}

// Drop the cached browser after a failed render so the NEXT request starts
// a fresh Chromium instead of reusing a half-dead one (a crashed child that
// still briefly reports connected is a classic source of repeat 502s).
async function resetBrowser(): Promise<void> {
  const dead = browser;
  browser = null;
  launching = null;
  if (dead) { try { await dead.close(); } catch { /* already gone */ } }
}

/** True when a value is a real string (not empty, not an LLM placeholder like "null"/"undefined"/"N/A"). */
function hasVal(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  return !/^(null|undefined|n\/a|none|-)$/i.test(t);
}

/** Escape text content for HTML (safe for visible text) */
function esc(s: string | null | undefined): string {
  if (!hasVal(s)) return "";
  return s
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn a user-supplied URL into an href value that is safe to interpolate
 * into `href="..."`. Two guarantees:
 *  1. Scheme is forced to http(s): a bare domain gets https:// prepended,
 *     and dangerous schemes (javascript:, data:) never match the http(s)
 *     test so they get https:// prefixed and neutralized into inert links.
 *  2. The result is HTML-attribute-escaped, so a double quote (or angle
 *     bracket) in the URL can't break out of the attribute and inject
 *     markup into the Puppeteer-rendered HTML. This is critical because
 *     /api/pdf/generate renders fully client-controlled resumeData.
 */
function safeHref(url: string): string {
  if (!hasVal(url)) return "";
  const trimmed = url.trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
  return withProto
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strip protocol and trailing slash for display */
function urlDisplay(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function buildResumeHtml(raw: any): string {
  // Accept the shape variants the model drifts into rather than rendering
  // an empty section. See server/src/resume-shape.ts.
  const data = normalizeResumeData(raw);
  const p = data.personalInfo || {};
  const summary = data.summary || "";
  const education = data.education || [];
  const skills = data.skills || {};
  const experience = data.experience || [];
  const projects = data.projects || [];
  const certifications = data.certifications || [];
  const awards = data.awards || [];
  const additionalSections = data.additionalSections || [];

  // Contact line - plain text, pipe separated, no icons, all links clickable.
  // Every part is wrapped in a .contact-item span with `white-space: nowrap`
  // so URLs and multi-word location strings never break mid-value. The
  // flex-wrap container in CSS then only breaks BETWEEN items (at the
  // separators), keeping handles like "linkedin.com/in/first-last" together
  // as a single token instead of wrapping at the hyphen.
  const wrap = (html: string) => `<span class="contact-item">${html}</span>`;
  const contactParts: string[] = [];
  if (hasVal(p.location)) contactParts.push(wrap(esc(p.location)));
  if (hasVal(p.phone)) contactParts.push(wrap(esc(p.phone)));
  if (hasVal(p.email)) contactParts.push(wrap(`<a href="mailto:${esc(p.email.trim())}">${esc(p.email)}</a>`));

  // Render all link fields dynamically (linkedin, github, portfolio, website, blog, etc.).
  // Every URL-shaped field becomes a clickable <a href> - recruiters expect
  // to click portfolio links the same way they click GitHub or LinkedIn.
  const skipFields = new Set(["name", "phone", "email", "location"]);
  for (const [key, value] of Object.entries(p)) {
    if (skipFields.has(key) || !hasVal(value)) continue;
    const v = (value as string).trim();
    const looksLikeUrl = /^https?:\/\//i.test(v) || /\.(com|io|dev|org|net|me|co|ai|app|xyz|tech|site|page|us|uk|in|ie|nl|eu)\b/i.test(v);
    if (looksLikeUrl) {
      contactParts.push(wrap(`<a href="${safeHref(v)}">${esc(urlDisplay(v))}</a>`));
    } else {
      contactParts.push(wrap(esc(v)));
    }
  }

  function bulletText(bp: any): string {
    if (bp.accepted && bp.improved) return esc(bp.improved);
    // Explicit rejection (accepted === false) is authoritative: render the
    // ORIGINAL only. For an AI-added bullet (empty original) this yields ""
    // and the line is filtered out below - so "Reject" in the editor truly
    // removes an added bullet instead of falling back to the improved text.
    // `accepted === false` (not just falsy) preserves legacy behavior for
    // bullets that never carried the flag.
    if (bp.accepted === false) return esc(bp.original || "");
    return esc(bp.original || bp.improved || "");
  }

  // Education
  let educationHtml = "";
  if (education.length > 0) {
    educationHtml = `<div class="section"><div class="section-title">EDUCATION</div>`;
    for (const edu of education) {
      educationHtml += `
        <div class="edu-entry">
          <div class="row">
            <span class="bold">${esc(edu.institution)}</span>
            ${hasVal(edu.date) ? `<span class="right bold">${esc(edu.date)}</span>` : ""}
          </div>
          <div class="italic">${esc(edu.degree)}${hasVal(edu.gpa) ? ` - GPA: ${esc(edu.gpa)}` : ""}</div>
        </div>`;
    }
    educationHtml += `</div>`;
  }

  // Experience
  let experienceHtml = "";
  if (experience.length > 0) {
    experienceHtml = `<div class="section"><div class="section-title">EXPERIENCE</div>`;
    for (const exp of experience) {
      experienceHtml += `
        <div class="exp-entry">
          <div class="row">
            <span class="bold">${esc(exp.title)} - ${esc(exp.company)}</span>
            ${hasVal(exp.date) ? `<span class="right bold">${esc(exp.date)}</span>` : ""}
          </div>
          ${hasVal(exp.location) ? `<div class="location">${esc(exp.location)}</div>` : ""}
          <div class="bullets">${(exp.bulletPoints || []).map((bp: any) => bulletText(bp)).filter((t: string) => t.trim()).map((t: string) => `<div class="bullet">- ${t}</div>`).join("")}</div>
        </div>`;
    }
    experienceHtml += `</div>`;
  }

  // Projects
  let projectsHtml = "";
  if (projects.length > 0) {
    projectsHtml = `<div class="section"><div class="section-title">PROJECTS</div>`;
    for (const proj of projects) {
      // Project repo/demo links were previously dropped from the PDF
      // entirely. Render the title as a clickable link when one exists - 
      // recruiters expect to click straight into the repo, and the
      // text layer still carries the plain title for ATS parsing.
      const titleHtml = hasVal(proj.link)
        ? `<a href="${safeHref(proj.link)}">${esc(proj.title)}</a>`
        : esc(proj.title);
      projectsHtml += `
        <div class="exp-entry">
          <div class="row">
            <span class="bold">${titleHtml}</span>
            ${hasVal(proj.date) ? `<span class="right bold">${esc(proj.date)}</span>` : ""}
          </div>
          <div class="bullets">${(proj.bulletPoints || []).map((bp: any) => bulletText(bp)).filter((t: string) => t.trim()).map((t: string) => `<div class="bullet">- ${t}</div>`).join("")}</div>
        </div>`;
    }
    projectsHtml += `</div>`;
  }

  // Skills - render whatever category names the AI returns (not hardcoded)
  let skillsHtml = "";
  const skillLines: string[] = [];
  for (const [category, value] of Object.entries(skills)) {
    if (value && typeof value === "string" && value.trim()) {
      // Capitalize first letter of category name for display
      const label = category.charAt(0).toUpperCase() + category.slice(1);
      skillLines.push(`<div class="skill-line"><span class="bold">${esc(label)}</span>: ${esc(value)}</div>`);
    }
  }
  if (skillLines.length > 0) {
    skillsHtml = `<div class="section"><div class="section-title">SKILLS</div><div class="skills-block">${skillLines.join("")}</div></div>`;
  }

  // Certifications
  let certsHtml = "";
  if (certifications.length > 0) {
    certsHtml = `<div class="section"><div class="section-title">CERTIFICATIONS</div>`;
    for (const c of certifications) {
      certsHtml += `<div class="cert-entry">`;
      certsHtml += `<div class="bold">${esc(c.name)}${hasVal(c.date) ? ` - ${esc(c.date)}` : ""}</div>`;
      if (hasVal(c.issuer)) certsHtml += `<div class="italic">${esc(c.issuer)}</div>`;
      certsHtml += `</div>`;
    }
    certsHtml += `</div>`;
  }

  // Anything the fixed sections cannot hold: publications, volunteering,
  // languages, patents. These used to be dropped on the floor, which on
  // an academic or early-career resume deletes the best content on it.
  let extraHtml = "";
  for (const sec of additionalSections) {
    const items = Array.isArray(sec?.items) ? sec.items : [];
    const rows = items.filter((it: any) => hasVal(it?.name) || hasVal(it?.detail));
    if (!hasVal(sec?.title) || rows.length === 0) continue;
    extraHtml += `<div class="section"><div class="section-title">${esc(String(sec.title).toUpperCase())}</div>`;
    for (const it of rows) {
      extraHtml += `<div class="cert-entry">`;
      extraHtml += `<div class="bold">${esc(it.name || it.detail)}${hasVal(it.date) ? ` - ${esc(it.date)}` : ""}</div>`;
      if (hasVal(it.name) && hasVal(it.detail)) extraHtml += `<div class="italic">${esc(it.detail)}</div>`;
      extraHtml += `</div>`;
    }
    extraHtml += `</div>`;
  }

  // Awards
  let awardsHtml = "";
  if (awards.length > 0) {
    awardsHtml = `<div class="section"><div class="section-title">AWARDS</div>`;
    for (const a of awards) {
      awardsHtml += `<div class="cert-entry"><div class="bold">${esc(a.title)}${hasVal(a.issuer) ? ` - ${esc(a.issuer)}` : ""}</div>${hasVal(a.date) ? `<div class="italic">${esc(a.date)}</div>` : ""}</div>`;
    }
    awardsHtml += `</div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400;1,700&display=swap');

  @page { margin: 0; size: letter; }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'EB Garamond', Georgia, 'Times New Roman', serif;
    font-feature-settings: "liga" 0;
    font-size: 10.5pt;
    line-height: 1.25;
    color: #000;
    padding: 20px 36px 20px 36px;
  }

  a { color: #0000EE; text-decoration: underline; cursor: pointer; }

  .header { text-align: center; margin-bottom: 4px; }
  .name {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: 22pt;
    /* text-transform: uppercase (not font-variant: small-caps).
       Chromium's synthesized small-caps writes lowercase letters into
       the PDF text layer with a font that lacks a proper ToUnicode
       mapping for the small-cap glyphs, so ATS parsers drop the
       lowercase characters and "Aravind" gets extracted as "Arvind".
       text-transform feeds genuine uppercase characters to the PDF
       text layer, which every ATS reads cleanly. */
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 1px;
    color: #000;
    margin-bottom: 4px;
  }
  .contact {
    font-size: 9pt;
    color: #000;
    line-height: 1.4;
    /* Flex + wrap so tokens break cleanly between items (at separators)
       instead of mid-URL. Only triggers when content is wider than the
       body - otherwise renders as a single centered line like before. */
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    row-gap: 2px;
  }
  .contact a { color: #0000EE; text-decoration: underline; }
  /* Each contact part (location, phone, email, linkedin, github, etc.) is
     a nowrap unit so multi-word text and long URLs never split mid-value. */
  .contact-item { white-space: nowrap; }
  .contact-sep { margin: 0 6px; color: #666; white-space: nowrap; }

  .section { margin-top: 6px; }
  .section-title {
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #000;
    border-bottom: 1px solid #000;
    padding-bottom: 1px;
    margin-bottom: 3px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .right {
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 12px;
    text-align: right;
  }
  .bold { font-weight: 700; }
  .italic { font-style: italic; }

  .summary-text {
    font-size: 10pt;
    line-height: 1.35;
    margin-top: 2px;
  }

  .edu-entry { margin-bottom: 1px; font-size: 10pt; }
  .edu-entry .italic { font-size: 10pt; }

  .exp-entry { margin-bottom: 5px; font-size: 10pt; }
  .location {
    font-style: italic;
    font-size: 10pt;
    text-align: right;
    margin-top: -1px;
  }

  .bullets { margin-top: 1px; }
  .bullet {
    font-size: 10pt;
    line-height: 1.3;
    margin-bottom: 1px;
    padding-left: 16px;
    text-indent: -12px;
  }

  .skills-block {
    font-size: 10pt;
    line-height: 1.45;
    padding-left: 10px;
  }
  .skill-line { margin-bottom: 0; }

  .cert-entry { margin-bottom: 3px; font-size: 10pt; }
  .cert-entry .italic { font-size: 9.5pt; }

  /* ---- Page-break rules ---- */
  /* Never split a section title from its first content */
  .section-title {
    break-after: avoid;
    page-break-after: avoid;
  }
  /* Never split an individual entry (edu, experience, project, cert) across pages */
  .edu-entry, .exp-entry, .cert-entry {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Keep section heading + first entry together */
  .section {
    break-inside: auto;
    page-break-inside: auto;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="name">${esc(p.name)}</div>
    <div class="contact">${contactParts.join(`<span class="contact-sep">|</span>`)}</div>
  </div>

  ${summary ? `<div class="section"><div class="section-title">PROFESSIONAL SUMMARY</div><div class="summary-text">${esc(summary)}</div></div>` : ""}
  ${educationHtml}
  ${skillsHtml}
  ${experienceHtml}
  ${projectsHtml}
  ${certsHtml}
  ${awardsHtml}
  ${extraHtml}
</body>
</html>`;
}

/**
 * Estimate how many Letter pages an uploaded resume occupies, from the
 * length of its extracted text. Aligns with the pipeline's existing
 * single-page boundary (~4200 chars) so both the prompt and the renderer
 * agree on what "one page" means. Returns 1, 2, or 3.
 *
 * This is a proxy: PDF text extraction strips layout, so character count is
 * the most reliable cross-format signal we have (a real PDF page count from
 * pdf-parse, when available, can be passed straight through as targetPages
 * instead and takes precedence).
 */
export function estimateResumePages(resumeText: string | null | undefined): number {
  const len = (resumeText || "").length;
  if (len < 4200) return 1;
  if (len < 9500) return 2;
  return 3;
}

export async function generateLocalPdf(
  resumeData: any,
  opts?: { targetPages?: number },
): Promise<Buffer> {
  // Page budget = the input resume's page count. "1 page in -> 1 page out,
  // 2 -> 2." Defaults to 1 so any caller that doesn't pass a target keeps
  // the original single-page behavior. Clamped to [1, 3].
  const targetPages = Math.min(3, Math.max(1, Math.round(opts?.targetPages || 1)));
  const html = buildResumeHtml(resumeData);

  // One retry: if the render fails on a stale/crashed browser (Chromium
  // child died between requests), throw away the singleton and try once
  // with a fresh instance before giving up. Prevents a single bad Chromium
  // state from turning every subsequent tailor into a 502.
  try {
    return await renderPdf(html, targetPages);
  } catch (err: any) {
    console.warn("[pdf] render failed, relaunching Chromium and retrying:", err?.message || err);
    await resetBrowser();
    return await renderPdf(html, targetPages);
  }
}

async function renderPdf(html: string, targetPages: number): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });
    await page.evaluateHandle("document.fonts.ready");

    // Fit the content within the target page budget. We only ever SHRINK to
    // avoid spilling PAST the budget; we never stretch content to fill more
    // pages, so a short resume given a 2-page budget still renders short.
    //
    // Strategy:
    //   1. Measure body height after initial render.
    //   2. If it exceeds the budget (targetPages × 1056px @ 96 DPI), shrink
    //      font-size + line-height uniformly to fit, with a 0.70x minimum so
    //      text stays readable.
    //   3. Remeasure. If still overflowing, tighten section + bullet spacing.
    //   4. If STILL over, one more uniform shrink down to the readability
    //      floor before the page-range cap clips any final overflow.
    const letterHeightPx = 1056;
    const budgetPx = letterHeightPx * targetPages;
    const MIN_SCALE = 0.70;

    const measure = () => page.evaluate(() => document.body.scrollHeight);

    let contentHeight = await measure();
    if (contentHeight > budgetPx) {
      const scale = Math.max(MIN_SCALE, budgetPx / contentHeight);
      await page.evaluate((s) => {
        const body = document.body;
        const current = parseFloat(getComputedStyle(body).fontSize);
        body.style.fontSize = (current * s) + "px";
        body.style.lineHeight = String(Math.max(1.12, 1.25 * s));
      }, scale);
      await new Promise((r) => setTimeout(r, 60));
      contentHeight = await measure();
    }

    // Second pass - squeeze section/bullet spacing if still over budget.
    if (contentHeight > budgetPx) {
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>(".section").forEach((s) => {
          s.style.marginTop = "3px";
        });
        document.querySelectorAll<HTMLElement>(".exp-entry").forEach((e) => {
          e.style.marginBottom = "2px";
        });
        document.querySelectorAll<HTMLElement>(".bullet").forEach((bl) => {
          bl.style.marginBottom = "0px";
          bl.style.lineHeight = "1.22";
        });
        document.querySelectorAll<HTMLElement>(".edu-entry, .cert-entry").forEach((e) => {
          e.style.marginBottom = "1px";
        });
      });
      await new Promise((r) => setTimeout(r, 60));
      contentHeight = await measure();
    }

    // Third pass - if STILL over, one more uniform shrink to the floor.
    if (contentHeight > budgetPx) {
      const scale = Math.max(MIN_SCALE, budgetPx / contentHeight);
      await page.evaluate((s) => {
        const body = document.body;
        const current = parseFloat(getComputedStyle(body).fontSize);
        body.style.fontSize = (current * s) + "px";
      }, scale);
      await new Promise((r) => setTimeout(r, 60));
      contentHeight = await measure();
    }

    // How many pages the content ACTUALLY needs after all the shrinking.
    // Content that still overflows the budget gets the pages it needs (up
    // to 3) instead of being cut off. Spilling onto a second page is a
    // cosmetic problem; dropping someone's experience or certifications
    // off the bottom of the page is a broken resume, and the trailing
    // sections are exactly the ones a hard clip would eat.
    const neededPages = Math.min(3, Math.max(targetPages, Math.ceil(contentHeight / letterHeightPx - 0.02)));
    if (neededPages > targetPages) {
      console.warn(`[pdf] content needs ${neededPages} pages at the ${MIN_SCALE}x floor (budget was ${targetPages}); keeping the overflow rather than clipping it`);
    }

    const pdfUint8 = await page.pdf({
      format: "Letter",
      printBackground: true,
      tagged: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      // Normally this is the input's page count (1 page in -> "1"), which
      // the shrink passes above have already fitted. It only widens when
      // the content genuinely does not fit at the readability floor, so
      // nothing is ever silently cut off.
      pageRanges: `1-${neededPages}`,
    });
    return Buffer.from(pdfUint8);
  } finally {
    await page.close();
  }
}

process.on("exit", () => { browser?.close().catch(() => {}); });
process.on("SIGINT", () => { browser?.close().catch(() => {}); process.exit(); });
