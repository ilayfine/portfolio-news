import { getSupabase } from "@/lib/supabase";
import type { Summary } from "@/lib/types";
import { MOCK_SUMMARIES } from "@/lib/mock-data";
import TickerCard from "../components/TickerCard";

export const revalidate = 300;

async function getSummaries(): Promise<Summary[]> {
  if (!process.env.SUPABASE_URL) return MOCK_SUMMARIES;

  const { data, error } = await getSupabase()
    .from("summaries")
    .select("*")
    .order("ticker");

  if (error) throw error;
  return data?.length ? data : MOCK_SUMMARIES;
}

export default async function PortfolioPage() {
  let summaries: Summary[] = [];
  let fetchError = false;

  try {
    summaries = await getSummaries();
  } catch {
    fetchError = true;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8 opacity-0 animate-fade-in">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Portfolio
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Full coverage for your watchlist
        </p>
      </div>

      {fetchError && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-400 mb-6">
          Failed to load summaries. Check your Supabase connection.
        </div>
      )}

      {summaries.length === 0 && !fetchError ? (
        <div className="text-neutral-500 text-sm">
          No summaries yet. Trigger a refresh via{" "}
          <code className="text-neutral-400 font-mono">/api/refresh</code>.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {summaries.map((s, i) => (
            <TickerCard key={s.ticker} summary={s} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
