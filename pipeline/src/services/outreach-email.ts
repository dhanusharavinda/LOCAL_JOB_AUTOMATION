import OpenAI from "openai";
import { config } from "../config";
import { buildCoverLetterPrompt } from "../prompts/outreach";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      maxRetries: 3,
    });
  }
  return client;
}

interface CoverLetterResult {
  coverLetter: string;
  whyImAFit: string;
}

export async function generateCoverLetter(
  companyName: string,
  jobTitle: string,
  candidateSkills: string,
  jobDescription: string,
  candidateName?: string
): Promise<CoverLetterResult> {
  const openai = getClient();
  const prompt = buildCoverLetterPrompt(companyName, jobTitle, candidateSkills, jobDescription, candidateName);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a cover letter writing assistant. Write personalized, impactful cover letters and fit summaries. Return valid JSON only. No backticks, no markdown, no em dashes.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("OpenAI returned empty response for cover letter");
    }

    try {
      // Strip any markdown code fences if present
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        coverLetter: parsed.coverLetter || "",
        whyImAFit: parsed.whyImAFit || "",
      };
    } catch {
      if (attempt === 2) {
        // Last attempt — return raw text as cover letter, empty fit
        return { coverLetter: text, whyImAFit: "" };
      }
    }
  }

  // Should never reach here, but TypeScript wants a return
  return { coverLetter: "", whyImAFit: "" };
}
