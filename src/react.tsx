/**
 * React bindings for `@webhookrelay/sdk`. A separate entry point so the core
 * SDK never imports React.
 *
 * ```tsx
 * import { WebhookRelayPortal } from "@webhookrelay/sdk/react";
 *
 * <WebhookRelayPortal url={portalUrl} height={720} />
 * ```
 *
 * @packageDocumentation
 */
import type { CSSProperties, IframeHTMLAttributes } from "react";

export interface WebhookRelayPortalProps
  extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "height" | "width"> {
  /**
   * The portal link from `relay.outbound.portalSessions.create`, minted on
   * your server for the signed-in consumer. It carries a one-time token in
   * its fragment: never log it. A new `url` mounts a new iframe. Only
   * `https:` URLs (and `http://localhost` / `http://127.0.0.1` for local
   * development) are framed; anything else renders nothing.
   */
  url: string;
  /** Accessible name of the frame. Defaults to "Webhooks". */
  title?: string;
  /** CSS height; a number is pixels. Defaults to 600. */
  height?: number | string;
  /** CSS width; a number is pixels. Defaults to "100%". */
  width?: number | string;
  /** Merged over the default borderless block style. */
  style?: CSSProperties;
  /** Permissions policy. Defaults to "clipboard-write" so secrets can be copied. */
  allow?: string;
}

/**
 * Embeds the Webhook Relay consumer portal in an iframe, where your customer
 * manages their own webhook endpoints and reads their deliveries. Embedding
 * needs your page's origin in the portal settings' `allowed_origins`.
 */
/**
 * Whether `url` may be framed as the portal: an `https:` URL, or `http:` on
 * `localhost` / `127.0.0.1` for local development. Anything else (e.g. a
 * `javascript:` or `data:` URL from an untrusted source) is refused.
 */
export function isAllowedPortalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
}

export function WebhookRelayPortal({
  url,
  title = "Webhooks",
  height = 600,
  width = "100%",
  style,
  allow = "clipboard-write",
  ...frameProps
}: WebhookRelayPortalProps) {
  if (!isAllowedPortalUrl(url)) {
    // Never log the URL itself: it carries a one-time token.
    console.error("WebhookRelayPortal: refusing a portal url that is not https");
    return null;
  }
  return (
    <iframe
      // The token in the URL is one-time: a changed URL needs a fresh frame.
      key={url}
      {...frameProps}
      src={url}
      title={title}
      allow={allow}
      // The URL carries a one-time token; never leak it in a Referer.
      referrerPolicy="no-referrer"
      style={{ border: 0, display: "block", width, height, ...style }}
    />
  );
}
