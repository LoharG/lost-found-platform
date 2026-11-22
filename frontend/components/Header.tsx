"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bell, Menu, MessageSquare, Plus, Search, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ThemeToggle } from "./ThemeToggle";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/messages";

const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिन्दी" };

function CountBadge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-lost px-1 text-center text-[11px] font-bold leading-5 text-white dark:text-black">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={clsx("flex items-center gap-2 text-sm", className)}>
      <span className="sr-only">{t("nav.language")}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="min-h-11 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
        aria-label={t("nav.language")}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Header() {
  const { t } = useI18n();
  const { user, loading, counts, logout } = useAuth();
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (value: boolean | ((v: boolean) => boolean)) =>
    setOpenPath((current) => ((typeof value === "function" ? value(current === pathname) : value) ? pathname : null));
  const toggleRef = useRef<HTMLButtonElement>(null);

  // The menu closes on navigation (pathname changes) and on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPath(null);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = [
    { href: "/items?type=lost", label: t("nav.lost") },
    { href: "/items?type=found", label: t("nav.found") },
  ];
  const isModerator = user && (user.role === "moderator" || user.role === "admin");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-bold">
          <Search className="size-5 text-primary" aria-hidden />
          {t("app.name")}
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">
              {link.label}
            </Link>
          ))}
          {isModerator && (
            <>
              <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">
                {t("nav.admin")}
              </Link>
              <Link href="/moderation" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">
                {t("nav.moderation")}
              </Link>
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/report"
            className="hidden min-h-11 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-contrast hover:bg-primary-hover sm:inline-flex"
          >
            <Plus className="size-4" aria-hidden />
            {t("nav.report")}
          </Link>
          {user && (
            <>
              <Link href="/inbox" className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-muted" aria-label={t("nav.inbox")}>
                <MessageSquare className="size-5" aria-hidden />
                <CountBadge count={counts.messages} label={t("nav.inbox")} />
              </Link>
              <Link
                href="/notifications"
                className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-muted"
                aria-label={t("nav.notifications")}
              >
                <Bell className="size-5" aria-hidden />
                <CountBadge count={counts.notifications} label={t("nav.notifications")} />
              </Link>
            </>
          )}
          <div className="hidden items-center gap-1 md:flex">
            <ThemeToggle />
            <LocaleSwitcher />
            {!loading &&
              (user ? (
                <>
                  <Link href="/account" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-surface-muted">
                    {user.profileImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.profileImage} alt="" width={28} height={28} referrerPolicy="no-referrer" className="size-7 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-contrast">
                        {user.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span>{t("nav.account")}</span>
                  </Link>
                  <button type="button" onClick={logout} className="min-h-11 rounded-lg px-3 text-sm font-medium hover:bg-surface-muted">
                    {t("nav.signOut")}
                  </button>
                </>
              ) : (
                <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-muted">
                  {t("nav.signIn")}
                </Link>
              ))}
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-muted md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            <span className="sr-only">{t("nav.menu")}</span>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="border-t border-border bg-surface px-4 pb-4 md:hidden">
          <ul className="flex flex-col py-2">
            {[{ href: "/report", label: t("nav.report") }, ...links].map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-surface-muted">
                  {link.label}
                </Link>
              </li>
            ))}
            {isModerator && (
              <>
                <li>
                  <Link href="/admin" className="flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-surface-muted">
                    {t("nav.admin")}
                  </Link>
                </li>
                <li>
                  <Link href="/moderation" className="flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-surface-muted">
                    {t("nav.moderation")}
                  </Link>
                </li>
              </>
            )}
            {user ? (
              <>
                <li>
                  <Link href="/account" className="flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-surface-muted">
                    {t("nav.account")}
                  </Link>
                </li>
                <li>
                  <button type="button" onClick={logout} className="flex min-h-11 w-full items-center rounded-lg px-2 text-left font-medium hover:bg-surface-muted">
                    {t("nav.signOut")}
                  </button>
                </li>
              </>
            ) : (
              <li>
                <Link href="/login" className="flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-surface-muted">
                  {t("nav.signIn")}
                </Link>
              </li>
            )}
            <li>
              <ThemeToggle withLabel />
            </li>
          </ul>
          <LocaleSwitcher />
        </nav>
      )}
    </header>
  );
}
