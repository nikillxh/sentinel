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
│  External    │   4 tools via stdio   │                                              │
│  MCP Client  │                       │  ┌────────────┐  ┌─────────────────────┐     │
│  (Claude     │                       │  │   Policy    │  │  Session Manager    │     │
│   Desktop)   │                       │  │   Engine    │  │  (Nitrolite Channel)│     │
└──────────────┘                       │  │  4 rules,   │  │  Off-chain balance  │     │
                                       │  │  SHA-256    │  │  tracking + state   │     │
┌──────────────┐                       │  │  anchored   │  │  channel co-signing │     │
│   Next.js    │   fetch() proxy       │  └─────┬──────┘  └──────────┬──────────┘     │
│   Frontend   │──────────────────────►│        │ approve/reject      │ update         │
│  :3000       │   API Server :3001    │        ▼                     ▼                │
│  + ChatPanel │                       │  ┌──────────────────────────────────────┐     │
└──────────────┘                       │  │         Swap Simulator               │     │
       ▲                               │  │   Uniswap v4 Quoter / Local AMM     │     │
       │  /api/agent                   │  └──────────────────────────────────────┘     │
       ▼                               │                    │ settle                    │
┌──────────────┐                       │                    ▼                           │
│  🧠 AI Agent │  LLM + tool calls     │  ┌──────────────────────────────────────┐     │
│  (GPT-4o /   │──────────────────────►│  │     On-Chain (Base Sepolia)          │     │
│   Claude /   │                       │  │  SentinelWallet ← PolicyGuard       │     │
│   Heuristic) │                       │  │  ERC-4337 · ENS Identity            │     │
└──────────────┘                       │  └──────────────────────────────────────┘     │
                                       └──────────────────────────────────────────────┘
```

## Key Features

| Feature | Description |
|---|---|
| **🔒 Policy Engine** | 4 deterministic rules: max trade size (2% of balance), allowed DEX (Uniswap v4 only), allowed assets (USDC/ETH), max slippage (0.5%). Every decision is logged with a full audit trail. |
| **⚡ Off-Chain Sessions** | Swaps execute instantly and gaslessly during the session via Nitrolite state channels connected to Yellow Network's ClearNode. Each state transition is co-signed with **real ECDSA** (`ethers.Wallet.signMessage`). |
| **🔗 On-Chain Settlement** | Final session balances settle once on-chain via the SentinelWallet smart contract, validated by PolicyGuard. ERC-4337 compatible. |
| **� AI Agent** | Built-in LLM-powered agent with 3 provider modes: **OpenAI** (GPT-4o, function calling), **Anthropic** (Claude, tool_use), and **Heuristic** (zero-API-key NLP fallback). Chat via the frontend ChatPanel or REST API. The agent reasons about DeFi actions and calls Sentinel tools — always subject to policy enforcement. |
| **🤖 MCP Server** | 4 tools exposed over the Model Context Protocol — any MCP-compatible AI agent (Claude Desktop, etc.) can use them. |
| **📊 Uniswap v4 Integration** | Queries the Quoter2 contract for real on-chain swap quotes on Base Sepolia. `getSpotPrice()` reads `sqrtPriceX96` from PoolManager slot0, with Quoter micro-quote and local AMM fallbacks. `buildSwapCalldata()` uses proper ABI-encoded PoolKey + SwapParams. All contract addresses pre-configured for Base Sepolia testnet. |
| **🪪 ENS Identity** | Agent identity resolved from ENS on session open. Policy hash stored as a text record (`com.sentinel.policyHash`) for tamper-proof verification. |
| **🏗️ Smart Contracts** | `SentinelWallet` (ERC-4337 smart wallet) + `PolicyGuard` (on-chain policy enforcement). Solidity 0.8.24, OpenZeppelin v5, Foundry tested. |
| **🌐 Web Dashboard** | Next.js 15 + React 19 + Tailwind CSS frontend with an integrated **AI ChatPanel** for conversational DeFi interaction. Proxies all calls to the real backend API — zero duplicate logic. |

## Architecture

### Components

```
src/
├── shared/               # Types, constants, logger, ENS resolver
│   ├── types.ts          # All protocol type definitions
│   ├── constants.ts      # Policy defaults, token registry, chain config,
│   │                     # Uniswap v4 addresses, Nitrolite config, ENS registry
│   ├── logger.ts         # Structured color-coded logging
│   └── ens.ts            # ENS identity resolution + policy verification
│
├── policy-engine/        # Deterministic rule evaluation
│   └── engine.ts         # 4 rules, SHA-256 policy hash, full audit trail
│
├── session/              # Off-chain session management
│   ├── manager.ts        # Balance tracking, swap execution, session lifecycle
│   └── channel.ts        # Nitrolite state channel (real ECDSA, Yellow ClearNode)
│
├── mcp-server/           # MCP protocol interface
│   ├── index.ts          # Server entry point (stdio transport)
│   ├── tools.ts          # 4 MCP tool handlers with Zod schemas
│   ├── swap-simulator.ts # Constant-product AMM + Uniswap v4 fallback
│   └── uniswap-client.ts # On-chain Quoter2 + PoolManager slot0 (Base Sepolia)
│
├── agent/                # AI agent brain (LLM-powered DeFi reasoning)
│   └── index.ts          # SentinelAgent — OpenAI / Anthropic / Heuristic
│
├── api/                  # Backend API server (wraps all real services)
│   └── server.ts         # HTTP server on port 3001 — frontend proxies here
│
├── contracts/            # TypeScript bindings for smart contracts
│   ├── abis.ts           # Human-readable ABIs
│   └── settlement.ts     # SettlementClient for on-chain settlement
│
└── demo/
    └── scenario.ts       # Full 7-step demo scenario

frontend/                 # Next.js 15 + React 19 + Tailwind dashboard
├── app/                  # App router pages + API routes (proxy to backend)
│   └── api/agent/        # AI agent chat proxy → POST/GET/DELETE :3001/api/agent
├── components/           # UI components (Header, SwapPanel, PolicyPanel, ChatPanel, etc.)
│   └── ChatPanel.tsx     # Conversational AI interface with quick prompts
└── lib/sentinel.ts       # Thin fetch() wrapper → real backend API

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

### AI Agent

Sentinel includes a **built-in AI agent** (`src/agent/index.ts`) that provides conversational DeFi interaction. The agent understands natural language requests ("swap 5 USDC for ETH", "check my balance", "simulate a trade") and translates them into the correct MCP tool calls — always subject to policy enforcement.

**Three provider modes:**

| Mode | LLM | How It Works | API Key? |
|---|---|---|---|
| `openai` | GPT-4o | Function calling with tool definitions | ✅ `OPENAI_API_KEY` |
| `anthropic` | Claude 3.5 | `tool_use` blocks with structured output | ✅ `ANTHROPIC_API_KEY` |
| `heuristic` | None | NLP intent parsing (regex + keyword matching) | ❌ None |

**Configuration:**

```dotenv
# In .env
AI_PROVIDER=heuristic        # openai | anthropic | heuristic (default)
AI_API_KEY=sk-...             # Required for openai/anthropic
AI_MODEL=gpt-4o              # Optional: override the default model
```

**REST API:**

```bash
# Chat with the agent
curl -X POST http://localhost:3001/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "Swap 5 USDC for ETH"}'

# Get conversation history
curl http://localhost:3001/api/agent

# Reset conversation
curl -X DELETE http://localhost:3001/api/agent
```

**Frontend ChatPanel:**

The dashboard includes an integrated chat panel with quick-prompt buttons for common actions (Check balances, Simulate swap, Swap 5 USDC, Session summary). The agent's responses include formatted tool results and reasoning.

> **Safety:** The AI agent operates within the same policy constraints as any external MCP client. It cannot bypass the policy engine, directly modify balances, or interact with smart contracts. Every tool call flows through the full policy→session→audit pipeline.

### Testnet Contract Addresses

All protocol contracts are pre-configured for **Base Sepolia** (chain ID 84532). You do not need to look these up — they are already set in `src/shared/constants.ts`:

**Uniswap v4 (Base Sepolia)**

| Contract | Address |
|---|---|
| PoolManager | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| V4 Quoter | `0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba` |
| StateView | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| PositionManager | `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80` |
| SwapRouter02 | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |

**Nitrolite / Yellow Network (Base Sepolia)**

| Contract | Address |
|---|---|
| Custody | `0x019B65A265EB3363822f2752141b3dF16131b262` |
| Adjudicator | `0x7c7ccbc98469190849BCC6c926307794fDfB11F2` |
| ClearNode | `wss://clearnet.yellow.com/ws` |

**ENS (Ethereum Mainnet)**

| Contract | Address |
|---|---|
| Registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |

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

### Quick Start (One Command)

The easiest way to run everything — supports both **local** and **testnet** modes:

```bash
# Local mode (default) — no API keys needed, runs Anvil + deploys contracts
./start.sh

# Testnet mode — connects to real Base Sepolia with pre-deployed contracts
./start.sh testnet
```

**Local mode** (`./start.sh` or `./start.sh local`):
1. ✅ Checks prerequisites (Node ≥ 20, Foundry)
2. ✅ Installs all dependencies (root + frontend)
3. ✅ Starts Anvil on port 8546 (local EVM)
4. ✅ Deploys SentinelWallet + PolicyGuard contracts
5. ✅ Generates `.env` with deployed addresses + Nitrolite config
6. ✅ Starts the Sentinel API server on port 3001 (with AI agent)
7. ✅ Starts the Next.js frontend on port 3000

**Testnet mode** (`./start.sh testnet`):
1. ✅ Validates `.env` exists with `RPC_URL` and `OPERATOR_PRIVATE_KEY`
2. ✅ Uses pre-configured Uniswap v4 + Nitrolite addresses from `constants.ts`
3. ✅ Connects to real Base Sepolia RPC
4. ✅ Starts the Sentinel API server on port 3001 (with AI agent)
5. ✅ Starts the Next.js frontend on port 3000

Open **http://localhost:3000** and start trading. Use the **ChatPanel** to talk to the AI agent.

To stop all services:

```bash
./start.sh stop
```

### Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your values:
#   SENTINEL_MODE         — "local" or "testnet"
#   RPC_URL               — Base Sepolia RPC endpoint (testnet mode)
#   OPERATOR_PRIVATE_KEY  — Deployer/operator key (NOT the AI agent)
#   AI_PROVIDER           — "heuristic" (no key), "openai", or "anthropic"
#   AI_API_KEY            — API key for OpenAI/Anthropic (if using LLM mode)
```

### Run the Demo (CLI)

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

### Run the API Server (Backend for Frontend)

```bash
# Start the backend API server on port 3001
npx tsx src/api/server.ts

# The frontend (port 3000) proxies all calls here.
# API endpoints: /api/session, /api/simulate, /api/swap, /api/policy,
#                /api/audit, /api/status, /api/agent
```

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

### Option A: Local Network (One Command)

The fastest way to test with real contracts — **no API keys or testnet ETH needed**.

```bash
./start.sh local    # or just ./start.sh
```

This starts Anvil (port 8546) → deploys contracts → starts API server with AI agent (port 3001) → starts frontend (port 3000). Everything is auto-configured.

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API Server | http://localhost:3001 |
| Anvil RPC | http://127.0.0.1:8546 |

Logs are stored in `.logs/anvil.log`, `.logs/api.log`, and `.logs/frontend.log`.

<details>
<summary>Manual setup (if you prefer separate terminals)</summary>

**Terminal 1 — Start Anvil:**

```bash
anvil --chain-id 84532 --port 8546
```

**Terminal 2 — Deploy:**

```bash
cd contracts
export OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
```

**Terminal 3 — API Server:**

```bash
# Update .env with deployed addresses first
npx tsx src/api/server.ts
```

**Terminal 4 — Frontend:**

```bash
cd frontend && npx next dev --port 3000
```

</details>

### Option B: Base Sepolia Testnet (One Command)

For a persistent deployment on the public Base Sepolia testnet with real Uniswap v4 and Yellow Network contracts.

**1. Get testnet ETH:**

- [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) — requires a Coinbase account
- Or bridge from Sepolia using the [Base Bridge](https://bridge.base.org/)

**2. Configure `.env`:**

```bash
cp .env.example .env
```

```dotenv
SENTINEL_MODE=testnet
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
OPERATOR_PRIVATE_KEY=0x<your-funded-testnet-key>

# AI Agent (optional — heuristic mode works without an API key)
AI_PROVIDER=heuristic
# AI_PROVIDER=openai
# AI_API_KEY=sk-...

# Uniswap v4 + Nitrolite addresses are pre-configured in constants.ts
# Override only if you've deployed custom contracts:
# UNISWAP_V4_QUOTER_ADDRESS=0x...
# NITROLITE_CUSTODY_ADDRESS=0x...
```

**3. Start in testnet mode:**

```bash
./start.sh testnet
```

This validates your `.env`, connects to Base Sepolia, and starts the API server + frontend. No Anvil, no contract deployment — it uses the pre-deployed Uniswap v4 and Nitrolite contracts.

**4. (Optional) Deploy your own SentinelWallet + PolicyGuard:**

```bash
cd contracts

# Deploy + verify on BaseScan
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Update .env with the printed addresses:
# SENTINEL_WALLET_ADDRESS=0x...
# POLICY_GUARD_ADDRESS=0x...
```

**5. (Optional) Fund the SentinelWallet:**

```bash
# Send some ETH to the wallet so it can pay for settlement gas
cast send $SENTINEL_WALLET_ADDRESS \
  --value 0.01ether \
  --rpc-url $RPC_URL \
  --private-key $OPERATOR_PRIVATE_KEY
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
| `SENTINEL_MODE` | Optional | `local` (default) or `testnet` — controls start.sh behavior |
| `RPC_URL` | For on-chain | Base Sepolia RPC endpoint |
| `OPERATOR_PRIVATE_KEY` | For on-chain | Operator key for settlement transactions |
| `SENTINEL_WALLET_ADDRESS` | For on-chain | Deployed SentinelWallet address |
| `POLICY_GUARD_ADDRESS` | For on-chain | Deployed PolicyGuard address |
| `ENTRYPOINT_ADDRESS` | Optional | ERC-4337 EntryPoint v0.7 (defaults to canonical address) |
| `ETHERSCAN_API_KEY` | Optional | BaseScan API key for contract verification |
| **AI Agent** | | |
| `AI_PROVIDER` | Optional | `heuristic` (default), `openai`, or `anthropic` |
| `AI_API_KEY` | For LLM | OpenAI or Anthropic API key |
| `AI_MODEL` | Optional | Override model (default: `gpt-4o` / `claude-sonnet-4-20250514`) |
| **Nitrolite / Yellow Network** | | |
| `NITROLITE_BROKER_URL` | Optional | WebSocket URL for ClearNode (default: `wss://clearnet.yellow.com/ws`) |
| `NITROLITE_SIGNER_KEY` | Optional | Private key for channel state signing (ECDSA) |
| `NITROLITE_BROKER_ADDRESS` | Optional | Broker's Ethereum address |
| `NITROLITE_CUSTODY_ADDRESS` | Optional | Custody contract (default: Base Sepolia address) |
| `NITROLITE_ADJUDICATOR_ADDRESS` | Optional | Adjudicator contract (default: Base Sepolia address) |
| **Uniswap v4** | | |
| `UNISWAP_V4_QUOTER_ADDRESS` | Optional | Quoter2 contract (default: Base Sepolia address) |
| `UNISWAP_V4_POOL_MANAGER_ADDRESS` | Optional | PoolManager (default: Base Sepolia address) |
| **ENS** | | |
| `ENS_RPC_URL` | Optional | RPC for ENS resolution (Ethereum mainnet) |
| `ENS_REGISTRY_ADDRESS` | Optional | Custom ENS registry address |
| **Server** | | |
| `API_PORT` | Optional | Backend API server port (default: 3001) |
| `AGENT_ENS_NAME` | Optional | ENS name for agent identity (default: sentinel-agent.eth) |
| `LOG_LEVEL` | Optional | `debug`, `info`, `warn`, `error` |

> **Note:** All on-chain features gracefully degrade. Without env vars, Sentinel runs in full mock mode — perfect for development and demos. The `start.sh` script auto-configures everything for local development. In testnet mode, Uniswap v4 and Nitrolite addresses default to the pre-configured Base Sepolia contracts in `constants.ts`.

## Do I Need API Keys?

**For local development: NO.** The `./start.sh` script runs everything locally with zero external dependencies:

| Integration | Local Mode | Testnet Mode |
|---|---|---|
| **AI Agent** | Heuristic mode (default) — no key needed. Parses intents via NLP. | Same, or set `AI_PROVIDER=openai` + `AI_API_KEY` for GPT-4o / Claude reasoning. |
| **EVM RPC** | Anvil (local) — no key needed | Public RPCs like `https://sepolia.base.org` work without a key. For higher rate limits, get a free key from [Alchemy](https://www.alchemy.com/), [Infura](https://infura.io/), or [QuickNode](https://www.quicknode.com/). |
| **ENS Resolution** | Skipped (graceful fallback) | Needs an Ethereum mainnet RPC (`ENS_RPC_URL`). Free public RPCs like `https://eth.llamarpc.com` work. |
| **Uniswap v4 Quoter** | Local AMM simulator | Pre-configured Base Sepolia addresses — just needs an RPC, no API key. |
| **Nitrolite Channel** | Auto-configured with Anvil keys | Connects to Yellow Network ClearNode (`wss://clearnet.yellow.com/ws`). No API key — uses WebSocket + ECDSA signing. |
| **BaseScan Verification** | Not needed | Optional `ETHERSCAN_API_KEY` for `--verify` during deployment. Get one free at [BaseScan](https://basescan.org/apis). |
| **Smart Contracts** | Deployed to local Anvil | Testnet ETH from [Base Faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) (free, Coinbase account). |

> **TL;DR:** Run `./start.sh` — zero API keys, zero testnet ETH, everything works out of the box. The AI agent uses heuristic mode by default.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (ESM, strict mode) |
| Runtime | Node.js ≥ 20, tsx for dev |
| AI Agent | OpenAI GPT-4o / Anthropic Claude / Heuristic NLP (zero-key fallback) |
| MCP | `@modelcontextprotocol/sdk` v1.12 |
| Frontend | Next.js 15, React 19, Tailwind CSS 3.4 |
| API Server | Node.js `http` module — lightweight, zero deps |
| Validation | Zod schemas on all tool inputs |
| Blockchain | ethers v6, viem v2.21 |
| Smart Contracts | Solidity 0.8.24, OpenZeppelin v5, Foundry |
| Chain | Base Sepolia (84532) |
| DEX | Uniswap v4 (Quoter2 + PoolManager slot0 + local AMM fallback) |
| State Channels | Yellow Network / Nitrolite (real ECDSA, ClearNode WebSocket) |
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

1. **AI Agent Layer** — The built-in agent can only call the same 4 MCP tools. It cannot bypass policy, access wallets directly, or execute arbitrary code. Heuristic mode works without any external API.
2. **MCP Tool Layer** — Zod schema validation on all inputs. Type-safe, no raw strings.
3. **Policy Engine** — Deterministic 4-rule evaluation. Every decision logged with full audit trail. SHA-256 policy hash for integrity.
4. **Session Manager** — Balance accounting with overflow/underflow protection. Action limits per session.
5. **Nitrolite Channel** — Co-signed state transitions via Yellow Network ClearNode. Neither party can unilaterally modify balances.
6. **PolicyGuard (on-chain)** — Final safety net. Even if all off-chain layers are compromised, settlement must pass on-chain validation.
7. **SentinelWallet (on-chain)** — Owner-only execution. AI agent never touches the wallet directly. ERC-4337 signature verification.
8. **ENS Anchoring** — Policy hash stored as a text record. Tamper-proof verification that the policy hasn't changed.

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
