const RESTRICTED_WEBPAGE_SANDBOX = 'allow-scripts allow-forms';
const TRUSTED_WEBPAGE_SANDBOX = `${RESTRICTED_WEBPAGE_SANDBOX} allow-same-origin`;

/**
 * The bundled park dashboard polls the same-origin `/api/park-ops-control`
 * endpoint. A sandbox without `allow-same-origin` turns its origin into `null`,
 * so the browser rejects that poll after the backend CORS policy is tightened.
 *
 * Only the shipped, same-origin dashboard receives its origin back. Arbitrary
 * webpage media remains in the opaque-origin sandbox.
 */
export function webpageSandbox(source: string | null | undefined, playerHref: string): string {
  if (!source) return RESTRICTED_WEBPAGE_SANDBOX;
  try {
    const player = new URL(playerHref);
    const target = new URL(source, player);
    const isBundledDashboard = target.origin === player.origin
      && /\/park-ops\/index\.html$/.test(target.pathname);
    return isBundledDashboard ? TRUSTED_WEBPAGE_SANDBOX : RESTRICTED_WEBPAGE_SANDBOX;
  } catch {
    return RESTRICTED_WEBPAGE_SANDBOX;
  }
}

