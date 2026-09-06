import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EthereumProvider } from "./evm"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

const ADDRESS = "0x000000000000000000000000000000000000dEaD"

describe("EvmProvider (Ethereum)", () => {
  beforeEach(() => {
    process.env.ETHERSCAN_API_KEY = "test-key"
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    delete process.env.ETHERSCAN_API_KEY
    vi.unstubAllGlobals()
  })

  it("isConfigured reflects the presence of an API key", () => {
    const provider = new EthereumProvider()
    expect(provider.isConfigured()).toBe(true)
    delete process.env.ETHERSCAN_API_KEY
    expect(provider.isConfigured()).toBe(false)
  })

  it("getTransaction resolves the real block timestamp instead of the current time", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          result: { from: "0xa", to: "0xb", value: "0xde0b6b3a7640000", blockNumber: "0x64" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ result: { timestamp: "0x60000000" } }))

    const provider = new EthereumProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx).not.toBeNull()
    expect(tx?.timestamp).toBe(new Date(Number(0x60000000) * 1000).toISOString())
    expect(tx?.amount).toBeCloseTo(1, 6)
  })

  it("getTransaction returns a null timestamp (never 'now') when the block lookup fails", async () => {
    // Uses a block number not touched by other tests in this file, since the
    // block-timestamp cache is a module-level singleton.
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ result: { from: "0xa", to: "0xb", value: "0x1", blockNumber: "0x65" } }),
      )
      .mockRejectedValueOnce(new Error("block lookup failed"))
      .mockRejectedValueOnce(new Error("block lookup failed")) // retry

    const before = Date.now()
    const provider = new EthereumProvider()
    const tx = await provider.getTransaction("0xhash")
    expect(tx?.timestamp).toBeNull()
    // Sanity: we did not silently substitute "now" for the missing timestamp.
    expect(tx?.timestamp === null || new Date(tx!.timestamp as string).getTime() !== before).toBe(true)
  })

  it("caches a resolved block timestamp so a repeat lookup doesn't refetch the block", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ result: { from: "0xa", to: "0xb", value: "0x1", blockNumber: "0x99" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { timestamp: "0x60000000" } }))
      .mockResolvedValueOnce(jsonResponse({ result: { from: "0xc", to: "0xd", value: "0x1", blockNumber: "0x99" } }))

    const provider = new EthereumProvider()
    await provider.getTransaction("0xhash1")
    const callsAfterFirst = mockFetch.mock.calls.length
    await provider.getTransaction("0xhash2")
    // Second lookup only re-fetches the tx itself, not the (now-cached) block.
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst + 1)
  })

  it("paginates getTransactionsPaged across multiple pages and reports meta", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      blockNumber: String(i),
      timeStamp: String(1700000000 + i),
      hash: `0x${i}`,
      from: "0xa",
      to: ADDRESS,
      value: "1000000000000000000",
    }))
    const page2 = Array.from({ length: 10 }, (_, i) => ({
      blockNumber: String(100 + i),
      timeStamp: String(1700000000 + 100 + i),
      hash: `0x${100 + i}`,
      from: "0xa",
      to: ADDRESS,
      value: "1000000000000000000",
    }))
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ status: "1", message: "OK", result: page1 }))
      .mockResolvedValueOnce(jsonResponse({ status: "1", message: "OK", result: page2 }))

    const provider = new EthereumProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS)
    expect(transactions).toHaveLength(110)
    expect(meta.pagesFetched).toBe(2)
    expect(meta.truncated).toBe(false)
  })

  it("stops paginating and marks truncated once the investigation cap is hit", async () => {
    const bigPage = Array.from({ length: 100 }, (_, i) => ({
      blockNumber: String(i),
      timeStamp: String(1700000000 + i),
      hash: `0x${i}`,
      from: "0xa",
      to: ADDRESS,
      value: "1",
    }))
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    // A fresh Response must be produced per call — a Response body can only
    // be read (via .json()) once.
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ status: "1", message: "OK", result: bigPage })))

    const provider = new EthereumProvider()
    const { transactions, meta } = await provider.getTransactionsPaged(ADDRESS, "ethereum", { maxTransactions: 150 })
    expect(transactions.length).toBeLessThanOrEqual(150)
    expect(meta.truncated).toBe(true)
  })

  it("never reports usdValue as 0 for a live native transfer — null when unpriced", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "1",
        message: "OK",
        result: [{ blockNumber: "1", timeStamp: "1700000000", hash: "0x1", from: "0xa", to: ADDRESS, value: "1" }],
      }),
    )
    const provider = new EthereumProvider()
    const txs = await provider.getTransactions(ADDRESS)
    expect(txs[0].usdValue).toBeNull()
    expect(txs[0].priceDataSource).toBe("UNAVAILABLE")
  })
})
