"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessage } from "@/components/AuthProvider";
import { RequireAuth } from "@/components/RequireAuth";
import { Alert, Badge, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";

type ConversationSummary = {
  id: number;
  item: { id: number; title: string; type: "lost" | "found"; available: boolean };
  role: "reporter" | "participant";
  counterpart: { displayName: string };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
};

function InboxList() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${t("inbox.title")} · ${t("app.name")}`;
    api<{ conversations: ConversationSummary[] }>("/conversations")
      .then((res) => setItems(res.conversations))
      .catch((err) => setError(errorMessage(err, t)));
  }, [t]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items) return <Spinner label={t("common.loading")} />;
  if (items.length === 0) return <EmptyState title={t("inbox.title")} body={t("inbox.empty")} />;

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/inbox/${c.id}`} className="flex min-h-16 flex-col gap-1 px-4 py-3 hover:bg-surface-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{c.counterpart.displayName}</span>
              <span className="flex items-center gap-2 text-xs text-muted">
                {c.unread > 0 && <Badge tone="lost">{t("inbox.unread", { count: c.unread })}</Badge>}
                {c.lastMessageAt && formatRelative(c.lastMessageAt, locale)}
              </span>
            </div>
            <span className="text-sm text-muted">{t("inbox.about", { title: c.item.title })}</span>
            {c.lastMessage && <span className="truncate text-sm">{c.lastMessage}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function InboxPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("inbox.title")} />
      <RequireAuth>
        <InboxList />
      </RequireAuth>
    </div>
  );
}
