import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Header } from "@/components/Header";
import { I18nProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const base = process.env.APP_URL || "http://localhost:3000";
  return {
    metadataBase: new URL(base),
    title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
    description: t("app.tagline"),
    openGraph: { siteName: t("app.name"), type: "website", description: t("app.tagline") },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151b23" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, t } = await getT();
  return (
    <html lang={locale} className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-contrast focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {t("nav.skip")}
        </a>
        <I18nProvider locale={locale}>
          <AuthProvider>
            <Header />
            <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
              {children}
            </main>
            <footer className="border-t border-border bg-surface">
              <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
                <p>{t("footer.note")}</p>
                <nav aria-label="Footer" className="flex gap-4">
                  <Link href="/privacy" className="underline-offset-4 hover:underline">
                    {t("footer.privacy")}
                  </Link>
                  <Link href="/terms" className="underline-offset-4 hover:underline">
                    {t("footer.terms")}
                  </Link>
                </nav>
              </div>
            </footer>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
