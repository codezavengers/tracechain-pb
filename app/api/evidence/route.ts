import { NextResponse } from "next/server"
import { ensureSeeded, listEvidence } from "@/lib/store"
import { requireUser } from "@/lib/api/session"
import { verifyChain } from "@/lib/evidence/evidence"

export async function GET(req: Request) {
  await ensureSeeded()
  const auth = await requireUser()
  if ("response" in auth) return auth.response
  const url = new URL(req.url)
  const caseId = url.searchParams.get("caseId") ?? undefined
  const records = listEvidence(caseId)
  const integrity = verifyChain(records)
  return NextResponse.json({ records, integrity })
}
