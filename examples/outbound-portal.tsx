/**
 * Embed the hosted consumer portal, where your customer manages their own
 * webhook endpoints and reads their deliveries.
 *
 * 1. Once: allow your app's origin to frame the portal (`allowSiteToEmbed`).
 * 2. Server: mint a link per page load for the signed-in customer
 *    (`createPortalLink`), and end their sessions on sign-out.
 * 3. Browser: render it with <WebhookRelayPortal /> from @webhookrelay/sdk/react.
 *
 * test/outbound-portal.test.ts runs these functions and renders the component.
 */
import { WebhookRelay } from "@webhookrelay/sdk";
import { WebhookRelayPortal } from "@webhookrelay/sdk/react";

export async function allowSiteToEmbed(relay: WebhookRelay, origin: string) {
  const settings = await relay.outbound.portalSettings.get();
  if (settings.allowed_origins.includes(origin)) return settings;
  const { portal_id: _id, created_at: _created, updated_at: _updated, ...current } = settings;
  return relay.outbound.portalSettings.update({
    ...current,
    allowed_origins: [...settings.allowed_origins, origin],
  });
}

// Server-side, e.g. in GET /api/webhooks-portal. The URL is a one-time
// bearer link for this customer: return it to their browser only, never log it.
export async function createPortalLink(relay: WebhookRelay, customerId: string, userId: string) {
  const link = await relay.outbound.portalSessions.create(customerId, {
    capabilities: "manage",
    sessionId: `user-${userId}`, // lets signOut end exactly this user's sessions
  });
  return { url: link.url, expiresAt: link.expires_at };
}

// When the user signs out of your app.
export async function signOut(relay: WebhookRelay, customerId: string, userId: string) {
  const { ended } = await relay.outbound.portalSessions.expire(customerId, { sessionId: `user-${userId}` });
  return ended;
}

// Browser-side: fetch the link from your server and render the portal.
export function CustomerWebhooks({ portalUrl }: { portalUrl: string }) {
  return (
    <section>
      <h2>Webhooks</h2>
      <WebhookRelayPortal url={portalUrl} height={720} className="webhooks-portal" />
    </section>
  );
}
