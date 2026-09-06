import type { AddressValidation, Chain, Transaction, WalletKind, WalletMetadata } from "@/lib/types"
import { validateAddress } from "@/lib/blockchain/address-utils"
import { getChainConfig, NATIVE_ASSET } from "@/lib/blockchain/config"
import { providerCache, cacheKey, CACHE_TTL } from "@/lib/blockchain/cache"
import { ProviderError } from "@/lib/blockchain/net"
import type {
  BlockchainProvider,
  DataSource,
  ProviderResult,
  TokenTransfer,
  TxFetchMeta,
  TxQueryOptions,
  WalletBalance,
} from "@/lib/blockchain/data-source"
import { isDemoSource, MAX_INVESTIGATION_TRANSACTIONS } from "@/lib/blockchain/data-source"
import { EthereumProvider, PolygonProvider, BSCProvider } from "@/lib/blockchain/providers/evm"
import { BitcoinProvider } from "@/lib/blockchain/providers/bitcoin"
import { TronProvider } from "@/lib/blockchain/providers/tron"
import { MockBlockchainProvider } from "@/lib/blockchain/providers/mock"
import { recordProviderSuccess } from "@/lib/blockchain/health-state"
import { getPriceProvider, isPriceEnrichmentConfigured } from "@/lib/blockchain/price/price-provider"

const DEMO_NOTICE = "DEMO DATA — deterministic sample, not live blockchain data."
const TRUNCATION_NOTICE = "Transaction history was limited to the investigation maximum."
// Cap how many distinct (asset, day) price lookups a single investigation
// will trigger, so value enrichment can never turn into an unbounded fan-out
// of price-API calls.
const MAX_PRICE_LOOKUPS = 25

// Exported so the provider-health service can probe the exact same adapters
// the trace path uses, without duplicating this switch.
export function liveProviderFor(chain: Chain): BlockchainProvider | null {
  switch (chain) {
    case "bitcoin":
      return new BitcoinProvider()
    case "ethereum":
      return new EthereumProvider()
    case "polygon":
      return new PolygonProvider()
    case "bsc":
      return new BSCProvider()
    case "tron":
      return new TronProvider()
    default:
      return null
  }
}

interface RunResult<T> {
  data: T
  dataSource: DataSource
  provider: string
  notice?: string
  meta?: TxFetchMeta
}

// Core execution path for single-value reads (balance, single tx lookup):
// cache -> live/indexed provider -> mock fallback. Only non-mock results are
// cached, so demo data is never relabelled CACHED.
async function run<T>(
  chain: Chain,
  op: string,
  ttlMs: number,
  liveFn: (p: BlockchainProvider) => Promise<T>,
  mockFn: (m: MockBlockchainProvider) => Promise<T>,
): Promise<ProviderResult<T>> {
  const key = cacheKey([chain, op])
  const cached = providerCache.get<{ data: T; dataSource: DataSource; provider: string }>(key)
  if (cached.hit && cached.value) {
    return {
      data: cached.value.data,
      dataSource: "CACHED",
      chain,
      provider: cached.value.provider,
      fetchedAt: new Date().toISOString(),
      cached: true,
    }
  }

  const mock = new MockBlockchainProvider(chain)
  const live = liveProviderFor(chain)
  const canGoLive = live?.isConfigured() ?? false

  let result: RunResult<T>
  if (live && canGoLive) {
    try {
      const data = await liveFn(live)
      result = { data, dataSource: live.nativeSource, provider: live.name }
      recordProviderSuccess(chain)
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : "live provider error"
      const data = await mockFn(mock)
      result = {
        data,
        dataSource: "MOCK",
        provider: mock.name,
        notice: `Live provider unavailable (${reason}). ${DEMO_NOTICE}`,
      }
    }
  } else {
    const data = await mockFn(mock)
    result = {
      data,
      dataSource: "MOCK",
      provider: mock.name,
      notice: DEMO_NOTICE,
    }
  }

  if (result.dataSource !== "MOCK") {
    providerCache.set(key, { data: result.data, dataSource: result.dataSource, provider: result.provider }, ttlMs)
  }

  return {
    data: result.data,
    dataSource: result.dataSource,
    chain,
    provider: result.provider,
    fetchedAt: new Date().toISOString(),
    cached: false,
    notice: result.notice,
  }
}

// List execution path (transactions / token transfers): same cache -> live
// -> mock flow as `run`, but prefers a provider's paginated method when
// available so callers get honest totalFetched/pagesFetched/truncated
// metadata instead of a silent 50-row clip.
async function runList<T>(
  chain: Chain,
  op: string,
  ttlMs: number,
  options: TxQueryOptions | undefined,
  pagedFn: ((p: BlockchainProvider) => Promise<{ items: T[]; meta: TxFetchMeta } | undefined>) | undefined,
  simpleFn: (p: BlockchainProvider) => Promise<T[]>,
  mockFn: (m: MockBlockchainProvider) => Promise<T[]>,
): Promise<ProviderResult<T[]>> {
  const key = cacheKey([chain, op, options?.page, options?.maxTransactions, options?.startDate, options?.endDate])
  const cached = providerCache.get<{ data: T[]; dataSource: DataSource; provider: string; meta?: TxFetchMeta }>(key)
  if (cached.hit && cached.value) {
    return {
      data: cached.value.data,
      dataSource: "CACHED",
      chain,
      provider: cached.value.provider,
      fetchedAt: new Date().toISOString(),
      cached: true,
      meta: cached.value.meta,
    }
  }

  const mock = new MockBlockchainProvider(chain)
  const live = liveProviderFor(chain)
  const canGoLive = live?.isConfigured() ?? false

  let result: RunResult<T[]>
  if (live && canGoLive) {
    try {
      const paged = pagedFn ? await pagedFn(live) : undefined
      if (paged) {
        result = {
          data: paged.items,
          dataSource: live.nativeSource,
          provider: live.name,
          meta: paged.meta,
          notice: paged.meta.truncated ? TRUNCATION_NOTICE : undefined,
        }
      } else {
        const data = await simpleFn(live)
        result = { data, dataSource: live.nativeSource, provider: live.name }
      }
      recordProviderSuccess(chain)
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : "live provider error"
      const data = await mockFn(mock)
      result = {
        data,
        dataSource: "MOCK",
        provider: mock.name,
        notice: `Live provider unavailable (${reason}). ${DEMO_NOTICE}`,
      }
    }
  } else {
    const data = await mockFn(mock)
    result = { data, dataSource: "MOCK", provider: mock.name, notice: DEMO_NOTICE }
  }

  if (result.dataSource !== "MOCK") {
    providerCache.set(
      key,
      { data: result.data, dataSource: result.dataSource, provider: result.provider, meta: result.meta },
      ttlMs,
    )
  }

  return {
    data: result.data,
    dataSource: result.dataSource,
    chain,
    provider: result.provider,
    fetchedAt: new Date().toISOString(),
    cached: false,
    notice: result.notice,
    meta: result.meta,
  }
}

// Best-effort historical USD enrichment for a batch of transactions. Never
// throws and never blocks tracing on a price-API failure — every lookup that
// fails or is unconfigured just leaves usdValue as null / UNAVAILABLE. Calls
// are deduped by (asset, day) and capped so one investigation can't fan out
// into an unbounded number of price requests.
async function enrichTransactionsWithPrices(txs: Transaction[]): Promise<Transaction[]> {
  if (!isPriceEnrichmentConfigured() || txs.length === 0) return txs
  const provider = getPriceProvider()
  const cache = new Map<string, { usd: number | null; source: string; timestamp: string | null }>()
  let lookups = 0

  const out: Transaction[] = []
  for (const tx of txs) {
    if ((tx.usdValue !== null && tx.usdValue !== undefined) || !tx.timestamp) {
      out.push(tx)
      continue
    }
    const day = tx.timestamp.slice(0, 10)
    const key = `${tx.asset}:${day}`
    let price = cache.get(key)
    if (!price) {
      if (lookups >= MAX_PRICE_LOOKUPS) {
        out.push(tx)
        continue
      }
      lookups++
      const historical = await provider.getHistoricalPrice(tx.asset, tx.timestamp)
      price = historical
      cache.set(key, historical)
    }
    if (price.usd === null) {
      out.push(tx)
      continue
    }
    out.push({
      ...tx,
      usdValue: Math.round(tx.amount * price.usd * 100) / 100,
      priceDataSource: price.source as Transaction["priceDataSource"],
      priceTimestamp: price.timestamp,
    })
  }
  return out
}

// Public façade — the production BlockchainProvider surface used by API routes.
export const blockchain = {
  validateAddress(address: string, chain?: Chain): AddressValidation {
    return validateAddress(address, chain)
  },

  isLiveCapable(chain: Chain): boolean {
    return getChainConfig(chain).configured && liveProviderFor(chain) !== null
  },

  async getTransactions(address: string, chain: Chain, options?: TxQueryOptions): Promise<ProviderResult<Transaction[]>> {
    const res = await runList<Transaction>(
      chain,
      cacheKey(["txs", address]),
      CACHE_TTL.transactions,
      options,
      async (p) => {
        if (!p.getTransactionsPaged) return undefined
        const { transactions, meta } = await p.getTransactionsPaged(address, chain, options)
        return { items: transactions, meta }
      },
      (p) => p.getTransactions(address, chain, options),
      (m) => m.getTransactions(address),
    )
    if (res.dataSource === "MOCK") return res
    return { ...res, data: await enrichTransactionsWithPrices(res.data) }
  },

  getTransaction(hash: string, chain: Chain): Promise<ProviderResult<Transaction | null>> {
    return run(
      chain,
      cacheKey(["tx", hash]),
      CACHE_TTL.transaction,
      (p) => p.getTransaction(hash, chain),
      (m) => m.getTransaction(hash),
    )
  },

  getWalletBalance(address: string, chain: Chain): Promise<ProviderResult<WalletBalance>> {
    return run(
      chain,
      cacheKey(["bal", address]),
      CACHE_TTL.balance,
      (p) => p.getWalletBalance(address, chain),
      (m) => m.getWalletBalance(address),
    )
  },

  getTokenTransfers(
    address: string,
    chain: Chain,
    options?: TxQueryOptions,
  ): Promise<ProviderResult<TokenTransfer[]>> {
    return runList<TokenTransfer>(
      chain,
      cacheKey(["tok", address]),
      CACHE_TTL.tokenTransfers,
      options,
      async (p) => {
        if (!p.getTokenTransfersPaged) return undefined
        const { transfers, meta } = await p.getTokenTransfersPaged(address, chain, options)
        return { items: transfers, meta }
      },
      (p) => p.getTokenTransfers(address, chain, options),
      (m) => m.getTokenTransfers(address),
    )
  },

  // Composite wallet lookup used by the wallet-investigation route. Returns a
  // single honest dataSource plus derived metadata. When the source is not
  // MOCK, metadata is synthesized from live balance + transaction stats.
  async inspectWallet(address: string, chain: Chain, options?: TxQueryOptions) {
    const [balRes, txRes, tokRes] = await Promise.all([
      this.getWalletBalance(address, chain),
      this.getTransactions(address, chain, options),
      this.getTokenTransfers(address, chain, options),
    ])

    // Overall source reflects the transaction feed (the primary intelligence).
    const dataSource = txRes.dataSource
    const demo = isDemoSource(dataSource)

    let metadata: WalletMetadata
    if (demo) {
      const mock = new MockBlockchainProvider(chain)
      const m = await mock.getMetadata(address)
      metadata = m ?? synthMetadata(address, chain, balRes.data, txRes.data, "DEMO_DATA")
    } else {
      metadata = synthMetadata(address, chain, balRes.data, txRes.data, "LIVE_BLOCKCHAIN_DATA")
    }

    return {
      address,
      chain,
      dataSource,
      demo,
      notice: txRes.notice,
      provider: txRes.provider,
      fetchedAt: txRes.fetchedAt,
      cached: txRes.cached,
      meta: txRes.meta,
      metadata,
      balance: balRes.data,
      transactions: txRes.data,
      tokenTransfers: tokRes.data,
    }
  },
}

function synthMetadata(
  address: string,
  chain: Chain,
  balance: WalletBalance,
  txs: Transaction[],
  provenance: "DEMO_DATA" | "LIVE_BLOCKCHAIN_DATA",
): WalletMetadata {
  const times = txs.map((t) => t.timestamp).filter((t): t is string => Boolean(t)).sort()
  const kind: WalletKind = "UNKNOWN"
  const now = new Date().toISOString()
  return {
    address,
    chain,
    kind,
    balance: balance.balance,
    asset: balance.asset || NATIVE_ASSET[chain],
    usdBalance: balance.usdBalance,
    firstSeen: times[0] ?? now,
    lastSeen: times[times.length - 1] ?? now,
    txCount: txs.length,
    provenance,
    attribution: null,
  }
}

export type WalletInspection = Awaited<ReturnType<typeof blockchain.inspectWallet>>
export { MAX_INVESTIGATION_TRANSACTIONS }
