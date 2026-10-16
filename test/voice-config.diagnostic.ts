import { expect, it } from "vitest";
import { catalogConfigured } from "../lib/catalog";
import { missingVoiceSettings, VOICE_SETTINGS, voiceConfigured } from "../lib/voice";

/** Configuration presence only: never opens a database or starts a paid/model session. */
it("reports the real layout gates without disclosing setting values", () => {
  const voice = voiceConfigured();
  const catalog = catalogConfigured();
  console.table([
    { check: "voiceConfigured()", result: voice },
    { check: "catalogConfigured()", result: catalog },
    { check: "voice prop passed by layout", result: voice && catalog },
    { check: "typed assistant enabled (ANTHROPIC_API_KEY)", result: !!process.env.ANTHROPIC_API_KEY },
  ]);
  console.table([...VOICE_SETTINGS, "MONGODB_URI"].map(name => ({ setting: name, presentAndNonblank: !!process.env[name]?.trim() })));
  console.log("Missing voice setting names:", missingVoiceSettings().join(", ") || "none");
  console.log("No credentials, code values, connection strings or database contents were printed.");
  console.log("This checks presence only, not credential validity, database connectivity or provider availability.");
  console.log("When the voice prop is true, open Ask the assistant: the voice control is labelled Talk, inside that panel.");
  expect(voice && catalog, "Voice is hidden by configuration. Inspect the false/missing setting names above.").toBe(true);
});
