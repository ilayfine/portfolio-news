import type { Summary } from "@/lib/types";
import { timeAgo } from "@/lib/data-utils";

export default function SpotlightCard({
  summary,
  index = 0,
}: {
  summary: Summary;
  index?: number;
}) {
  return (
    <div
      className="group relative rounded-2xl border border-neutral-800/60 bg-neutral-900/50 backdrop-blur-sm p-6 overflow-hidden
        transition-all duration-300 ease-out
        hover:border-neutral-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
        opacity-0 animate-fade-in-up"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent transition-opacity duration-300 group-hover:via-cyan-500/50" />
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/[0.03] to-transparent pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xl font-bold tracking-wide text-white">
            {summary.ticker}
          </span>
          <span className="text-[11px] font-mono text-neutral-500">
            {timeAgo(summary.updated_at)}
          </span>
        </div>

        <p className="text-sm text-neutral-200 leading-relaxed mb-4">
          {summary.one_liner}
        </p>

        <p className="text-sm text-neutral-400 leading-relaxed">
          {summary.detail}
        </p>

        {summary.headlines.length > 0 && (
          <div className="mt-4 pt-3 border-t border-neutral-800/60">
            {summary.headlines.slice(0, 2).map((h, i) => (
              <a
                key={i}
                href={h.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 text-xs py-1 text-cyan-400/80 hover:text-cyan-300 transition-colors duration-150"
              >
                <span className="mt-1.5 h-1 w-1 rounded-full bg-cyan-500/50 shrink-0" />
                <span className="line-clamp-1">{h.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
