/**
 * A soft per-IP speed bump (per server instance) for routes that call a
 * model. It isn't a security boundary: the model's own cost is capped by
 * max_tokens and turns. It stops one browser or script from looping.
 */
export function speedBump(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (request: Request): boolean => {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const now = Date.now();
    if (hits.size > 5000) for (const [k, h] of hits) if (h.until < now) hits.delete(k);
    const h = hits.get(ip);
    if (!h || h.until < now) {
      hits.set(ip, { n: 1, until: now + windowMs });
      return false;
    }
    return ++h.n > limit;
  };
}
