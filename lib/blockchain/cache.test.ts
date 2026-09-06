import { describe, it, expect, vi, afterEach } from "vitest"
import { providerCache, cacheKey } from "./cache"

describe("providerCache", () => {
  afterEach(() => {
    providerCache.clear()
    vi.useRealTimers()
  })

  it("stores and retrieves a value before it expires", () => {
    const key = cacheKey(["chain", "op", "addr"])
    providerCache.set(key, { hello: "world" }, 10_000)
    const result = providerCache.get<{ hello: string }>(key)
    expect(result.hit).toBe(true)
    expect(result.value?.hello).toBe("world")
  })

  it("expires entries after the TTL elapses", () => {
    vi.useFakeTimers()
    const key = cacheKey(["chain", "op"])
    providerCache.set(key, "value", 1000)
    vi.advanceTimersByTime(1500)
    const result = providerCache.get(key)
    expect(result.hit).toBe(false)
  })

  it("cacheKey skips undefined segments", () => {
    expect(cacheKey(["a", undefined, "b"])).toBe("a:b")
  })

  it("delete removes a key immediately", () => {
    const key = cacheKey(["x"])
    providerCache.set(key, 1, 10_000)
    providerCache.delete(key)
    expect(providerCache.get(key).hit).toBe(false)
  })
})
