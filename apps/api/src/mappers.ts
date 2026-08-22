import type { ItemDto } from "@time-friend/contracts";
import type { Item, TaskPriority } from "@time-friend/domain";

const priorityToDto: Record<TaskPriority, NonNullable<ItemDto["priority"]>> = {
  0: "none",
  1: "low",
  3: "medium",
  5: "high",
};

const priorityFromDto = {
  none: 0,
  low: 1,
  medium: 3,
  high: 5,
} as const;

export function toItemDto(item: Item): ItemDto {
  return {
    ...item,
    priority: item.priority === null ? null : priorityToDto[item.priority],
    contentDoc: {
      type: "doc",
      schemaVersion: 1,
      content: [...item.contentDoc.content],
    },
  };
}

export function toDomainPriority(priority: keyof typeof priorityFromDto | null | undefined): TaskPriority | null | undefined {
  if (priority === undefined || priority === null) return priority;
  return priorityFromDto[priority];
}
