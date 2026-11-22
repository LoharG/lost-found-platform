"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocateFixed, SlidersHorizontal } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "./ui";
import { useI18n } from "@/lib/i18n/client";
import { CATEGORIES } from "@/lib/types";

export type Filters = Partial<
  Record<"type" | "q" | "category" | "location" | "from" | "to" | "sort" | "status" | "lat" | "lng" | "radiusKm", string>
>;

// Filters live in the URL, so every result page is shareable and works with
// the back button. Submitting navigates; the server renders the results.
export function SearchFilters({ initial }: { initial: Filters }) {
  const { t } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState<Filters>(initial);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const set = (key: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  function navigate(next: Filters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    router.push(`/items${params.size ? `?${params}` : ""}`);
  }

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

  return (
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
        <div className="sm:w-44">
          <Field label={t("browse.type")}>
            {(props) => (
              <Select {...props} value={values.type || ""} onChange={set("type")}>
                <option value="">{t("type.all")}</option>
                <option value="lost">{t("type.lost")}</option>
                <option value="found">{t("type.found")}</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit">{t("home.search")}</Button>
        <Button type="button" variant="secondary" aria-expanded={expanded} aria-controls="more-filters" onClick={() => setExpanded((v) => !v)}>
          <SlidersHorizontal className="size-4" aria-hidden />
          {t("browse.filters")}
        </Button>
      </div>

      <div id="more-filters" hidden={!expanded} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("browse.category")}>
          {(props) => (
            <Select {...props} value={values.category || ""} onChange={set("category")}>
              <option value="">{t("category.any")}</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`category.${category}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
        <div className="flex flex-wrap items-end gap-2">
          {hasNear ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const next = { ...values, lat: "", lng: "", radiusKm: "", sort: values.sort === "distance" ? "" : values.sort };
                setValues(next);
                navigate(next);
              }}
            >
              {t("browse.clearNearMe")}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={nearMe} loading={locating}>
              <LocateFixed className="size-4" aria-hidden />
              {locating ? t("browse.locating") : t("browse.nearMe")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => navigate({ type: values.type })}>
            {t("browse.reset")}
          </Button>
        </div>
      </div>
      {geoError && (
        <Alert tone="warn" className="mt-3">
          {t("browse.locationDenied")}
        </Alert>
      )}
    </form>
  );
}
