"use client";

/* eslint-disable react-hooks/incompatible-library, react-hooks/refs -- dnd-kit and TanStack Virtual intentionally expose callback refs and imperative measurements. Keep that boundary isolated in this adapter. */

import { useRef, type ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";

interface SortableRecord {
  id: string;
  title: string;
}

export function VirtualSortableList<T extends SortableRecord>({ items, disabledIds, onReorder, children }: {
  items: T[];
  disabledIds: ReadonlySet<string>;
  onReorder(activeId: string, overId: string): void;
  children(item: T): ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const virtual = items.length > 100;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => virtual ? scrollRef.current : null,
    estimateSize: () => 82,
    overscan: 8,
    enabled: virtual,
  });

  function dragEnded(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(String(event.active.id), String(event.over.id));
  }

  const row = (item: T) => <SortableRow key={item.id} item={item} disabled={disabledIds.has(item.id)}>{children(item)}</SortableRow>;

  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnded}>
    <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      {virtual
        ? <div ref={scrollRef} className="connected-virtual-list" aria-label="任务列表"><div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{virtualizer.getVirtualItems().map((virtualRow) => <div key={items[virtualRow.index]!.id} ref={virtualizer.measureElement} data-index={virtualRow.index} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}>{row(items[virtualRow.index]!)}</div>)}</div></div>
        : items.map(row)}
    </SortableContext>
  </DndContext>;
}

function SortableRow<T extends SortableRecord>({ item, disabled, children }: { item: T; disabled: boolean; children: ReactNode }) {
  const sortable = useSortable({ id: item.id, disabled });
  return <div ref={sortable.setNodeRef} className={`connected-sortable-item ${sortable.isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button className="connected-drag-handle" type="button" disabled={disabled} aria-label={`拖动“${item.title}”排序`} {...sortable.attributes} {...sortable.listeners}>⋮⋮</button>
    {children}
  </div>;
}
