import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// GET /api/agent — get conversation history
export async function GET() {
  try {
    const sentinel = getSentinel();
    const data = await sentinel.getAgentHistory();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// POST /api/agent — send a message to the AI agent
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sentinel = getSentinel();
    const result = await sentinel.chatWithAgent(body.message ?? "");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

// DELETE /api/agent — reset conversation
export async function DELETE() {
  try {
    const sentinel = getSentinel();
    await sentinel.resetAgent();
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
