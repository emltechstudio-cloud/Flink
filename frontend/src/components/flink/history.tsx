import { Link2, MessageCircle, Phone, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";

export function HistoryView() {
  const { threads, calls, contacts, openThread, setView } = useFlink();
  const nameOf = (n: string) => contacts.find((c) => c.flinkNumber === n)?.name || formatFlinkNumber(n);

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-24">
      <section className="mx-1 mt-2 overflow-hidden rounded-[26px] bg-primary px-5 py-5 text-primary-fg shadow-lift">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary-fg/70 uppercase">Flink · your internet phone</p>
        <h1 className="font-display mt-2 max-w-[270px] text-2xl leading-tight">Reach people directly, without a phone number.</h1>
        <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-primary-fg/75">Chat privately, call in one tap, or make a room link for anyone else.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button size="sm" variant="secondary" className="border-0 bg-white/15 text-primary-fg hover:bg-white/25" onClick={() => setView("dial")}><MessageCircle className="size-4" /> Chat</Button>
          <Button size="sm" variant="secondary" className="border-0 bg-white/15 text-primary-fg hover:bg-white/25" onClick={() => setView("calls")}><Phone className="size-4" /> Call</Button>
          <Button size="sm" variant="secondary" className="border-0 bg-white/15 text-primary-fg hover:bg-white/25" onClick={() => setView("rooms")}><Link2 className="size-4" /> Room</Button>
        </div>
      </section>
      <section className="pt-2">
        <div className="flex items-center justify-between px-3 py-2"><div><p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Chats</p><p className="mt-1 text-sm text-muted">Your private conversations</p></div><span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-primary">{threads.length}</span></div>
        {threads.length === 0 && calls.length === 0 && (
          <div className="mx-3 mt-4 rounded-[22px] border border-primary/10 bg-surface p-4 shadow-soft">
            <p className="font-semibold">Your internet phone is ready.</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Start with a six-digit Flink number. Then choose chat, voice, or video. You can also make a room link for people who do not have Flink.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => setView("dial")}>
                <MessageCircle className="size-4" /> New chat
              </Button>
              <Button type="button" variant="secondary" onClick={() => setView("rooms")}>
                <Radio className="size-4" /> New room
              </Button>
            </div>
          </div>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => void openThread(t)}
            className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left hover:bg-mist"
          >
            <NumberAvatar seed={t.peerNumber || t.id} label={t.title} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold">{t.kind === "direct" ? nameOf(t.peerNumber ?? t.title) : t.title}</p>
                <span className="text-[11px] text-subtle tabular-nums">{formatTime(t.lastTs)}</span>
              </div>
              <p className="truncate text-sm text-muted">{t.lastText}</p>
            </div>
          </button>
        ))}
      </section>
      {threads.length > 0 && <p className="px-3 pt-6 text-center text-xs text-muted">Calls live in the Calls tab.</p>}
      <Button type="button" size="sm" className="fixed right-[max(1rem,calc(50% - 184px))] bottom-[76px] z-20 rounded-full px-4 shadow-[0_10px_24px_rgba(123,21,53,0.24)]" onClick={() => setView("dial")}><MessageCircle className="size-4" /> New chat</Button>
    </div>
  );
}
