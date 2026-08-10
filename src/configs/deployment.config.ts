/** Deployment identity for the standalone static app. */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Set this in production so generated metadata uses the deployed origin. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

/** Normalize a public asset path. */
export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
