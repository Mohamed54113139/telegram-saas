import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  return NextResponse.json({ apiUrl });
}
