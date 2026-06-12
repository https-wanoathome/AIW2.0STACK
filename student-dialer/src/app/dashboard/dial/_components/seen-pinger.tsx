"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Marks the lead as first-visible the first time this component mounts
 * for a given lead id. Fire-and-forget, one POST per lead, then a
 * router refresh so the stamped timestamp shows up.
 */
export function SeenPinger({
  leadQueueId,
  alreadySeen,
}: {
  leadQueueId: string;
  alreadySeen: boolean;
}) {
  const fired = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (alreadySeen || fired.current) return;
    fired.current = true;
    void fetch(`/api/leads/${leadQueueId}/seen`, { method: "POST" }).then(
      () => {
        router.refresh();
      },
    );
  }, [leadQueueId, alreadySeen, router]);

  return null;
}
