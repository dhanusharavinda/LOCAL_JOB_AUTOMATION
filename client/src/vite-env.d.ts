/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /**
   * Support inbox shown in the floating Contact dialog as a mailto:
   * fallback. Optional - when unset the dialog hides the email row and
   * the "Email instead" link, and feedback goes only through
   * POST /api/feedback.
   */
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
