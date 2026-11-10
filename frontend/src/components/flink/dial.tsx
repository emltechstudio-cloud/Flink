import { useState } from "react";
import { ArrowLeft, Delete, MessageCircle, Phone, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";
import type { CommMode } from "@/lib/flink/types";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function DialPad() {
  const { startChat, approach, busy, setView } = useFlink();
  const [digits, setDigits] = useState("");

  function press(key: (typeof KEYS)[number]) {
    if (key === "") return;
    if (key === "del") {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setDigits((d) => (d + key).slice(0, 6));
  }

  function go(mode: CommMode) {
    if (digits.length !== 6 || busy) return;
    void approach(digits, mode);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2"><Button variant="ghost" size="icon" onClick={() => setView("history")} aria-label="Back to chats"><ArrowLeft className="size-5" /></Button><div><p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">New chat</p><p className="text-sm text-muted">Enter a six-digit Flink number</p></div></div>
      <div className="px-6 pt-3 pb-2">
        <p className="font-display mt-3 min-h-[3.2rem] text-center text-[2.6rem] leading-none tracking-[0.14em] text-fg tabular-nums">
          {digits ? formatFlinkNumber(digits) : "······"}
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-[320px] grid-cols-3 gap-3 px-6 py-4">
        {KEYS.map((key, i) =>
          key === "" ? (
            <div key={i} />
          ) : (
            <button
              key={`dial-${key}`}
              type="button"
              onClick={() => press(key)}
              className="flex aspect-square items-center justify-center rounded-full bg-surface text-2xl font-medium text-fg shadow-[0_2px_16px_rgba(123,21,53,0.06)] ring-1 ring-border transition-transform duration-150 active:scale-95"
            >
              {key === "del" ? <Delete className="size-6 text-muted" /> : key}
            </button>
          ),
        )}
      </div>
      <div className="mt-auto flex items-center justify-center gap-4 px-6 pt-2 pb-4">
        <div className="flex flex-col items-center gap-1.5"><Button size="round" variant="secondary" disabled={digits.length !== 6 || busy} onClick={() => void startChat(digits)} aria-label="Open chat"><MessageCircle className="size-5" /></Button><span className="text-xs font-semibold text-muted">Chat</span></div>
        <div className="flex flex-col items-center gap-1.5"><Button size="round" disabled={digits.length !== 6 || busy} onClick={() => go("voice")} aria-label="Voice call"><Phone className="size-5" /></Button><span className="text-xs font-semibold text-muted">Voice</span></div>
        <div className="flex flex-col items-center gap-1.5"><Button size="round" variant="secondary" disabled={digits.length !== 6 || busy} onClick={() => go("video")} aria-label="Video call"><Video className="size-5" /></Button><span className="text-xs font-semibold text-muted">Video</span></div>
      </div>
    </div>
  );
}
