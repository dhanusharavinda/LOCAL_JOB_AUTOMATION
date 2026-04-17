import { LinkedInJob, ScrapedJob } from "../types";
import { contentHash, freshnessScore, toLinkedInJob } from "./scrapers/utils";

/**
 * Deduplicate an array of ScrapedJobs:
 * - Same title + company + location → merge sources[], keep best data
 * - Returns LinkedInJob[] with source/sources/contentHash/freshnessScore populated
 */
export function deduplicateJobs(jobs: ScrapedJob[]): LinkedInJob[] {
  const byHash = new Map<string, { job: ScrapedJob; sources: Set<string>; hashes: Set<string> }>();

  for (const job of jobs) {
    const hash = contentHash(job.title, job.companyName, job.location);
    const existing = byHash.get(hash);
    if (existing) {
      existing.sources.add(job.source);
      // Prefer the entry with more description
      if ((job.descriptionText?.length || 0) > (existing.job.descriptionText?.length || 0)) {
        existing.job = { ...job, source: existing.job.source }; // keep primary source
      }
    } else {
      byHash.set(hash, { job, sources: new Set([job.source]), hashes: new Set([hash]) });
    }
  }

  const result: LinkedInJob[] = [];
  for (const [hash, { job, sources }] of byHash) {
    const fresh = freshnessScore(job.postedAt);
    const lj = toLinkedInJob(job, hash, fresh);
    lj.sources = Array.from(sources);
    lj.source = job.source; // primary source (first found)
    result.push(lj);
  }

  return result;
}

/**
 * Merge free-scraper results with Apify/LinkedIn results.
 * LinkedIn data is treated as authoritative when the same job appears on both.
 */
export function mergeWithLinkedIn(linkedInJobs: LinkedInJob[], freeJobs: LinkedInJob[]): LinkedInJob[] {
  const linkedInByHash = new Map<string, LinkedInJob>();

  for (const job of linkedInJobs) {
    const hash = job.contentHash || contentHash(job.title, job.companyName, job.location);
    job.contentHash = hash;
    job.source = job.source || "linkedin";
    job.sources = [job.source];
    job.freshnessScore = freshnessScore(job.postedAt);
    linkedInByHash.set(hash, job);
  }

  const merged: LinkedInJob[] = [...linkedInJobs];

  for (const freeJob of freeJobs) {
    const hash = freeJob.contentHash || contentHash(freeJob.title, freeJob.companyName, freeJob.location);
    const existing = linkedInByHash.get(hash);
    if (existing) {
      // Same job found on LinkedIn AND free source — merge sources
      existing.sources = [...new Set([...(existing.sources || ["linkedin"]), ...(freeJob.sources || [freeJob.source || "free"])])];
      // If free source has richer description, supplement
      if (!existing.descriptionText && freeJob.descriptionText) {
        existing.descriptionText = freeJob.descriptionText;
      }
    } else {
      // Net-new job from free source — add to pipeline
      freeJob.contentHash = hash;
      merged.push(freeJob);
    }
  }

  return merged;
}

/**
 * Compute priority score: combines match_score (0-10) and freshness (0-1).
 * Used to sort jobs so the most relevant + freshest appear first.
 */
export function computePriority(matchScore: number, fresh: number): number {
  return matchScore * 0.7 + fresh * 10 * 0.3;
}
