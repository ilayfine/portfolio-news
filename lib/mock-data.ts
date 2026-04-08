import type { Summary } from "./types";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

export const MOCK_SUMMARIES: Summary[] = [
  {
    id: "1",
    ticker: "AAPL",
    one_liner: "Apple rallies on strong iPhone 16 demand and AI push",
    detail:
      "Apple shares climbed after analysts raised price targets citing better-than-expected iPhone 16 sales in China and growing excitement around Apple Intelligence features. Services revenue also beat estimates.",
    headlines: [
      { title: "Apple Stock Surges on iPhone 16 Sales Data", url: "#", publishedDate: hoursAgo(2) },
      { title: "Analysts Raise AAPL Targets Amid AI Optimism", url: "#", publishedDate: hoursAgo(4) },
      { title: "Apple Services Revenue Hits Record High", url: "#", publishedDate: hoursAgo(6) },
    ],
    updated_at: hoursAgo(1),
  },
  {
    id: "2",
    ticker: "AMZN",
    one_liner: "AWS growth re-accelerates, ad revenue a bright spot",
    detail:
      "Amazon reported stronger-than-expected cloud growth as enterprise AI workloads boosted AWS demand. Advertising revenue also outpaced estimates, reinforcing the diversification narrative.",
    headlines: [
      { title: "AWS Growth Beats Expectations in Q1", url: "#", publishedDate: hoursAgo(3) },
      { title: "Amazon Ad Business Grows 24% Year-Over-Year", url: "#", publishedDate: hoursAgo(5) },
    ],
    updated_at: hoursAgo(2),
  },
  {
    id: "3",
    ticker: "BRK-B",
    one_liner: "Berkshire cash pile hits $190B as Buffett stays cautious",
    detail:
      "Warren Buffett continues to build cash reserves, signaling lack of attractive large-scale investment opportunities. Insurance underwriting remains strong despite catastrophe losses.",
    headlines: [
      { title: "Berkshire Hathaway Cash Reserves Reach New Record", url: "#", publishedDate: hoursAgo(8) },
      { title: "Buffett Warns of Market Overvaluation at Meeting", url: "#", publishedDate: hoursAgo(12) },
    ],
    updated_at: hoursAgo(3),
  },
  {
    id: "4",
    ticker: "GOOGL",
    one_liner: "Gemini integration drives Search engagement higher",
    detail:
      "Google's AI-powered search overhauls are increasing user engagement and time-on-site. Cloud revenue growth accelerated to 28% as Gemini enterprise adoption expands.",
    headlines: [
      { title: "Google Search Gets Major Gemini AI Upgrade", url: "#", publishedDate: hoursAgo(1) },
      { title: "Google Cloud Revenue Accelerates on AI Demand", url: "#", publishedDate: hoursAgo(5) },
      { title: "Alphabet Announces $70B Buyback Program", url: "#", publishedDate: hoursAgo(7) },
    ],
    updated_at: hoursAgo(1),
  },
  {
    id: "5",
    ticker: "JPM",
    one_liner: "JPMorgan beats on trading revenue, guides higher NII",
    detail:
      "JPMorgan posted record trading revenue driven by fixed-income outperformance. Management raised net interest income guidance, citing a favorable rate environment.",
    headlines: [
      { title: "JPMorgan Q1 Earnings Beat on Trading Strength", url: "#", publishedDate: hoursAgo(4) },
      { title: "JPM Raises Full-Year Net Interest Income Outlook", url: "#", publishedDate: hoursAgo(6) },
    ],
    updated_at: hoursAgo(4),
  },
  {
    id: "6",
    ticker: "META",
    one_liner: "Meta ad revenue surges as Reels monetization takes off",
    detail:
      "Meta reported better-than-expected ad revenue growth driven by Reels monetization improvements and AI-powered ad targeting. Reality Labs losses narrowed slightly quarter-over-quarter.",
    headlines: [
      { title: "Meta Ad Revenue Beats Estimates by Wide Margin", url: "#", publishedDate: hoursAgo(2) },
      { title: "Reels Now Generating Meaningful Ad Revenue for Meta", url: "#", publishedDate: hoursAgo(5) },
      { title: "Meta AI Assistant Reaches 400M Monthly Users", url: "#", publishedDate: hoursAgo(8) },
    ],
    updated_at: hoursAgo(2),
  },
  {
    id: "7",
    ticker: "MSFT",
    one_liner: "Azure AI services fuel Microsoft cloud beat",
    detail:
      "Microsoft exceeded cloud revenue expectations as Azure AI services grew triple digits. Copilot adoption across Office 365 enterprise customers accelerated sharply.",
    headlines: [
      { title: "Microsoft Azure Revenue Jumps 31% on AI Demand", url: "#", publishedDate: hoursAgo(3) },
      { title: "Copilot Adoption Doubles Among Enterprise Customers", url: "#", publishedDate: hoursAgo(6) },
    ],
    updated_at: hoursAgo(2),
  },
  {
    id: "8",
    ticker: "NVDA",
    one_liner: "Nvidia data center revenue doubles on Blackwell ramp",
    detail:
      "Nvidia's data center segment posted record revenue as Blackwell GPU shipments ramped ahead of schedule. Management guided above consensus for next quarter on continued AI infrastructure buildout.",
    headlines: [
      { title: "Nvidia Blackwell GPUs Ship Ahead of Schedule", url: "#", publishedDate: hoursAgo(1) },
      { title: "NVDA Data Center Revenue Hits $30B in Single Quarter", url: "#", publishedDate: hoursAgo(3) },
      { title: "Nvidia Guides Above Street on AI Demand Strength", url: "#", publishedDate: hoursAgo(5) },
    ],
    updated_at: hoursAgo(1),
  },
  {
    id: "9",
    ticker: "TSLA",
    one_liner: "Tesla deliveries miss but robotaxi timeline excites bulls",
    detail:
      "Tesla reported slightly below-expected deliveries as pricing pressure continued in China. However, Musk's announcement of a concrete robotaxi launch timeline sent shares higher in after-hours trading.",
    headlines: [
      { title: "Tesla Q1 Deliveries Fall Short of Estimates", url: "#", publishedDate: hoursAgo(4) },
      { title: "Musk Confirms Robotaxi Launch Date for Austin", url: "#", publishedDate: hoursAgo(6) },
      { title: "Tesla Energy Storage Deployments Surge 150%", url: "#", publishedDate: hoursAgo(10) },
    ],
    updated_at: hoursAgo(3),
  },
  {
    id: "10",
    ticker: "V",
    one_liner: "Visa cross-border volumes surge on travel recovery",
    detail:
      "Visa reported strong cross-border transaction growth as international travel spending continued its recovery. New fintech partnerships are driving volume growth in emerging markets.",
    headlines: [
      { title: "Visa Cross-Border Volume Grows 16% in Q2", url: "#", publishedDate: hoursAgo(5) },
      { title: "Visa Expands Fintech Partnerships in Southeast Asia", url: "#", publishedDate: hoursAgo(9) },
    ],
    updated_at: hoursAgo(5),
  },
];
