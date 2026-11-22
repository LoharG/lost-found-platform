"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Link2, MessageSquare } from "lucide-react";
import { errorMessage, useAuth } from "@/components/AuthProvider";
import { ItemCard } from "@/components/items";
import { flashToast, useToast } from "@/components/Toaster";
import { markViewed } from "@/components/ViewedBadge";
import { Alert, Badge, Button, Card, Field, LinkButton, Select, Textarea } from "@/components/ui";
import { CATEGORIES } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import { inr } from "@/lib/money";
import { rewardOf, usePricing } from "@/lib/pricing";
import { CheckoutCard } from "@/components/Checkout";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Claim, Item, Viewer } from "@/lib/types";

export function ItemActions({ item, viewer: initialViewer }: { item: Item; viewer: Viewer }) {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => markViewed(item.id), [item.id]);

  const share = (
    <Button
      type="button"
      variant="ghost"
      className="self-start"
      onClick={async () => {
        await navigator.clipboard?.writeText(window.location.href).catch(() => {});
        toast(t("toast.copied"));
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
  const { t, locale } = useI18n();
  const toast = useToast();
  const pricing = usePricing();
  const feePaise = pricing?.connectionFeePaise ?? 10000;
  const fee = inr(feePaise, locale);
  const currentReward = rewardOf(pricing, item.category) ?? item.reward?.amountPaise ?? null;
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [answer, setAnswer] = useState("");
  const [acceptReward, setAcceptReward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ claims: Claim[] }>(`/items/${item.id}/claims`).then(
        (res) => setClaims(res.claims),
        () => setClaims([])
      ),
    [item.id]
  );
  useEffect(() => {
    load();
  }, [load]);

  const removed = item.moderationState === "removed";
  if (removed) return null;

  // In a FOUND listing the visitor is the owner (claims, accepts reward, pays).
  // In a LOST listing the visitor is the finder (responds, never pays).
  const visitorIsOwner = item.type === "found";
  const ctaLabel = visitorIsOwner ? t("claim.cta.found") : t("claim.cta.lost");
  const active = claims?.find((c) => c.status === "pending" || c.status === "accepted") ?? null;
  const declined = !active && claims?.some((c) => c.status === "declined");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (visitorIsOwner && !acceptReward) {
      setError(t("claim.acceptRewardRequired"));
      return;
    }
    setBusy(true);
    try {
      await api(`/items/${item.id}/claims`, {
        method: "POST",
        json: { answer: answer.trim(), ...(visitorIsOwner ? { acceptReward: true, expectedRewardPaise: currentReward } : {}) },
      });
      toast(t("toast.claimSent"));
      setAnswer("");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "contact_detected") setError(t("claim.contactDetected"));
      else if (err instanceof ApiError && err.code === "pricing_changed") {
        setAcceptReward(false);
        setError(err.message);
      } else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function renew(claim: Claim) {
    setBusy(true);
    try {
      await api(`/claims/${claim.id}/terms`, { method: "POST", json: { expectedRewardPaise: currentReward } });
      toast(t("toast.termsAccepted"));
      await load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(claim: Claim) {
    setBusy(true);
    try {
      await api(`/claims/${claim.id}/withdraw`, { method: "POST" });
      toast(t("toast.claimWithdrawn"), "info");
      await load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (claims === null) return <Card><p className="text-sm text-muted">{t("common.loading")}</p></Card>;

  // Accepted match: owner pays to connect; finder waits; unlocked -> open chat.
  if (active?.status === "accepted") {
    if (active.unlocked && active.conversationId) {
      return (
        <Card>
          <p className="text-sm">{t("checkout.success")}</p>
          <LinkButton href={`/inbox/${active.conversationId}`} className="mt-3 w-full">
            {t("actions.openConversation")}
          </LinkButton>
        </Card>
      );
    }
    if (active.viewerRole === "owner" && active.agreement) {
      return <CheckoutCard claimId={active.id} rewardPaise={active.agreement.rewardPaise} feePaise={active.agreement.feePaise} conversationId={active.conversationId} onPaid={load} />;
    }
    return (
      <Card>
        <Alert tone="info">{t("claim.waitingPayment", { fee })}</Alert>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <h2 className="font-semibold">{t("actions.claim.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("claim.lockedInfo", { fee })}</p>
        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}
        {active?.status === "pending" ? (
          <div className="mt-3 flex flex-col gap-3">
            {visitorIsOwner && active.agreement && active.agreement.current === false ? (
              <Alert tone="warn">
                <p className="font-semibold">{t("claim.renewTitle")}</p>
                <p className="mt-1">{t("claim.renewBody", { amount: inr(currentReward, locale) })}</p>
                <Button type="button" className="mt-2" loading={busy} onClick={() => renew(active)}>
                  {t("claim.renewButton", { amount: inr(currentReward, locale) })}
                </Button>
              </Alert>
            ) : (
              <Alert tone="info">{t("actions.claim.pending")}</Alert>
            )}
            <Button type="button" variant="secondary" onClick={() => withdraw(active)} loading={busy}>
              {t("actions.claim.withdraw")}
            </Button>
          </div>
        ) : item.status !== "open" ? (
          <p className="mt-2 text-sm text-muted">{t("actions.notOpen")}</p>
        ) : !item.categoryConfirmed ? (
          <p className="mt-2 text-sm text-muted">{t("owner.confirmCategoryBody")}</p>
        ) : (
          <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
            {declined && <Alert tone="warn">{t("actions.claim.declined")}</Alert>}
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
            {visitorIsOwner && currentReward && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-found/40 bg-found-bg/40 p-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0" checked={acceptReward} onChange={(e) => setAcceptReward(e.target.checked)} />
                <span className="text-sm">{t("claim.acceptReward", { amount: inr(currentReward, locale), fee })}</span>
              </label>
            )}
            <Button
              type="submit"
              loading={busy}
              disabled={!answer.trim() || (visitorIsOwner && !acceptReward)}
              disabledReason={!answer.trim() ? t("disabled.needAnswer") : t("claim.acceptRewardRequired")}
            >
              {ctaLabel}
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
  const toast = useToast();
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
            toast(t("toast.reportSent"));
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

function Confetti() {
  // Short, decorative burst; hidden from assistive tech and from reduced-motion users.
  const colors = ["#f26a3d", "#1d4ed8", "#067647", "#fdb022", "#b42318", "#5b8cf5"];
  return (
    <span aria-hidden className="celebrate pointer-events-none absolute inset-0 motion-reduce:hidden">
      {Array.from({ length: 18 }).map((_, i) => {
        const angle = (i / 18) * Math.PI * 2;
        const distance = 60 + (i % 3) * 25;
        return (
          <i
            key={i}
            style={
              {
                background: colors[i % colors.length],
                "--dx": `${Math.cos(angle) * distance}px`,
                "--dy": `${Math.sin(angle) * distance}px`,
                animationDelay: `${(i % 4) * 30}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

function OwnerPanel({ item }: { item: Item }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [celebrate, setCelebrate] = useState(false);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [matches, setMatches] = useState<{ score: number; item: Item }[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pricing = usePricing();
  const feePaise = pricing?.connectionFeePaise ?? 10000;
  const currentReward = rewardOf(pricing, item.category) ?? item.reward?.amountPaise ?? null;
  // Lost listing: the poster is the owner and must accept the reward when accepting a finder.
  const posterIsOwner = item.type === "lost";
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [rewardAck, setRewardAck] = useState(false);
  const [confirmCategory, setConfirmCategory] = useState<string>(item.category);
  const [categoryAck, setCategoryAck] = useState(false);

  const loadClaims = useCallback(
    () =>
      api<{ claims: Claim[] }>(`/items/${item.id}/claims`).then(
        (res) => setClaims(res.claims),
        (err) => setError(errorMessage(err, t))
      ),
    [item.id, t]
  );

  useEffect(() => {
    loadClaims();
    api<{ matches: { score: number; item: Item }[] }>(`/items/${item.id}/matches`)
      .then((res) => setMatches(res.matches))
      .catch(() => setMatches([]));
  }, [item.id, loadClaims]);

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (success) toast(success);
      if (key === "returned") {
        setCelebrate(true);
        if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
        celebrateTimer.current = setTimeout(() => setCelebrate(false), 1200);
      }
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
      <Card className="relative">
        {celebrate && <Confetti />}
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
                onClick={() =>
                  run(
                    status,
                    () => api(`/items/${item.id}/status`, { method: "POST", json: { status } }),
                    status === "returned" ? t("toast.returned") : status === "closed" ? t("toast.closed") : t("toast.reopened")
                  )
                }
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
                      flashToast(t("toast.deleted"));
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

      {!item.categoryConfirmed && item.moderationState !== "removed" && (
        <Card className="border-warn/50">
          <h2 className="font-semibold">{t("owner.confirmCategoryTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("owner.confirmCategoryBody")}</p>
          <div className="mt-3 flex flex-col gap-3">
            <Field label={t("form.category")}>
              {(props) => (
                <Select {...props} value={confirmCategory} onChange={(e) => { setConfirmCategory(e.target.value); setCategoryAck(false); }}>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {t(`category.${category}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {posterIsOwner && (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0" checked={categoryAck} onChange={(e) => setCategoryAck(e.target.checked)} />
                <span className="text-sm">{t("reward.lost.ack", { amount: inr(rewardOf(pricing, confirmCategory), locale), fee: inr(feePaise, locale) })}</span>
              </label>
            )}
            <Button
              type="button"
              disabled={posterIsOwner && !categoryAck}
              disabledReason={t("reward.lost.ackRequired")}
              loading={busy === "confirm-category"}
              onClick={() =>
                run(
                  "confirm-category",
                  () =>
                    api(`/items/${item.id}/confirm-category`, {
                      method: "POST",
                      json: { category: confirmCategory, ...(posterIsOwner ? { acceptRewardTerms: true, expectedRewardPaise: rewardOf(pricing, confirmCategory) } : {}) },
                    }),
                  t("toast.categoryConfirmed")
                )
              }
            >
              {t("owner.confirmCategoryButton")}
            </Button>
          </div>
        </Card>
      )}

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
                  {claim.status === "pending" && item.status === "open" && item.categoryConfirmed && (
                    <>
                      {posterIsOwner ? (
                        acceptingId === claim.id ? (
                          <div className="flex w-full flex-col gap-2 rounded-lg border border-found/40 bg-found-bg/40 p-3">
                            <label className="flex cursor-pointer items-start gap-3">
                              <input type="checkbox" className="mt-1 size-5 shrink-0" checked={rewardAck} onChange={(e) => setRewardAck(e.target.checked)} />
                              <span className="text-sm">{t("owner.acceptRewardCheck", { amount: inr(currentReward, locale), fee: inr(feePaise, locale) })}</span>
                            </label>
                            <Button
                              type="button"
                              disabled={!rewardAck}
                              disabledReason={t("claim.acceptRewardRequired")}
                              loading={busy === `a${claim.id}`}
                              onClick={() =>
                                run(`a${claim.id}`, () => api(`/claims/${claim.id}/accept`, { method: "POST", json: { acceptReward: true, expectedRewardPaise: currentReward } }), t("toast.accepted"))
                              }
                            >
                              {t("owner.acceptWithReward", { amount: inr(currentReward, locale) })}
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" onClick={() => { setAcceptingId(claim.id); setRewardAck(false); }}>
                            {t("owner.accept")}
                          </Button>
                        )
                      ) : (
                        <Button type="button" loading={busy === `a${claim.id}`} onClick={() => run(`a${claim.id}`, () => api(`/claims/${claim.id}/accept`, { method: "POST", json: {} }), t("toast.accepted"))}>
                          {t("owner.accept")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        loading={busy === `d${claim.id}`}
                        onClick={() => run(`d${claim.id}`, () => api(`/claims/${claim.id}/decline`, { method: "POST" }), t("toast.declined"))}
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
                {claim.status === "accepted" && !claim.unlocked && (
                  <div className="mt-3">
                    {claim.viewerRole === "owner" && claim.agreement ? (
                      <CheckoutCard claimId={claim.id} rewardPaise={claim.agreement.rewardPaise} feePaise={claim.agreement.feePaise} conversationId={claim.conversationId} onPaid={loadClaims} />
                    ) : (
                      <Alert tone="info">{t("claim.waitingPayment", { fee: inr(feePaise, locale) })}</Alert>
                    )}
                  </div>
                )}
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
  const toast = useToast();
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
            toast(removed ? t("toast.restored") : t("toast.removed"));
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
        <Button type="submit" variant={removed ? "secondary" : "danger"} loading={busy} disabled={reason.trim().length < 3} disabledReason={t("disabled.needReason")}>
          {removed ? t("moderation.restore") : t("moderation.remove")}
        </Button>
      </form>
    </Card>
  );
}
