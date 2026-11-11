import { Phone, Radio, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";

export function CallsView() {
  const { calls, contacts, approach, setView } = useFlink();
  const nameOf = (number: string) => contacts.find((contact) => contact.flinkNumber === number)?.name || formatFlinkNumber(number);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
      <div className="flex items-center justify-between px-3 pt-4 pb-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Calls</p>
          <p className="mt-1 text-sm text-muted">Call anyone with a Flink number.</p>
        </div>
        <Button size="sm" onClick={() => setView("dial")}><Phone className="size-4" /> New call</Button>
      </div>
      {calls.length === 0 ? (
        <div className="mx-3 mt-4 rounded-[22px] border border-primary/10 bg-surface p-5 text-center shadow-soft">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-mist text-primary"><Phone className="size-6" /></div>
          <p className="mt-3 font-semibold">No calls yet</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">Enter a six-digit Flink number to start a voice or video call.</p>
          <Button className="mt-4" onClick={() => setView("dial")}>Open dial pad</Button>
        </div>
      ) : (
        <div className="mt-3">
          {calls.slice(0, 50).map((call) => {
            const Icon = call.mode === "video" ? Video : call.mode === "voice" ? Phone : Radio;
            return (
              <button key={call.id} type="button" onClick={() => void approach(call.peer, call.mode)} className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left hover:bg-mist">
                <div className="flex size-11 items-center justify-center rounded-full bg-mist text-primary"><Icon className="size-4" /></div>
                <div className="min-w-0 flex-1"><p className="font-semibold">{nameOf(call.peer)}</p><p className="text-sm text-muted">{call.direction === "out" ? "Outgoing" : "Incoming"} · {call.mode} · {call.status}</p></div>
                <span className="text-[11px] text-subtle tabular-nums">{formatTime(call.ts)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
