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
    // 内置同源投放页(运营大屏 / 欢迎页)都要以同源身份轮询 /api; 缺
    // allow-same-origin 时 iframe origin=null, 后端收紧 CORS 后请求被拒 -> 白屏/拉不到方案。
    const isBundledPage = target.origin === player.origin
      && (/\/park-ops\/index\.html$/.test(target.pathname)
        || /\/welcome\/index\.html$/.test(target.pathname));
    return isBundledPage ? TRUSTED_WEBPAGE_SANDBOX : RESTRICTED_WEBPAGE_SANDBOX;
  } catch {
    return RESTRICTED_WEBPAGE_SANDBOX;
  }
}

