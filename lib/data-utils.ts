import type { Summary, Headline } from "./types";

export interface HeadlineWithTicker extends Headline {
  ticker: string;
}

export function getTopMovers(summaries: Summary[], count: number): Summary[] {
  return [...summaries]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
    .slice(0, count);
}

export function getLatestHeadlines(
  summaries: Summary[],
  count: number
): HeadlineWithTicker[] {
  return summaries
    .flatMap((s) =>
      s.headlines.map((h) => ({ ...h, ticker: s.ticker }))
    )
    .sort(
      (a, b) =>
        new Date(b.publishedDate).getTime() -
        new Date(a.publishedDate).getTime()
    )
    .slice(0, count);
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
