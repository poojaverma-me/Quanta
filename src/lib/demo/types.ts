import type { DatasetProfile, Report } from "../types";

/**
 * A pre-computed analysis pack for one of the sample datasets. Every narrative
 * number was computed from the CSV before it was written, and `checks` let
 * `npm run verify-demo` re-prove each one against the data. In SQL, `{t}` is
 * replaced with the loaded table's name.
 */
export interface DemoCheck {
  sql: string;
  /** Expected first-row values; numbers match within rounding (±0.051). */
  expect: (number | string)[];
}

export type DemoStep = { kind: "thinking" | "note"; text: string } | { kind: "query"; purpose: string; sql: string };

export interface DemoScenario {
  id: string;
  objective: string;
  keywords: string[];
  steps: DemoStep[];
  report: Report;
  checks: DemoCheck[];
}

export interface DemoQA {
  question: string;
  keywords: string[];
  sql: string;
  explanation: string;
  answer: string;
  checks: DemoCheck[];
}

export interface DemoPack {
  id: string;
  /** CSV headers, used to recognize the file even if it was renamed. */
  headers: string[];
  profile: DatasetProfile;
  scenarios: DemoScenario[];
  qa: DemoQA[];
}
