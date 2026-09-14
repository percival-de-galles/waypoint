import { scopeThreadRef } from "@waypoint/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@waypoint/client-runtime/state/shell";
import { type ScopedThreadRef } from "@waypoint/contracts";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckIcon, CircleDotIcon, GripVerticalIcon, ListTodoIcon, PlayIcon } from "lucide-react";
import { useCallback, useMemo, type CSSProperties } from "react";

import { isLatestTurnSettled } from "../session-logic";
import { useThreadShellsForProjectRefs } from "../state/entities";
import { useThreadActions } from "../hooks/useThreadActions";
import { pinOrderKeyBetween } from "./Sidebar.logic";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";

type BoardLane = "queue" | "running" | "review" | "done";

const BOARD_LANES: ReadonlyArray<{
  readonly id: BoardLane;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof ListTodoIcon;
}> = [
  { id: "queue", label: "Queue", description: "Pinned for next", icon: ListTodoIcon },
  { id: "running", label: "Running", description: "Agent at work", icon: PlayIcon },
  { id: "review", label: "Review", description: "Ready for attention", icon: CircleDotIcon },
  { id: "done", label: "Done", description: "Settled work", icon: CheckIcon },
];

function boardLaneFor(thread: EnvironmentThreadShell): BoardLane {
  if (thread.settledAt !== null || thread.settledOverride === "settled") return "done";
  if (
    thread.session?.status === "running" ||
    (thread.latestTurn?.startedAt && !isLatestTurnSettled(thread.latestTurn, thread.session))
  ) {
    return "running";
  }
  return thread.pinnedAt !== null ? "queue" : "review";
}

function threadRef(thread: EnvironmentThreadShell): ScopedThreadRef {
  return scopeThreadRef(thread.environmentId, thread.id);
}

function BoardCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly lane: BoardLane;
  readonly onOpenThread: (thread: ScopedThreadRef) => void;
  readonly onMoveToQueue: (thread: EnvironmentThreadShell) => void;
  readonly onMoveToReview: (thread: EnvironmentThreadShell) => void;
  readonly onMarkDone: (thread: EnvironmentThreadShell) => void;
  readonly onReopen: (thread: EnvironmentThreadShell) => void;
  readonly onMoveEarlier?: (() => void) | undefined;
  readonly onMoveLater?: (() => void) | undefined;
  readonly drag?:
    | {
        readonly setNodeRef: (node: HTMLElement | null) => void;
        readonly style: CSSProperties;
        readonly listeners: ReturnType<typeof useSortable>["listeners"];
        readonly isDragging: boolean;
      }
    | undefined;
}) {
  const { thread, lane, drag } = props;
  return (
    <article
      ref={drag?.setNodeRef}
      className={cn(
        "group rounded-lg border border-border/75 bg-background p-3 shadow-xs transition-[border-color,box-shadow,opacity] motion-reduce:transition-none hover:border-border hover:shadow-sm",
        lane === "running" && "border-primary/25",
        drag?.isDragging && "opacity-45 shadow-none",
      )}
      style={drag?.style}
    >
      <div className="flex min-w-0 gap-1.5">
        {drag ? (
          <button
            type="button"
            aria-label={`Drag to reorder ${thread.title}`}
            className="mt-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...drag.listeners}
          >
            <GripVerticalIcon aria-hidden className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="block min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => props.onOpenThread(threadRef(thread))}
        >
          <h3 className="line-clamp-2 text-sm font-medium text-foreground">{thread.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="max-w-full truncate rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {thread.modelSelection.model}
            </span>
            {thread.branch ? (
              <span className="max-w-full truncate rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {thread.branch}
              </span>
            ) : null}
          </div>
        </button>
      </div>
      {lane !== "running" ? (
        <div className="mt-3 flex items-center gap-1 opacity-80 transition-opacity motion-reduce:transition-none sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {lane === "queue" ? (
            <>
              <Button
                size="micro"
                variant="ghost-muted"
                onClick={props.onMoveEarlier}
                disabled={!props.onMoveEarlier}
              >
                Earlier
              </Button>
              <Button
                size="micro"
                variant="ghost-muted"
                onClick={props.onMoveLater}
                disabled={!props.onMoveLater}
              >
                Later
              </Button>
              <Button
                size="micro"
                variant="ghost-muted"
                onClick={() => props.onMoveToReview(thread)}
              >
                Review
              </Button>
            </>
          ) : null}
          {lane === "review" ? (
            <>
              <Button
                size="micro"
                variant="ghost-muted"
                onClick={() => props.onMoveToQueue(thread)}
              >
                Queue
              </Button>
              <Button size="micro" variant="ghost-muted" onClick={() => props.onMarkDone(thread)}>
                Done
              </Button>
            </>
          ) : null}
          {lane === "done" ? (
            <Button size="micro" variant="ghost-muted" onClick={() => props.onReopen(thread)}>
              Reopen
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SortableQueueCard(props: Omit<Parameters<typeof BoardCard>[0], "drag">) {
  const sortable = useSortable({ id: props.thread.id });
  return (
    <BoardCard
      {...props}
      drag={{
        setNodeRef: sortable.setNodeRef,
        style: {
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        },
        listeners: sortable.listeners,
        isDragging: sortable.isDragging,
      }}
    />
  );
}

export function ProjectBoard(props: {
  readonly project: EnvironmentProject;
  readonly onOpenThread: (thread: ScopedThreadRef) => void;
}) {
  const threads = useThreadShellsForProjectRefs([
    { environmentId: props.project.environmentId, projectId: props.project.id },
  ]);
  const { pinThread, unpinThread, settleThread, unsettleThread, reorderPinnedThread } =
    useThreadActions();
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const lanes = useMemo(() => {
    const grouped: Record<BoardLane, Array<EnvironmentThreadShell>> = {
      queue: [],
      running: [],
      review: [],
      done: [],
    };
    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      grouped[boardLaneFor(thread)].push(thread);
    }
    return grouped;
  }, [threads]);
  const reportFailure = useCallback((title: string, result: { readonly _tag: string }) => {
    if (result._tag !== "Failure") return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: "Check the connection and try again.",
      }),
    );
  }, []);
  const moveToQueue = useCallback(
    (thread: EnvironmentThreadShell) => {
      void pinThread(threadRef(thread)).then((result) =>
        reportFailure("Failed to queue thread", result),
      );
    },
    [pinThread, reportFailure],
  );
  const moveToReview = useCallback(
    (thread: EnvironmentThreadShell) => {
      void unpinThread(threadRef(thread)).then((result) =>
        reportFailure("Failed to move thread", result),
      );
    },
    [reportFailure, unpinThread],
  );
  const markDone = useCallback(
    (thread: EnvironmentThreadShell) => {
      void settleThread(threadRef(thread)).then((result) =>
        reportFailure("Failed to settle thread", result),
      );
    },
    [reportFailure, settleThread],
  );
  const reopen = useCallback(
    (thread: EnvironmentThreadShell) => {
      void unsettleThread(threadRef(thread)).then((result) =>
        reportFailure("Failed to reopen thread", result),
      );
    },
    [reportFailure, unsettleThread],
  );
  const reorderQueue = useCallback(
    (thread: EnvironmentThreadShell, targetIndex: number) => {
      const sourceIndex = lanes.queue.findIndex((candidate) => candidate.id === thread.id);
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= lanes.queue.length) return;
      const ordered = arrayMove(lanes.queue, sourceIndex, targetIndex);
      const index = ordered.findIndex((candidate) => candidate.id === thread.id);
      const orderKey = pinOrderKeyBetween(
        ordered[index - 1]?.pinOrderKey ?? null,
        ordered[index + 1]?.pinOrderKey ?? null,
      );
      if (!orderKey) return;
      void reorderPinnedThread(threadRef(thread), orderKey).then((result) =>
        reportFailure("Failed to reorder queue", result),
      );
    },
    [lanes.queue, reorderPinnedThread, reportFailure],
  );
  const handleQueueDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.over || event.active.id === event.over.id) return;
      const thread = lanes.queue.find((candidate) => candidate.id === event.active.id);
      const targetIndex = lanes.queue.findIndex((candidate) => candidate.id === event.over?.id);
      if (thread && targetIndex >= 0) reorderQueue(thread, targetIndex);
    },
    [lanes.queue, reorderQueue],
  );

  return (
    <section
      aria-label={`${props.project.title} board`}
      className="min-h-0 flex-1 overflow-auto scroll-fade bg-background px-3 py-4 sm:px-5 sm:py-6"
    >
      <div className="mx-auto flex min-h-full max-w-[1440px] gap-3 sm:gap-4">
        {BOARD_LANES.map((lane) => {
          const Icon = lane.icon;
          const laneThreads = lanes[lane.id];
          return (
            <section key={lane.id} className="flex w-72 shrink-0 flex-col gap-2 sm:w-80">
              <header className="flex items-center gap-2 px-1.5 py-1">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium text-foreground">{lane.label}</h2>
                  <p className="text-xs text-muted-foreground">{lane.description}</p>
                </div>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {laneThreads.length}
                </span>
              </header>
              <div className="flex min-h-28 flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-2">
                {lane.id === "queue" ? (
                  <DndContext sensors={dragSensors} onDragEnd={handleQueueDragEnd}>
                    <SortableContext
                      items={laneThreads.map((thread) => thread.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {laneThreads.map((thread, index) => (
                        <SortableQueueCard
                          key={thread.id}
                          lane={lane.id}
                          thread={thread}
                          onOpenThread={props.onOpenThread}
                          onMoveToQueue={moveToQueue}
                          onMoveToReview={moveToReview}
                          onMarkDone={markDone}
                          onReopen={reopen}
                          {...(index > 0
                            ? { onMoveEarlier: () => reorderQueue(thread, index - 1) }
                            : {})}
                          {...(index < laneThreads.length - 1
                            ? { onMoveLater: () => reorderQueue(thread, index + 1) }
                            : {})}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  laneThreads.map((thread) => (
                    <BoardCard
                      key={thread.id}
                      lane={lane.id}
                      thread={thread}
                      onOpenThread={props.onOpenThread}
                      onMoveToQueue={moveToQueue}
                      onMoveToReview={moveToReview}
                      onMarkDone={markDone}
                      onReopen={reopen}
                    />
                  ))
                )}
                {laneThreads.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Nothing here
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
