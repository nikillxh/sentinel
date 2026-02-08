import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/policy — get current policy config
export async function GET() {
  const engine = getSentinel();
  return NextResponse.json(engine.getPolicy());
}
