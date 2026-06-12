/**
 * Shared types for the Import Leads tab. Kept out of actions.ts so the
 * client component can import them without touching the "use server"
 * module's runtime exports.
 */

export interface ImportRow {
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
}

export interface ImportRowError {
  line: number;
  message: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: ImportRowError[];
}

export interface ImportCounts {
  total: number;
  added: number;
  duplicates: number;
  failed: number;
}
