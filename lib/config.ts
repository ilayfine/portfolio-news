export const TICKERS = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  "BRK-B",
  "JPM",
  "V",
] as const;

export type Ticker = (typeof TICKERS)[number];
