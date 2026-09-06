import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BitcoinProvider } from "./bitcoin"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

const ADDRESS = "1BitcoinEaterAddressDontSendf59kuE"

function makeTx(txid: string, confirmed: boolean, blockTime: number | null, netSats: number) {
  return {
    txid,
    status: { confirmed, block_height: confirmed ? 800000 : undefined, block_time: blockTime ?? undefined },
    vin: netSats < 0 ? [{ prevout: { scriptpubkey_address: ADDRESS, value: Math.abs(netSats) } }] : [],
    vout:
      netSats >= 0
        ? [{ scriptpubkey_address: ADDRESS, value: netSats }]
        : [{ scriptpubkey_address: "bc1other", value: Math.abs(netSats) }],
  }
}

describe("BitcoinProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is always configured (public keyless explorer)", () => {
    expect(new BitcoinProvider().isConfigured()).toBe(true)
  })

  it("projects a UTXO transaction into the common Transaction shape with a real timestamp", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse([makeTx("t1", true, 1700000000, 50000)]))
    const provider = new BitcoinProvider()
    const txs = await provider.getTransactions(ADDRESS)
    expect(txs).toHaveLength(1)
    expect(txs[0].timestamp).toBe(new Date(1700000000 * 1000).toISOString())
    expect(txs[0].direction).toBeUndefined() // normalizeNative only sets direction when a reference address is passed explicitly
  })

  it("never fabricates 'now' for an unconfirmed transaction with no block_time", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse([makeTx("t1", false, null, 1000)]))
    const provider = new BitcoinProvider()
    const txs = await provider.getTransactions(ADDRESS)
    expect(txs[0].timestamp).toBeNull()
  })

  it("paginates via the last-seen-confirmed-txid cursor until a short page ends history", async () => {
    const fullPage = Array.from({ length: 25 }, (_, i) => makeTx(`c${i}`, true, 1700000000 + i, 1000))
    const shortPage = Array.from({ length: 5 }, (_, i) => makeTx(`d${i}`, true, 1700001000 + i, 1000))
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse(fullPage)).mockResolvedValueOnce(jsonResponse(shortPage))

    const provider = new BitcoinProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS)
    expect(transactions).toHaveLength(30)
    expect(meta.pagesFetched).toBe(2)
    expect(meta.truncated).toBe(false)
    // second call should have used the /txs/chain/{lastTxid} cursor endpoint
    const secondUrl = mockFetch.mock.calls[1][0] as string
    expect(secondUrl).toContain("/txs/chain/c24")
  })

  it("truncates once the investigation cap is reached", async () => {
    const fullPage = Array.from({ length: 25 }, (_, i) => makeTx(`c${i}`, true, 1700000000 + i, 1000))
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    // A fresh Response must be produced per call — a Response body can only
    // be read (via .json()) once.
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(fullPage)))

    const provider = new BitcoinProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "bitcoin", { maxTransactions: 30, maxPages: 5 })
    expect(transactions.length).toBeLessThanOrEqual(30)
    expect(meta.truncated).toBe(true)
  })

  it("never reports usdValue as 0 — null when unpriced", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(jsonResponse([makeTx("t1", true, 1700000000, 50000)]))
    const provider = new BitcoinProvider()
    const txs = await provider.getTransactions(ADDRESS)
    expect(txs[0].usdValue).toBeNull()
  })

  it("returns no token transfers (Bitcoin has no token layer)", async () => {
    const provider = new BitcoinProvider()
    expect(await provider.getTokenTransfers()).toEqual([])
  })
})
