# Diagnose voice visibility

From the Machine Shop repository run:

```powershell
pnpm.cmd diagnose:voice
```

This uses the same development envmachine file as `pnpm dev` and imports the actual `voiceConfigured()` and `catalogConfigured()` functions. It only checks configuration presence; it does not connect to MongoDB or call a model. Output contains setting names and booleans only. Exit code 1 means the layout's voice gate is false. The diagnostic is opt-in and does not enter the ordinary synthetic test suite.

If environment variables have already been injected by your shell or deployment tooling, use `pnpm.cmd diagnose:voice:runtime`. This reads that process's environment; it does not remotely inspect a running Vercel deployment. Restart the dev server after configuration changes and redeploy the relevant Vercel environment so new values take effect. For a local production build, rebuild and restart.

## Finding on 2026-10-16

With the development configuration, `voiceConfigured()` returned false, `catalogConfigured()` true and the combined voice prop false. `VOICE_MONGODB_DB` was missing or blank; every other required voice setting was nonblank.

Set `VOICE_MONGODB_DB` to the intended dedicated voice/transcript database name, matching the database permissions of the voice-specific connection. `.env.example` uses `machineshop_voice` as an illustration, not a verified existing database. Do not substitute the product catalog database merely to make the check pass. No environment file or deployed variable was changed by this diagnostic.

The deployed configuration was not inspected. Check the same variable in the Vercel project and the Production/Preview environment being used; local envmachine variables are not automatically installed on Vercel.

When the gate is true, open **Ask the assistant**: the voice control is **Talk**, inside that panel. It is not a second floating Voice button. The browser may then show availability, cooldown, access-code or microphone states. Presence checks do not validate credentials, database access, browser support or a successful voice call.

## Diagnose DNS and connectivity

```powershell
pnpm.cmd diagnose:voice:db
pnpm.cmd diagnose:voice:db -- --public-dns
```

These opt-in scripts inspect connection metadata, compare system SRV lookup with a public resolver, and connect/ping the dedicated voice database without reading documents or writing records. They print no credentials. `--public-dns` changes DNS selection only for that diagnostic process; it does not change Windows, Next.js or deployed settings. Ping does not prove database read/write permissions.

On 2026-10-16, system SRV lookup failed with `ECONNREFUSED`, public DNS returned three records, and voice connection/ping succeeded when the diagnostic used public DNS. The catalog uses a standard three-host `mongodb://` seed list; voice uses SRV discovery. This explains why catalog access can work while voice fails.

Use Atlas Connect → Drivers to obtain the **standard/non-SRV connection string**, keeping the dedicated voice user's credentials, target database and the Atlas-provided TLS/replica-set/authentication options. Do not merely remove `+srv`, copy the catalog's login or invent hostnames/options. Alternatively resolve the host's DNS/SRV issue. Update the appropriate local/Vercel environment and restart/redeploy. The application does not force a public DNS server.

A connection retry regression fix now clears and closes a failed voice connection attempt so a later request can recover. It does not repair DNS; restart once to remove any rejected promise cached by the older code.

## OpenAI authentication

Run `pnpm.cmd diagnose:voice:openai` to check the configured key against the read-only models endpoint. It performs no generation or voice call and prints only safe status/error codes; provider error messages are deliberately omitted because they can echo credential material. A passing models check does not prove Realtime-specific permissions or session configuration.

On 2026-10-16 this returned HTTP 401 with `invalid_api_key`. The configured value was nonblank, without surrounding whitespace or a Bearer prefix. Replace `OPENAI_API_KEY` with a valid project API key, restart the development process, and rerun the check. Update the Vercel environment separately before redeployment if needed. No key value was printed or changed by the diagnostic.
