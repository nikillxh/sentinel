import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/session — get current session state (proxied to real backend)
export async function GET() {
  try {
    const engine = getSentinel();
    const state = await engine.getSessionState();
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// POST /api/session — open a new session { depositUsdc: number }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const engine = getSentinel();
    const result = await engine.openSession(body.depositUsdc ?? 1000);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// DELETE /api/session — close & settle session
export async function DELETE() {
  try {
    const engine = getSentinel();
    const result = await engine.closeSession();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
