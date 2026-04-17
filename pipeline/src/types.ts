export interface LinkedInJob {
  id: string;
  link: string;
  title: string;
  companyName: string;
  companyLinkedinUrl?: string;
  companyWebsite?: string;
  companyLogo?: string;
  location: string;
  salary: string;
  postedAt: string;
  descriptionText: string;
  descriptionHtml?: string;
  applicantsCount: string;
  applyUrl: string;
  seniorityLevel: string;
  employmentType: string;
  jobFunction?: string;
  industries?: string;
  /** Multi-source tracking fields */
  source?: string;        // primary source name e.g. "linkedin", "remoteok"
  sources?: string[];     // all sources this job was found on (after dedup merge)
  contentHash?: string;   // SHA-256(title+company+location) for dedup
  tags?: string[];        // skill tags from source
  freshnessScore?: number; // 0–1, 1=posted today
}

/** Normalised job from any free scraper before merging with LinkedIn results */
export interface ScrapedJob {
  title: string;
  companyName: string;
  link?: string;
  applyUrl?: string;
  location?: string;
  salary?: string;
  descriptionText?: string;
  postedAt?: string;
  seniorityLevel?: string;
  applicantsCount?: string;
  employmentType?: string;
  companyWebsite?: string;
  companyLogo?: string;
  tags?: string[];
  source: string;
  externalId?: string;
}

export interface DimensionScore {
  score: number;       // 1-5
  reasoning: string;
}

export interface ScoreBreakdown {
  dimensions: Record<string, DimensionScore>;
  weighted_score: number;   // 1-5 weighted average
  letter_grade: string;     // A-F
  detected_role_type: string;
  gate_capped: boolean;
}

export interface JobVerdict {
  verdict: boolean;
  reason: string;
  score: number;       // 1-10 relevance score (backward compat, derived from weighted 1-5)
  is_reach: boolean;   // true if job mentions senior/4+ years but still relevant
  score_breakdown?: ScoreBreakdown;
  detected_role_type?: string;
}

// Duplicate check returns null when tracker is unreachable (vs true/false)
export type DuplicateCheckResult = boolean | null;

export interface BulletPoint {
  original: string;
  improved: string | null;
  accepted: boolean;
}

export interface ResumeData {
  resumeData: {
    personalInfo: {
      name: string;
      phone: string;
      email: string;
      linkedin: string;
      github: string;
      portfolio: string;
    };
    summary: string;
    education: Array<{
      institution: string;
      date: string;
      degree: string;
      gpa: string;
    }>;
    skills: Record<string, string>;
    experience: Array<{
      title: string;
      company: string;
      date: string;
      location: string;
      summary: string;
      bulletPoints: BulletPoint[];
    }>;
    projects: Array<{
      title: string;
      link: string;
      date: string;
      location: string;
      bulletPoints: BulletPoint[];
    }>;
    certifications: Array<{
      name: string;
      issuer: string;
      date: string;
    }>;
    awards: Array<{
      title: string;
      issuer: string;
      date: string;
    }>;
  };
}

export interface PipelineStats {
  scraped: number;
  locationFiltered: number;
  relevant: number;
  tailored: number;
  applied: number;
  skipped: number;
  errors: number;
}
