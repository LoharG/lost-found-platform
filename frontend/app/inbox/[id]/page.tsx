"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Phone, ShieldAlert } from "lucide-react";
import { errorMessage, useAuth } from "@/components/AuthProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { ClaimStatus, Item } from "@/lib/types";

type Message = { id: number; body: string; mine: boolean; senderDeleted: boolean; createdAt: string; clientId: string; pending?: boolean };
type Conversation = {
  id: number;
  role: "reporter" | "participant";
  item: Item & { available: boolean };
  counterpart: { displayName: string; phone: string | null };
  sharingMyPhone: boolean;
  messages: Message[];
  claims: { id: number; status: ClaimStatus; answer: string; createdAt: string }[];
};

function ConversationView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { user, refreshCounts } = useAuth();
  const [data, setData] = useState<Conversation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ conversation: Conversation }>(`/conversations/${id}`);
      setData(res.conversation);
      refreshCounts();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(errorMessage(err, t));
    }
  }, [id, t, refreshCounts]);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (data) document.title = `${data.counterpart.displayName} · ${t("app.name")}`;
  }, [data, t]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !data) return;
    const clientId = crypto.randomUUID();
    setSending(true);
    setError(null);
    // Optimistic append; the clientId makes retries idempotent on the server.
    setData({ ...data, messages: [...data.messages, { id: -Date.now(), body, mine: true, senderDeleted: false, createdAt: new Date().toISOString(), clientId, pending: true }] });
    setDraft("");
    try {
      await api(`/conversations/${id}/messages`, { method: "POST", json: { body, clientId } });
      await load();
    } catch (err) {
      setError(errorMessage(err, t));
      setDraft(body);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function toggleSharing(share: boolean) {
    setSharing(true);
    setError(null);
    try {
      await api(`/conversations/${id}/phone-sharing`, { method: "POST", json: { share } });
      await load();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSharing(false);
    }
  }

  if (notFound) return <Alert tone="error">{t("inbox.notFound")}</Alert>;
  if (!data) return error ? <Alert tone="error">{error}</Alert> : <Spinner label={t("common.loading")} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section aria-label={t("inbox.title")} className="flex flex-col gap-3">
        <Alert tone="warn">
          <span className="flex items-center gap-2">
            <ShieldAlert className="size-4" aria-hidden />
            {t("inbox.safety")}
          </span>
        </Alert>
        <ol ref={listRef} className="flex max-h-[60vh] min-h-48 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-4" aria-live="polite">
          {data.messages.map((m) => (
            <li key={m.clientId} className={clsx("flex", m.mine ? "justify-end" : "justify-start")}>
              <div className={clsx("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.mine ? "bg-primary text-primary-contrast" : "bg-surface-muted")}>
                <span className="sr-only">{m.mine ? t("inbox.you") : m.senderDeleted ? t("inbox.deletedUser") : data.counterpart.displayName}: </span>
                <p className="whitespace-pre-line break-words">{m.body}</p>
                <p className={clsx("mt-1 text-[11px]", m.mine ? "opacity-80" : "text-muted")}>{m.pending ? t("form.saving") : formatDateTime(m.createdAt, locale)}</p>
              </div>
            </li>
          ))}
        </ol>
        {error && <Alert tone="error">{error}</Alert>}
        {data.item.available ? (
          <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label htmlFor="composer" className="sr-only">
              {t("inbox.placeholder")}
            </label>
            <Textarea
              id="composer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("inbox.placeholder")}
              maxLength={2000}
              rows={2}
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
            />
            <Button type="submit" loading={sending} disabled={!draft.trim()}>
              {t("inbox.send")}
            </Button>
          </form>
        ) : (
          <Alert tone="info">{t("inbox.closed")}</Alert>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        <Card>
          <p className="text-xs text-muted">
            {data.role === "reporter" ? t("inbox.withRole.reporter") : t("inbox.withRole.participant", { name: data.item.reporter.displayName })}
          </p>
          <Link href={`/items/${data.item.id}`} className="mt-1 block font-semibold text-primary underline-offset-4 hover:underline">
            {data.item.title}
          </Link>
          <p className="text-sm text-muted">{data.item.location}</p>
        </Card>

        <Card>
          {data.counterpart.phone && (
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Phone className="size-4" aria-hidden />
              {t("inbox.theirPhone", { name: data.counterpart.displayName, phone: data.counterpart.phone })}
            </p>
          )}
          {user?.phone ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5"
                checked={data.sharingMyPhone}
                disabled={sharing}
                onChange={(e) => toggleSharing(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">{t("inbox.sharePhone")}</span>
                <span className="block text-xs text-muted">{t("inbox.sharePhoneHint")}</span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted">
              <Link href="/account" className="text-primary underline">
                {t("inbox.noPhone")}
              </Link>
            </p>
          )}
        </Card>

        {data.claims.length > 0 && (
          <Card>
            <h2 className="font-semibold">{t("inbox.claims")}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {data.claims.map((claim) => (
                <li key={claim.id} className="text-sm">
                  <Badge tone={claim.status === "accepted" ? "success" : claim.status === "pending" ? "warn" : "neutral"}>{t(`claim.status.${claim.status}`)}</Badge>
                  <p className="mt-1">{claim.answer}</p>
                </li>
              ))}
            </ul>
            {data.role === "reporter" && (
              <Link href={`/items/${data.item.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
                {t("owner.claims")} →
              </Link>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

export default function ConversationPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  return (
    <div>
      <Link href="/inbox" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">
        <ArrowLeft className="size-4" aria-hidden />
        {t("inbox.title")}
      </Link>
      <RequireAuth>
        <ConversationView id={params.id} />
      </RequireAuth>
    </div>
  );
}
