import type { Chain } from "@/lib/types"

// Central, server-only configuration for live providers. API keys are read from
// environment variables and NEVER shipped to the client or embedded in code.
//
// EVM chains (Ethereum / Polygon / BSC) are served by the Etherscan V2 unified
// API: a single ETHERSCAN_API_KEY works across chains via the `chainid` param.
// Per-chain legacy overrides (TRACECHAIN_<CHAIN>_API_URL / _API_KEY) remain
// supported for operators using dedicated explorer keys.
//
// Bitcoin uses a public, keyless explorer API (Blockstream/mempool.space), so
// it is live-capable out of the box and needs no secret.

export const EVM_CHAIN_ID: Partial<Record<Chain, number>> = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
}

export const NATIVE_ASSET: Record<Chain, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  polygon: "MATIC",
  bsc: "BNB",
  tron: "TRX",
}

// Env var names surfaced (names only, never values) on the Integrations page.
export const ENV_VARS: Record<Chain, { url: string; key: string }> = {
  ethereum: { url: "TRACECHAIN_ETH_API_URL", key: "TRACECHAIN_ETH_API_KEY" },
  polygon: { url: "TRACECHAIN_POLYGON_API_URL", key: "TRACECHAIN_POLYGON_API_KEY" },
  bsc: { url: "TRACECHAIN_BSC_API_URL", key: "TRACECHAIN_BSC_API_KEY" },
  bitcoin: { url: "TRACECHAIN_BTC_API_URL", key: "TRACECHAIN_BTC_API_KEY" },
  tron: { url: "TRACECHAIN_TRON_API_URL", key: "TRACECHAIN_TRON_API_KEY" },
}

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api"
const BLOCKSTREAM_BASE = "https://blockstream.info/api"
const TRONGRID_BASE = "https://api.trongrid.io"

export interface ChainConfig {
  chain: Chain
  // Resolved base URL used by the adapter.
  baseUrl: string
  // Server-side API key (may be empty for keyless public APIs like Bitcoin).
  apiKey: string
  // For EVM: the numeric chain id used by the Etherscan V2 unified endpoint.
  chainId?: number
  // Whether a live/indexed fetch is possible for this chain.
  configured: boolean
  // "indexer" -> Etherscan family (INDEXED), "explorer" -> direct chain API (LIVE)
  kind: "indexer" | "explorer" | "none"
}

function env(name: string): string {
  return (process.env[name] ?? "").trim()
}

export function getChainConfig(chain: Chain): ChainConfig {
  const legacyUrl = env(ENV_VARS[chain].url)
  const legacyKey = env(ENV_VARS[chain].key)

  if (chain === "bitcoin") {
    // Public, keyless explorer — live by default, overridable via env.
    return {
      chain,
      baseUrl: legacyUrl || BLOCKSTREAM_BASE,
      apiKey: legacyKey,
      configured: true,
      kind: "explorer",
    }
  }

  const chainId = EVM_CHAIN_ID[chain]
  if (chainId) {
    // Prefer a dedicated legacy key+url; otherwise fall back to the unified
    // Etherscan V2 endpoint with the shared ETHERSCAN_API_KEY.
    const unifiedKey = env("ETHERSCAN_API_KEY")
    const apiKey = legacyKey || unifiedKey
    return {
      chain,
      baseUrl: legacyUrl || ETHERSCAN_V2_BASE,
      apiKey,
      chainId,
      configured: Boolean(apiKey),
      kind: "indexer",
    }
  }

  if (chain === "tron") {
    // TronGrid is a public indexer with a sane default endpoint (like
    // Blockstream for Bitcoin), but a free/keyless request rate is too low
    // for reliable investigation traffic, so live-capability still requires
    // an API key. The URL may be overridden for a self-hosted node/gateway.
    return {
      chain,
      baseUrl: legacyUrl || TRONGRID_BASE,
      apiKey: legacyKey,
      configured: Boolean(legacyKey),
      kind: legacyKey ? "explorer" : "none",
    }
  }

  // Anything else — live only if a full url+key pair is provided.
  return {
    chain,
    baseUrl: legacyUrl,
    apiKey: legacyKey,
    configured: Boolean(legacyUrl && legacyKey),
    kind: legacyUrl ? "explorer" : "none",
  }
}

export function isLiveCapable(chain: Chain): boolean {
  return getChainConfig(chain).configured
}
