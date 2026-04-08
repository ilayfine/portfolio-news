import type { HeadlineWithTicker } from "@/lib/data-utils";
import { timeAgo } from "@/lib/data-utils";

export default function HeadlineFeed({
  headlines,
}: {
  headlines: HeadlineWithTicker[];
}) {
  return (
    <div className="rounded-2xl border border-neutral-800/60 bg-neutral-900/50 backdrop-blur-sm overflow-hidden opacity-0 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
      {headlines.map((h, i) => (
        <a
          key={i}
          href={h.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-neutral-800/40 ${
            i !== headlines.length - 1 ? "border-b border-neutral-800/40" : ""
          }`}
        >
          <span className="shrink-0 inline-flex items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400 text-[10px] font-bold font-mono px-2 py-0.5 min-w-[48px] text-center">
            {h.ticker}
          </span>
          <span className="flex-1 text-sm text-neutral-300 line-clamp-1">
            {h.title}
          </span>
          <span className="shrink-0 text-[11px] font-mono text-neutral-600">
            {timeAgo(h.publishedDate)}
          </span>
        </a>
      ))}
    </div>
  );
}
