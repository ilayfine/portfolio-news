import { getSupabase } from "@/lib/supabase";
import type { Summary } from "@/lib/types";
import { MOCK_SUMMARIES } from "@/lib/mock-data";
import {
  getTopMovers,
  getLatestHeadlines,
  getGreeting,
} from "@/lib/data-utils";
import SpotlightCard from "./components/SpotlightCard";
import HeadlineFeed from "./components/HeadlineFeed";
import TickerPill from "./components/TickerPill";
import SectionHeader from "./components/SectionHeader";

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

export default async function Home() {
  let summaries: Summary[] = [];
  let fetchError = false;

  try {
    summaries = await getSummaries();
  } catch {
    fetchError = true;
  }

  const topMovers = getTopMovers(summaries, 3);
  const latestHeadlines = getLatestHeadlines(summaries, 8);
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
      {/* Greeting */}
      <div className="opacity-0 animate-fade-in">
        <h1 className="text-3xl font-bold text-white tracking-tight">
          {getGreeting()}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {today} &middot; Tracking {summaries.length} tickers
        </p>
      </div>

      {fetchError && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-400">
          Failed to load summaries. Check your Supabase connection.
        </div>
      )}

      {summaries.length > 0 && (
        <>
          {/* Market Pulse */}
          <section>
            <SectionHeader
              title="Market Pulse"
              subtitle="Most recently updated"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {topMovers.map((s, i) => (
                <SpotlightCard key={s.ticker} summary={s} index={i} />
              ))}
            </div>
          </section>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-neutral-800 to-transparent" />

          {/* Latest Headlines */}
          <section>
            <SectionHeader
              title="Latest Headlines"
              subtitle="Recent news across your portfolio"
            />
            <HeadlineFeed headlines={latestHeadlines} />
          </section>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-neutral-800 to-transparent" />

          {/* Portfolio Overview */}
          <section>
            <SectionHeader
              title="Your Portfolio"
              action={{ label: "View All", href: "/portfolio" }}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {summaries.map((s, i) => (
                <TickerPill key={s.ticker} summary={s} index={i} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
