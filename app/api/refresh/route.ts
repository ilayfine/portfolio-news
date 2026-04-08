import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { TICKERS } from "@/lib/config";
import type { Headline } from "@/lib/types";

const FMP_BASE = "https://financialmodelingprep.com/api/v3/stock_news";

interface FmpArticle {
  title: string;
  url: string;
  publishedDate: string;
  text: string;
  site: string;
  symbol: string;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchNews(ticker: string): Promise<FmpArticle[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 3 * 24 * 60 * 60 * 1000);
  const url = `${FMP_BASE}?tickers=${ticker}&limit=20&from=${formatDate(from)}&to=${formatDate(to)}&apikey=${process.env.FMP_API_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FMP error for ${ticker}: ${res.status}`);
  return res.json();
}

async function summarize(
  client: Anthropic,
  ticker: string,
  articles: FmpArticle[]
): Promise<{ one_liner: string; detail: string }> {
  const articlesText = articles
    .map((a, i) => `[${i + 1}] ${a.title}\n${a.text.slice(0, 500)}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are a financial news analyst. Given these recent news articles about ${ticker}, produce:
1. ONE_LINER: A single punchy sentence (max 15 words) capturing the dominant theme.
2. DETAIL: A 2-3 sentence summary covering the key developments.

Respond in JSON: {"one_liner": "...", "detail": "..."}

Articles:
${articlesText}`,
      },
    ],
  });

  const text =
    msg.content[0].type === "text" ? msg.content[0].text : "";
  const parsed = JSON.parse(text);
  return { one_liner: parsed.one_liner, detail: parsed.detail };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results: { ticker: string; ok: boolean; error?: string }[] = [];

  for (const ticker of TICKERS) {
    try {
      const articles = await fetchNews(ticker);
      if (articles.length === 0) {
        results.push({ ticker, ok: true, error: "no articles" });
        continue;
      }

      const { one_liner, detail } = await summarize(anthropic, ticker, articles);

      const headlines: Headline[] = articles.slice(0, 5).map((a) => ({
        title: a.title,
        url: a.url,
        publishedDate: a.publishedDate,
      }));

      const { error } = await getSupabase().from("summaries").upsert(
        {
          ticker,
          one_liner,
          detail,
          headlines,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "ticker" }
      );

      if (error) throw error;
      results.push({ ticker, ok: true });
    } catch (e) {
      results.push({
        ticker,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ results });
}
