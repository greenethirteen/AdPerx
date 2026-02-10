import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json({ openaiKey: hasKey });
}
