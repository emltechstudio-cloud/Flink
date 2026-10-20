import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Film, Mic, Paperclip, Pause, Phone, Play, RefreshCw, Send, Trash2, UserPlus, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";

type VoicePreview = { file: File; url: string; duration: number };
type MediaPreview = { file: File; url: string; kind: "image" | "video" };
const waveform = [4, 8, 13, 9, 16, 11, 19, 12, 7, 15, 10, 18, 8, 14, 6, 11, 17, 9, 13, 5, 10, 15, 8, 12];

export function ChatView() {
  const {
    activeThread, messages, contacts, sendText, sendImage, sendVoiceNote, sendVideo, sendGif, sendFile,
    addReaction, deleteMessage, setView, approach, callStatus, peerStatuses, sessionEnded, startNewSession, upsertContact,
  } = useFlink();
  const [draft, setDraft] = useState("");
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voicePreview, setVoicePreview] = useState<VoicePreview | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [mediaCaption, setMediaCaption] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const gifRef = useRef<HTMLInputElement>(null);
  const fileUploadRef = useRef<HTMLInputElement>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const recordingFinalizedRef = useRef(false);
  const recordingStoppingRef = useRef(false);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const previewAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = bottom.current;
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, voicePreview]);
  useEffect(() => {
    if (!recordingVoice) return;
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recordingVoice]);
  useEffect(() => {
    return () => {
      const recorder = voiceRecorderRef.current;
      if (recorder?.state === "recording") {
        try { recorder.stop(); } catch { /* component is leaving */ }
      }
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof URL.revokeObjectURL === "function") {
        previewUrlsRef.current.forEach((url) => {
          try { URL.revokeObjectURL(url); } catch { /* browser cleanup is best effort */ }
        });
      }
    };
    // Cleanup must only run when ChatView unmounts, not whenever a preview changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearVoicePreview() {
    setVoicePreview(null);
    setPreviewPlaying(false);
  }

  function prepareMedia(file: File, kind: "image" | "video") {
    const limit = kind === "image" ? 180_000 : 50_000_000;
    if (file.size > limit) {
      setRecordingError(kind === "image" ? "Keep photos under 180 KB for peer transfer." : "Keep videos under 50 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    setMediaPreview({ file, url, kind });
    setMediaCaption("");
    setFileMenuOpen(false);
  }

  function clearMediaPreview() {
    setMediaPreview(null);
    setMediaCaption("");
  }

  function sendMediaPreview() {
    if (!mediaPreview) return;
    const pending = mediaPreview;
    const caption = mediaCaption.trim();
    setMediaPreview(null);
    setMediaCaption("");
    if (pending.kind === "image") void sendImage(pending.file, caption);
    else void sendVideo(pending.file, caption);
  }

  function prepareVoice(file: File) {
    if (file.size > 5_000_000) {
      setRecordingError("Keep voice notes under 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    setVoicePreview({ file, url, duration: 0 });
    setPreviewPlaying(false);
  }

  function stopVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder || recordingStoppingRef.current) return;
    if (recorder.state !== "recording") {
      setRecordingVoice(false);
      return;
    }
    recordingStoppingRef.current = true;
    try { recorder.stop(); } catch {
      recordingStoppingRef.current = false;
      setRecordingVoice(false);
      setRecordingError("The recording could not be stopped. Please try again.");
    }
  }

  async function toggleVoiceRecording() {
    if (recordingVoice) {
      stopVoiceRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceRef.current?.click();
      return;
    }
    const activeRecorder = voiceRecorderRef.current;
    if (activeRecorder) {
      stopVoiceRecording();
      return;
    }
    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      recordingFinalizedRef.current = false;
      recordingStoppingRef.current = false;
      const preferredMime = "audio/webm;codecs=opus";
      const mimeType = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(preferredMime)
        ? preferredMime
        : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceChunksRef.current = [];
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => { if (event.data.size > 0) voiceChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        if (recordingFinalizedRef.current) return;
        recordingFinalizedRef.current = true;
        try {
          const chunks = voiceChunksRef.current.slice();
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          stream.getTracks().forEach((track) => track.stop());
          voiceStreamRef.current = null;
          voiceRecorderRef.current = null;
          recordingStoppingRef.current = false;
          setRecordingVoice(false);
          if (blob.size > 0) prepareVoice(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));
          else setRecordingError("No audio was captured. Please try recording again.");
        } catch {
          voiceStreamRef.current = null;
          voiceRecorderRef.current = null;
          recordingStoppingRef.current = false;
          setRecordingVoice(false);
          setRecordingError("The voice note could not be prepared. Please try again.");
        }
      };
      recorder.onerror = () => {
        recordingFinalizedRef.current = true;
        stream.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        voiceRecorderRef.current = null;
        recordingStoppingRef.current = false;
        setRecordingVoice(false);
        setRecordingError("The microphone stopped unexpectedly. Please try again.");
      };
      voiceRecorderRef.current = recorder;
      recorder.start();
      setRecordingVoice(true);
    } catch {
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
      voiceRecorderRef.current = null;
      setRecordingVoice(false);
      setRecordingError("Microphone access is unavailable in this browser.");
    }
  }

  function togglePreview() {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => setPreviewPlaying(true)).catch(() => setPreviewPlaying(false));
    } else {
      audio.pause();
      setPreviewPlaying(false);
    }
  }

  function sendPreview() {
    if (!voicePreview) return;
    void sendVoiceNote(voicePreview.file);
    clearVoicePreview();
  }

  if (!activeThread) return <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a conversation</div>;

  const peer = activeThread.peerNumber ?? activeThread.title;
  const name = contacts.find((c) => c.flinkNumber === peer)?.name || formatFlinkNumber(peer);
  const status = peerStatuses.get(peer);
  const statusLabel = status?.online ? "Online" : status?.lastSeen ? `Last seen: ${formatTime(status.lastSeen)}` : callStatus || formatFlinkNumber(peer);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8eef2]">
      <header className="relative flex items-center gap-1 bg-primary px-1 py-2 text-primary-fg shadow-sm">
        <Button variant="ghost" size="icon" className="text-primary-fg hover:bg-white/10" onClick={() => setView("history")} aria-label="Back"><ArrowLeft className="size-5" /></Button>
        <NumberAvatar seed={peer} label={name} size={40} />
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold">{name}</p><p className="text-xs text-primary-fg/75">{statusLabel}</p></div>
        {/^[0-9]{6}$/.test(peer) && <div className="ml-auto flex items-center gap-1 rounded-full bg-black/10 p-1"><Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => void upsertContact(peer, name)} aria-label="Save contact"><UserPlus className="size-[18px]" /></Button><Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => void approach(peer, "voice")} aria-label="Audio call"><Phone className="size-[18px]" /></Button><Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => void approach(peer, "video")} aria-label="Video call"><Video className="size-[18px]" /></Button></div>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(rgba(123,21,53,0.07)_1px,transparent_1px)] [background-size:18px_18px] px-3 py-4">
        {messages.length === 0 && <div className="mx-auto mt-8 max-w-[280px] rounded-lg bg-[#fff5c4] px-4 py-2.5 text-center text-xs leading-relaxed text-[#6b5c32] shadow-sm">Messages stay on this device. They travel peer to peer once you are connected.</div>}
        {messages.map((m) => <div key={m.id} className={`mb-2 flex ${m.mine ? "justify-end" : "justify-start"}`}>
          <div className={`relative ${m.kind === "voice" ? "w-[min(94%,360px)]" : "max-w-[86%]"} rounded-[9px] px-3 py-2 text-[15px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.12)] ${m.mine ? "rounded-br-[2px] bg-[#f2d9e2] text-fg" : "rounded-bl-[2px] bg-white text-fg"}`} onContextMenu={(e) => { e.preventDefault(); setSelectedMessageId(m.id); setEmojiPickerOpen(true); }}>
            {m.kind === "image" && m.imageUrl && <img src={m.imageUrl} alt="Photo message" className="mb-1 max-h-64 w-full rounded-[7px] object-cover" />}
            {m.kind === "voice" && m.audioUrl && <audio src={m.audioUrl} controls className="mb-1 min-w-0 w-full accent-primary" />}
            {m.kind === "video" && m.videoUrl && <video src={m.videoUrl} controls className="mb-1 max-h-64 w-full rounded-[7px]" />}
            {m.kind === "gif" && m.imageUrl && <img src={m.imageUrl} alt="GIF" className="mb-1 max-h-64 rounded-[7px]" />}
            {m.kind === "file" && m.fileUrl && <a href={m.fileUrl} download={m.fileName || "file"} className="mb-1 flex items-center gap-2 rounded-lg bg-primary/10 p-2 text-sm text-primary"><FileText className="size-5 shrink-0" /><span className="max-w-[180px] truncate">{m.fileName || "File"}</span></a>}
            {(m.kind === "text" || m.caption) && <p className={m.kind === "text" ? "" : "mt-1 whitespace-pre-wrap"}>{renderLinkedText(m.kind === "text" ? m.text : m.caption)}</p>}
            {m.reactions && Object.keys(m.reactions).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{Object.entries(m.reactions).map(([emoji, reaction]) => <span key={emoji} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs"><span>{emoji}</span><span className="text-subtle">{reaction.count}</span></span>)}</div>}
            <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.mine ? "text-primary/70" : "text-muted"}`}><span>{formatTime(m.ts)}</span><span>{m.mine && m.status === "sent" && "✓"}{m.mine && m.status === "delivered" && "✓✓"}{m.mine && m.status === "read" && <span className="text-primary-2">✓✓</span>}</span></div>
          </div>
        </div>)}
        <div ref={bottom} />
      </div>

      {sessionEnded && <div className="border-t border-border bg-surface px-4 py-3 text-center"><p className="text-sm text-muted">Chat connection ended</p><Button className="mt-2" onClick={() => void startNewSession(peer)}><RefreshCw className="mr-2 size-4" />Reconnect chat</Button></div>}

      {recordingError && <div className="border-t border-danger/20 bg-danger/5 px-3 py-2 text-center text-xs text-danger" role="status">{recordingError}<button type="button" className="ml-2 font-semibold underline" onClick={() => setRecordingError(null)}>Dismiss</button></div>}
      {voicePreview && <div className="border-t border-border bg-surface px-3 py-2"><audio ref={previewAudioRef} src={voicePreview.url} onLoadedMetadata={(e) => { const duration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0; setVoicePreview((preview) => preview ? { ...preview, duration } : preview); }} onEnded={() => setPreviewPlaying(false)} className="hidden" /><div className="flex w-full items-center gap-3 rounded-xl border border-primary/20 bg-[#fff8fa] px-3 py-2.5"><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" onClick={togglePreview} aria-label={previewPlaying ? "Pause voice note" : "Play voice note"}>{previewPlaying ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</Button><div className="flex min-w-0 flex-1 items-center gap-[3px]">{waveform.map((height, index) => <span key={index} className="w-[3px] shrink-0 rounded-full bg-primary/60" style={{ height }} />)}</div><span className="min-w-[38px] text-right text-xs text-muted">{voicePreview.duration ? `${Math.round(voicePreview.duration)}s` : "Ready"}</span><Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-danger hover:bg-danger/10" onClick={clearVoicePreview} aria-label="Delete voice note"><Trash2 className="size-4" /></Button><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" onClick={sendPreview} aria-label="Send voice note"><Send className="size-4" /></Button></div></div>}

      {mediaPreview && <div className="border-t border-border bg-surface px-3 py-3"><div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[#fff8fa] p-2"><Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 z-10 size-8 rounded-full bg-black/55 text-white hover:bg-black/70" onClick={clearMediaPreview} aria-label="Cancel media preview"><X className="size-4" /></Button>{mediaPreview.kind === "image" ? <img src={mediaPreview.url} alt="Photo preview" className="max-h-64 w-full rounded-xl object-cover" /> : <video src={mediaPreview.url} controls className="max-h-64 w-full rounded-xl bg-black" />}<div className="mt-2 flex items-center gap-2"><input value={mediaCaption} onChange={(e) => setMediaCaption(e.target.value)} placeholder="Add a caption" className="min-h-10 flex-1 rounded-full border border-border bg-white px-4 text-sm text-fg outline-none focus:border-primary" aria-label="Media caption" /><Button type="button" size="icon" className="size-10 shrink-0 rounded-full" onClick={sendMediaPreview} aria-label="Send media"><Send className="size-4" /></Button></div></div></div>}
      <form className="flex items-end gap-2 border-t border-border bg-[#fff8fa] px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void sendText(draft); setDraft(""); } }}>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareMedia(f, "image"); e.target.value = ""; }} />
        <input ref={voiceRef} type="file" accept="audio/*" capture className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareVoice(f); e.target.value = ""; }} />
        <input ref={videoRef} type="file" accept="video/*" capture className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareMedia(f, "video"); e.target.value = ""; }} />
        <input ref={gifRef} type="file" accept="image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendGif(f); e.target.value = ""; }} />
        <input ref={fileUploadRef} type="file" accept="*/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendFile(f); e.target.value = ""; }} />
        <div className="relative flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="size-10 rounded-full text-primary hover:bg-primary/10" onClick={() => setFileMenuOpen((open) => !open)} aria-label="Attach photo, video, or file"><Paperclip className="size-5" /></Button><Button type="button" variant="ghost" size="sm" className="h-9 rounded-full px-2 font-bold text-[11px] text-primary hover:bg-primary/10" onClick={() => gifRef.current?.click()} aria-label="Send GIF">GIF</Button>{fileMenuOpen && <div className="absolute bottom-12 left-0 z-10 min-w-[150px] rounded-[16px] border border-border bg-surface p-2 shadow-lg"><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { fileRef.current?.click(); setFileMenuOpen(false); }}><FileText className="size-4 text-primary" />Photo</button><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { videoRef.current?.click(); setFileMenuOpen(false); }}><Film className="size-4 text-primary" />Video</button><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { fileUploadRef.current?.click(); setFileMenuOpen(false); }}><FileText className="size-4 text-primary" />File</button></div>}</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder={recordingVoice ? `Recording… ${recordingSeconds}s` : "Type a message"} className="max-h-28 min-h-10 flex-1 resize-none rounded-[22px] border border-border bg-white px-4 py-2.5 text-[15px] text-fg outline-none placeholder:text-muted focus:border-primary" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (draft.trim()) { void sendText(draft); setDraft(""); } } }} />
        {!draft.trim() && <Button type="button" variant="ghost" size="icon" className={`size-10 rounded-full ${recordingVoice ? "bg-danger text-white hover:bg-danger/90" : "text-primary hover:bg-primary/10"}`} onClick={() => void toggleVoiceRecording()} aria-label={recordingVoice ? "Stop recording" : "Record voice note"}>{recordingVoice ? <Pause className="size-4" /> : <Mic className="size-4" />}</Button>}
        {draft.trim() && <Button type="submit" size="icon" className="size-10 rounded-full" aria-label="Send message"><Send className="size-4" /></Button>}
      </form>

      {emojiPickerOpen && selectedMessageId && <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-[20px] border border-border bg-surface p-4 shadow-lg"><p className="mb-2 text-sm">Message actions</p><div className="grid grid-cols-6 gap-2">{["👍", "❤️", "🔥", "😂", "😢", "👏", "✨", "💯", "🎉", "🙏", "🚀", "💖"].map((emoji) => <button key={emoji} type="button" className="rounded-full p-1 text-2xl hover:bg-bg" onClick={() => { void addReaction(selectedMessageId, emoji); setEmojiPickerOpen(false); setSelectedMessageId(null); }}>{emoji}</button>)}</div><Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => { void deleteMessage(selectedMessageId); setEmojiPickerOpen(false); setSelectedMessageId(null); }}>Delete for me</Button><Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => { setEmojiPickerOpen(false); setSelectedMessageId(null); }}>Cancel</Button></div>}
    </div>
  );
}

function renderLinkedText(value?: string) {
  if (!value) return null;
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="break-all text-primary underline">{part}</a> : <span key={`${part}-${index}`}>{part}</span>);
}
