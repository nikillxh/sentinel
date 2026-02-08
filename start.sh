#!/usr/bin/env bash
# ============================================================
# Sentinel – Local Demo Launcher
# Starts Anvil, deploys contracts, and launches the frontend.
# Usage:  ./start.sh
# Stop:   ./start.sh stop
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANVIL_PORT=8546
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
  echo -e "${CYAN}  │${NC}  🛡️  ${GREEN}Sentinel${NC} – Local Demo Launcher       ${CYAN}│${NC}"
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

  if [ -f "$LOG_DIR/frontend.pid" ]; then
    kill "$(cat "$LOG_DIR/frontend.pid")" 2>/dev/null && log "Frontend stopped" || true
    rm -f "$LOG_DIR/frontend.pid"
  fi

  # Kill any orphan processes on our ports
  lsof -ti :"$ANVIL_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
  lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

  log "All processes stopped"
}

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
  banner
  cleanup
  exit 0
fi

# --- Preflight checks ---
banner
step "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { err "Node.js not found. Install Node >= 20."; exit 1; }
command -v anvil >/dev/null 2>&1 || { err "Anvil not found. Install Foundry: https://book.getfoundry.sh"; exit 1; }
command -v forge >/dev/null 2>&1 || { err "Forge not found. Install Foundry: https://book.getfoundry.sh"; exit 1; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  err "Node.js >= 20 required (found v$(node -v))"
  exit 1
fi

log "Node $(node -v)"
log "Anvil $(anvil --version 2>&1 | head -1)"
log "Forge $(forge --version 2>&1 | head -1)"

# Create log directory
mkdir -p "$LOG_DIR"

# --- Kill anything on our ports ---
step "Freeing ports $ANVIL_PORT and $FRONTEND_PORT..."
lsof -ti :"$ANVIL_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
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

# --- Start Anvil ---
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

# --- Update .env ---
step "Updating .env..."

cat > "$ROOT_DIR/.env" << EOF
# === Sentinel Configuration (auto-generated by start.sh) ===

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

# Session defaults
DEFAULT_SESSION_DEPOSIT_USDC=1000
MAX_TRADE_PERCENT=2
MAX_SLIPPAGE_PERCENT=0.5

# Logging
LOG_LEVEL=debug
EOF

log ".env written with deployed addresses"

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
echo -e "  ${CYAN}│${NC}   ${GREEN}🟢 All services running${NC}                        ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Frontend:  ${YELLOW}http://localhost:$FRONTEND_PORT${NC}            ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Anvil:     ${YELLOW}http://127.0.0.1:$ANVIL_PORT${NC}            ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Logs:      .logs/anvil.log                     ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}              .logs/frontend.log                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}   Stop:      ${BLUE}./start.sh stop${NC}                      ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}└──────────────────────────────────────────────────┘${NC}"
echo ""
