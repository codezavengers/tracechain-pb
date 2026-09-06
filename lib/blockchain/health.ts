import type { Chain, ProviderHealth, ProviderHealthStatus } from "@/lib/types"
import { getChainConfig } from "@/lib/blockchain/config"
import { liveProviderFor } from "@/lib/blockchain/service"
import { getLastSuccess } from "@/lib/blockchain/health-state"
import { ProviderError } from "@/lib/blockchain/net"

const CHAINS: Chain[] = ["ethereum", "polygon", "bsc", "bitcoin", "tron"]

// Well-known, always-exists addresses used purely to measure round-trip
// latency and reachability. Never touches investigation data, never leaks
// secrets (the health check only ever reads config booleans, not values).
const PROBE_ADDRESS: Partial<Record<Chain, string>> = {
  ethereum: "0x000000000000000000000000000000000000dEaD",
  polygon: "0x000000000000000000000000000000000000dEaD",
  bsc: "0x000000000000000000000000000000000000dEaD",
  bitcoin: "1BitcoinEaterAddressDontSendf59kuE",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
}

const DEGRADED_LATENCY_MS = 3000
const PROBE_TIMEOUT_MS = 6000

async function checkOne(chain: Chain): Promise<ProviderHealth> {
  const cfg = getChainConfig(chain)
  const provider = liveProviderFor(chain)
  const liveCapable = provider !== null
  const configured = cfg.configured && liveCapable

  if (!configured || !provider) {
    return {
      chain,
      provider: "mock:demo-dataset",
      status: "DEMO",
      latencyMs: null,
      lastSuccess: getLastSuccess(chain),
      configured,
      liveCapable,
      mode: "DEMO",
    }
  }

  const probeAddress = PROBE_ADDRESS[chain]
  const started = Date.now()
  try {
    if (probeAddress) {
      await Promise.race([
        provider.getWalletBalance(probeAddress, chain),
        new Promise((_, reject) => setTimeout(() => reject(new ProviderError("probe timeout", "timeout")), PROBE_TIMEOUT_MS)),
      ])
    }
    const latencyMs = Date.now() - started
    const status: ProviderHealthStatus = latencyMs > DEGRADED_LATENCY_MS ? "DEGRADED" : "HEALTHY"
    return {
      chain,
      provider: provider.name,
      status,
      latencyMs,
      lastSuccess: new Date().toISOString(),
      configured: true,
      liveCapable,
      mode: "LIVE",
    }
  } catch (err) {
    const latencyMs = Date.now() - started
    const status: ProviderHealthStatus =
      err instanceof ProviderError && err.kind === "rate_limit" ? "RATE_LIMITED" : "UNAVAILABLE"
    return {
      chain,
      provider: provider.name,
      status,
      latencyMs,
      lastSuccess: getLastSuccess(chain),
      configured: true,
      liveCapable,
      mode: "LIVE",
    }
  }
}

// Checks every supported chain in parallel. Never throws — an individual
// probe failure surfaces as UNAVAILABLE/RATE_LIMITED for that chain only.
export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  return Promise.all(CHAINS.map(checkOne))
}
