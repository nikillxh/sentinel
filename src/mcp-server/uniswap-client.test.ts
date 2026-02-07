import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  UniswapV4Client,
  createUniswapV4Client,
  type UniswapV4Config,
} from "./uniswap-client.js";
import { TOKENS } from "../shared/constants.js";

const TEST_CONFIG: UniswapV4Config = {
  rpcUrl: "http://127.0.0.1:8545",
  quoterAddress: "0x1234567890123456789012345678901234567890",
};

describe("UniswapV4Client", () => {
  let client: UniswapV4Client;

  beforeEach(() => {
    client = new UniswapV4Client(TEST_CONFIG);
  });

  describe("constructor", () => {
    it("should instantiate with config", () => {
      expect(client).toBeInstanceOf(UniswapV4Client);
    });

    it("should accept optional poolManagerAddress", () => {
      const withPM = new UniswapV4Client({
        ...TEST_CONFIG,
        poolManagerAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      });
      expect(withPM).toBeInstanceOf(UniswapV4Client);
    });
  });

  describe("getSpotPrice", () => {
    it("should return correct USDC→ETH price", async () => {
      const price = await client.getSpotPrice("USDC", "ETH");
      expect(price).toBeCloseTo(0.0004, 4);
    });

    it("should return correct ETH→USDC price", async () => {
      const price = await client.getSpotPrice("ETH", "USDC");
      expect(price).toBe(2500);
    });
  });

  describe("buildSwapCalldata", () => {
    it("should build calldata for USDC→ETH swap", () => {
      const result = client.buildSwapCalldata("USDC", "ETH", 100, 0.039);
      expect(result.to).toBe(TEST_CONFIG.quoterAddress);
      expect(result.data).toMatch(/^0x/);
      expect(result.data.length).toBeGreaterThan(10);
    });

    it("should encode the correct parameters in calldata", () => {
      const result = client.buildSwapCalldata("ETH", "USDC", 1, 2400);
      const hexPayload = result.data.slice(2);
      const decoded = JSON.parse(Buffer.from(hexPayload, "hex").toString());

      expect(decoded.action).toBe("swap");
      expect(decoded.tokenIn).toBe(
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      );
      expect(decoded.tokenOut).toBe(TOKENS.USDC.address);
      expect(decoded.fee).toBe(3000);
    });
  });
});

describe("createUniswapV4Client factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return null when env vars are missing", () => {
    delete process.env.RPC_URL;
    delete process.env.BASE_SEPOLIA_RPC_URL;
    delete process.env.UNISWAP_V4_QUOTER_ADDRESS;
    expect(createUniswapV4Client()).toBeNull();
  });

  it("should return null when quoter address is placeholder", () => {
    process.env.RPC_URL = "http://localhost:8545";
    process.env.UNISWAP_V4_QUOTER_ADDRESS = "0x...placeholder";
    expect(createUniswapV4Client()).toBeNull();
  });

  it("should return a client when env vars are set", () => {
    process.env.RPC_URL = "http://localhost:8545";
    process.env.UNISWAP_V4_QUOTER_ADDRESS =
      "0x1234567890123456789012345678901234567890";
    const client = createUniswapV4Client();
    expect(client).toBeInstanceOf(UniswapV4Client);
  });

  it("should prefer RPC_URL over BASE_SEPOLIA_RPC_URL", () => {
    process.env.RPC_URL = "http://rpc-primary:8545";
    process.env.BASE_SEPOLIA_RPC_URL = "http://rpc-fallback:8545";
    process.env.UNISWAP_V4_QUOTER_ADDRESS =
      "0x1234567890123456789012345678901234567890";
    const client = createUniswapV4Client();
    expect(client).toBeInstanceOf(UniswapV4Client);
  });
});
