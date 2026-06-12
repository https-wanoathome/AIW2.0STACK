"use client";

import { useTransition, useState } from "react";
import { Phone } from "lucide-react";
import { claimLead } from "../actions";
import { useActivity } from "./activity-provider";

export function DialButton({ leadQueueId }: { leadQueueId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { online } = useActivity();

  const disabled = isPending || !online;

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await claimLead(leadQueueId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data?.ghl_url) {
        window.open(result.data.ghl_url, "_blank", "noopener,noreferrer");
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={online ? undefined : "Go online to dial"}
        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[var(--red)] text-white text-sm font-medium uppercase tracking-[0.16em] rounded hover:bg-[var(--red-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Phone className="h-4 w-4" />
        {isPending ? "Claiming..." : online ? "Dial" : "Offline"}
      </button>
      {error && (
        <div className="text-xs text-[var(--red)] font-mono px-2">{error}</div>
      )}
      {!online && (
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--silver)] text-center">
          Press online to enable
        </div>
      )}
    </div>
  );
}
