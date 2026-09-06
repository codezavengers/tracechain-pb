import { NextResponse } from "next/server"
import { requireUser } from "@/lib/api/session"
import { blockchain, getChainConfig, ENV_VARS, DATA_SOURCE_LABEL } from "@/lib/blockchain"
import { VASP_KNOWLEDGE_BASE } from "@/lib/vasp/knowledge-base"
import type { Chain } from "@/lib/types"

const CHAINS: Chain[] = ["bitcoin", "ethereum", "polygon", "bsc", "tron"]

// Reports the real, live provider configuration state without leaking secrets.
export async function GET() {
  const auth = await requireUser()
  if ("response" in auth) return auth.response

  const chains = CHAINS.map((c) => {
    const cfg = getChainConfig(c)
    const configured = blockchain.isLiveCapable(c)
    // The data source each chain would resolve to on a successful fetch.
    const dataSource = configured ? (cfg.kind === "indexer" ? "INDEXED" : "LIVE") : "MOCK"
    return {
      chain: c,
      mode: configured ? "LIVE" : "DEMO",
      configured,
      kind: cfg.kind,
      dataSource,
      dataSourceLabel: DATA_SOURCE_LABEL[dataSource],
      envUrl: ENV_VARS[c].url,
      envKey: ENV_VARS[c].key,
    }
  })

  return NextResponse.json({
    chains,
    liveConfiguredCount: chains.filter((c) => c.configured).length,
    // Single shared key that enables all EVM chains via Etherscan V2.
    unifiedEvmKey: "ETHERSCAN_API_KEY",
    unifiedEvmConfigured: Boolean((process.env.ETHERSCAN_API_KEY ?? "").trim()),
    vasps: VASP_KNOWLEDGE_BASE,
    jwtConfigured: Boolean(process.env.TRACECHAIN_JWT_SECRET),
  })
}
