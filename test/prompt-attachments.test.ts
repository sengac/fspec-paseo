/**
 * Feature: spec/features/fspec-prompt-attachments.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderContent } from "@getpaseo/plugin/server/provider";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

// A 1x1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function promptWith(content: ProviderContent[]) {
  const h = await harness();
  await h.open("paseo-1");
  await h.send({ type: "session.prompt", sessionId: "paseo-1", prompt: { clientMessageId: "c-1", delivery: "auto", input: { type: "message", content } } });
  await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
  return { h, text: h.daemon.sent("sendInput")[0]!.text };
}

describe("Feature: Send images from Paseo prompts to fspec", () => {
  describe("Scenario: An attached image is saved and referenced in the prompt", () => {
    it("writes the image to a private temp folder and references it", async () => {
      // @step Given an open fspec session "paseo-1"
      // @step When Paseo prompts "what is wrong here?" with one PNG image
      const { text } = await promptWith([
        { type: "text", text: "what is wrong here?" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ]);
      // @step Then the provider wrote the decoded PNG to a private temp folder for "paseo-1" outside the workspace
      const path = /\[Attached image: (.+)\]$/.exec(text)?.[1];
      expect(path).toBeDefined();
      expect(path!.startsWith(tmpdir())).toBe(true);
      expect(path!.endsWith(".png")).toBe(true);
      expect(readFileSync(path!)).toEqual(Buffer.from(PNG, "base64"));
      expect(statSync(dirname(path!)).mode & 0o777).toBe(0o700);
      // @step And it sent the prompt with the line "[Attached image: <that path>]" after the typed text
      expect(text).toBe(`what is wrong here?\n\n[Attached image: ${path}]`);
    });
  });

  describe("Scenario: An uploaded file is referenced by its path", () => {
    it("adds the uploaded file path", async () => {
      // @step Given an open fspec session "paseo-1"
      // @step When Paseo prompts "review this" with an uploaded file at "/uploads/spec.pdf"
      const { text } = await promptWith([
        { type: "text", text: "review this" },
        { type: "uploaded_file", id: "u-1", fileName: "spec.pdf", mimeType: "application/pdf", size: 10, path: "/uploads/spec.pdf" },
      ]);
      // @step Then the provider sent the prompt with the line "[Attached file: /uploads/spec.pdf]"
      expect(text).toBe("review this\n\n[Attached file: /uploads/spec.pdf]");
    });
  });

  describe("Scenario: Closing the session removes its saved images", () => {
    it("deletes the session's image folder on close", async () => {
      // @step Given an open fspec session "paseo-1" with a saved image
      const { h, text } = await promptWith([{ type: "image", data: PNG, mimeType: "image/png" }]);
      const folder = dirname(/\[Attached image: (.+)\]$/.exec(text)![1]!);
      expect(existsSync(folder)).toBe(true);
      // @step When Paseo closes the session
      await h.send({ type: "session.close", requestId: "x-1", sessionId: "paseo-1" });
      // @step Then the session's temp image folder no longer exists
      expect(existsSync(folder)).toBe(false);
    });
  });
});
