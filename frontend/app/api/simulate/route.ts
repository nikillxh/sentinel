import { NextResponse } from "next/server";
import { getSentinel } from "@/lib/sentinel";

// POST /api/simulate — { tokenIn, tokenOut, amountIn } (proxied to real backend)
export async function POST(req: Request) {
  try {
    const { tokenIn, tokenOut, amountIn } = await req.json();
    const engine = getSentinel();
    const result = await engine.simulate(tokenIn, tokenOut, amountIn);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
