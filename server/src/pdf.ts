import puppeteer, { Browser } from "puppeteer";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      // --no-sandbox is unavoidable inside unprivileged container runtimes
      // (Railway, Fly, k8s) that can't grant SYS_ADMIN for the Chromium
      // sandbox. The other flags harden what we can:
      //   --disable-dev-shm-usage: use /tmp instead of the 64MB default
      //     /dev/shm — prevents crashes on small-shm containers.
      //   --no-zygote / --single-process off: default, keeps multi-process
      //     isolation between renderer and browser process.
      //   --disable-extensions + --disable-background-networking: less
      //     attack surface, less background CPU.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
      ],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    });
  }
  return browser;
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

/** Ensure URL has protocol and return raw URL (NOT html-escaped) for use in href="" */
function safeHref(url: string): string {
  if (!hasVal(url)) return "";
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "https://" + trimmed;
  return trimmed;
}

/** Strip protocol and trailing slash for display */
function urlDisplay(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function buildResumeHtml(data: any): string {
  const p = data.personalInfo || {};
  const summary = data.summary || "";
  const education = data.education || [];
  const skills = data.skills || {};
  const experience = data.experience || [];
  const projects = data.projects || [];
  const certifications = data.certifications || [];
  const awards = data.awards || [];

  // Contact line — plain text, pipe separated, no icons, all links clickable.
  // Every part is wrapped in a .contact-item span with `white-space: nowrap`
  // so URLs and multi-word location strings never break mid-value. The
  // flex-wrap container in CSS then only breaks BETWEEN items (at the
  // separators), keeping handles like "linkedin.com/in/first-last" together
  // as a single token instead of wrapping at the hyphen.
  const wrap = (html: string) => `<span class="contact-item">${html}</span>`;
  const contactParts: string[] = [];
  if (hasVal(p.location)) contactParts.push(wrap(esc(p.location)));
  if (hasVal(p.phone)) contactParts.push(wrap(esc(p.phone)));
  if (hasVal(p.email)) contactParts.push(wrap(`<a href="mailto:${p.email.trim()}">${esc(p.email)}</a>`));

  // Render all link fields dynamically (linkedin, github, portfolio, website, blog, etc.).
  // Every URL-shaped field becomes a clickable <a href> — recruiters expect
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
          <div class="bullets">${(exp.bulletPoints || []).map((bp: any) => `<div class="bullet">- ${bulletText(bp)}</div>`).join("")}</div>
        </div>`;
    }
    experienceHtml += `</div>`;
  }

  // Projects
  let projectsHtml = "";
  if (projects.length > 0) {
    projectsHtml = `<div class="section"><div class="section-title">PROJECTS</div>`;
    for (const proj of projects) {
      projectsHtml += `
        <div class="exp-entry">
          <div class="row">
            <span class="bold">${esc(proj.title)}</span>
            ${hasVal(proj.date) ? `<span class="right bold">${esc(proj.date)}</span>` : ""}
          </div>
          <div class="bullets">${(proj.bulletPoints || []).map((bp: any) => `<div class="bullet">- ${bulletText(bp)}</div>`).join("")}</div>
        </div>`;
    }
    projectsHtml += `</div>`;
  }

  // Skills — render whatever category names the AI returns (not hardcoded)
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
       body — otherwise renders as a single centered line like before. */
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
</body>
</html>`;
}

export async function generateLocalPdf(resumeData: any): Promise<Buffer> {
  const html = buildResumeHtml(resumeData);
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15000 });
    await page.evaluateHandle("document.fonts.ready");

    // Force single-page output. The product contract is: if the user's
    // uploaded resume is one page, the tailored resume must also be one
    // page. We don't know the input page count server-side, but in
    // practice every tailored resume should fit on one Letter page —
    // that's what recruiters expect and what the AI is prompted for.
    //
    // Strategy:
    //   1. Measure body height after initial render.
    //   2. If it exceeds 1056px (Letter @ 96 DPI), shrink font-size +
    //      line-height uniformly to fit, with a 0.70x minimum so text
    //      stays readable.
    //   3. Remeasure. If still overflowing (rare — happens when the AI
    //      generates genuinely too much content), tighten section and
    //      bullet spacing as a last resort.
    //   4. Only if BOTH passes fail do we let the content spill to a
    //      second page — better than unreadable 0.5x text.
    const letterHeightPx = 1056;
    const MIN_SCALE = 0.70;

    const measure = () => page.evaluate(() => document.body.scrollHeight);

    let contentHeight = await measure();
    if (contentHeight > letterHeightPx) {
      const scale = Math.max(MIN_SCALE, letterHeightPx / contentHeight);
      await page.evaluate((s) => {
        const body = document.body;
        const current = parseFloat(getComputedStyle(body).fontSize);
        body.style.fontSize = (current * s) + "px";
        body.style.lineHeight = String(Math.max(1.12, 1.25 * s));
      }, scale);
      await new Promise((r) => setTimeout(r, 60));
      contentHeight = await measure();
    }

    // Second pass — squeeze section/bullet spacing if still over.
    if (contentHeight > letterHeightPx) {
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>(".section").forEach((s) => {
          s.style.marginTop = "3px";
        });
        document.querySelectorAll<HTMLElement>(".exp-entry").forEach((e) => {
          e.style.marginBottom = "2px";
        });
        document.querySelectorAll<HTMLElement>(".bullet").forEach((b) => {
          b.style.marginBottom = "0px";
          b.style.lineHeight = "1.22";
        });
        document.querySelectorAll<HTMLElement>(".edu-entry, .cert-entry").forEach((e) => {
          e.style.marginBottom = "1px";
        });
      });
      await new Promise((r) => setTimeout(r, 60));
      contentHeight = await measure();
    }

    // Third pass — if STILL over, apply one more uniform shrink down to
    // the readability floor. We'd rather ship a slightly tight 1-page
    // PDF than a 2-page one that breaks the product contract.
    if (contentHeight > letterHeightPx) {
      const scale = Math.max(MIN_SCALE, letterHeightPx / contentHeight);
      await page.evaluate((s) => {
        const body = document.body;
        const current = parseFloat(getComputedStyle(body).fontSize);
        body.style.fontSize = (current * s) + "px";
      }, scale);
      await new Promise((r) => setTimeout(r, 60));
    }

    const pdfUint8 = await page.pdf({
      format: "Letter",
      printBackground: true,
      tagged: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      // Belt-and-suspenders single-page enforcement. The three-pass
      // shrink above should have compressed the content to fit, but if
      // the AI genuinely produced more than one page of content, this
      // caps the output at the first page instead of letting it spill.
      // The product contract is "1 page in = 1 page out" — any content
      // loss here is a symptom of over-tailoring, not a PDF bug.
      pageRanges: "1",
    });
    return Buffer.from(pdfUint8);
  } finally {
    await page.close();
  }
}

process.on("exit", () => { browser?.close().catch(() => {}); });
process.on("SIGINT", () => { browser?.close().catch(() => {}); process.exit(); });
