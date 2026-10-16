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
