/**
 * Feature: spec/features/fspec-prompt-attachments.feature
 *
 * fspec's send_input carries text only, so prompt attachments travel as paths
 * the agent can open with its Read tool: pasted images are written to a
 * private temp folder outside the workspace, uploaded files keep the path
 * Paseo stored them at.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderContent } from "@getpaseo/plugin/server/provider";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** The temp folder holding one Paseo session's pasted images. */
export function attachmentFolder(sessionId: string): string {
  return join(tmpdir(), "fspec-paseo", sessionId.replace(/[^\w.-]/g, "_"));
}

/**
 * The prompt text for fspec: typed text first, then one line per attachment.
 * `counter` numbers saved images across the session's prompts.
 */
export function promptText(
  sessionId: string,
  content: readonly ProviderContent[],
  counter: { images: number },
): string {
  const text: string[] = [];
  const attached: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      text.push(part.text);
    } else if (part.type === "image") {
      const folder = attachmentFolder(sessionId);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, `image-${++counter.images}.${EXTENSIONS[part.mimeType] ?? "bin"}`);
      writeFileSync(path, Buffer.from(part.data, "base64"), { mode: 0o600 });
      attached.push(`[Attached image: ${path}]`);
    } else if (part.type === "uploaded_file") {
      attached.push(`[Attached file: ${part.path}]`);
    }
  }
  const body = text.join("\n");
  if (attached.length === 0) return body;
  return body === "" ? attached.join("\n") : `${body}\n\n${attached.join("\n")}`;
}

export function removeAttachments(sessionId: string): void {
  rmSync(attachmentFolder(sessionId), { recursive: true, force: true });
}
