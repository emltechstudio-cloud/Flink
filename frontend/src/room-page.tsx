import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Monitor, MonitorOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { FlinkMark, NumberAvatar } from "./components/flink/mark";
import { FlinkSession } from "./lib/flink/session";
import { useFlink } from "./lib/flink/store";
import { flinkStorage } from "./lib/flink/storage";
import { randomId } from "./lib/utils";
import type { ChatMessage, CommMode } from "./lib/flink/types";

export function RoomPage({ id, mode: rawMode, title }: { id: string; mode: string; title: string }) {
  const mode = (['chat', 'voice', 'video'].includes(rawMode) ? rawMode : 'video') as CommMode;
  const profile = useFlink((s) => s.profile);
  const boot = useFlink((s) => s.boot);
  const [name, setName] = useState(profile?.flinkNumber ?? '');
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Waiting');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [remotes, setRemotes] = useState<Array<{ id: string; stream: MediaStream }>>([]);
  const [screenSharing, setScreenSharing] = useState(false);
  const sessionRef = useRef<FlinkSession | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const guestId = useRef(`guest-${randomId(6)}`);

  useEffect(() => { void useFlink.getState().bootApp(); }, []);
  useEffect(() => {
    if (profile?.flinkNumber) setName((current) => current || profile.flinkNumber);
  }, [profile?.flinkNumber]);
  useEffect(() => () => {
    sessionRef.current?.close();
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function join() {
    try {
      const display = name.trim() || guestId.current;
      let stream: MediaStream | undefined;
      if (mode !== 'chat') {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser does not support camera or microphone access.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: mode === 'video' ? { facingMode: 'user' } : false,
        });
        cameraRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;
      }
      setMessages(await flinkStorage.getMessages(id));
      const session = new FlinkSession(id, profile?.accessToken, mode, {
        onStatus: setStatus,
        onChat: (from, data) => {
          const message: ChatMessage = {
            id: data.id,
            threadId: id,
            from,
            kind: data.kind === 'image' ? 'image' : data.kind === 'video' ? 'video' : data.kind === 'voice' ? 'voice' : data.kind === 'file' ? 'file' : 'text',
            text: data.text,
            caption: data.caption,
            imageUrl: data.image,
            audioUrl: data.audio,
            videoUrl: data.video,
            fileUrl: data.file,
            fileName: data.fileName,
            ts: data.ts,
            mine: false,
          };
          void flinkStorage.putMessage(message);
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        },
        onPeerMedia: (peerId, media) => setRemotes((current) => [...current.filter((item) => item.id !== peerId), { id: peerId, stream: media }]),
        onPeerLeft: (peerId) => setRemotes((current) => current.filter((item) => item.id !== peerId)),
        onConnected: () => setStatus('Connected'),
      }, display);
      await session.start(stream);
      sessionRef.current = session;
      setJoined(true);
      void display;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not join. Check your camera and microphone permissions.');
    }
  }

  async function toggleScreenShare() {
    const session = sessionRef.current;
    if (!session || mode !== 'video') return;
    if (screenSharing) {
      screenRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current = null;
      if (cameraRef.current) session.attachLocal(cameraRef.current);
      session.sendScreenShare(false);
      setScreenSharing(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => void toggleScreenShare());
      session.attachLocal(stream);
      session.sendScreenShare(true);
      setScreenSharing(true);
    } catch {
      setStatus('Screen sharing was cancelled');
    }
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    const message: ChatMessage = { id: randomId(8), threadId: id, from: name || 'You', kind: 'text', text, ts: Date.now(), mine: true };
    sessionRef.current?.sendChat({ kind: 'text', text, id: message.id, ts: message.ts });
    void flinkStorage.putMessage(message);
    setMessages((current) => [...current, message]);
    setDraft('');
  }

  if (!joined) return (
    <div className="flex min-h-dvh items-center justify-center bg-mist px-5">
      <div className="w-full max-w-sm rounded-[28px] border border-border bg-surface p-6 shadow-soft">
        <div className="mb-4 flex items-center gap-2 text-primary"><FlinkMark size={22} /><span className="font-display text-xl">Flink room</span></div>
        <h1 className="font-display text-2xl font-medium">{title}</h1>
        <p className="mt-1 mb-5 text-sm text-muted">{mode} room. Guests can join without a Flink number.</p>
        <Label htmlFor="guest">Name in this room</Label>
        <Input id="guest" value={name} onChange={(event) => setName(event.target.value)} className="mb-4" />
        <Button className="w-full" onClick={() => void join()} disabled={boot === 'loading'}>{boot === 'loading' ? 'Opening room…' : 'Join room'}</Button>
        {status !== 'Waiting' && <p role="status" className="mt-3 text-center text-sm text-muted">{status}</p>}
        <button className="mt-4 w-full text-sm text-muted" onClick={() => { window.location.hash = ''; }}>Back to Flink</button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div><p className="font-semibold">{title}</p><p className="text-xs text-muted">{status}</p></div>
        <Button variant="danger" size="sm" onClick={() => { sessionRef.current?.close(); window.location.hash = ''; }}>Leave</Button>
      </header>
      {mode !== 'chat' && <div className="relative min-h-[240px] flex-1 bg-call">
        {mode === 'video' && remotes.length > 0 ? <div className="grid h-full auto-rows-fr grid-cols-1 gap-1 sm:grid-cols-2">{remotes.map((remote) => <RemoteVideo key={remote.id} stream={remote.stream} />)}</div> : <div className="flex h-full items-center justify-center"><NumberAvatar seed={id} label={title} size={88} /></div>}
        {mode === 'video' && <video ref={localRef} autoPlay muted playsInline className="absolute right-3 bottom-3 h-28 w-20 rounded-[12px] object-cover" />}
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-4">
          <Button size="round" className="bg-call-fg/15 text-call-fg" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => { sessionRef.current?.mute(!muted); setMuted((value) => !value); }}>{muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}</Button>
          {mode === 'video' && <Button size="round" className="bg-call-fg/15 text-call-fg" aria-label={videoOff ? 'Camera on' : 'Camera off'} onClick={() => { sessionRef.current?.setVideo(videoOff); setVideoOff((value) => !value); }}>{videoOff ? <VideoOff className="size-5" /> : <Video className="size-5" />}</Button>}
          {mode === 'video' && <Button size="round" className="bg-call-fg/15 text-call-fg" aria-label={screenSharing ? 'Stop sharing' : 'Share screen'} onClick={() => void toggleScreenShare()}>{screenSharing ? <MonitorOff className="size-5" /> : <Monitor className="size-5" />}</Button>}
          <Button size="round" variant="danger" aria-label="Leave room" onClick={() => { sessionRef.current?.close(); window.location.hash = ''; }}><PhoneOff className="size-5" /></Button>
        </div>
      </div>}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.map((message) => <div key={message.id} className={`mb-2 flex ${message.mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-[18px] px-3 py-2 text-sm ${message.mine ? 'bg-primary text-primary-fg' : 'border border-border bg-surface'}`}>{!message.mine && <p className="mb-0.5 text-[10px] opacity-70">{message.from}</p>}{message.kind === 'image' && message.imageUrl && <img src={message.imageUrl} alt="Room photo" className="mb-1 max-h-64 rounded-xl" />}{message.kind === 'video' && message.videoUrl && <video src={message.videoUrl} controls className="mb-1 max-h-64 rounded-xl" />}{message.kind === 'voice' && message.audioUrl && <audio src={message.audioUrl} controls className="mb-1 max-w-full" />}{message.kind === 'file' && message.fileUrl && <a href={message.fileUrl} download={message.fileName || 'file'} className="underline">{message.fileName || 'Download file'}</a>}{renderLinkedText(message.text || message.caption)}</div></div>)}
        </div>
        <form className="flex gap-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Temporary message" />
          <Button type="submit" disabled={!draft.trim()}>Send</Button>
        </form>
      </div>
    </div>
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />;
}

function renderLinkedText(value?: string) {
  if (!value) return null;
  return value.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="break-all underline">{part}</a> : <span key={`${part}-${index}`}>{part}</span>);
}
