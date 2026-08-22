import { DomainError } from "./errors.js";

export const CONTENT_SCHEMA_VERSION = 1 as const;
export const MAX_CONTENT_BYTES = 1_048_576;
const MAX_CONTENT_NODES = 10_000;
const MAX_CONTENT_DEPTH = 16;

export type ContentNodeType =
  | "paragraph"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "taskList"
  | "taskItem"
  | "horizontalRule"
  | "text";

export interface ContentNode {
  type: ContentNodeType;
  attrs?: Readonly<Record<string, unknown>>;
  content?: readonly ContentNode[];
  text?: string;
}

export interface ContentDocument {
  type: "doc";
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  content: readonly ContentNode[];
}

export function emptyContentDocument(): ContentDocument {
  return {
    type: "doc",
    schemaVersion: CONTENT_SCHEMA_VERSION,
    content: [],
  };
}

export function validateContentDocument(value: unknown): ContentDocument {
  if (!isRecord(value) || value.type !== "doc" || value.schemaVersion !== CONTENT_SCHEMA_VERSION || !Array.isArray(value.content)) {
    throw invalidContent("正文必须是受支持的文档格式");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONTENT_BYTES) {
    throw new DomainError("CONTENT_TOO_LARGE", "正文不能超过 1MB");
  }

  let nodeCount = 0;
  const visit = (node: unknown, parent: "doc" | ContentNodeType, depth: number): void => {
    if (depth > MAX_CONTENT_DEPTH) throw invalidContent("正文嵌套层级过深");
    if (!isRecord(node) || typeof node.type !== "string") throw invalidContent("正文包含无效节点");
    nodeCount += 1;
    if (nodeCount > MAX_CONTENT_NODES) throw invalidContent("正文节点数量过多");

    const type = node.type as ContentNodeType;
    if (!isAllowedChild(parent, type)) throw invalidContent(`节点 ${type} 不能出现在 ${parent} 中`);
    assertKnownKeys(node, type === "text" ? ["type", "text"] : type === "taskItem" ? ["type", "attrs", "content"] : ["type", "content"]);

    if (type === "text") {
      if (typeof node.text !== "string" || node.text.length === 0) throw invalidContent("文本节点不能为空");
      return;
    }
    if (type === "taskItem") {
      if (!isRecord(node.attrs) || typeof node.attrs.checked !== "boolean" || Object.keys(node.attrs).some((key) => key !== "checked")) {
        throw invalidContent("检查项必须包含 checked 布尔属性");
      }
    }
    if (type === "horizontalRule") {
      if (node.content !== undefined) throw invalidContent("分隔线不能包含子节点");
      return;
    }
    if (!Array.isArray(node.content)) throw invalidContent(`${type} 必须包含 content 数组`);
    for (const child of node.content) visit(child, type, depth + 1);
  };

  for (const node of value.content) visit(node, "doc", 1);
  return structuredClone(value) as unknown as ContentDocument;
}

export function extractContentText(document: ContentDocument): string {
  const chunks: string[] = [];
  const visit = (node: ContentNode): void => {
    if (node.type === "text" && node.text) chunks.push(node.text);
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of document.content) visit(node);
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function isAllowedChild(parent: "doc" | ContentNodeType, child: ContentNodeType): boolean {
  if (parent === "doc") return ["paragraph", "bulletList", "orderedList", "taskList", "horizontalRule"].includes(child);
  if (parent === "paragraph") return child === "text";
  if (parent === "bulletList" || parent === "orderedList") return child === "listItem";
  if (parent === "taskList") return child === "taskItem";
  if (parent === "listItem") return ["paragraph", "bulletList", "orderedList"].includes(child);
  if (parent === "taskItem") return ["paragraph", "bulletList", "orderedList", "taskList"].includes(child);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw invalidContent("正文包含不支持的字段");
  }
}

function invalidContent(message: string): DomainError {
  return new DomainError("INVALID_CONTENT", message);
}
