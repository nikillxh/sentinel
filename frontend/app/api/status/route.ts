import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/status — get integration status (proxied to real backend)
export async function GET() {
  try {
    const engine = getSentinel();
    const status = await engine.getIntegrationStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
