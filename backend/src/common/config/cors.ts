export type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;

const normalizeOrigin = (value: string): string | null => {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

export const parseCorsAllowedOrigins = (
  raw: string | undefined,
  defaults: string[] = [],
): string[] => {
  const values = raw === undefined ? defaults : raw.split(',');
  return [
    ...new Set(
      values
        .map((value) => normalizeOrigin(value.trim()))
        .filter((value): value is string => !!value),
    ),
  ];
};

/**
 * Browsers supply Origin for cross-origin calls. CLI, health checks and same-origin
 * server requests may omit it and remain allowed. Unknown browser origins receive no
 * CORS permission, so credential-bearing preflight requests never reach a write route.
 */
export const createCorsOriginValidator = (allowedOrigins: readonly string[]) => {
  const allowed = new Set(allowedOrigins);
  return (origin: string | undefined, callback: CorsOriginCallback): void => {
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    callback(null, normalized !== null && allowed.has(normalized));
  };
};

export const createCorsOptions = (allowedOrigins: readonly string[]) => ({
  origin: createCorsOriginValidator(allowedOrigins),
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Accept',
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'If-Modified-Since',
    'If-None-Match',
    'Pragma',
    'Range',
    'X-Admin-Token',
    'X-Client-Token',
    'X-Player-Token',
    'X-Requested-With',
    // Required by the existing authenticated upload quota precheck.
    'X-Upload-Size',
  ],
  exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'ETag'],
  maxAge: 600,
});
