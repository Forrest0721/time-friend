import { describe, expect, it } from "vitest";

import { extractContentText, MAX_CONTENT_BYTES, validateContentDocument } from "./content.js";

describe("content document", () => {
  it("accepts exactly the V1 block types and extracts searchable text", () => {
    const document = validateContentDocument({
      type: "doc",
      schemaVersion: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "验证方向" }] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "访谈" }] }] }],
        },
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "原型" }] }] }],
        },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "发布" }] }] }],
        },
        { type: "horizontalRule" },
      ],
    });

    expect(extractContentText(document)).toBe("验证方向 访谈 原型 发布");
  });

  it.each([
    { type: "doc", schemaVersion: 2, content: [] },
    { type: "doc", schemaVersion: 1, content: [{ type: "heading", content: [] }] },
    { type: "doc", schemaVersion: 1, content: [{ type: "taskItem", attrs: { checked: false }, content: [] }] },
    { type: "doc", schemaVersion: 1, content: [{ type: "paragraph", content: [], html: "<script />" }] },
    { type: "doc", schemaVersion: 1, content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: "yes" }, content: [] }] }] },
  ])("rejects unsupported or malformed content %#", (document) => {
    expect(() => validateContentDocument(document)).toThrowError(expect.objectContaining({ code: "INVALID_CONTENT" }));
  });

  it("enforces the 1MB server-side content limit", () => {
    const text = "字".repeat(MAX_CONTENT_BYTES);
    expect(() =>
      validateContentDocument({
        type: "doc",
        schemaVersion: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      }),
    ).toThrowError(expect.objectContaining({ code: "CONTENT_TOO_LARGE" }));
  });
});
