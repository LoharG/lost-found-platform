"use client";

import { useState } from "react";
import { CheckCircle2, Handshake, PackageCheck } from "lucide-react";
import { errorMessage } from "./AuthProvider";
import { useToast } from "./Toaster";
import { Alert, Badge, Button, Card, Field, Textarea } from "./ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { inr } from "@/lib/money";
import { useI18n } from "@/lib/i18n/client";
import type { RewardStatus } from "@/lib/types";

export type MatchClaim = {
  id: number;
  status: string;
  agreement: { rewardPaise: number; feePaise: number } | null;
  payment: { status: string };
  returnConfirmedAt: string | null;
  reward: { status: RewardStatus; at: string | null; note: string | null };
};

// After the connection: agreed reward (paid directly), the owner's "I have
// received my item", the finder's reward receipt / issue, and a refund path.
// Return and reward receipt are separate facts; neither is gateway-verified.
export function MatchPanel({ claim, role, onChange }: { claim: MatchClaim; role: "owner" | "finder"; onChange: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundSent, setRefundSent] = useState(false);

  async function run(key: string, path: string, json: unknown, success: string, tone: "success" | "info" = "success") {
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: "POST", json });
      toast(success, tone);
      onChange();
      return true;
    } catch (err) {
      setError(errorMessage(err, t));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const rewardTone = claim.reward.status === "confirmed" ? "success" : claim.reward.status === "issue" ? "lost" : "warn";

  return (
    <Card className="border-found/50">
      {claim.agreement && (
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Handshake className="size-4" aria-hidden />
            {t("reward.agreed")}
          </p>
          <p className="mt-1 text-sm">{t("reward.agreedBody", { amount: inr(claim.agreement.rewardPaise, locale) })}</p>
        </div>
      )}

      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <PackageCheck className="size-4 text-muted" aria-hidden />
          <dd>{claim.returnConfirmedAt ? t("return.confirmed", { date: formatDateTime(claim.returnConfirmedAt, locale) }) : t("return.notYet")}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 className="size-4 text-muted" aria-hidden />
          <dd>
            <Badge tone={rewardTone}>{t(`reward.status.${claim.reward.status}`)}</Badge>
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">{t("reward.externalNote")}</p>
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {role === "owner" && !claim.returnConfirmedAt && (
          <Button type="button" loading={busy === "return"} onClick={() => run("return", `/claims/${claim.id}/return`, {}, t("toast.returnConfirmed"))}>
            {t("return.ownerAction")}
          </Button>
        )}
        {role === "finder" && claim.reward.status !== "confirmed" && (
          <>
            <Button type="button" loading={busy === "confirm"} onClick={() => run("confirm", `/claims/${claim.id}/reward`, { status: "confirmed" }, t("toast.rewardConfirmed"))}>
              {t("reward.finderConfirm")}
            </Button>
            {claim.reward.status !== "issue" &&
              (issueOpen ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run("issue", `/claims/${claim.id}/reward`, { status: "issue", note: issueNote.trim() }, t("toast.rewardIssue"), "info")) setIssueOpen(false);
                  }}
                >
                  <Field label={t("reward.issueNote")}>{(props) => <Textarea {...props} value={issueNote} onChange={(e) => setIssueNote(e.target.value)} maxLength={1000} required />}</Field>
                  <Button type="submit" variant="secondary" loading={busy === "issue"} disabled={!issueNote.trim()} disabledReason={t("disabled.needMessage")}>
                    {t("reward.issueSubmit")}
                  </Button>
                </form>
              ) : (
                <Button type="button" variant="secondary" onClick={() => setIssueOpen(true)}>
                  {t("reward.finderIssue")}
                </Button>
              ))}
          </>
        )}
        {role === "owner" && claim.payment.status === "paid" && !claim.returnConfirmedAt && (
          refundSent ? (
            <Alert tone="success">{t("refund.sent")}</Alert>
          ) : refundOpen ? (
            <form
              className="flex flex-col gap-2 border-t border-border pt-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy("refund");
                setError(null);
                try {
                  await api(`/claims/${claim.id}/refund-request`, { method: "POST", json: { reason: refundReason.trim() } });
                  setRefundSent(true);
                  toast(t("refund.sent"), "info");
                } catch (err) {
                  setError(errorMessage(err, t));
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Field label={t("refund.reason")}>{(props) => <Textarea {...props} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} minLength={10} maxLength={1000} required />}</Field>
              <Button type="submit" variant="secondary" loading={busy === "refund"}>
                {t("refund.submit")}
              </Button>
              <a href="/pricing#refunds" className="text-xs text-primary underline">
                {t("refund.policyLink")}
              </a>
            </form>
          ) : (
            <Button type="button" variant="ghost" className="text-muted" onClick={() => setRefundOpen(true)}>
              {t("refund.request")}
            </Button>
          )
        )}
      </div>
    </Card>
  );
}
