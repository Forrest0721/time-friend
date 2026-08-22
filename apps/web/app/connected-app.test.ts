import { describe, expect, it } from "vitest";

import { contentDocumentToText, formatDuration, textToContentDocument } from "./connected-app";

describe("connected app content helpers", () => {
  it("round-trips paragraphs and checked/unchecked items through the shared content document", () => {
    const source = "产品背景\n- [ ] 校验队列\n- [x] 完成接口";
    const document = textToContentDocument(source);

    expect(document).toEqual({
      type: "doc",
      schemaVersion: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "产品背景" }] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "校验队列" }] }] },
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "完成接口" }] }] },
          ],
        },
      ],
    });
    expect(contentDocumentToText(document)).toBe(source);
  });

  it("formats short and long effective durations without negative values", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(125)).toBe("02:05");
    expect(formatDuration(3_725)).toBe("1h 02m");
  });
});
