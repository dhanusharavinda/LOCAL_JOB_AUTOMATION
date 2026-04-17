const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export const log = {
  info(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${msg}`);
  },

  step(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${CYAN}${BOLD}>>>${RESET} ${msg}`);
  },

  success(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${GREEN}  ✓${RESET} ${msg}`);
  },

  warn(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${YELLOW}  ⚠${RESET} ${msg}`);
  },

  error(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${RED}  ✗${RESET} ${msg}`);
  },

  skip(msg: string) {
    console.log(`${GRAY}${timestamp()}${RESET} ${DIM}  ○ ${msg}${RESET}`);
  },

  job(current: number, total: number, title: string, company: string) {
    console.log(
      `\n${GRAY}${timestamp()}${RESET} ${BLUE}${BOLD}[${current}/${total}]${RESET} ${BOLD}${title}${RESET} ${DIM}@${RESET} ${MAGENTA}${company}${RESET}`
    );
  },

  banner() {
    console.log(`
${CYAN}${BOLD}╔══════════════════════════════════════════╗
║       Job Automation Pipeline            ║
╚══════════════════════════════════════════╝${RESET}
`);
  },

  summary(stats: { scraped: number; locationFiltered: number; relevant: number; tailored: number; applied: number; skipped: number; errors: number }) {
    console.log(`
${BOLD}${CYAN}═══ Pipeline Summary ═══${RESET}
  ${DIM}Scraped:${RESET}     ${BOLD}${stats.scraped}${RESET} jobs from all sources
  ${DIM}Location:${RESET}    ${BOLD}${stats.locationFiltered}${RESET} in target regions
  ${DIM}Relevant:${RESET}    ${GREEN}${BOLD}${stats.relevant}${RESET} passed AI filter (all posted to tracker)
  ${DIM}Tailored:${RESET}    ${BLUE}${BOLD}${stats.tailored}${RESET} top-N resumes + cover letters
  ${DIM}Applied:${RESET}     ${BLUE}${BOLD}${stats.applied}${RESET} fully processed
  ${DIM}Skipped:${RESET}     ${YELLOW}${stats.skipped}${RESET} (duplicates)
  ${DIM}Errors:${RESET}      ${stats.errors > 0 ? RED : ""}${stats.errors}${RESET}
`);
  },
};
