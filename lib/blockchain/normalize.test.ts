import { describe, it, expect } from "vitest"
import { normalizeNative, normalizeToken, baseUnitsToDecimal, directionOf, applyInvestigationFilters } from "./normalize"
import type { Transaction } from "@/lib/types"

describe("baseUnitsToDecimal", () => {
  it("converts wei-style base units to a decimal amount", () => {
    expect(baseUnitsToDecimal("1000000000000000000", 18)).toBeCloseTo(1, 6)
  })
  it("handles zero/undefined input without throwing", () => {
    expect(baseUnitsToDecimal(undefined, 18)).toBe(0)
    expect(baseUnitsToDecimal("", 6)).toBe(0)
  })
  it("supports hex-prefixed input (EVM RPC values)", () => {
    expect(baseUnitsToDecimal("0xde0b6b3a7640000", 18)).toBeCloseTo(1, 6)
  })
})

describe("directionOf", () => {
  it("returns in when the reference address is the recipient", () => {
    expect(directionOf("0xabc", "0xdef", "0xABC")).toBe("in")
  })
  it("returns out when the reference address is the sender", () => {
    expect(directionOf("0xabc", "0xABC", "0xdef")).toBe("out")
  })
  it("returns undefined without a reference address", () => {
    expect(directionOf(undefined, "0xabc", "0xdef")).toBeUndefined()
  })
})

describe("normalizeNative / normalizeToken", () => {
  it("marks native transfers with transferType NATIVE and null tokenAddress", () => {
    const tx = normalizeNative({
      hash: "0x1",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 1,
      asset: "ETH",
      timestamp: "2024-01-01T00:00:00.000Z",
      blockHeight: 100,
    })
    expect(tx.transferType).toBe("NATIVE")
    expect(tx.tokenAddress).toBeNull()
    expect(tx.usdValue).toBeNull()
    expect(tx.priceDataSource).toBe("UNAVAILABLE")
  })

  it("marks token transfers with transferType TOKEN and the contract address", () => {
    const tx = normalizeToken({
      hash: "0x2",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 5,
      asset: "USDT",
      tokenAddress: "0xdac17f958d2ee523a2206206994597c13d831ec",
      timestamp: "2024-01-01T00:00:00.000Z",
      blockHeight: 101,
    })
    expect(tx.transferType).toBe("TOKEN")
    expect(tx.tokenAddress).toBe("0xdac17f958d2ee523a2206206994597c13d831ec")
  })

  it("never fabricates a timestamp — passes null through untouched", () => {
    const tx = normalizeNative({
      hash: "0x3",
      chain: "ethereum",
      from: "0xa",
      to: "0xb",
      amount: 1,
      asset: "ETH",
      timestamp: null,
      blockHeight: 102,
    })
    expect(tx.timestamp).toBeNull()
  })
})

describe("applyInvestigationFilters", () => {
  const baseTx: Transaction = {
    hash: "h",
    chain: "ethereum",
    from: "a",
    to: "b",
    amount: 1,
    asset: "ETH",
    usdValue: null,
    timestamp: "2024-06-01T00:00:00.000Z",
    blockHeight: 1,
    provenance: "LIVE_BLOCKCHAIN_DATA",
  }

  it("truncates to the investigation cap and reports truncated=true", () => {
    const txs = Array.from({ length: 10 }, (_, i) => ({ ...baseTx, hash: `h${i}` }))
    const { transactions, truncated } = applyInvestigationFilters(txs, { maxTransactions: 5 })
    expect(transactions).toHaveLength(5)
    expect(truncated).toBe(true)
  })

  it("keeps rows with a null timestamp rather than dropping them", () => {
    const txs = [{ ...baseTx, timestamp: null }]
    const { transactions } = applyInvestigationFilters(txs, { startDate: "2024-01-01", endDate: "2024-12-31" })
    expect(transactions).toHaveLength(1)
  })

  it("filters by date range when timestamps are present", () => {
    const txs = [
      { ...baseTx, hash: "old", timestamp: "2023-01-01T00:00:00.000Z" },
      { ...baseTx, hash: "new", timestamp: "2024-06-01T00:00:00.000Z" },
    ]
    const { transactions } = applyInvestigationFilters(txs, { startDate: "2024-01-01" })
    expect(transactions.map((t) => t.hash)).toEqual(["new"])
  })
})
