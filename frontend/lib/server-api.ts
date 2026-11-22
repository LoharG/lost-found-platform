import "server-only";
import { cookies, headers } from "next/headers";

// Server-side calls to the API (for server-rendered pages). Runs inside the
// cluster/compose network, forwarding the visitor's cookies so owners and
// moderators get their own view. Read at request time, not build time.
const API = (process.env.API_INTERNAL_URL || "http://localhost:5000").replace(/\/$/, "");

export type ServerResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; data: null };

export async function serverApi<T>(path: string, { forwardCookies = true } = {}): Promise<ServerResult<T>> {
  const headerList: Record<string, string> = { Accept: "application/json" };
  if (forwardCookies) {
    const cookieHeader = (await cookies()).toString();
    if (cookieHeader) headerList.Cookie = cookieHeader;
  }
  const requestId = (await headers()).get("x-request-id");
  if (requestId) headerList["X-Request-Id"] = requestId;

  try {
    const response = await fetch(`${API}/api${path}`, { headers: headerList, cache: "no-store" });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}
