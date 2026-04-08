export interface Headline {
  title: string;
  url: string;
  publishedDate: string;
}

export interface Summary {
  id: string;
  ticker: string;
  one_liner: string;
  detail: string;
  headlines: Headline[];
  updated_at: string;
}
