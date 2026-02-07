<p align="center">
  <h1 align="center">🛡️ Sentinel</h1>
  <p align="center">
    <strong>Policy-Governed MCP Wallet for Safe AI-Driven DeFi Execution</strong>
  </p>
  <p align="center">
    ETHGlobal HackMoney 2026
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript" />
  <img src="https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity" />
  <img src="https://img.shields.io/badge/MCP-1.12-green" />
  <img src="https://img.shields.io/badge/Chain-Base%20Sepolia-0052FF?logo=coinbase" />
  <img src="https://img.shields.io/badge/Tests-142%20passing-brightgreen" />
</p>

---

## The Problem

AI agents are increasingly capable of executing financial operations — but giving an LLM unrestricted access to a crypto wallet is a recipe for disaster. One hallucination, one prompt injection, or one adversarial input could drain an entire portfolio.

## The Solution

**Sentinel** is a policy-governed MCP (Model Context Protocol) wallet that lets AI agents execute DeFi trades safely. Every action the agent takes passes through a deterministic policy engine that enforces hard limits — max trade sizes, allowed DEXes, permitted assets, and slippage caps — before any balance is modified.

Swaps execute **instantly off-chain** via Yellow Network / Nitrolite state channels during the session, and settle **once on-chain** when the session closes — combining the UX of a CEX with the security of a smart contract wallet.

```
┌──────────────┐     MCP Protocol     ┌──────────────────────────────────────────────┐
│              │◄────────────────────►│                  Sentinel                    │
│   AI Agent   │   4 tools via stdio   │                                              │
│  (Claude,    │                       │  ┌────────────┐  ┌─────────────────────┐     │
│   GPT, etc.) │                       │  │   Policy    │  │  Session Manager    │     │
│              │                       │  │   Engine    │  │  (Nitrolite Channel)│     │
└──────────────┘                       │  │  4 rules,   │  │  Off-chain balance  │     │
                                       │  │  SHA-256    │  │  tracking + state   │     │
                                       │  │  anchored   │  │  channel co-signing │     │
                                       │  └─────┬──────┘  └──────────┬──────────┘     │
                                       │        │ approve/reject      │ update         │
                                       │        ▼                     ▼                │
                                       │  ┌──────────────────────────────────────┐     │
                                       │  │         Swap Simulator               │     │
                                       │  │   Uniswap v4 Quoter / Local AMM     │     │
                                       │  └──────────────────────────────────────┘     │
                                       │                    │ settle                    │
                                       │                    ▼                           │
                                       │  ┌──────────────────────────────────────┐     │
                                       │  │     On-Chain (Base Sepolia)          │     │
                                       │  │  SentinelWallet ← PolicyGuard       │     │
                                       │  │  ERC-4337 · ENS Identity            │     │
                                       │  └──────────────────────────────────────┘     │
                                       └──────────────────────────────────────────────┘
```

## Key Features

| Feature | Description |
|---|---|
| **🔒 Policy Engine** | 4 deterministic rules: max trade size (2% of balance), allowed DEX (Uniswap v4 only), allowed assets (USDC/ETH), max slippage (0.5%). Every decision is logged with a full audit trail. |
| **⚡ Off-Chain Sessions** | Swaps execute instantly and gaslessly during the session via Nitrolite state channels. Each state transition is cryptographically co-signed. |
| **🔗 On-Chain Settlement** | Final session balances settle once on-chain via the SentinelWallet smart contract, validated by PolicyGuard. ERC-4337 compatible. |
| **🤖 MCP Server** | 4 tools exposed over the Model Context Protocol — any MCP-compatible AI agent (Claude Desktop, etc.) can use them. |
| **📊 Uniswap v4 Integration** | Queries the Quoter2 contract for real on-chain swap quotes. Falls back to a constant-product AMM simulator for demo/testing. |
| **🪪 ENS Identity** | Agent identity resolved from ENS. Policy hash stored as a text record (`com.sentinel.policyHash`) for tamper-proof verification. |
| **🏗️ Smart Contracts** | `SentinelWallet` (ERC-4337 smart wallet) + `PolicyGuard` (on-chain policy enforcement). Solidity 0.8.24, OpenZeppelin v5, Foundry tested. |

## Architecture

### Components

```
src/
├── shared/               # Types, constants, logger, ENS resolver
│   ├── types.ts          # All protocol type definitions
│   ├── constants.ts      # Policy defaults, token registry, chain config
│   ├── logger.ts         # Structured color-coded logging
│   └── ens.ts            # ENS identity resolution + policy verification
│
├── policy-engine/        # Deterministic rule evaluation
│   └── engine.ts         # 4 rules, SHA-256 policy hash, full audit trail
│
├── session/              # Off-chain session management
│   ├── manager.ts        # Balance tracking, swap execution, session lifecycle
│   └── channel.ts        # Nitrolite state channel client (co-signed states)
│
├── mcp-server/           # MCP protocol interface
│   ├── index.ts          # Server entry point (stdio transport)
│   ├── tools.ts          # 4 MCP tool handlers with Zod schemas
│   ├── swap-simulator.ts # Constant-product AMM + Uniswap v4 fallback
│   └── uniswap-client.ts # On-chain Quoter2 integration
│
├── contracts/            # TypeScript bindings for smart contracts
│   ├── abis.ts           # Human-readable ABIs
│   └── settlement.ts     # SettlementClient for on-chain settlement
│
└── demo/
    └── scenario.ts       # Full 7-step demo scenario

contracts/                # Solidity smart contracts (Foundry)
├── src/
│   ├── SentinelWallet.sol   # ERC-4337 smart wallet
│   ├── PolicyGuard.sol      # On-chain policy enforcement
│   └── interfaces/          # ISentinelWallet, IPolicyGuard
├── test/                    # Foundry tests (27 passing)
└── foundry.toml             # Solidity 0.8.24, Cancun EVM, optimizer 200 runs
```

### MCP Tools

The AI agent interacts with Sentinel via 4 MCP tools:

| Tool | Description |
|---|---|
| `get_session_balance` | Read current off-chain balance for USDC or ETH, plus session PnL and total USD value. |
| `simulate_swap` | Preview a swap without executing it. Returns estimated output, price impact, and whether the policy engine would approve it. |
| `propose_swap` | Propose and execute a swap. Simulated → policy-checked → executed off-chain. The hard safety gate. |
| `close_session_and_settle` | Close the session, finalize the Nitrolite channel, and settle final balances on-chain via ERC-4337. |

### Policy Rules

Every `propose_swap` call is evaluated against all 4 rules. **All must pass** for the swap to execute:

| # | Rule | Default | Description |
|---|---|---|---|
| 1 | Max Trade Size | 2% of balance | Prevents outsized positions. Scales with current balance. |
| 2 | Allowed DEX | `uniswap-v4` | Only whitelisted DEXes. Rejects sushiswap, curve, etc. |
| 3 | Allowed Assets | `USDC`, `ETH` | Only whitelisted tokens. Both tokenIn and tokenOut must be allowed. |
| 4 | Max Slippage | 50 bps (0.5%) | Protects against sandwich attacks and poor execution. |

The policy config is hashed with SHA-256 and anchored on ENS, so any tampering is detectable.

### Session Lifecycle

```
   open(1000 USDC)          applySwap()              close()           settle(txHash)
        │                       │                       │                    │
   ┌────▼────┐   swap OK   ┌───▼────┐  session end  ┌──▼─────┐  on-chain ┌─▼──────┐
   │  active  │────────────►│ active │──────────────►│closing │─────────►│settled │
   └─────────┘              └────────┘               └────────┘          └────────┘
                                │                                             │
                         Nitrolite channel                             SentinelWallet
                         state co-signed                             settleSession()
```

### Smart Contracts

**SentinelWallet** (`contracts/src/SentinelWallet.sol`)
- ERC-4337 smart contract wallet
- `execute()` / `executeBatch()` for arbitrary calls (owner or EntryPoint only)
- `settleSession()` — validates via PolicyGuard, then records final balances
- `validateUserOp()` — ECDSA signature verification for bundler submission
- Nonce tracking for replay protection

**PolicyGuard** (`contracts/src/PolicyGuard.sol`)
- On-chain safety net for settlement validation
- Max USDC/ETH settlement limits per session
- Allowed token whitelist
- Session replay protection via `settledSessions` mapping
- Policy hash matching — settlement must reference the correct policy version

## Getting Started

### Prerequisites

- **Node.js** ≥ 20.0.0
- **Foundry** (for smart contract tests) — [install](https://book.getfoundry.sh/getting-started/installation)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/sentinel.git
cd sentinel

# Install Node.js dependencies
npm install

# Install Foundry dependencies (OpenZeppelin, forge-std)
cd contracts && forge install && cd ..
```

### Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your values:
#   RPC_URL           — Base Sepolia RPC endpoint
#   OPERATOR_PRIVATE_KEY — Deployer/operator key (NOT the AI agent)
#   SENTINEL_WALLET_ADDRESS — After deployment
#   POLICY_GUARD_ADDRESS    — After deployment
```

### Run the Demo

```bash
# Run the full 7-step demo scenario
npx tsx src/demo/scenario.ts
```

This will:
1. Open a session with 1000 USDC
2. Simulate a 2% USDC→ETH swap
3. Execute the swap (policy-approved, off-chain)
4. Attempt an illegal 5% swap (rejected by policy)
5. Execute another valid 2% swap
6. Show final session state
7. Close & settle (mock or real on-chain)

### Run as MCP Server

```bash
# Start the MCP server on stdio transport
npx tsx src/mcp-server/index.ts
```

Connect from any MCP-compatible client (Claude Desktop, etc.) by adding to your MCP config:

```json
{
  "mcpServers": {
    "sentinel-wallet": {
      "command": "npx",
      "args": ["tsx", "src/mcp-server/index.ts"],
      "cwd": "/path/to/sentinel"
    }
  }
}
```

### Run Tests

```bash
# TypeScript tests (115 tests)
npm test

# Foundry / Solidity tests (27 tests)
cd contracts && forge test -vv

# Both
npm test && cd contracts && forge test && cd ..

# Watch mode
npx vitest
```

## Deployment

### Option A: Local Network (Anvil)

The fastest way to test with real contracts — no testnet ETH needed.

**Terminal 1 — Start Anvil:**

```bash
# Start a local EVM node (forks Base Sepolia for realistic USDC)
anvil --fork-url https://sepolia.base.org --chain-id 84532
```

Anvil prints 10 funded accounts. Copy the **first private key** (Account 0).

**Terminal 2 — Deploy:**

```bash
cd contracts

# Set the operator key (Anvil account 0)
export OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Deploy to local Anvil
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

The script prints the deployed addresses. Update your `.env`:

```bash
RPC_URL=http://127.0.0.1:8545
OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
SENTINEL_WALLET_ADDRESS=<printed address>
POLICY_GUARD_ADDRESS=<printed address>
```

**Terminal 2 — Run the demo against local contracts:**

```bash
cd ..
npx tsx src/demo/scenario.ts
```

### Option B: Base Sepolia Testnet

For a persistent deployment on the public Base Sepolia testnet.

**1. Get testnet ETH:**

- [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) — requires a Coinbase account
- Or bridge from Sepolia using the [Base Bridge](https://bridge.base.org/)

**2. Configure `.env`:**

```bash
cp .env.example .env
```

```dotenv
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
OPERATOR_PRIVATE_KEY=0x<your-funded-testnet-key>
ETHERSCAN_API_KEY=<your-basescan-api-key>   # optional, for verification
```

**3. Deploy:**

```bash
cd contracts

# Deploy + verify on BaseScan
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Without verification (skip --verify and --etherscan-api-key)
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast
```

**4. Update `.env` with the printed addresses:**

```dotenv
SENTINEL_WALLET_ADDRESS=0x...
POLICY_GUARD_ADDRESS=0x...
```

**5. (Optional) Fund the SentinelWallet:**

```bash
# Send some ETH to the wallet so it can pay for settlement gas
cast send $SENTINEL_WALLET_ADDRESS \
  --value 0.01ether \
  --rpc-url $RPC_URL \
  --private-key $OPERATOR_PRIVATE_KEY
```

**6. Run the demo against Base Sepolia:**

```bash
cd ..
npx tsx src/demo/scenario.ts
```

### Option C: Mock Mode (No Deployment Needed)

If you just want to explore the policy engine and MCP tools without any on-chain interaction, **no deployment is needed**. Leave the contract addresses unset in `.env` and everything runs in mock mode:

```bash
npm install
npx tsx src/demo/scenario.ts    # full demo, mock settlement
npx tsx src/mcp-server/index.ts # MCP server, mock settlement
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RPC_URL` | For on-chain | Base Sepolia RPC endpoint |
| `OPERATOR_PRIVATE_KEY` | For on-chain | Operator key for settlement transactions |
| `SENTINEL_WALLET_ADDRESS` | For on-chain | Deployed SentinelWallet address |
| `POLICY_GUARD_ADDRESS` | For on-chain | Deployed PolicyGuard address |
| `ENTRYPOINT_ADDRESS` | Optional | ERC-4337 EntryPoint v0.7 (defaults to canonical address) |
| `ETHERSCAN_API_KEY` | Optional | BaseScan API key for contract verification |
| `NITROLITE_BROKER_URL` | Optional | WebSocket URL for Nitrolite broker |
| `NITROLITE_SIGNER_KEY` | Optional | Private key for channel state signing |
| `NITROLITE_BROKER_ADDRESS` | Optional | Broker's Ethereum address |
| `UNISWAP_V4_QUOTER_ADDRESS` | Optional | Uniswap v4 Quoter2 contract address |
| `ENS_RPC_URL` | Optional | RPC for ENS resolution (Ethereum mainnet) |
| `LOG_LEVEL` | Optional | `debug`, `info`, `warn`, `error` |

> **Note:** All on-chain features gracefully degrade. Without env vars, Sentinel runs in full mock mode — perfect for development and demos.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ESM, strict mode) |
| Runtime | Node.js ≥ 20, tsx for dev |
| MCP | `@modelcontextprotocol/sdk` v1.12 |
| Validation | Zod schemas on all tool inputs |
| Blockchain | ethers v6, viem v2.21 |
| Smart Contracts | Solidity 0.8.24, OpenZeppelin v5, Foundry |
| Chain | Base Sepolia (84532) |
| DEX | Uniswap v4 (Quoter2 + local AMM fallback) |
| State Channels | Yellow Network / Nitrolite |
| Identity | ENS (text records for policy anchoring) |
| Testing | Vitest (TS), Forge (Solidity) |
| Logging | Chalk v5, structured per-module colors |

## Test Coverage

```
 ✓ src/policy-engine/engine.test.ts        24 tests
 ✓ src/session/manager.test.ts             19 tests
 ✓ src/session/channel.test.ts             18 tests
 ✓ src/mcp-server/swap-simulator.test.ts    9 tests
 ✓ src/mcp-server/uniswap-client.test.ts   10 tests
 ✓ src/mcp-server/tools.test.ts            12 tests
 ✓ src/contracts/settlement.test.ts         8 tests
 ✓ src/shared/ens.test.ts                  15 tests
────────────────────────────────────────────────
   TypeScript                             115 tests

 ✓ contracts/test/PolicyGuard.t.sol        12 tests
 ✓ contracts/test/SentinelWallet.t.sol     15 tests
────────────────────────────────────────────────
   Solidity (Foundry)                      27 tests

   TOTAL                                  142 tests ✅
```

## Security Model

Sentinel implements **defense in depth** — multiple independent layers that each enforce safety:

1. **MCP Tool Layer** — Zod schema validation on all inputs. Type-safe, no raw strings.
2. **Policy Engine** — Deterministic 4-rule evaluation. Every decision logged with full audit trail. SHA-256 policy hash for integrity.
3. **Session Manager** — Balance accounting with overflow/underflow protection. Action limits per session.
4. **Nitrolite Channel** — Co-signed state transitions. Neither party can unilaterally modify balances.
5. **PolicyGuard (on-chain)** — Final safety net. Even if all off-chain layers are compromised, settlement must pass on-chain validation.
6. **SentinelWallet (on-chain)** — Owner-only execution. AI agent never touches the wallet directly. ERC-4337 signature verification.
7. **ENS Anchoring** — Policy hash stored as a text record. Tamper-proof verification that the policy hasn't changed.

> **The AI agent can only call 4 MCP tools.** It cannot bypass the policy engine, directly modify balances, or interact with the smart contracts. The operator key (not the agent) controls settlement.

## Example: What Happens When the Agent Tries a Bad Trade

```
Agent → propose_swap({ tokenIn: "USDC", tokenOut: "ETH", amount: 50 })

  1. SwapSimulator.simulate()     → 50 USDC ≈ 0.0199 ETH (0.3% fee)
  2. PolicyEngine.evaluate()      →
       ✓ Allowed DEX: uniswap-v4
       ✓ Allowed Assets: USDC/ETH
       ✓ Max Slippage: 50 bps ≤ 50 bps
       ✗ Max Trade Size: 50 USDC = 5% of 1000 (limit: 2%)
  3. REJECTED — balance unchanged, full audit trail logged
  4. Response: { success: false, error: "Policy rejected: ..." }
```

## License

MIT

---

<p align="center">
  Built with 🛡️ for <strong>ETHGlobal HackMoney 2026</strong>
</p>
