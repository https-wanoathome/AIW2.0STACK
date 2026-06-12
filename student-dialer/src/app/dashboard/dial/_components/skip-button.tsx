"use client";

import { useTransition } from "react";
import { skipLead } from "../actions";

export function SkipButton({ leadQueueId }: { leadQueueId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm("Skip this lead? It re-enters the queue after 24 hours."))
      return;

    const fd = new FormData();
    fd.append("lead_queue_id", leadQueueId);

    startTransition(async () => {
      await skipLead(fd);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] hover:text-white transition-colors disabled:opacity-50"
    >
      {isPending ? "Skipping..." : "Skip lead"}
    </button>
  );
}
