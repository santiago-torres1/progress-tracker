/// <reference types="vite/client" />

interface ViteTypeOptions {
  // Makes import.meta.env strict: only the keys declared below are allowed.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COMMIT_SHA?: string;
  /**
   * The Supabase project the browser signs in against. Public by design — the anon key is in the
   * bundle either way, and row-level security is what protects the data, not the key's secrecy.
   * A build without these still runs: it says it has nowhere to keep goals, and nothing else.
   */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Frontend package version, injected by Vite `define` from package.json. */
declare const __APP_VERSION__: string;
