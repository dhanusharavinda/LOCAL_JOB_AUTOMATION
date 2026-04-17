import { config } from "../config";
import { log } from "../logger";
import { ResumeData } from "../types";
import { internalAuthHeaders } from "./job-tracker";

/**
 * Generate PDF via the local server endpoint.
 * No cold-start warm-up needed — the server is always running locally.
 */
export async function generatePdf(resumeData: ResumeData): Promise<Buffer> {
  const pdfUrl = `${config.JOB_TRACKER_URL}/api/pdf/generate`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s timeout

      const response = await fetch(pdfUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
        body: JSON.stringify(resumeData.resumeData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`PDF endpoint returned ${response.status}: ${errText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/pdf") && !contentType.includes("application/octet-stream")) {
        throw new Error(`Unexpected content-type: "${contentType}"`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length < 5 || buffer.toString("ascii", 0, 4) !== "%PDF") {
        throw new Error("Response is not a valid PDF (missing %PDF header)");
      }

      return buffer;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw new Error(`PDF generation failed after ${maxRetries} attempts: ${error.message}`);
      }
      log.warn(`PDF attempt ${attempt} failed: ${error.message}, retrying...`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  throw new Error("PDF generation failed after all retries");
}

// No-op warm-up since the server is local (kept for backward compatibility)
export async function warmUpPdfBackend(): Promise<void> {
  log.success("PDF generation: using local server (no warm-up needed)");
}
