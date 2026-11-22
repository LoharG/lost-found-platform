"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Check, LocateFixed, SlidersHorizontal, X } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "./ui";
import { useI18n } from "@/lib/i18n/client";
import { CATEGORIES } from "@/lib/types";

export type Filters = Partial<
  Record<"type" | "q" | "category" | "location" | "from" | "to" | "sort" | "status" | "lat" | "lng" | "radiusKm", string>
>;

const ADVANCED: (keyof Filters)[] = ["category", "location", "from", "to", "status", "lat"];

function toHref(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return `/items${params.size ? `?${params}` : ""}`;
}

// Selectable pill (toggle button; one active per group).
function Chip({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
        selected
          ? "border-primary bg-primary text-primary-contrast"
          : "border-border bg-surface text-text hover:border-primary/60 hover:bg-surface-muted"
      )}
    >
      {selected && <Check className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

// Filters live in the URL, so every result page is shareable and works with
// the back button. Submitting navigates; the server renders the results.
export function SearchFilters({ initial }: { initial: Filters }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState<Filters>(initial);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const activeAdvanced = ADVANCED.filter((key) => initial[key] && !(key === "status" && initial.status === "active")).length;
  const [expanded, setExpanded] = useState(activeAdvanced > 0);

  const set = (key: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const navigate = (next: Filters) => router.push(toHref(next));
  const choose = (key: keyof Filters, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    navigate(next);
  };

  function nearMe() {
    setGeoError(false);
    if (!("geolocation" in navigator)) return setGeoError(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const next = {
          ...values,
          lat: position.coords.latitude.toFixed(4),
          lng: position.coords.longitude.toFixed(4),
          radiusKm: values.radiusKm || "10",
          sort: "distance",
        };
        setValues(next);
        navigate(next);
      },
      () => {
        setLocating(false);
        setGeoError(true);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  const hasNear = Boolean(values.lat && values.lng);
  const dateFmt = (d: string) => new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  // Applied filters (from the URL) as removable chips.
  const applied: { key: string; label: string; without: Filters }[] = [];
  const drop = (...keys: (keyof Filters)[]) => Object.fromEntries(Object.entries(initial).filter(([k]) => !keys.includes(k as keyof Filters))) as Filters;
  if (initial.q) applied.push({ key: "q", label: `“${initial.q}”`, without: drop("q") });
  if (initial.type) applied.push({ key: "type", label: t(`type.${initial.type}` as "type.lost"), without: drop("type") });
  if (initial.category) applied.push({ key: "category", label: t(`category.${initial.category}` as "category.other"), without: drop("category") });
  if (initial.location) applied.push({ key: "location", label: `📍 ${initial.location}`, without: drop("location") });
  if (initial.from || initial.to) applied.push({ key: "dates", label: `${initial.from ? dateFmt(initial.from) : "…"} – ${initial.to ? dateFmt(initial.to) : "…"}`, without: drop("from", "to") });
  if (initial.status && initial.status !== "active") applied.push({ key: "status", label: t(`status.${initial.status}` as "status.open"), without: drop("status") });
  if (initial.lat && initial.lng) applied.push({ key: "near", label: t("filters.nearMe", { km: initial.radiusKm || "10" }), without: drop("lat", "lng", "radiusKm", "sort") });

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(values);
        }}
        className="rounded-xl border border-border bg-surface p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label={t("browse.keyword")}>
              {(props) => <Input {...props} type="search" value={values.q || ""} onChange={set("q")} placeholder={t("home.searchPlaceholder")} maxLength={100} />}
            </Field>
          </div>
          <Button type="submit">{t("home.search")}</Button>
          <Button type="button" variant="secondary" aria-expanded={expanded} aria-controls="more-filters" onClick={() => setExpanded((v) => !v)}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {activeAdvanced ? t("filters.count", { count: activeAdvanced }) : t("browse.filters")}
          </Button>
        </div>

        <div role="group" aria-label={t("browse.type")} className="mt-3 flex flex-wrap gap-2">
          {(["", "lost", "found"] as const).map((type) => (
            <Chip key={type || "all"} selected={(values.type || "") === type} onSelect={() => choose("type", type)}>
              {type ? t(`type.${type}`) : t("type.all")}
            </Chip>
          ))}
        </div>

        <div id="more-filters" hidden={!expanded} className="menu-in mt-4 border-t border-border pt-4">
          <div role="group" aria-label={t("browse.category")} className="flex flex-wrap gap-2">
            <Chip selected={!values.category} onSelect={() => choose("category", "")}>
              {t("category.any")}
            </Chip>
            {CATEGORIES.map((category) => (
              <Chip key={category} selected={values.category === category} onSelect={() => choose("category", category)}>
                {t(`category.${category}`)}
              </Chip>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("browse.location")}>{(props) => <Input {...props} value={values.location || ""} onChange={set("location")} maxLength={100} />}</Field>
            <Field label={t("browse.from")}>{(props) => <Input {...props} type="date" value={values.from || ""} onChange={set("from")} />}</Field>
            <Field label={t("browse.to")}>{(props) => <Input {...props} type="date" value={values.to || ""} onChange={set("to")} />}</Field>
            <Field label={t("browse.status")}>
              {(props) => (
                <Select {...props} value={values.status || "active"} onChange={set("status")}>
                  <option value="active">{t("status.active")}</option>
                  <option value="open">{t("status.open")}</option>
                  <option value="claimed">{t("status.claimed")}</option>
                  <option value="returned">{t("status.returned")}</option>
                  <option value="all">{t("status.all")}</option>
                </Select>
              )}
            </Field>
            <Field label={t("browse.sort")}>
              {(props) => (
                <Select {...props} value={values.sort || "newest"} onChange={set("sort")}>
                  <option value="newest">{t("browse.sort.newest")}</option>
                  <option value="oldest">{t("browse.sort.oldest")}</option>
                  <option value="date">{t("browse.sort.date")}</option>
                  {hasNear && <option value="distance">{t("browse.sort.distance")}</option>}
                </Select>
              )}
            </Field>
            {hasNear && (
              <Field label={t("browse.nearMe")}>
                {(props) => (
                  <Select {...props} value={values.radiusKm || "10"} onChange={set("radiusKm")}>
                    {["2", "5", "10", "25", "50", "100"].map((km) => (
                      <option key={km} value={km}>
                        {t("browse.radius", { km })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <div className="flex flex-wrap items-end gap-2 lg:col-span-2">
              {!hasNear && (
                <Button type="button" variant="secondary" onClick={nearMe} loading={locating}>
                  <LocateFixed className="size-4" aria-hidden />
                  {locating ? t("browse.locating") : t("browse.nearMe")}
                </Button>
              )}
              <Button type="submit">{t("browse.apply")}</Button>
              <Button type="button" variant="ghost" onClick={() => navigate({ type: values.type })}>
                {t("browse.reset")}
              </Button>
            </div>
          </div>
        </div>
        {geoError && (
          <Alert tone="warn" className="mt-3">
            {t("browse.locationDenied")}
          </Alert>
        )}
      </form>

      {applied.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label={t("filters.active")} role="group">
          {applied.map((filter) => (
            <a
              key={filter.key}
              href={toHref(filter.without)}
              onClick={(event) => {
                event.preventDefault();
                navigate(filter.without);
              }}
              className="fade-in inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-info-bg px-3 text-sm font-medium transition-colors hover:border-lost hover:text-lost"
              aria-label={t("filters.remove", { label: filter.label })}
            >
              {filter.label}
              <X className="size-3.5" aria-hidden />
            </a>
          ))}
          {applied.length > 1 && (
            <button type="button" onClick={() => navigate({})} className="min-h-9 px-2 text-sm font-medium text-muted underline-offset-4 hover:text-text hover:underline">
              {t("browse.reset")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
