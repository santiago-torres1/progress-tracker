/// <reference types="vite/client" />

interface ViteTypeOptions {
  // Makes import.meta.env strict: only the keys declared below are allowed.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COMMIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Frontend package version, injected by Vite `define` from package.json. */
declare const __APP_VERSION__: string;
