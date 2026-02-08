import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/audit — get full audit log (proxied to real backend)
export async function GET() {
  try {
    const engine = getSentinel();
    const log = await engine.getAuditLog();
    return NextResponse.json(log);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
