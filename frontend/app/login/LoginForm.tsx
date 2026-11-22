"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useAuth } from "@/components/AuthProvider";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import type { User } from "@/lib/types";

type Providers = { google: boolean; apple: boolean; email: boolean };

// Only allow same-site relative paths as post-login destinations.
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { user, setSession } = useAuth();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const next = safeNext(params.get("next"));
  const oauthError = params.get("error");

  useEffect(() => {
    api<Providers>("/auth/providers").then(setProviders).catch(() => setProviders({ google: false, apple: false, email: false }));
  }, []);
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ delivered: boolean }>("/auth/email/request", { method: "POST", json: { email } });
      setStep("code");
      setNotice(res.delivered ? t("login.codeSent", { email }) : t("login.codeNotDelivered"));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: User; csrfToken: string }>("/auth/email/verify", { method: "POST", json: { email, code } });
      setSession(res.user, res.csrfToken);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  const providerHref = (name: "google" | "apple") => `/api/auth/${name}`;

  return (
    <div className="flex flex-col gap-4">
      {oauthError === "oauth_failed" && <Alert tone="error">{t("login.oauthFailed")}</Alert>}
      {(oauthError === "google_unconfigured" || (providers && !providers.google)) && <Alert tone="warn">{t("login.googleUnavailable")}</Alert>}

      {providers?.google && (
        <a
          href={providerHref("google")}
          className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 font-semibold hover:bg-surface-muted"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-5">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
          </svg>
          {t("login.google")}
        </a>
      )}
      {providers?.apple && (
        <a href={providerHref("apple")} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-text px-4 font-semibold text-bg hover:opacity-90">
          {t("login.apple")}
        </a>
      )}

      {providers?.email && (
        <>
          {(providers.google || providers.apple) && (
            <div className="flex items-center gap-3 text-sm text-muted" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              {t("login.or")}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {notice && step === "code" && <Alert tone="info">{notice}</Alert>}
          {step === "email" ? (
            <form onSubmit={requestCode} className="flex flex-col gap-3">
              <Field label={t("login.email")}>
                {(props) => <Input {...props} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
              </Field>
              <Button type="submit" loading={busy}>
                {t("login.sendCode")}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-3">
              <Field label={t("login.code")}>
                {(props) => (
                  <Input
                    {...props}
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                )}
              </Field>
              <Button type="submit" loading={busy} disabled={code.length !== 6}>
                {t("login.verify")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setNotice(null);
                }}
              >
                {t("login.changeEmail")}
              </Button>
            </form>
          )}
        </>
      )}
      {providers && !providers.email && !providers.google && !providers.apple && <Alert tone="error">{t("login.emailUnavailable")}</Alert>}
      <p className="text-xs text-muted">{t("login.terms")}</p>
    </div>
  );
}
