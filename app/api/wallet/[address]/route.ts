import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { blockchain, DATA_SOURCE_LABEL } from "@/lib/blockchain"
import { validateAddress } from "@/lib/blockchain/address-utils"
import type { Chain } from "@/lib/types"

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const { address } = await params
  const url = new URL(req.url)
  const chainParam = url.searchParams.get("chain") as Chain | null

  const validation = validateAddress(address, chainParam ?? undefined)
  if (!validation.valid || !validation.chain) {
    return NextResponse.json({ error: validation.reason, validation }, { status: 400 })
  }
  const chain = (chainParam && validation.candidateChains.includes(chainParam) ? chainParam : validation.chain) as Chain

  const inspection = await blockchain.inspectWallet(address, chain)

  return NextResponse.json({
    validation,
    // New, honest source labeling:
    dataSource: inspection.dataSource,
    dataSourceLabel: DATA_SOURCE_LABEL[inspection.dataSource],
    demo: inspection.demo,
    notice: inspection.notice ?? null,
    provider: inspection.provider,
    fetchedAt: inspection.fetchedAt,
    cached: inspection.cached,
    metadata: inspection.metadata,
    balance: inspection.balance,
    transactions: inspection.transactions,
    tokenTransfers: inspection.tokenTransfers,
    // Back-compat fields for existing UI consumers:
    mode: inspection.demo ? "DEMO" : "LIVE",
    provenance: inspection.demo ? "DEMO_DATA" : "LIVE_BLOCKCHAIN_DATA",
  })
}
