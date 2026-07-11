import { config } from "../config";
import { log } from "../logger";
import { LinkedInJob } from "../types";

/**
 * Send a Telegram alert when a high-scoring job is found.
 * No-op when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.
 */
export async function sendTelegramAlert(job: LinkedInJob, score: number, reason: string): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

  const sourceLabel = job.source || "pipeline";
  const sources = job.sources && job.sources.length > 1 ? ` · Found on ${job.sources.length} boards` : "";
  const salary = job.salary ? `\n💰 ${job.salary}` : "";
  const location = job.location ? `\n📍 ${job.location}` : "";
  const link = job.link ? `\n🔗 ${job.link}` : "";

  const text = [
    `🔥 *High-Match Job Alert* - Score: ${score}/10`,
    ``,
    `*${escapeMarkdown(job.title)}*`,
    `🏢 ${escapeMarkdown(job.companyName)}`,
    `📡 ${escapeMarkdown(sourceLabel)}${sources}`,
    salary,
    location,
    ``,
    `💡 _${escapeMarkdown(reason)}_`,
    link,
  ].filter((l) => l !== "").join("\n");

  try {
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn(`Telegram alert failed: ${res.status} ${body}`);
    } else {
      log.success(`Telegram alert sent for: ${job.title} @ ${job.companyName}`);
    }
  } catch (err: any) {
    log.warn(`Telegram alert error: ${err.message}`);
  }
}

/** Escape Telegram MarkdownV1 special chars */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}
