import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { blockchain } from "./service"
import { providerCache } from "./cache"

describe("blockchain service — data-honesty fallback", () => {
  beforeEach(() => {
    providerCache.clear()
    delete process.env.ETHERSCAN_API_KEY
    delete process.env.TRACECHAIN_ETH_API_KEY
    delete process.env.TRACECHAIN_ETH_API_URL
  })

  it("falls back to MOCK with an explicit DEMO notice when no chain is configured", async () => {
    const res = await blockchain.getTransactions("0xabc", "ethereum")
    expect(res.dataSource).toBe("MOCK")
    expect(res.notice).toMatch(/DEMO DATA/)
  })

  it("labels a Tron lookup as MOCK when no Tron API key is configured", async () => {
    const res = await blockchain.getWalletBalance(
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      "tron",
    )
    expect(res.dataSource).toBe("MOCK")
  })

  it("never labels demo data as CACHED — only real fetches get cached", async () => {
    const first = await blockchain.getTransactions("0xabc", "ethereum")
    const second = await blockchain.getTransactions("0xabc", "ethereum")
    expect(first.dataSource).toBe("MOCK")
    expect(second.dataSource).toBe("MOCK")
    expect(second.cached).toBe(false)
  })

  it("isLiveCapable is false for every chain when no env vars are set", () => {
    expect(blockchain.isLiveCapable("ethereum")).toBe(false)
    expect(blockchain.isLiveCapable("tron")).toBe(false)
  })

  describe("with a live-configured chain that errors", () => {
    beforeEach(() => {
      process.env.ETHERSCAN_API_KEY = "test-key"
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream down")))
    })
    afterEach(() => {
      delete process.env.ETHERSCAN_API_KEY
      vi.unstubAllGlobals()
    })

    it("falls back to MOCK and surfaces the live-provider failure reason in the notice", async () => {
      const res = await blockchain.getTransactions("0xabc", "ethereum")
      expect(res.dataSource).toBe("MOCK")
      expect(res.notice).toMatch(/Live provider unavailable/)
    })
  })
})
