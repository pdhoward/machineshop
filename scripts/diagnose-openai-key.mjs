// Authentication-only diagnostic: no generation, voice call or secret value is printed.
const key = process.env.OPENAI_API_KEY ?? "";
console.log(JSON.stringify({ configured: !!key.trim(), hasSurroundingWhitespace: key !== key.trim(), hasBearerPrefix: /^Bearer\s/i.test(key), looksLikePlaceholder: /<|>|your[-_ ]?(api[-_ ]?)?key|placeholder/i.test(key) }));
if (!key.trim()) { process.exitCode = 1; }
else {
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    // Error text can echo API key material; allowlist structured codes instead of printing it.
    const safeTag = value => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : null;
    console.log(JSON.stringify({ endpoint: "models (authentication check only)", status: res.status, accepted: res.ok, errorCode: safeTag(body?.error?.code), errorType: safeTag(body?.error?.type) }));
    if (!res.ok) process.exitCode = 1;
  } catch { console.log("Authentication check could not complete; no conclusion about key validity."); process.exitCode = 1; }
}
