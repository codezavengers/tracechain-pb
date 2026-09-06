import type { EvidenceRecord, DataProvenance } from "@/lib/types"

const encoder = new TextEncoder()

// SHA-256 hex digest via Web Crypto.
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export const GENESIS_HASH = "0".repeat(64)

// Create an evidence record chained to the previous record's hash (tamper-evident).
export async function createEvidenceRecord(params: {
  caseId: string
  type: string
  title: string
  summary: string
  content: unknown
  createdBy: string
  prevHash: string
  provenance: DataProvenance
}): Promise<EvidenceRecord> {
  const createdAt = new Date().toISOString()
  const canonical = JSON.stringify({
    caseId: params.caseId,
    type: params.type,
    title: params.title,
    summary: params.summary,
    content: params.content,
    createdBy: params.createdBy,
    createdAt,
    prevHash: params.prevHash,
  })
  const contentHash = await sha256Hex(canonical)
  return {
    id: `ev_${contentHash.slice(0, 12)}`,
    caseId: params.caseId,
    type: params.type,
    title: params.title,
    contentHash,
    prevHash: params.prevHash,
    createdAt,
    createdBy: params.createdBy,
    provenance: params.provenance,
    summary: params.summary,
  }
}

// Verify the integrity of an evidence chain (each prevHash must match).
export function verifyChain(records: EvidenceRecord[]): { valid: boolean; brokenAt?: string } {
  const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let prev = GENESIS_HASH
  for (const r of ordered) {
    if (r.prevHash !== prev) return { valid: false, brokenAt: r.id }
    prev = r.contentHash
  }
  return { valid: true }
}
