import { useState } from "react";
import { Copy, ExternalLink, Link2, MessageCircle, Phone, Video, Users, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFlink } from "@/lib/flink/store";
import { NumberAvatar } from "./mark";
import { formatFlinkNumber } from "@/lib/utils";
import type { CommMode } from "@/lib/flink/types";

export function RoomsView() {
  const { startRoom, profile, rooms } = useFlink();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<CommMode>("video");
  const [link, setLink] = useState<string | null>(null);

  function create() {
    const room = startRoom(mode, title || `${mode} room`);
    const url = `${room.url}&host=${profile?.flinkNumber ?? ""}`;
    setLink(url);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Room link copied");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Link rooms</p>
      <h2 className="font-display mt-1 text-2xl font-medium">Share a room, not an identity</h2>
      <p className="mt-2 mb-6 text-sm leading-relaxed text-muted">
        Only you need a Flink number. Guests join from the link, pick a name, and leave when it is over.
      </p>
      <Label htmlFor="rtitle">Room name</Label>
      <Input
        id="rtitle"
        placeholder="Thursday studio"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-4"
      />
      <div className="mb-5 grid grid-cols-3 gap-2">
        {(
          [
            ["video", Video, "Video"],
            ["voice", Phone, "Voice"],
            ["chat", MessageCircle, "Chat"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`flex flex-col items-center gap-2 rounded-[16px] border px-2 py-3 text-sm font-semibold transition-colors ${
              mode === id ? "border-primary bg-mist text-primary" : "border-border bg-surface text-muted"
            }`}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>
      <Button className="w-full" onClick={create}>
        <Link2 className="size-4" />
        Create room link
      </Button>
      {link && (
        <div className="mt-4 rounded-[20px] border border-border bg-surface p-4">
          <p className="break-all text-sm text-muted">{link}</p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" variant="secondary" onClick={() => void copy()}>
              <Copy className="size-4" /> Copy
            </Button>
            <Button className="flex-1" onClick={() => (window.location.href = link)}>
              Open as host
            </Button>
          </div>
        </div>
      )}
      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted uppercase">Saved room links</p>
        {rooms.length === 0 ? <p className="text-sm text-muted">Created links will stay here for later host re-entry.</p> : rooms.map((room) => <div key={room.id} className="mb-2 rounded-[18px] border border-border bg-surface p-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{room.title}</p><p className="text-xs text-muted">{room.mode} · {new Date(room.lastOpenedAt).toLocaleString()}</p></div><Button size="icon" variant="ghost" aria-label={`Open ${room.title}`} onClick={() => { window.location.href = `${room.url}&host=${room.hostNumber ?? profile?.flinkNumber ?? ""}`; }}><ExternalLink className="size-4" /></Button><Button size="icon" variant="ghost" aria-label={`Copy ${room.title}`} onClick={() => void navigator.clipboard.writeText(`${room.url}&host=${room.hostNumber ?? profile?.flinkNumber ?? ""}`)}><Copy className="size-4" /></Button></div></div>)}
      </section>
    </div>
  );
}

export function RoomParticipants() {
  const { roomParticipants } = useFlink();
  const participants = Array.from(roomParticipants.values());
  
  if (participants.length === 0) return null;
  
  return (
    <div className="flex -space-x-2">
      {participants.slice(0, 5).map((p) => (
        <NumberAvatar key={p.flinkNumber} seed={p.flinkNumber} label={p.name || formatFlinkNumber(p.flinkNumber)} size={32} />
      ))}
      {participants.length > 5 && (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-mist text-xs font-semibold">
          +{participants.length - 5}
        </div>
      )}
    </div>
  );
}

export function ScreenShareIndicator() {
  const { isScreenSharing } = useFlink();
  
  if (!isScreenSharing) return null;
  
  return (
    <div className="flex items-center gap-2 rounded-full bg-primary/20 px-3 py-1 text-sm text-primary-fg">
      <Monitor className="size-4" />
      Screen sharing active
    </div>
  );
}
