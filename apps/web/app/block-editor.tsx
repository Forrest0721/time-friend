"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { CheckSquare, List, ListOrdered, Minus, Pilcrow } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ItemDto } from "@time-friend/contracts";

import { clientPersistence, type EditorDraft } from "./client-db";
import { contentDocumentToEditorJson, editorJsonToContentDocument } from "./content-document";

export function BlockEditor({ document, revision, draftKey, onChange }: {
  document: ItemDto["contentDoc"];
  revision: number;
  draftKey: string;
  onChange(document: ItemDto["contentDoc"]): void;
}) {
  const draftTimer = useRef<number | null>(null);
  const pendingDraft = useRef<EditorDraft | null>(null);
  const latestRevision = useRef(revision);
  const baseDocument = useRef(document);
  const onChangeRef = useRef(onChange);
  const editor = useEditor({
    immediatelyRender: false,
    content: contentDocumentToEditorJson(document),
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        bold: false,
        italic: false,
        strike: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editorProps: {
      attributes: { class: "connected-tiptap-surface", "aria-label": "笔记与检查事项" },
    },
    onUpdate({ editor: current }) {
      const next = editorJsonToContentDocument(current.getJSON());
      onChangeRef.current(next);
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
      const draft = {
        key: draftKey,
        baseRevision: latestRevision.current,
        document: next,
        updatedAt: new Date().toISOString(),
      } satisfies EditorDraft;
      pendingDraft.current = draft;
      draftTimer.current = window.setTimeout(() => {
        draftTimer.current = null;
        void clientPersistence.saveDraft(draft).then(
          () => { if (pendingDraft.current === draft) pendingDraft.current = null; },
          () => undefined,
        );
      }, 800);
    },
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let active = true;
    void clientPersistence.getDraft(draftKey).then((draft) => {
      if (!active || !editor || !draft) return;
      if (draft.baseRevision !== revision) {
        void clientPersistence.deleteDraft(draftKey);
        return;
      }
      if (JSON.stringify(draft.document) !== JSON.stringify(baseDocument.current)) {
        editor.commands.setContent(contentDocumentToEditorJson(draft.document), { emitUpdate: false });
        onChangeRef.current(draft.document);
      }
    });
    return () => { active = false; };
  }, [draftKey, editor, revision]);

  useEffect(() => {
    if (revision === latestRevision.current) return;
    latestRevision.current = revision;
    void clientPersistence.deleteDraft(draftKey);
  }, [draftKey, revision]);

  useEffect(() => () => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    if (pendingDraft.current) void clientPersistence.saveDraft(pendingDraft.current).catch(() => undefined);
  }, []);

  if (!editor) return <div className="connected-editor-loading">正在打开块编辑器…</div>;
  return <div className="connected-block-editor">
    <div className="connected-editor-toolbar" aria-label="正文块类型">
      <EditorButton active={editor.isActive("paragraph")} label="段落" onClick={() => editor.chain().focus().setParagraph().run()}><Pilcrow /></EditorButton>
      <EditorButton active={editor.isActive("bulletList")} label="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></EditorButton>
      <EditorButton active={editor.isActive("orderedList")} label="有序列表" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></EditorButton>
      <EditorButton active={editor.isActive("taskList")} label="检查项" onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></EditorButton>
      <EditorButton active={false} label="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></EditorButton>
    </div>
    <EditorContent editor={editor} />
    <small>内容会先保存在本机草稿中；点击“保存内容”写入服务端。</small>
  </div>;
}

function EditorButton({ active, label, onClick, children }: {
  active: boolean;
  label: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return <button type="button" className={active ? "active" : ""} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}
