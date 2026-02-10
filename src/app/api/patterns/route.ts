import { NextResponse } from "next/server";
import { parseFiltersFromQuery, runSearch } from "@/lib/search";
import { generatePatterns } from "@/lib/patterns";

export const runtime = "nodejs";

export function GET(req: Request) {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    url = new URL(req.url, "http://localhost");
  }

  const filters = parseFiltersFromQuery(url.searchParams);
  // Patterns must analyze the full filtered corpus, not just the first page.
  // Otherwise large result sets can incorrectly show "0 patterns".
  const data = runSearch(filters, 10000, 0);

  const patterns = generatePatterns(data.results, 8);
  return NextResponse.json({ total: data.total, patterns });
}
