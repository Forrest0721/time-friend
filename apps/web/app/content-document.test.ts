import { describe, expect, it } from "vitest";

import {
  contentDocumentToEditorJson,
  contentDocumentToText,
  editorJsonToContentDocument,
} from "./content-document";

describe("content document adapter", () => {
  it("round-trips every block type allowed by the V1 server schema", () => {
    const document = {
      type: "doc" as const,
      schemaVersion: 1 as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "背景" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "发散" }] }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "收敛" }] }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "验证" }] }] }] },
        { type: "horizontalRule" },
      ],
    };

    expect(editorJsonToContentDocument(contentDocumentToEditorJson(document))).toEqual(document);
    expect(contentDocumentToText(document)).toBe("背景\n- 发散\n1. 收敛\n- [x] 验证\n---");
  });

  it("removes unsupported nodes and text marks before the API boundary", () => {
    const document = editorJsonToContentDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "不支持" }] },
        { type: "paragraph", content: [{ type: "text", text: "安全文本", marks: [{ type: "bold" }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: "yes" }, content: [{ type: "paragraph" }] }] },
      ],
    });

    expect(document).toEqual({
      type: "doc",
      schemaVersion: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "安全文本" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [] }] }] },
      ],
    });
  });
});
