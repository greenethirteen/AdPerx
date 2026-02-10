import { NextResponse } from "next/server";
import { parseFiltersFromQuery, runSearch } from "@/lib/search";

export const runtime = "nodejs";

export function GET(req: Request) {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    // Some environments provide a relative URL in req.url.
    url = new URL(req.url, "http://localhost");
  }
  const filters = parseFiltersFromQuery(url.searchParams);
  const limit = Number(url.searchParams.get("limit") ?? "48");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 48;
  const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;
  const data = runSearch(filters, safeLimit, safeOffset);
  return NextResponse.json(data);
}
