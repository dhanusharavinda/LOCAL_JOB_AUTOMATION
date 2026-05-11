export type JobStatus = "filtered" | "saved" | "applied" | "interviewing" | "offer" | "rejected";

export interface DimensionScore {
  score: number;
  reasoning: string;
}

export interface ScoreBreakdown {
  dimensions: Record<string, DimensionScore>;
  weighted_score: number;
  letter_grade: string;
  detected_role_type: string;
  gate_capped: boolean;
}

export interface Job {
  id: number;
  job_title: string;
  company_name: string;
  company_url: string | null;
  job_link: string | null;
  location: string | null;
  salary: string | null;
  seniority_level: string | null;
  applicants_count: string | null;
  apply_url: string | null;
  resume_url: string | null;
  outreach_email: string | null;
  description: string | null;
  status: JobStatus;
  match_score: number | null;
  match_reason: string | null;
  applied_date: string | null;
  notes: string | null;
  deadline: string | null;
  job_category: string | null;
  interview_date: string | null;
  offer_date: string | null;
  // Multi-source fields
  source: string | null;
  sources: string | null;   // JSON array stored as string
  source_count: number | null;
  content_hash: string | null;
  posted_at: string | null;
  freshness_score: number | null;
  tags: string | null;      // JSON array stored as string
  cover_letter: string | null;
  hiring_message: string | null;
  flagged: number;
  interview_prep: string | null;
  expired: number;
  last_checked_at: string | null;
  expiry_reason: string | null;
  ats_score: number | null;
  resume_profile_id: number | null;
  score_breakdown: string | null;    // JSON string of ScoreBreakdown
  detected_role_type: string | null;
  keyword_match_rate: number | null;
  /** Latest interview-practice readiness score for this role (0-100).
   *  Populated by /api/interview/score and surfaced as a small badge
   *  on the kanban card and JobDetailModal "Practice" button. */
  interview_readiness_score?: number | null;
  created_at: string;
  updated_at: string;
}

export interface CareerEvent {
  id: number;
  title: string;
  organizer: string | null;
  location: string | null;
  event_date: string | null;
  event_url: string | null;
  description: string | null;
  event_type: string;
  source: string | null;
  scraped_at: string;
}

export interface SkillData {
  skill: string;
  count: number;
  pct: number;
}

export interface Column {
  id: JobStatus;
  title: string;
  emoji: string;
  gradient: string;
  dotColor: string;
  cardAccent: string;
  countBg: string;
}

export const COLUMNS: Column[] = [
  {
    id: "filtered",
    title: "Filtered",
    emoji: "",
    gradient: "border-t-2 border-t-[#5b9ea6]",
    dotColor: "bg-[#5b9ea6]",
    cardAccent: "hover:border-[#5b9ea6]/30",
    countBg: "bg-[#5b9ea6]/10 text-[#5b9ea6]",
  },
  {
    id: "saved",
    title: "Saved",
    emoji: "",
    gradient: "border-t-2 border-t-[#7a7f94]",
    dotColor: "bg-[#7a7f94]",
    cardAccent: "hover:border-[#7a7f94]/30",
    countBg: "bg-[#7a7f94]/10 text-[#7a7f94]",
  },
  {
    id: "applied",
    title: "Applied",
    emoji: "",
    gradient: "border-t-2 border-t-[#6775a0]",
    dotColor: "bg-[#6775a0]",
    cardAccent: "hover:border-[#6775a0]/30",
    countBg: "bg-[#6775a0]/10 text-[#6775a0]",
  },
  {
    id: "interviewing",
    title: "Interviewing",
    emoji: "",
    gradient: "border-t-2 border-t-[#c9a94e]",
    dotColor: "bg-[#c9a94e]",
    cardAccent: "hover:border-[#c9a94e]/30",
    countBg: "bg-[#c9a94e]/10 text-[#c9a94e]",
  },
  {
    id: "offer",
    title: "Offer",
    emoji: "",
    gradient: "border-t-2 border-t-[#5d9968]",
    dotColor: "bg-[#5d9968]",
    cardAccent: "hover:border-[#5d9968]/30",
    countBg: "bg-[#5d9968]/10 text-[#5d9968]",
  },
  {
    id: "rejected",
    title: "Rejected",
    emoji: "",
    gradient: "border-t-2 border-t-[#c45252]",
    dotColor: "bg-[#c45252]",
    cardAccent: "hover:border-[#c45252]/30",
    countBg: "bg-[#c45252]/10 text-[#c45252]",
  },
];
