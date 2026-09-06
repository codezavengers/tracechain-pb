"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  PlayCircle,
  FileText,
  Share2,
  Route,
  Brain,
  ShieldCheck,
  MessageSquare,
  LayoutList,
  Coins,
  Users,
  Wallet,
  Send,
} from "lucide-react"
import { SectionHeading, StatusBadge, RiskBadge, ProvenanceBadge, CopyAddress, StatTile } from "@/components/intel/shared"
import { PriorityRing } from "@/components/case-card"
import { GraphView } from "@/components/intel/graph-view"
import { JourneyTimeline } from "@/components/intel/journey-timeline"
import { IntelligenceBoard } from "@/components/intel/intelligence-panels"
import { Tabs } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, Textarea, Label } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { LoadingBlock, ErrorState, EmptyState, Spinner } from "@/components/ui/feedback"
import { useCaseDetail, useEvidence, apiPost, useSession } from "@/lib/client/hooks"
import { PERMISSIONS } from "@/lib/auth"
import { CHAIN_LABEL, usd, usdFull, dateTime, relTime, humanize, STATUS_LABEL, pct } from "@/lib/client/format"
import type { CaseStatus } from "@/lib/types"

const STATUSES: CaseStatus[] = [
  "NEW",
  "ANALYZING",
  "TRACING",
  "VASP_IDENTIFIED",
  "ACTION_REQUIRED",
  "FREEZE_REVIEW",
  "MONITORING",
  "CLOSED",
]

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { user } = useSession()
  const { data, error, isLoading, mutate } = useCaseDetail(id)
  const [tab, setTab] = React.useState("overview")
  const [busy, setBusy] = React.useState<null | "investigate" | "status" | "report">(null)
  const [msg, setMsg] = React.useState<string | null>(null)

  const canRun = user ? PERMISSIONS.runInvestigation(user.role) : false
  const canEdit = user ? PERMISSIONS.editCase(user.role) : false
  const canExport = user ? PERMISSIONS.exportReport(user.role) : false

  const c = data?.case
  const inv = data?.investigation ?? null
  const graph = data?.graph ?? null

  async function runInvestigation() {
    if (!id) return
    setBusy("investigate")
    setMsg(null)
    try {
      await apiPost(`/api/cases/${id}/investigate`, { depth: 5 })
      await mutate()
      setMsg("Investigation complete — intelligence refreshed.")
      setTab("intelligence")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Investigation failed.")
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(status: CaseStatus) {
    if (!id) return
    setBusy("status")
    try {
      await apiPost(`/api/cases/${id}`, { status }, "PATCH")
      await mutate()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Status update failed.")
    } finally {
      setBusy(null)
    }
  }

  async function generateReport() {
    if (!id) return
    setBusy("report")
    setMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/report`, { credentials: "include" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "Report generation failed.")
      const blob = new Blob([JSON.stringify(json.report, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${id}-report.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg("Report generated and downloaded.")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Report generation failed.")
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <LoadingBlock label="Loading case workspace…" />
  if (error) return <ErrorState message={error.message} />
  if (!c) return <ErrorState message="Case not found." />

  const tabs = [
    { value: "overview", label: "Overview", icon: LayoutList },
    { value: "graph", label: "Transaction Graph", icon: Share2 },
    { value: "journey", label: "Fraud Journey", icon: Route },
    { value: "intelligence", label: "Intelligence", icon: Brain },
    { value: "evidence", label: "Evidence & Activity", icon: ShieldCheck },
    { value: "notes", label: "Notes", icon: MessageSquare },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All cases
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <PriorityRing score={c.priorityScore} size={52} />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">{c.title}</h1>
              <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              <RiskBadge score={c.riskScore} band={c.riskBand} />
              <Badge variant="outline">{CHAIN_LABEL[c.chain]}</Badge>
              <Badge variant="muted">{humanize(c.typology)}</Badge>
              <ProvenanceBadge provenance={c.provenance} />
            </div>
            <p className="text-xs text-muted-foreground">
              Complaint {c.complaintRef} · assigned to {c.investigator} · updated {relTime(c.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <div className="space-y-1">
              <Label htmlFor="status" className="sr-only">
                Status
              </Label>
              <Select
                id="status"
                value={c.status}
                onChange={(e) => changeStatus(e.target.value as CaseStatus)}
                disabled={busy === "status"}
                className="h-8 w-44 text-xs"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {canRun ? (
            <Button onClick={runInvestigation} disabled={busy === "investigate"}>
              {busy === "investigate" ? <Spinner className="text-primary-foreground" /> : <PlayCircle className="size-4" />}
              {inv ? "Re-run investigation" : "Run investigation"}
            </Button>
          ) : null}
          {canExport ? (
            <Button variant="outline" onClick={generateReport} disabled={busy === "report" || !inv}>
              {busy === "report" ? <Spinner /> : <FileText className="size-4" />} Report
            </Button>
          ) : null}
        </div>
      </div>

      {msg ? <div className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">{msg}</div> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Reported loss" value={usd(c.reportedLossUsd)} icon={Coins} accent="var(--risk-high)" />
        <StatTile label="Traceable" value={usd(c.traceableUsd)} icon={Wallet} accent="var(--risk-low)" />
        <StatTile label="Recovery est." value={pct(c.recoveryProbability)} accent="var(--primary)" />
        <StatTile label="Connected victims" value={c.connectedVictims} icon={Users} accent="var(--chart-2)" />
      </div>

      <Tabs items={tabs} value={tab} onValueChange={setTab} />

      {tab === "overview" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Investigation summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {inv ? (
                <p className="text-sm leading-relaxed text-foreground/85 text-pretty">{inv.summary}</p>
              ) : (
                <EmptyState
                  icon={Brain}
                  title="No investigation yet"
                  description="Run the multi-engine investigation to populate fund tracing, exit-point attribution and recovery intelligence."
                />
              )}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Complaint</p>
                <p className="rounded-md border border-border bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground text-pretty">
                  {c.complaintText || "No complaint narrative recorded."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reported wallet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <CopyAddress address={c.reportedWallet} full />
              <MetaRow label="Chain" value={CHAIN_LABEL[c.chain]} />
              <MetaRow label="Reported loss" value={usdFull(c.reportedLossUsd)} />
              <MetaRow label="Opened" value={dateTime(c.createdAt)} />
              <MetaRow label="Extracted wallets" value={String(c.extractedWallets.length)} />
              {c.extractedWallets.length > 1 ? (
                <div className="space-y-1 pt-1">
                  {c.extractedWallets.map((w) => (
                    <CopyAddress key={w} address={w} className="block" />
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "graph" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transaction graph</CardTitle>
          </CardHeader>
          <CardContent>
            {graph ? (
              <GraphView graph={graph} />
            ) : (
              <EmptyState
                icon={Share2}
                title="No graph available"
                description="This manual case has no pre-built demo graph. Cross-provider graph reconstruction runs during investigation."
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "journey" ? (
        <Card>
          <CardHeader>
            <CardTitle>Fraud journey timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <JourneyTimeline steps={inv?.journey ?? []} />
          </CardContent>
        </Card>
      ) : null}

      {tab === "intelligence" ? (
        inv ? (
          <IntelligenceBoard inv={inv} />
        ) : (
          <EmptyState
            icon={Brain}
            title="Run the investigation"
            description="The intelligence board populates once the multi-engine investigation has been executed."
            action={
              canRun ? (
                <Button onClick={runInvestigation} disabled={busy === "investigate"}>
                  <PlayCircle className="size-4" /> Run investigation
                </Button>
              ) : undefined
            }
          />
        )
      ) : null}

      {tab === "evidence" ? <EvidenceAndActivity caseId={c.id} activity={c.activity} /> : null}

      {tab === "notes" ? <NotesPanel caseId={c.id} notes={c.notes} canEdit={canEdit} onAdded={() => mutate()} /> : null}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function EvidenceAndActivity({
  caseId,
  activity,
}: {
  caseId: string
  activity: { id: string; actor: string; action: string; detail: string; createdAt: string }[]
}) {
  const { data } = useEvidence(caseId)
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chain of evidence</CardTitle>
            {data ? (
              <Badge
                variant="outline"
                style={{
                  color: data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)",
                  borderColor: `color-mix(in oklch, ${data.integrity.valid ? "var(--risk-low)" : "var(--risk-critical)"} 40%, transparent)`,
                }}
              >
                {data.integrity.valid ? "Integrity verified" : "Integrity broken"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!data ? (
            <Spinner />
          ) : data.records.length ? (
            data.records.map((r) => (
              <div key={r.id} className="rounded-md border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{r.title}</span>
                  <ProvenanceBadge provenance={r.provenance} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground text-pretty">{r.summary}</p>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-mono">{r.contentHash.slice(0, 24)}…</span>
                  <span>
                    {r.createdBy} · {relTime(r.createdAt)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No evidence recorded.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Activity history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activity
            .slice()
            .reverse()
            .map((a) => (
              <div key={a.id} className="flex items-start gap-2 border-b border-border/50 pb-2 last:border-0">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{humanize(a.action)}</p>
                  <p className="text-[11px] text-muted-foreground text-pretty">{a.detail}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {a.actor} · {relTime(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}

function NotesPanel({
  caseId,
  notes,
  canEdit,
  onAdded,
}: {
  caseId: string
  notes: { id: string; author: string; createdAt: string; body: string }[]
  canEdit: boolean
  onAdded: () => void
}) {
  const [body, setBody] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await apiPost(`/api/cases/${caseId}/notes`, { body })
      setBody("")
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Case notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notes.length ? (
            notes
              .slice()
              .reverse()
              .map((n) => (
                <div key={n.id} className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-xs leading-relaxed text-foreground/85 text-pretty">{n.body}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {n.author} · {relTime(n.createdAt)}
                  </p>
                </div>
              ))
          ) : (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          )}
        </CardContent>
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add note</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-2">
              <Textarea
                placeholder="Record an observation, action taken, or coordination step…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-sans text-sm"
              />
              {error ? <ErrorState message={error} /> : null}
              <Button type="submit" disabled={submitting || !body.trim()}>
                {submitting ? <Spinner className="text-primary-foreground" /> : <Send className="size-4" />} Add note
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
