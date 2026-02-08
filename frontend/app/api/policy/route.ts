import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/policy — get current policy config (proxied to real backend)
export async function GET() {
  try {
    const engine = getSentinel();
    const policy = await engine.getPolicy();
    return NextResponse.json(policy);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
