import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// POST /api/swap — { tokenIn, tokenOut, amountIn, slippageBps?, dex? }
export async function POST(req: Request) {
  try {
    const { tokenIn, tokenOut, amountIn, slippageBps, dex } = await req.json();
    const engine = getSentinel();
    const { result, policyDecision } = engine.executeSwap(
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps,
      dex,
    );
    return NextResponse.json({ result: result ?? null, policyDecision });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
