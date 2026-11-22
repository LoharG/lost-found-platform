// Formats integer paise as rupees, e.g. 50000 -> "₹500" (no decimals for whole rupees).
export function inr(paise: number | null | undefined, locale: "en" | "hi" = "en") {
  if (paise === null || paise === undefined) return "—";
  return new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}
