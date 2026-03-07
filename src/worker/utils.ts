import { Context } from "hono";
import { Bindings } from "./index";

export function getAppBaseUrl(c: Context<{ Bindings: Bindings }>): string {
  const requestUrl = new URL(c.req.url);
  if (c.env.BASE_URL) {
    const base = c.env.BASE_URL.endsWith("/")
      ? c.env.BASE_URL.slice(0, -1)
      : c.env.BASE_URL;
    return base;
  }
  const host = c.req.header("x-forwarded-host") || requestUrl.host;
  const protocol = c.req.header("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}
