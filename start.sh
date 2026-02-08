#!/usr/bin/env bash
# ============================================================
# Sentinel – Demo Launcher
# Supports two modes:
#   local   → Anvil (:8546) → deploy contracts → API (:3001) → Frontend (:3000)
#   testnet → API (:3001) → Frontend (:3000)  (uses real Base Sepolia RPC)
#
# Usage:
#   ./start.sh                 # auto-detect from SENTINEL_MODE or default to local
#   ./start.sh local           # force local Anvil mode
#   ./start.sh testnet         # force testnet mode (requires .env with real keys)
#   ./start.sh stop            # stop all services
#
# In testnet mode:
#   - No Anvil needed — connects directly to Base Sepolia via RPC_URL in .env
#   - Uniswap v4 uses real deployed contracts (PoolManager, V4Quoter)
#   - Nitrolite connects to Yellow ClearNode at wss://clearnet.yellow.com/ws
#   - ENS resolves via Ethereum mainnet
#   - AI agent runs with configured provider (heuristic/openai/anthropic)
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANVIL_PORT=8546
API_PORT=3001
FRONTEND_PORT=3000
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
LOG_DIR="$ROOT_DIR/.logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}  ┌──────────────────────────────────────────┐${NC}"
  echo -e "${CYAN}  │${NC}  🛡️  ${GREEN}Sentinel${NC} – Demo Launcher              ${CYAN}│${NC}"
  echo -e "${CYAN}  │${NC}     ETHGlobal HackMoney 2026             ${CYAN}│${NC}"
  echo -e "${CYAN}  └──────────────────────────────────────────┘${NC}"
  echo ""
}

log() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err() { echo -e "  ${RED}✗${NC} $1"; }
step() { echo -e "\n  ${BLUE}▸${NC} ${CYAN}$1${NC}"; }

cleanup() {
  step "Shutting down..."

  if [ -f "$LOG_DIR/anvil.pid" ]; then
    kill "$(cat "$LOG_DIR/anvil.pid")" 2>/dev/null && log "Anvil stopped" || true
    rm -f "$LOG_DIR/anvil.pid"
  fi

  if [ -f "$LOG_DIR/api.pid" ]; then
    kill "$(cat "$LOG_DIR/api.pid")" 2>/dev/null && log "API server stopped" || true
    rm -f "$LOG_DIR/api.pid"
  fi

  if [ -f "$LOG_DIR/frontend.pid" ]; then
    kill "$(cat "$LOG_DIR/frontend.pid")" 2>/dev/null && log "Frontend stopped" || true
    rm -f "$LOG_DIR/frontend.pid"
  fi

  # Kill any orphan processes on our ports
  lsof -ti :"$ANVIL_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
  lsof -ti :"$API_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
  lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

  log "All processes stopped"
}

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
  banner
  cleanup
  exit 0
fi

# --- Determine mode ---
# Priority: CLI arg > SENTINEL_MODE env var > default (local)
MODE="${1:-${SENTINEL_MODE:-local}}"

if [ "$MODE" != "local" ] && [ "$MODE" != "testnet" ]; then
  err "Unknown mode: $MODE. Use 'local' or 'testnet'."
  exit 1
fi

# --- Preflight checks ---
banner
step "Checking prerequisites... (mode: $MODE)"

command -v node >/dev/null 2>&1 || { err "Node.js not found. Install Node >= 20."; exit 1; }
command -v curl >/dev/null 2>&1 || { err "curl not found. Install curl."; exit 1; }

if [ "$MODE" = "local" ]; then
  command -v anvil >/dev/null 2>&1 || { err "Anvil not found. Install Foundry: https://book.getfoundry.sh"; exit 1; }
  command -v forge >/dev/null 2>&1 || { err "Forge not found. Install Foundry: https://book.getfoundry.sh"; exit 1; }
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  err "Node.js >= 20 required (found v$(node -v))"
  exit 1
fi

log "Node $(node -v)"
if [ "$MODE" = "local" ]; then
  log "Anvil $(anvil --version 2>&1 | head -1)"
  log "Forge $(forge --version 2>&1 | head -1)"
fi

# Create log directory
mkdir -p "$LOG_DIR"

# --- Kill anything on our ports ---
step "Freeing ports $API_PORT and $FRONTEND_PORT..."
lsof -ti :"$API_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
if [ "$MODE" = "local" ]; then
  lsof -ti :"$ANVIL_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
fi
sleep 1
log "Ports clear"

# --- Install dependencies ---
step "Installing dependencies..."

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  (cd "$ROOT_DIR" && npm install --silent)
  log "Root dependencies installed"
else
  log "Root dependencies already installed"
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  (cd "$ROOT_DIR/frontend" && npm install --silent)
  log "Frontend dependencies installed"
else
  log "Frontend dependencies already installed"
fi

# --- Start Anvil (local mode only) ---
if [ "$MODE" = "local" ]; then
  step "Starting Anvil on port $ANVIL_PORT..."

  anvil \
    --chain-id 84532 \
    --port "$ANVIL_PORT" \
    --silent \
    > "$LOG_DIR/anvil.log" 2>&1 &

  echo $! > "$LOG_DIR/anvil.pid"

  # Wait for Anvil to be ready
  for i in $(seq 1 15); do
    if curl -s "http://127.0.0.1:$ANVIL_PORT" \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      > /dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  # Verify
  CHAIN=$(curl -s "http://127.0.0.1:$ANVIL_PORT" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null \
    | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$CHAIN" ]; then
    err "Anvil failed to start. Check $LOG_DIR/anvil.log"
    exit 1
  fi
  log "Anvil running — chain ID $CHAIN (PID $(cat "$LOG_DIR/anvil.pid"))"

  # --- Deploy contracts ---
  step "Deploying contracts..."

  DEPLOY_OUTPUT=$(cd "$ROOT_DIR/contracts" && \
    OPERATOR_PRIVATE_KEY="$ANVIL_KEY" \
    forge script script/Deploy.s.sol \
      --rpc-url "http://127.0.0.1:$ANVIL_PORT" \
      --broadcast 2>&1)

  # Extract addresses from deploy output
  POLICY_GUARD=$(echo "$DEPLOY_OUTPUT" | grep "PolicyGuard deployed" | grep -oE '0x[0-9a-fA-F]{40}')
  SENTINEL_WALLET=$(echo "$DEPLOY_OUTPUT" | grep "SentinelWallet deployed" | grep -oE '0x[0-9a-fA-F]{40}')

  if [ -z "$POLICY_GUARD" ] || [ -z "$SENTINEL_WALLET" ]; then
    warn "Could not parse addresses, using defaults from .env"
    POLICY_GUARD="0x5FbDB2315678afecb367f032d93F642f64180aa3"
    SENTINEL_WALLET="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
  fi

  log "PolicyGuard:    $POLICY_GUARD"
  log "SentinelWallet: $SENTINEL_WALLET"

  # --- Write local .env ---
  step "Writing .env for local mode..."

  cat > "$ROOT_DIR/.env" << EOF
# === Sentinel Configuration (auto-generated by start.sh — local mode) ===
SENTINEL_MODE=local

# EVM RPC (local Anvil)
RPC_URL=http://127.0.0.1:$ANVIL_PORT
CHAIN_ID=84532

# Deployer / Operator (Anvil account 0)
OPERATOR_PRIVATE_KEY=$ANVIL_KEY

# Smart contract addresses (deployed on local Anvil)
SENTINEL_WALLET_ADDRESS=$SENTINEL_WALLET
POLICY_GUARD_ADDRESS=$POLICY_GUARD

# ERC-4337 EntryPoint v0.7
ENTRYPOINT_ADDRESS=0x0000000071727De22E5E9d8BAf0edAc6f37da032

# ENS
AGENT_ENS_NAME=sentinel-agent.eth

# Nitrolite State Channel (uses Anvil account 1 as signer)
NITROLITE_BROKER_URL=ws://localhost:8547
NITROLITE_SIGNER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
NITROLITE_BROKER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

# Uniswap v4 (defaults from constants.ts if not set)
# UNISWAP_V4_POOL_MANAGER_ADDRESS=
# UNISWAP_V4_QUOTER_ADDRESS=

# AI Agent (heuristic by default — no API key needed)
AI_PROVIDER=heuristic

# API Server
API_PORT=$API_PORT

# Session defaults
DEFAULT_SESSION_DEPOSIT_USDC=1000
MAX_TRADE_PERCENT=2
MAX_SLIPPAGE_PERCENT=0.5

# Logging
LOG_LEVEL=debug
EOF

  log ".env written for local mode"

else
  # --- Testnet mode ---
  step "Testnet mode — checking .env..."

  if [ ! -f "$ROOT_DIR/.env" ]; then
    err "No .env file found. Copy .env.example to .env and fill in your keys:"
    err "  cp .env.example .env"
    err "  # Edit .env with your OPERATOR_PRIVATE_KEY, NITROLITE_SIGNER_KEY, etc."
    exit 1
  fi

  # Validate critical env vars
  source "$ROOT_DIR/.env" 2>/dev/null || true

  if [ -z "${RPC_URL:-}" ] || [ "${RPC_URL:-}" = "0x..." ]; then
    warn "RPC_URL not set — defaulting to https://sepolia.base.org"
  else
    log "RPC: $RPC_URL"
  fi

  if [ -z "${OPERATOR_PRIVATE_KEY:-}" ] || [ "${OPERATOR_PRIVATE_KEY:-}" = "0x..." ]; then
    warn "OPERATOR_PRIVATE_KEY not set — settlement will fail"
  else
    log "Operator key configured"
  fi

  log "Uniswap v4 addresses from constants.ts (Base Sepolia)"
  log "Nitrolite ClearNode: wss://clearnet.yellow.com/ws"
  log "AI Provider: ${AI_PROVIDER:-heuristic}"
fi

# --- Start API Server ---
step "Starting Sentinel API server on port $API_PORT..."

(cd "$ROOT_DIR" && npx tsx src/api/server.ts) \
  > "$LOG_DIR/api.log" 2>&1 &

echo $! > "$LOG_DIR/api.pid"

# Wait for API to be ready
for i in $(seq 1 15); do
  if curl -s "http://localhost:$API_PORT/api/status" > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -s "http://localhost:$API_PORT/api/status" > /dev/null 2>&1; then
  err "API server failed to start. Check $LOG_DIR/api.log"
  exit 1
fi

log "API server running — http://localhost:$API_PORT (PID $(cat "$LOG_DIR/api.pid"))"

# --- Start Frontend ---
step "Starting frontend on port $FRONTEND_PORT..."

(cd "$ROOT_DIR/frontend" && npx next dev --port "$FRONTEND_PORT") \
  > "$LOG_DIR/frontend.log" 2>&1 &

echo $! > "$LOG_DIR/frontend.pid"

# Wait for frontend
for i in $(seq 1 30); do
  if curl -s "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s "http://localhost:$FRONTEND_PORT" > /dev/null 2>&1; then
  err "Frontend failed to start. Check $LOG_DIR/frontend.log"
  exit 1
fi

log "Frontend running — http://localhost:$FRONTEND_PORT (PID $(cat "$LOG_DIR/frontend.pid"))"

# --- Done ---
echo ""
echo -e "  ${CYAN}┌──────────────────────────────────────────────────┐${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   ${GREEN}🟢 All services running${NC}  (${YELLOW}$MODE${NC} mode)           ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Frontend:  ${YELLOW}http://localhost:$FRONTEND_PORT${NC}            ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   API:       ${YELLOW}http://localhost:$API_PORT${NC}            ${CYAN}│${NC}"
if [ "$MODE" = "local" ]; then
echo -e "  ${CYAN}│${NC}   Anvil:     ${YELLOW}http://127.0.0.1:$ANVIL_PORT${NC}            ${CYAN}│${NC}"
else
echo -e "  ${CYAN}│${NC}   Chain:     ${YELLOW}Base Sepolia (84532)${NC}                ${CYAN}│${NC}"
fi
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Logs:      .logs/api.log                       ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}              .logs/frontend.log                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Stop:      ${BLUE}./start.sh stop${NC}                      ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}└──────────────────────────────────────────────────┘${NC}"
echo ""
