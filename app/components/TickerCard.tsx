"use client";

import { useState } from "react";
import type { Summary } from "@/lib/types";
import { timeAgo } from "@/lib/data-utils";

export default function TickerCard({
  summary,
  index = 0,
}: {
  summary: Summary;
  index?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="group relative rounded-2xl border border-neutral-800/60 bg-neutral-900/50 backdrop-blur-sm p-6 cursor-pointer
        transition-all duration-300 ease-out
        hover:border-neutral-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
        opacity-0 animate-fade-in-up"
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent transition-opacity duration-300 group-hover:via-cyan-500/40" />

      <div className="flex items-center justify-between mb-2.5">
        <span className="text-lg font-bold tracking-wide text-white">
          {summary.ticker}
        </span>
        <span className="text-[11px] font-mono text-neutral-500">
          {timeAgo(summary.updated_at)}
        </span>
      </div>

      <p className="text-sm text-neutral-300 leading-relaxed">
        {summary.one_liner}
      </p>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="mt-4 space-y-3 border-t border-neutral-800/60 pt-4">
            <p className="text-sm text-neutral-400 leading-relaxed">
              {summary.detail}
            </p>

            {summary.headlines.length > 0 && (
              <ul className="space-y-2">
                {summary.headlines.map((h, i) => (
                  <li key={i} className="text-xs flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-cyan-500/50 shrink-0" />
                    <div>
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-cyan-400 hover:text-cyan-300 transition-colors duration-150"
                      >
                        {h.title}
                      </a>
                      <span className="text-neutral-600 ml-2 font-mono">
                        {new Date(h.publishedDate).toLocaleDateString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
