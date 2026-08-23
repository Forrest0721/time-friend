import type { JSONContent } from "@tiptap/core";

import type { ItemDto } from "@time-friend/contracts";

const allowedNodeTypes = new Set(["paragraph", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "horizontalRule", "text"]);

export function editorJsonToContentDocument(value: JSONContent): ItemDto["contentDoc"] {
  return {
    type: "doc",
    schemaVersion: 1,
    content: (value.content ?? []).map(sanitizeNode).filter((node): node is Record<string, unknown> => node !== null),
  };
}

export function contentDocumentToEditorJson(document: ItemDto["contentDoc"]): JSONContent {
  return { type: "doc", content: structuredClone(document.content) as JSONContent[] };
}

export function textToContentDocument(value: string): ItemDto["contentDoc"] {
  const content: Array<Record<string, unknown>> = [];
  let taskItems: Array<Record<string, unknown>> = [];
  const flushTasks = () => {
    if (taskItems.length > 0) {
      content.push({ type: "taskList", content: taskItems });
      taskItems = [];
    }
  };
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    const task = line.match(/^- \[([ xX])\]\s*(.+)$/);
    if (task) {
      taskItems.push({
        type: "taskItem",
        attrs: { checked: task[1]!.toLowerCase() === "x" },
        content: [{ type: "paragraph", content: [{ type: "text", text: task[2]! }] }],
      });
      continue;
    }
    flushTasks();
    if (line) content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
  }
  flushTasks();
  return { type: "doc", schemaVersion: 1, content };
}

export function contentDocumentToText(document: ItemDto["contentDoc"]): string {
  const lines: string[] = [];
  const text = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const value = node as { text?: string; content?: unknown[] };
    return value.text ?? (value.content ?? []).map(text).join("");
  };
  for (const raw of document.content) {
    const node = raw as { type?: string; content?: Array<{ attrs?: { checked?: boolean }; content?: unknown[] }> };
    if (node.type === "taskList") {
      for (const item of node.content ?? []) lines.push(`- [${item.attrs?.checked ? "x" : " "}] ${text(item)}`);
    } else if (node.type === "bulletList") {
      for (const item of node.content ?? []) lines.push(`- ${text(item)}`);
    } else if (node.type === "orderedList") {
      for (const [index, item] of (node.content ?? []).entries()) lines.push(`${index + 1}. ${text(item)}`);
    } else if (node.type === "horizontalRule") {
      lines.push("---");
    } else {
      lines.push(text(node));
    }
  }
  return lines.filter(Boolean).join("\n");
}

function sanitizeNode(value: JSONContent): Record<string, unknown> | null {
  if (!value.type || !allowedNodeTypes.has(value.type)) return null;
  if (value.type === "text") return typeof value.text === "string" && value.text.length > 0 ? { type: "text", text: value.text } : null;
  if (value.type === "horizontalRule") return { type: "horizontalRule" };
  const content = (value.content ?? []).map(sanitizeNode).filter((node): node is Record<string, unknown> => node !== null);
  if (value.type === "taskItem") return { type: "taskItem", attrs: { checked: value.attrs?.checked === true }, content };
  return { type: value.type, content };
}
