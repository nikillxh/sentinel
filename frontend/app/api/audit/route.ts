import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/audit — get full audit log
export async function GET() {
  const engine = getSentinel();
  return NextResponse.json(engine.getAuditLog());
}
