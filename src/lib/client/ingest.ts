import { DEMO_MODEL, findPack } from "../demo";
import { computeStats, fallbackProfile, materialize, reconcileProfile, stageCsv, uniqueTableName } from "../pipeline";
import type { LoadedDataset } from "../types";
import { api } from "./api";
import { dropFile, query, registerFile } from "./duckdb";

export type IngestStage = "reading" | "profiling" | "building" | "analyzing" | "done";

let uploads = 0;

/**
 * Upload → stage as VARCHAR → Haiku profiles 20 sample rows → typed table → local stats.
 * If the AI profiler is unavailable, DuckDB's own type detection is used instead.
 */
export async function ingestCsv(
  fileName: string,
  bytes: Uint8Array,
  takenTables: string[],
  onStage: (stage: IngestStage, note?: string, model?: string) => void,
): Promise<{ dataset: LoadedDataset; warning?: string }> {
  onStage("reading");
  const virtualName = `upload_${++uploads}_${fileName.replace(/[^\w.-]/g, "_")}`;
  await registerFile(virtualName, bytes);
  const raw = `_raw_${uploads}`;
  const sample = await stageCsv(query, virtualName, raw);
  if (!sample.headers.length || sample.rowCount === 0) throw new Error("That file has no rows we could read. Is it a CSV with a header row?");

  // Sample datasets come with a profile pre-computed by Claude Opus 5.5.
  const pack = findPack(sample.headers);
  const note = `${sample.rowCount.toLocaleString()} rows · ${sample.headers.length} columns`;
  onStage("profiling", note, pack ? DEMO_MODEL : "Claude Haiku");
  let warning: string | undefined;
  let profile;
  let usage;
  let fallback = false;
  if (pack) {
    await new Promise((r) => setTimeout(r, 1800));
    profile = reconcileProfile(pack.profile, sample, fileName);
  } else try {
    const res = await api.profile({ fileName, headers: sample.headers, detectedTypes: sample.detectedTypes, rows: sample.rows, rowCount: sample.rowCount, ranges: sample.ranges });
    profile = reconcileProfile(res.profile, sample, fileName);
    usage = res.usage;
  } catch (e) {
    warning = `AI profiling unavailable (${e instanceof Error ? e.message : e}). Using automatic type detection.`;
    profile = fallbackProfile(fileName, sample);
    fallback = true;
  }

  onStage("building");
  const table = uniqueTableName(profile.table_name, takenTables);
  const built = await materialize(query, raw, table, profile);
  await dropFile(virtualName);

  onStage("analyzing");
  const stats = await computeStats(query, table, built.profile, built.failures);
  onStage("done");
  return {
    dataset: {
      id: `${table}-${Date.now()}`,
      fileName,
      tableName: table,
      rowCount: sample.rowCount,
      profile: built.profile,
      stats,
      fallback,
      usage,
      demoPackId: pack?.id,
      loadedAt: Date.now(),
    },
    warning,
  };
}
