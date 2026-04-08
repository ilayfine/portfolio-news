import Link from "next/link";
import type { Summary } from "@/lib/types";

export default function TickerPill({
  summary,
  index = 0,
}: {
  summary: Summary;
  index?: number;
}) {
  return (
    <Link
      href="/portfolio"
      className="group flex items-center gap-3 rounded-xl bg-neutral-900/40 border border-neutral-800/40 px-4 py-3
        transition-all duration-200 hover:bg-neutral-800/60 hover:border-neutral-700/60
        opacity-0 animate-fade-in-up"
      style={{ animationDelay: `${300 + index * 50}ms` }}
    >
      <span className="text-sm font-semibold text-white shrink-0">
        {summary.ticker}
      </span>
      <span className="text-xs text-neutral-500 truncate">
        {summary.one_liner}
      </span>
    </Link>
  );
}
