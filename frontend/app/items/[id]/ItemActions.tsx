"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Flag, Link2, MessageSquare } from "lucide-react";
import { errorMessage, useAuth } from "@/components/AuthProvider";
import { ItemCard } from "@/components/items";
import { Alert, Badge, Button, Card, Field, LinkButton, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Claim, Item, Viewer } from "@/lib/types";

export function ItemActions({ item, viewer: initialViewer }: { item: Item; viewer: Viewer }) {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const [copied, setCopied] = useState(false);

  const share = (
    <Button
      type="button"
      variant="ghost"
      className="self-start"
      onClick={async () => {
        await navigator.clipboard?.writeText(window.location.href).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Link2 className="size-4" aria-hidden />
      <span aria-live="polite">{copied ? t("item.copied") : t("item.share")}</span>
    </Button>
  );

  if (loading) return share;
  if (!user) {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <p className="text-sm">{t("actions.signInToContact")}</p>
          <LinkButton href={`/login?next=/items/${item.id}`} className="mt-3 w-full">
            {t("nav.signIn")}
          </LinkButton>
        </Card>
        {share}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {initialViewer.isOwner ? <OwnerPanel item={item} /> : <VisitorPanel item={item} viewer={initialViewer} />}
      {initialViewer.canModerate && <ModeratorPanel item={item} />}
      {share}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitor: private contact, claim, report
// ---------------------------------------------------------------------------
function VisitorPanel({ item, viewer }: { item: Item; viewer: Viewer }) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const [claim, setClaim] = useState(viewer.claim);
  const [answer, setAnswer] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);

  const removed = item.moderationState === "removed";

  async function contact(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setContactError(null);
    try {
      const res = await api<{ conversationId: number }>(`/items/${item.id}/conversations`, {
        method: "POST",
        json: { body: message.trim(), clientId: crypto.randomUUID() },
      });
      router.push(`/inbox/${res.conversationId}`);
    } catch (error) {
      setContactError(errorMessage(error, t));
      setSending(false);
    }
  }

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault();
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await api<{ claim: Claim }>(`/items/${item.id}/claims`, { method: "POST", json: { answer: answer.trim() } });
      setClaim({ id: res.claim.id, status: res.claim.status });
      setClaimNotice(t("actions.claim.sent"));
      setAnswer("");
    } catch (error) {
      setClaimError(errorMessage(error, t));
    } finally {
      setClaiming(false);
    }
  }

  async function withdraw() {
    if (!claim) return;
    setClaiming(true);
    try {
      const res = await api<{ claim: Claim }>(`/claims/${claim.id}/withdraw`, { method: "POST" });
      setClaim({ id: res.claim.id, status: res.claim.status });
      setClaimNotice(null);
    } catch (error) {
      setClaimError(errorMessage(error, t));
    } finally {
      setClaiming(false);
    }
  }

  if (removed) return null;
  const claimLabel = item.type === "found" ? t("actions.claim.found") : t("actions.claim.lost");
  const activeClaim = claim && (claim.status === "pending" || claim.status === "accepted");

  return (
    <>
      <Card>
        <h2 className="flex items-center gap-2 font-semibold">
          <MessageSquare className="size-4" aria-hidden />
          {t("actions.contact")}
        </h2>
        {viewer.conversationId ? (
          <LinkButton href={`/inbox/${viewer.conversationId}`} variant="secondary" className="mt-3 w-full">
            {t("actions.openConversation")}
          </LinkButton>
        ) : (
          <form onSubmit={contact} className="mt-3 flex flex-col gap-3">
            <Field label={t("actions.contact")} error={contactError ?? undefined}>
              {(props) => (
                <Textarea {...props} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("actions.contactPlaceholder")} maxLength={2000} required />
              )}
            </Field>
            <Button type="submit" loading={sending} disabled={!message.trim()}>
              {t("actions.send")}
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">{t("actions.claim.title")}</h2>
        {claimNotice && (
          <Alert tone="success" className="mt-3">
            {claimNotice}
          </Alert>
        )}
        {claimError && (
          <Alert tone="error" className="mt-3">
            {claimError}
          </Alert>
        )}
        {activeClaim ? (
          <div className="mt-3 flex flex-col gap-3">
            <Alert tone={claim.status === "accepted" ? "success" : "info"}>
              {claim.status === "accepted" ? t("actions.claim.accepted") : t("actions.claim.pending")}
            </Alert>
            {claim.status === "pending" && (
              <Button type="button" variant="secondary" onClick={withdraw} loading={claiming}>
                {t("actions.claim.withdraw")}
              </Button>
            )}
          </div>
        ) : item.status !== "open" ? (
          <p className="mt-2 text-sm text-muted">{t("actions.notOpen")}</p>
        ) : (
          <form onSubmit={submitClaim} className="mt-3 flex flex-col gap-3">
            {claim?.status === "declined" && <Alert tone="warn">{t("actions.claim.declined")}</Alert>}
            <p className="text-sm">
              {item.ownershipQuestion ? (
                <>
                  <span className="text-muted">{t("actions.claim.question")}</span> <strong>{item.ownershipQuestion}</strong>
                </>
              ) : (
                <span className="text-muted">{t("actions.claim.noQuestion")}</span>
              )}
            </p>
            <Field label={t("actions.claim.answer")}>
              {(props) => <Textarea {...props} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} required />}
            </Field>
            <Button type="submit" loading={claiming} disabled={!answer.trim()}>
              {claimLabel}
            </Button>
          </form>
        )}
      </Card>

      <ReportListing itemId={item.id} alreadyReported={Boolean(viewer.hasReported)} />
    </>
  );
}

function ReportListing({ itemId, alreadyReported }: { itemId: number; alreadyReported: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">(alreadyReported ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const reasons = ["spam", "scam", "inappropriate", "personal_info", "duplicate", "other"] as const;

  if (state === "done") return <Alert tone="success">{t("actions.report.done")}</Alert>;
  if (!open) {
    return (
      <Button type="button" variant="ghost" className="self-start text-muted" onClick={() => setOpen(true)} aria-expanded={false}>
        <Flag className="size-4" aria-hidden />
        {t("actions.report")}
      </Button>
    );
  }
  return (
    <Card>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setState("sending");
          setError(null);
          try {
            await api(`/items/${itemId}/reports`, { method: "POST", json: { reason, details: details.trim() || undefined } });
            setState("done");
          } catch (err) {
            setError(errorMessage(err, t));
            setState("idle");
          }
        }}
        className="flex flex-col gap-3"
      >
        <h2 className="font-semibold">{t("actions.report.title")}</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t("actions.report.reason")}>
          {(props) => (
            <Select {...props} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
              {reasons.map((value) => (
                <option key={value} value={value}>
                  {t(`actions.report.reason.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("actions.report.details")}>{(props) => <Textarea {...props} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />}</Field>
        <div className="flex gap-2">
          <Button type="submit" loading={state === "sending"}>
            {t("actions.report.submit")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("actions.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Owner: lifecycle, claims review, matches
// ---------------------------------------------------------------------------
const NEXT_STATUSES: Record<string, ("returned" | "closed" | "open")[]> = {
  open: ["closed"],
  claimed: ["returned", "open", "closed"],
  closed: ["open"],
  returned: [],
};

function OwnerPanel({ item }: { item: Item }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [matches, setMatches] = useState<{ score: number; item: Item }[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadClaims = useCallback(async () => {
    try {
      setClaims((await api<{ claims: Claim[] }>(`/items/${item.id}/claims`)).claims);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }, [item.id, t]);

  useEffect(() => {
    loadClaims();
    api<{ matches: { score: number; item: Item }[] }>(`/items/${item.id}/matches`)
      .then((res) => setMatches(res.matches))
      .catch(() => setMatches([]));
  }, [item.id, loadClaims]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await loadClaims();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = { returned: t("owner.markReturned"), closed: t("owner.close"), open: t("owner.reopen") };
  const removed = item.moderationState === "removed";

  return (
    <>
      <Card>
        <h2 className="font-semibold">{t("owner.title")}</h2>
        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!removed && (
            <LinkButton href={`/items/${item.id}/edit`} variant="secondary">
              {t("owner.edit")}
            </LinkButton>
          )}
          {!removed &&
            NEXT_STATUSES[item.status].map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === "returned" ? "primary" : "secondary"}
                loading={busy === status}
                onClick={() => run(status, () => api(`/items/${item.id}/status`, { method: "POST", json: { status } }))}
              >
                {statusLabel[status]}
              </Button>
            ))}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <Alert tone="warn">{t("owner.deleteConfirm")}</Alert>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  loading={busy === "delete"}
                  onClick={() =>
                    run("delete", async () => {
                      await api(`/items/${item.id}`, { method: "DELETE" });
                      router.push("/account");
                    })
                  }
                >
                  {t("owner.delete")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  {t("actions.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="text-lost" onClick={() => setConfirmDelete(true)}>
              {t("owner.delete")}
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">{t("owner.claims")}</h2>
        {claims === null ? (
          <p className="mt-2 text-sm text-muted">{t("common.loading")}</p>
        ) : claims.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("owner.noClaims")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{claim.claimant.displayName}</span>
                  <Badge tone={claim.status === "accepted" ? "success" : claim.status === "pending" ? "warn" : "neutral"}>{t(`claim.status.${claim.status}`)}</Badge>
                </div>
                <p className="mt-2 text-sm">
                  <span className="text-muted">{t("owner.answer")}:</span> {claim.answer}
                </p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(claim.createdAt, locale)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {claim.status === "pending" && item.status === "open" && (
                    <>
                      <Button type="button" loading={busy === `a${claim.id}`} onClick={() => run(`a${claim.id}`, () => api(`/claims/${claim.id}/accept`, { method: "POST" }))}>
                        {t("owner.accept")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        loading={busy === `d${claim.id}`}
                        onClick={() => run(`d${claim.id}`, () => api(`/claims/${claim.id}/decline`, { method: "POST" }))}
                      >
                        {t("owner.decline")}
                      </Button>
                    </>
                  )}
                  {claim.conversationId && (
                    <Link href={`/inbox/${claim.conversationId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
                      {t("owner.viewChat")}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="matches">
        <h2 id="matches" className="mb-3 font-semibold">
          {t("owner.matches")}
        </h2>
        {matches === null ? (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted">{t("owner.noMatches")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((match) => (
              <li key={match.item.id}>
                <p className="mb-1 text-xs font-semibold text-muted">{t("owner.match", { score: Math.round(match.score * 100) })}</p>
                <ItemCard item={match.item} t={t} locale={locale} headingLevel={3} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Moderator: remove / restore with a recorded reason
// ---------------------------------------------------------------------------
function ModeratorPanel({ item }: { item: Item }) {
  const { t } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removed = item.moderationState === "removed";

  return (
    <Card className="border-warn/50">
      <h2 className="font-semibold">{t("nav.moderation")}</h2>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/moderation/items/${item.id}/${removed ? "restore" : "remove"}`, { method: "POST", json: { reason } });
            setReason("");
            router.refresh();
          } catch (err) {
            setError(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t("moderation.reason")}>{(props) => <Textarea {...props} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required />}</Field>
        <Button type="submit" variant={removed ? "secondary" : "danger"} loading={busy}>
          {removed ? t("moderation.restore") : t("moderation.remove")}
        </Button>
      </form>
    </Card>
  );
}
