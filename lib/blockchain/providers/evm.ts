import type { Chain, Transaction } from "@/lib/types"
import { AbstractProvider } from "./base"
import { fetchJson, ProviderError } from "@/lib/blockchain/net"
import { getChainConfig, NATIVE_ASSET } from "@/lib/blockchain/config"
import { normalizeNative, normalizeToken, baseUnitsToDecimal, directionOf } from "@/lib/blockchain/normalize"
import {
  MAX_ROWS_PER_PAGE,
  DEFAULT_MAX_PAGES,
  MAX_INVESTIGATION_TRANSACTIONS,
  type DataSource,
  type PagedTokenTransfers,
  type PagedTransactions,
  type TokenTransfer,
  type TxQueryOptions,
  type WalletBalance,
} from "@/lib/blockchain/data-source"

// Etherscan V2 unified-API response envelope.
interface EtherscanEnvelope<T> {
  status: string
  message: string
  result: T
}

interface EtherscanTx {
  blockNumber: string
  timeStamp: string
  hash: string
  from: string
  to: string
  value: string
  isError?: string
}

interface EtherscanTokenTx {
  blockNumber: string
  timeStamp: string
  hash: string
  from: string
  to: string
  value: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  contractAddress: string
}

interface EthProxyTx {
  from: string
  to: string | null
  value: string
  blockNumber: string | null
}

interface EthProxyBlock {
  timestamp: string
}

// Block-timestamp lookups (Phase 3). Block timestamps never change once
// mined, so this cache never needs a TTL/eviction beyond a simple size cap —
// keyed by "<chain>:<blockNumber>" as specified.
const blockTimestampCache = new Map<string, string | null>()
const BLOCK_TIMESTAMP_CACHE_MAX = 5000

// Etherscan-family (indexer) adapter shared by Ethereum, Polygon and BSC. The
// numeric chainId selects the network on the V2 unified endpoint.
export class EvmProvider extends AbstractProvider {
  readonly nativeSource: DataSource = "INDEXED"
  readonly name: string

  constructor(readonly chain: Chain) {
    super()
    this.name = `evm:${chain}`
  }

  isConfigured(): boolean {
    return getChainConfig(this.chain).configured
  }

  private buildUrl(params: Record<string, string>): string {
    const cfg = getChainConfig(this.chain)
    if (!cfg.configured) {
      throw new ProviderError(`${this.chain} live provider is not configured.`, "not_configured")
    }
    const u = new URL(cfg.baseUrl)
    if (cfg.chainId) u.searchParams.set("chainid", String(cfg.chainId))
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    if (cfg.apiKey) u.searchParams.set("apikey", cfg.apiKey)
    return u.toString()
  }

  // Transaction Hash -> Get Transaction -> Get Block Number -> Get Block Data
  // -> Extract Block Timestamp -> Convert to ISO. Returns null (never "now")
  // when the timestamp cannot be resolved.
  private async getBlockTimestamp(blockNumberHex: string): Promise<string | null> {
    let blockNumber: number
    try {
      blockNumber = Number(BigInt(blockNumberHex))
    } catch {
      return null
    }
    const key = `${this.chain}:${blockNumber}`
    if (blockTimestampCache.has(key)) return blockTimestampCache.get(key) ?? null

    let result: string | null = null
    try {
      const url = this.buildUrl({
        module: "proxy",
        action: "eth_getBlockByNumber",
        tag: blockNumberHex,
        boolean: "false",
      })
      const res = await fetchJson<{ result: EthProxyBlock | null }>(url, {
        label: `${this.chain} block`,
        retries: 1,
      })
      if (res.result?.timestamp) {
        result = new Date(Number(BigInt(res.result.timestamp)) * 1000).toISOString()
      }
    } catch {
      result = null
    }

    if (blockTimestampCache.size >= BLOCK_TIMESTAMP_CACHE_MAX) blockTimestampCache.clear()
    blockTimestampCache.set(key, result)
    return result
  }

  async getTransactionsPaged(
    address: string,
    _chain?: Chain,
    options: TxQueryOptions = {},
  ): Promise<PagedTransactions> {
    const rowsPerPage = Math.min(options.offset ?? MAX_ROWS_PER_PAGE, MAX_ROWS_PER_PAGE)
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)
    const asset = NATIVE_ASSET[this.chain]

    const all: Transaction[] = []
    let pagesFetched = 0
    let truncated = false

    for (let page = 1; page <= maxPages; page++) {
      const url = this.buildUrl({
        module: "account",
        action: "txlist",
        address,
        startblock: "0",
        endblock: "99999999",
        page: String(page),
        offset: String(rowsPerPage),
        sort: "desc",
      })
      const res = await fetchJson<EtherscanEnvelope<EtherscanTx[] | string>>(url, {
        label: `${this.chain} txlist`,
      })
      pagesFetched++

      if (!Array.isArray(res.result)) {
        // "No transactions found" comes back as status "0" with a string result.
        if (res.status === "0" && /no transactions/i.test(String(res.result))) break
        if (page === 1) throw new ProviderError(`${this.chain} txlist error: ${res.message || "unknown"}.`, "http")
        break
      }

      const rows = res.result
      for (const t of rows) {
        all.push(
          normalizeNative({
            hash: t.hash,
            chain: this.chain,
            from: t.from,
            to: t.to,
            amount: baseUnitsToDecimal(t.value, 18),
            asset,
            timestamp: t.timeStamp ? new Date(Number(t.timeStamp) * 1000).toISOString() : null,
            blockHeight: Number(t.blockNumber),
            address,
            provenance: "LIVE_BLOCKCHAIN_DATA",
          }),
        )
        if (all.length >= cap) break
      }

      if (all.length >= cap) {
        truncated = rows.length >= rowsPerPage
        break
      }
      if (rows.length < rowsPerPage) break // last page
    }

    return {
      transactions: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTransactions(address: string, chain?: Chain, options?: TxQueryOptions): Promise<Transaction[]> {
    const { transactions } = await this.getTransactionsPaged(address, chain, options)
    return transactions
  }

  async getTransaction(hash: string): Promise<Transaction | null> {
    const url = this.buildUrl({
      module: "proxy",
      action: "eth_getTransactionByHash",
      txhash: hash,
    })
    const res = await fetchJson<{ result: EthProxyTx | null }>(url, { label: `${this.chain} tx` })
    if (!res.result) return null
    const r = res.result
    const timestamp = r.blockNumber ? await this.getBlockTimestamp(r.blockNumber) : null
    let blockHeight = 0
    try {
      blockHeight = r.blockNumber ? Number(BigInt(r.blockNumber)) : 0
    } catch {
      blockHeight = 0
    }
    return normalizeNative({
      hash,
      chain: this.chain,
      from: r.from,
      to: r.to ?? "",
      amount: baseUnitsToDecimal(r.value, 18),
      asset: NATIVE_ASSET[this.chain],
      timestamp,
      blockHeight,
      provenance: "LIVE_BLOCKCHAIN_DATA",
    })
  }

  async getWalletBalance(address: string): Promise<WalletBalance> {
    const url = this.buildUrl({
      module: "account",
      action: "balance",
      address,
      tag: "latest",
    })
    const res = await fetchJson<EtherscanEnvelope<string>>(url, { label: `${this.chain} balance` })
    return {
      address,
      chain: this.chain,
      balance: baseUnitsToDecimal(String(res.result ?? "0"), 18),
      asset: NATIVE_ASSET[this.chain],
      usdBalance: 0,
    }
  }

  async getTokenTransfersPaged(
    address: string,
    _chain?: Chain,
    options: TxQueryOptions = {},
  ): Promise<PagedTokenTransfers> {
    const rowsPerPage = Math.min(options.offset ?? MAX_ROWS_PER_PAGE, MAX_ROWS_PER_PAGE)
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
    const cap = Math.min(options.maxTransactions ?? MAX_INVESTIGATION_TRANSACTIONS, MAX_INVESTIGATION_TRANSACTIONS)

    const all: TokenTransfer[] = []
    let pagesFetched = 0
    let truncated = false

    for (let page = 1; page <= maxPages; page++) {
      const url = this.buildUrl({
        module: "account",
        action: "tokentx",
        address,
        page: String(page),
        offset: String(rowsPerPage),
        sort: "desc",
      })
      const res = await fetchJson<EtherscanEnvelope<EtherscanTokenTx[] | string>>(url, {
        label: `${this.chain} tokentx`,
      })
      pagesFetched++

      if (!Array.isArray(res.result)) {
        if (page === 1) break
        break
      }

      const rows = res.result
      for (const t of rows) {
        const decimals = Number(t.tokenDecimal) || 18
        all.push({
          hash: t.hash,
          chain: this.chain,
          from: t.from,
          to: t.to,
          tokenSymbol: t.tokenSymbol || "TOKEN",
          tokenName: t.tokenName || "Unknown token",
          tokenAddress: t.contractAddress,
          amount: baseUnitsToDecimal(t.value, decimals),
          decimals,
          timestamp: t.timeStamp ? new Date(Number(t.timeStamp) * 1000).toISOString() : null,
          blockHeight: Number(t.blockNumber),
          direction: directionOf(address, t.from, t.to),
          usdValue: null,
        })
        if (all.length >= cap) break
      }

      if (all.length >= cap) {
        truncated = rows.length >= rowsPerPage
        break
      }
      if (rows.length < rowsPerPage) break
    }

    return {
      transfers: all.slice(0, cap),
      meta: { totalFetched: all.length, pagesFetched, truncated },
    }
  }

  async getTokenTransfers(address: string, chain?: Chain, options?: TxQueryOptions): Promise<TokenTransfer[]> {
    const { transfers } = await this.getTokenTransfersPaged(address, chain, options)
    return transfers
  }
}

// Adapt a rich TokenTransfer into the common Transaction shape, reusing the
// shared normalizer instead of re-deriving field mapping per adapter.
export function evmTokenTransferToTransaction(t: TokenTransfer, referenceAddress?: string): Transaction {
  return normalizeToken({
    hash: t.hash,
    chain: t.chain,
    from: t.from,
    to: t.to,
    amount: t.amount,
    asset: t.tokenSymbol,
    tokenAddress: t.tokenAddress,
    timestamp: t.timestamp,
    blockHeight: t.blockHeight,
    address: referenceAddress,
  })
}

// Named subclasses to match the required adapter architecture. Each binds the
// shared Etherscan V2 logic to a specific network.
export class EthereumProvider extends EvmProvider {
  constructor() {
    super("ethereum")
  }
}
export class PolygonProvider extends EvmProvider {
  constructor() {
    super("polygon")
  }
}
export class BSCProvider extends EvmProvider {
  constructor() {
    super("bsc")
  }
}
