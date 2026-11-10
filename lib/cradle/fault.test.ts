import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { modelFault, ModelUnavailable } from "./fault";

const apiError = (status: number, type: string, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

describe("modelFault", () => {
  it("knows the model-account failures", () => {
    expect(modelFault(apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."))?.kind).toBe("billing");
    expect(modelFault(apiError(401, "authentication_error", "invalid x-api-key"))?.kind).toBe("auth");
    expect(modelFault(apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"))?.kind).toBe("rate_limit");
    expect(modelFault(apiError(529, "overloaded_error", "Overloaded"))?.kind).toBe("overloaded");
    expect(modelFault(new Anthropic.APIConnectionError({ message: "Connection error." }))?.kind).toBe("unavailable");
  });
  it("leaves the app's own errors to the app", () => {
    expect(modelFault(apiError(400, "invalid_request_error", "max_tokens: Field required"))).toBeNull();
    expect(modelFault(new SyntaxError("Unexpected end of JSON input"))).toBeNull();
    expect(modelFault("nope")).toBeNull();
  });
  it("names the fault when it stops a proof", () => {
    const f = modelFault(apiError(400, "invalid_request_error", "Your credit balance is too low"))!;
    expect(new ModelUnavailable(f).message).toMatch(/^AI out of credit: /);
  });
});
