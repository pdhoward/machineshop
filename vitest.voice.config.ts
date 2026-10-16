import { mergeConfig } from "vitest/config";
import base from "./vitest.config";
/** Opt-in real-environment diagnostic, excluded from the ordinary synthetic unit suite. */
export default mergeConfig(base, { test: { include: ["test/voice-config.diagnostic.ts"] } });
