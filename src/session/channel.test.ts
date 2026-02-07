import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  NitroliteChannel,
  createNitroliteChannel,
  type NitroliteConfig,
  type ChannelState,
  type ChannelSession,
} from "./channel.js";
import type { Asset, SessionBalance } from "../shared/types.js";

const TEST_CONFIG: NitroliteConfig = {
  brokerUrl: "wss://broker.yellow.org/ws",
  signerPrivateKey:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  brokerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
};

function makeBalances(
  usdc: number,
  eth: number,
): Map<Asset, SessionBalance> {
  const m = new Map<Asset, SessionBalance>();
  m.set("USDC", { asset: "USDC", amount: usdc, initialAmount: usdc, pnl: 0 });
  m.set("ETH", { asset: "ETH", amount: eth, initialAmount: 0, pnl: eth });
  return m;
}

describe("NitroliteChannel", () => {
  let channel: NitroliteChannel;

  beforeEach(() => {
    channel = new NitroliteChannel(TEST_CONFIG);
  });

  describe("connection lifecycle", () => {
    it("should throw if operations called before connect()", async () => {
      const balances = makeBalances(1000, 0);
      await expect(channel.openChannel(balances)).rejects.toThrow(
        "Not connected",
      );
    });

    it("should connect successfully", async () => {
      await channel.connect();
      // No throw = success
    });

    it("should disconnect", async () => {
      await channel.connect();
      await channel.disconnect();
      const balances = makeBalances(1000, 0);
      await expect(channel.openChannel(balances)).rejects.toThrow(
        "Not connected",
      );
    });
  });

  describe("openChannel", () => {
    beforeEach(async () => {
      await channel.connect();
    });

    it("should open a channel with initial balances", async () => {
      const balances = makeBalances(1000, 0);
      const session = await channel.openChannel(balances);

      expect(session.channelId).toMatch(/^ch-/);
      expect(session.status).toBe("running");
      expect(session.participants).toHaveLength(2);
      expect(session.currentState.turnNum).toBe(0);
      expect(session.currentState.balances.USDC).toBe(1000);
      expect(session.currentState.balances.ETH).toBe(0);
      expect(session.currentState.signatures).toHaveLength(2);
      expect(session.openedAt).toBeDefined();
    });

    it("should reject opening a second channel while one is running", async () => {
      await channel.openChannel(makeBalances(1000, 0));
      await expect(
        channel.openChannel(makeBalances(500, 0)),
      ).rejects.toThrow("already running");
    });

    it("should generate unique channel IDs", async () => {
      const ch1 = new NitroliteChannel(TEST_CONFIG);
      await ch1.connect();
      const s1 = await ch1.openChannel(makeBalances(1000, 0));

      const ch2 = new NitroliteChannel(TEST_CONFIG);
      await ch2.connect();
      const s2 = await ch2.openChannel(makeBalances(1000, 0));

      expect(s1.channelId).not.toBe(s2.channelId);
    });
  });

  describe("updateState", () => {
    beforeEach(async () => {
      await channel.connect();
      await channel.openChannel(makeBalances(1000, 0));
    });

    it("should update balances and increment turnNum", async () => {
      const newBalances = makeBalances(600, 0.16);
      const state = await channel.updateState(newBalances);

      expect(state.turnNum).toBe(1);
      expect(state.balances.USDC).toBe(600);
      expect(state.balances.ETH).toBe(0.16);
      expect(state.signatures).toHaveLength(2);
    });

    it("should maintain state history", async () => {
      await channel.updateState(makeBalances(800, 0.08));
      await channel.updateState(makeBalances(600, 0.16));
      await channel.updateState(makeBalances(500, 0.2));

      const session = channel.getChannel()!;
      expect(session.stateHistory).toHaveLength(4); // 1 open + 3 updates
      expect(session.stateHistory[0].turnNum).toBe(0);
      expect(session.stateHistory[3].turnNum).toBe(3);
    });

    it("should produce unique state hashes", async () => {
      const s1 = await channel.updateState(makeBalances(800, 0.08));
      const s2 = await channel.updateState(makeBalances(600, 0.16));

      expect(s1.stateHash).not.toBe(s2.stateHash);
      expect(s1.stateHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should throw if channel is not running", async () => {
      await channel.closeChannel();
      await expect(
        channel.updateState(makeBalances(500, 0.2)),
      ).rejects.toThrow("not running");
    });
  });

  describe("closeChannel", () => {
    beforeEach(async () => {
      await channel.connect();
      await channel.openChannel(makeBalances(1000, 0));
    });

    it("should finalize the channel", async () => {
      await channel.updateState(makeBalances(600, 0.16));
      const session = await channel.closeChannel();

      expect(session.status).toBe("finalized");
      expect(session.closedAt).toBeDefined();
    });

    it("should preserve final balances", async () => {
      await channel.updateState(makeBalances(600, 0.16));
      const session = await channel.closeChannel();

      expect(session.currentState.balances.USDC).toBe(600);
      expect(session.currentState.balances.ETH).toBe(0.16);
    });

    it("should throw if closed twice", async () => {
      await channel.closeChannel();
      await expect(channel.closeChannel()).rejects.toThrow("not running");
    });
  });

  describe("getLatestStateHash", () => {
    it("should return null when no channel", () => {
      expect(channel.getLatestStateHash()).toBeNull();
    });

    it("should return current state hash", async () => {
      await channel.connect();
      await channel.openChannel(makeBalances(1000, 0));
      const hash = channel.getLatestStateHash();
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});

describe("createNitroliteChannel factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return null when env vars are missing", () => {
    delete process.env.NITROLITE_BROKER_URL;
    delete process.env.NITROLITE_SIGNER_KEY;
    delete process.env.NITROLITE_BROKER_ADDRESS;
    expect(createNitroliteChannel()).toBeNull();
  });

  it("should return null when env vars are placeholder", () => {
    process.env.NITROLITE_BROKER_URL = "wss://broker.yellow.org/ws";
    process.env.NITROLITE_SIGNER_KEY = "0x...your-key";
    process.env.NITROLITE_BROKER_ADDRESS = "0x...broker";
    expect(createNitroliteChannel()).toBeNull();
  });

  it("should return a NitroliteChannel when env vars are set", () => {
    process.env.NITROLITE_BROKER_URL = "wss://broker.yellow.org/ws";
    process.env.NITROLITE_SIGNER_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.NITROLITE_BROKER_ADDRESS =
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const ch = createNitroliteChannel();
    expect(ch).toBeInstanceOf(NitroliteChannel);
  });
});
