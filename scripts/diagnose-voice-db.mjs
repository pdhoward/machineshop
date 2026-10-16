import { getServers, setServers } from "node:dns";
import { Resolver } from "node:dns/promises";
import { MongoClient } from "mongodb";

// Opt-in read-only network diagnostic. Never prints URI, username, password or document data.
const settings = ["MONGODB_URI", "VOICE_MONGODB_URI"];
const hosts = {};
for (const setting of settings) {
  const raw = process.env[setting];
  if (!raw?.trim()) { console.log(JSON.stringify({ setting, present: false })); continue; }
  try {
    const parsed = new MongoClient(raw);
    const hostname = parsed.options.srvHost;
    hosts[setting] = hostname ?? null;
    if (setting === "VOICE_MONGODB_URI") {
      const credentials = parsed.options.credentials;
      const password = credentials?.password ?? "";
      console.log(JSON.stringify({ voiceCredentialChecks: {
        usernameIsExpectedVoiceUser: credentials?.username === "voice_writer",
        passwordPresent: password.length > 0,
        passwordLooksLikePlaceholder: /<|>|db_password|url-encoded-password|notmypassword/i.test(password),
        passwordHasSurroundingWhitespace: password !== password.trim(),
        passwordContainsEncodedSequenceAfterParsing: /%[a-f0-9]{2}/i.test(password),
        authenticatesAgainstAdmin: credentials?.source === "admin",
        tlsEnabled: parsed.options.tls === true
      } }));
    }

    console.log(JSON.stringify({ setting, scheme: hostname ? "mongodb+srv:" : "mongodb:", hostname: hostname ?? null, seedHostCount: parsed.options.hosts?.length ?? null }));
    if (!hostname) continue;
    for (const mode of ["system", "public-resolver"]) {
      const resolver = new Resolver({ timeout: 2500, tries: 1 });
      if (mode === "public-resolver") resolver.setServers(["1.1.1.1"]);
      try {
        const records = await resolver.resolveSrv(`_mongodb._tcp.${hostname}`);
        console.log(JSON.stringify({ setting, dns: mode, resolved: true, recordCount: records.length }));
      } catch (error) { console.log(JSON.stringify({ setting, dns: mode, resolved: false, code: error.code ?? "UNKNOWN" })); }
    }
  } catch { console.log(JSON.stringify({ setting, parseable: false })); }
}
console.log(JSON.stringify({ sameClusterHostname: !!hosts.MONGODB_URI && hosts.MONGODB_URI === hosts.VOICE_MONGODB_URI, voiceDatabaseConfigured: !!process.env.VOICE_MONGODB_DB?.trim() }));
if (!process.env.VOICE_MONGODB_URI || !process.env.VOICE_MONGODB_DB?.trim()) {
  console.log("Voice connection test skipped: required configuration is missing."); process.exitCode = 1;
} else {
  const previousDns = getServers();
  const publicDns = process.argv.includes("--public-dns");
  if (publicDns) { setServers(["1.1.1.1"]); console.log("Using public DNS for this diagnostic process only; no machine or application settings changed."); }
  const client = new MongoClient(process.env.VOICE_MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 5000 });
  try {
    await client.connect();
    const result = await client.db(process.env.VOICE_MONGODB_DB).command({ ping: 1 });
    console.log(JSON.stringify({ voiceConnection: "connected", ping: result.ok === 1, readWritePermissionsVerified: false }));
  } catch (error) {
    console.log(JSON.stringify({ voiceConnection: "failed", errorType: error.name, code: error.code ?? error.cause?.code ?? "UNKNOWN", codeName: error.codeName ?? null }));
    process.exitCode = 1;
  } finally { await client.close(); if (publicDns) setServers(previousDns); }
}
