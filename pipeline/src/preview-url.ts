import { config, buildLinkedInUrl } from "./config";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";

const url = buildLinkedInUrl();
const isManual = !!process.env.LINKEDIN_SEARCH_URL;

console.log(`
${CYAN}${BOLD}══ LinkedIn URL Preview ══${RESET}
`);

if (isManual) {
  console.log(`${YELLOW}  Mode:${RESET}        Manual override (LINKEDIN_SEARCH_URL set)`);
} else {
  console.log(`${GREEN}  Mode:${RESET}        Auto-built from env vars`);
  console.log(`${DIM}  Keywords:${RESET}    ${config.LINKEDIN_KEYWORDS}`);
  console.log(`${DIM}  Skills:${RESET}      ${config.LINKEDIN_SKILLS || "(none)"}`);
  console.log(`${DIM}  Location:${RESET}    geoId=${config.LINKEDIN_GEO_ID}`);
  console.log(`${DIM}  Time:${RESET}        ${config.LINKEDIN_TIME_FILTER === "r86400" ? "Last 24h" : config.LINKEDIN_TIME_FILTER === "r604800" ? "Last 7 days" : config.LINKEDIN_TIME_FILTER === "r2592000" ? "Last 30 days" : config.LINKEDIN_TIME_FILTER}`);
  console.log(`${DIM}  Experience:${RESET}  ${config.LINKEDIN_EXPERIENCE.split(",").map((e: string) => ({ "1": "Intern", "2": "Entry", "3": "Associate", "4": "Mid-Senior", "5": "Director", "6": "Executive" }[e.trim()] || e)).join(", ")}`);
  if (config.LINKEDIN_WORK_TYPE) console.log(`${DIM}  Work type:${RESET}   ${config.LINKEDIN_WORK_TYPE.split(",").map((w: string) => ({ "1": "On-site", "2": "Remote", "3": "Hybrid" }[w.trim()] || w)).join(", ")}`);
  if (config.LINKEDIN_JOB_TYPE) console.log(`${DIM}  Job type:${RESET}    ${config.LINKEDIN_JOB_TYPE.split(",").map((j: string) => ({ "F": "Full-time", "P": "Part-time", "I": "Internship", "C": "Contract", "T": "Temporary" }[j.trim()] || j)).join(", ")}`);
  console.log(`${DIM}  Sort:${RESET}        ${config.LINKEDIN_SORT === "DD" ? "Most recent" : "Most relevant"}`);
}

console.log(`
${BOLD}  URL:${RESET}
${GREEN}  ${url}${RESET}

${DIM}  Copy the URL above and paste in your browser to test.
  If results look good, run: npm run --workspace=pipeline pipeline${RESET}
`);
