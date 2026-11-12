import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Film, Mic, Paperclip, Pause, Phone, Play, RefreshCw, Reply, Send, Smile, Trash2, UserPlus, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber, formatTime } from "@/lib/utils";
import type { ChatMessage } from "@/lib/flink/types";
import { flinkStorage } from "@/lib/flink/storage";

type VoicePreview = { file: File; url: string; duration: number };
type MediaPreview = { file: File; url: string; kind: "image" | "video" };
const MAX_VOICE_SECONDS = 10 * 60;
const MAX_VOICE_BYTES = 20_000_000;
const MAX_STICKER_BYTES = 2_000_000;
const MAX_STICKER_DIMENSION = 256;
const waveform = [4, 8, 13, 9, 16, 11, 19, 12, 7, 15, 10, 18, 8, 14, 6, 11, 17, 9, 13, 5, 10, 15, 8, 12];
const flinkStarterStickers = ["✦", "♥", "★", "☺", "☀", "⚡", "✓", "→"].map((mark, index) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="${["#7b1535", "#c44f58", "#b77b18", "#1b8064", "#175c8c", "#6040a0", "#343434", "#9a1b44"][index]}"/><text x="64" y="82" text-anchor="middle" font-size="68" fill="white">${mark}</text></svg>`)}`);

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
  const [emojiComposerOpen, setEmojiComposerOpen] = useState(false);
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false);
  const [stickers, setStickers] = useState<string[]>([]);
  const [favoriteStickers, setFavoriteStickers] = useState<string[]>([]);
  const [stickerTab, setStickerTab] = useState<"flink" | "saved" | "favorites">("flink");
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
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
    void Promise.all([
      flinkStorage.getSetting<string[]>("stickers", []).then(setStickers),
      flinkStorage.getSetting<string[]>("favorite_stickers", []).then(setFavoriteStickers),
    ]);
  }, []);
  useEffect(() => {
    if (!recordingVoice) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((seconds) => {
        if (seconds + 1 >= MAX_VOICE_SECONDS) window.setTimeout(stopVoiceRecording, 0);
        return Math.min(seconds + 1, MAX_VOICE_SECONDS);
      });
    }, 1000);
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
    const limit = kind === "image" ? 20_000_000 : 60_000_000;
    if (file.size > limit) {
      setRecordingError(kind === "image" ? "Keep photos under 20 MB." : "Keep videos under 60 MB.");
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
    if (file.size > MAX_VOICE_BYTES) {
      setRecordingError("Keep voice notes under 20 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > MAX_VOICE_SECONDS) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(url);
        setRecordingError("Voice notes can be up to 10 minutes.");
        return;
      }
      setVoicePreview({ file, url, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
      setPreviewPlaying(false);
    };
    audio.onerror = () => {
      setRecordingError("This audio format cannot be played in this browser.");
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(url);
    };
    audio.src = url;
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
      const mimeCandidates = [
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = typeof MediaRecorder.isTypeSupported === "function"
        ? mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
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
          if (blob.size > 0) {
            const type = blob.type || "audio/webm";
            const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
            prepareVoice(new File([blob], `voice-${Date.now()}.${extension}`, { type }));
          }
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
      setRecordingError(null);
      void audio.play().then(() => setPreviewPlaying(true)).catch(() => {
        setPreviewPlaying(false);
        setRecordingError("This voice note could not be played in this browser. Try another audio file or browser.");
      });
    } else {
      audio.pause();
      setPreviewPlaying(false);
    }
  }

  function sendPreview() {
    if (!voicePreview) return;
    void sendVoiceNote(voicePreview.file, replyingTo ?? undefined);
    clearVoicePreview();
    setReplyingTo(null);
  }

  async function importStickers(files?: FileList | File[]) {
    const selected = Array.from(files || []);
    const valid = selected.filter((file) => {
      const extension = file.name.toLowerCase().split(".").pop();
      return file.size <= MAX_STICKER_BYTES && (/^image\/(webp|gif|png)$/.test(file.type) || ["webp", "gif", "png"].includes(extension || ""));
    }).slice(0, 200);
    if (valid.length === 0) {
      setRecordingError("Choose WebP, GIF, or PNG sticker files.");
      return;
    }
    setRecordingError(null);
    try {
      const outcomes = await Promise.allSettled(valid.map((file) => file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif") ? fileToDataUrl(file) : compressSticker(file)));
      const imported = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
      if (imported.length === 0) {
        setRecordingError("The selected sticker images could not be decoded. Try PNG, GIF, or WebP files.");
        return;
      }
      const next = [...imported, ...stickers.filter((item) => !imported.includes(item))].slice(0, 200);
      setStickers(next);
      await flinkStorage.setSetting("stickers", next);
      setStickerTrayOpen(true);
      if (imported.length < valid.length) setRecordingError(`${valid.length - imported.length} sticker file(s) could not be imported.`);
    } catch {
      setRecordingError("Stickers could not be saved on this device. Please try again.");
    }
  }

  async function sendSavedSticker(dataUrl: string) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      if (blob.size > MAX_STICKER_BYTES) {
        setRecordingError("This sticker is too large to send.");
        return;
      }
      if (blob.type === "image/gif" || dataUrl.startsWith("data:image/gif")) {
        await sendGif(new File([blob], `sticker-${Date.now()}.gif`, { type: "image/gif" }), replyingTo ?? undefined);
      } else {
        const compressed = await compressSticker(new File([blob], `sticker-${Date.now()}.webp`, { type: blob.type || "image/webp" }));
        const compressedBlob = await (await fetch(compressed)).blob();
        await sendGif(new File([compressedBlob], `sticker-${Date.now()}.webp`, { type: "image/webp" }), replyingTo ?? undefined);
      }
      setRecordingError(null);
      setReplyingTo(null);
    } catch {
      setRecordingError("This sticker could not be prepared for sending. Try another image.");
    }
  }

  async function favoriteSticker(dataUrl: string) {
    const next = [dataUrl, ...favoriteStickers.filter((item) => item !== dataUrl)].slice(0, 96);
    setFavoriteStickers(next);
    await flinkStorage.setSetting("favorite_stickers", next);
  }

  if (!activeThread) return <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a conversation</div>;

  const peer = activeThread.peerNumber ?? activeThread.title;
  const peerContact = contacts.find((c) => c.flinkNumber === peer);
  const name = peerContact?.name || formatFlinkNumber(peer);
  const savedContact = contacts.some((contact) => contact.flinkNumber === peer);
  const status = peerStatuses.get(peer);
  const statusLabel = status?.online ? "Online" : status?.lastSeen ? `Last seen: ${formatTime(status.lastSeen)}` : callStatus || formatFlinkNumber(peer);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f8eef2]">
      <header className="relative flex items-center gap-1 bg-primary px-1 py-2 text-primary-fg shadow-sm">
        <Button variant="ghost" size="icon" className="text-primary-fg hover:bg-white/10" onClick={() => setView("history")} aria-label="Back"><ArrowLeft className="size-5" /></Button>
        {peerContact?.avatarDataUrl ? <img src={peerContact.avatarDataUrl} alt={`${name} avatar`} className="size-10 rounded-full object-cover" /> : <NumberAvatar seed={peer} label={name} size={40} />}
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold">{name}</p><p className="text-xs text-primary-fg/75">{statusLabel}</p></div>
        {/^[0-9]{6}$/.test(peer) && (
          <div className="relative ml-auto flex items-center gap-1 rounded-full bg-black/10 p-1">
            <Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => { setContactNameDraft(savedContact ? name : ""); setContactEditorOpen((open) => !open); }} aria-label={savedContact ? "Edit contact" : "Save contact"}>
              <UserPlus className="size-[18px]" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => void approach(peer, "voice")} aria-label="Audio call"><Phone className="size-[18px]" /></Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-full text-primary-fg hover:bg-white/15" onClick={() => void approach(peer, "video")} aria-label="Video call"><Video className="size-[18px]" /></Button>
            {contactEditorOpen && (
              <div className="absolute right-0 top-12 z-20 w-56 rounded-2xl bg-surface p-3 text-fg shadow-lg">
                <p className="mb-2 text-xs font-semibold text-muted">Name this contact</p>
                <input autoFocus value={contactNameDraft} onChange={(event) => setContactNameDraft(event.target.value)} placeholder="e.g. Maya" className="min-h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-primary" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void upsertContact(peer, contactNameDraft.trim() || peer); setContactEditorOpen(false); } }} />
                <Button size="sm" className="mt-2 w-full" onClick={() => { void upsertContact(peer, contactNameDraft.trim() || peer); setContactEditorOpen(false); }}>Save contact</Button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(rgba(123,21,53,0.07)_1px,transparent_1px)] [background-size:18px_18px] px-3 py-4">
        {messages.length === 0 && <div className="mx-auto mt-8 max-w-[280px] rounded-lg bg-[#fff5c4] px-4 py-2.5 text-center text-xs leading-relaxed text-[#6b5c32] shadow-sm">Messages stay on this device. They travel peer to peer once you are connected.</div>}
        {messages.map((m) => <div key={m.id} className={`mb-2 flex ${m.mine ? "justify-end" : "justify-start"}`}>
          <div className={`relative ${m.kind === "voice" ? "w-[min(94%,360px)]" : "max-w-[86%]"} rounded-[9px] px-3 py-2 text-[15px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.12)] ${m.mine ? "rounded-br-[2px] bg-[#f2d9e2] text-fg" : "rounded-bl-[2px] bg-white text-fg"}`} onContextMenu={(e) => { e.preventDefault(); setSelectedMessageId(m.id); setEmojiPickerOpen(true); }}>
            {m.replyTo && <div className="mb-2 rounded-lg border-l-2 border-primary bg-primary/5 px-2 py-1 text-xs text-muted"><span className="font-semibold">Replying to {m.replyTo.from}</span><p className="truncate">{m.replyTo.preview}</p></div>}
            {m.kind === "image" && m.imageUrl && <img src={m.imageUrl} alt="Photo message" className="mb-1 max-h-64 w-full rounded-[7px] object-cover" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add("media-load-error"); }} />}
            {m.kind === "voice" && m.audioUrl && <audio src={m.audioUrl} controls preload="metadata" className="mb-1 min-w-0 w-full accent-primary" onError={() => setRecordingError("A received voice note could not be loaded or played. The file may be unsupported or unavailable from the connection.")} />}
            {m.kind === "video" && m.videoUrl && <video src={m.videoUrl} controls className="mb-1 max-h-64 w-full rounded-[7px]" />}
            {m.kind === "gif" && m.imageUrl && <><img src={m.imageUrl} alt="Sticker" className="mb-1 max-h-40 max-w-40 rounded-[7px] object-contain" onError={(event) => { event.currentTarget.hidden = true; setRecordingError("This sticker image could not be displayed. Its data may be incomplete or unsupported."); }} /><button type="button" className="mb-1 text-[11px] font-semibold text-primary hover:underline" onClick={() => void favoriteSticker(m.imageUrl!)}>★ Save sticker</button></>}
            {m.kind === "file" && m.fileUrl && <a href={m.fileUrl} download={m.fileName || "file"} className="mb-1 flex items-center gap-2 rounded-lg bg-primary/10 p-2 text-sm text-primary"><FileText className="size-5 shrink-0" /><span className="max-w-[180px] truncate">{m.fileName || "File"}</span></a>}
            {(m.kind === "text" || m.caption) && <p className={m.kind === "text" ? "" : "mt-1 whitespace-pre-wrap"}>{renderLinkedText(m.kind === "text" ? m.text : m.caption)}</p>}
            {m.reactions && Object.keys(m.reactions).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{Object.entries(m.reactions).map(([emoji, reaction]) => <span key={emoji} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs"><span>{emoji}</span><span className="text-subtle">{reaction.count}</span></span>)}</div>}
            <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.mine ? "text-primary/70" : "text-muted"}`}><button type="button" className="mr-auto inline-flex items-center gap-1 text-primary hover:underline" onClick={() => setReplyingTo(m)}><Reply className="size-3" />Reply</button><span>{formatTime(m.ts)}</span><span>{m.mine && m.status === "pending" && "Waiting"}{m.mine && m.status === "sent" && "✓"}{m.mine && m.status === "delivered" && "✓✓"}{m.mine && m.status === "read" && <span className="text-primary-2">✓✓</span>}</span></div>
          </div>
        </div>)}
        <div ref={bottom} />
      </div>

      {sessionEnded && <div className="border-t border-border bg-surface px-4 py-3 text-center"><p className="text-sm text-muted">Chat connection ended</p><Button className="mt-2" onClick={() => void startNewSession(peer)}><RefreshCw className="mr-2 size-4" />Reconnect chat</Button></div>}

      {recordingError && <div className="border-t border-danger/20 bg-danger/5 px-3 py-2 text-center text-xs text-danger" role="status">{recordingError}<button type="button" className="ml-2 font-semibold underline" onClick={() => setRecordingError(null)}>Dismiss</button></div>}
      {voicePreview && <div className="border-t border-border bg-surface px-3 py-2"><audio ref={previewAudioRef} src={voicePreview.url} onLoadedMetadata={(e) => { const duration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0; setVoicePreview((preview) => preview ? { ...preview, duration } : preview); }} onEnded={() => setPreviewPlaying(false)} className="hidden" /><div className="flex w-full items-center gap-3 rounded-xl border border-primary/20 bg-[#fff8fa] px-3 py-2.5"><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" onClick={togglePreview} aria-label={previewPlaying ? "Pause voice note" : "Play voice note"}>{previewPlaying ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}</Button><div className="flex min-w-0 flex-1 items-center gap-[3px]">{waveform.map((height, index) => <span key={index} className="w-[3px] shrink-0 rounded-full bg-primary/60" style={{ height }} />)}</div><span className="min-w-[38px] text-right text-xs text-muted">{voicePreview.duration ? `${Math.round(voicePreview.duration)}s` : "Ready"}</span><Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-danger hover:bg-danger/10" onClick={clearVoicePreview} aria-label="Delete voice note"><Trash2 className="size-4" /></Button><Button type="button" size="icon" className="size-11 shrink-0 rounded-full" onClick={sendPreview} aria-label="Send voice note"><Send className="size-4" /></Button></div></div>}

      {mediaPreview && <div className="border-t border-border bg-surface px-3 py-3"><div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-[#fff8fa] p-2"><Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 z-10 size-8 rounded-full bg-black/55 text-white hover:bg-black/70" onClick={clearMediaPreview} aria-label="Cancel media preview"><X className="size-4" /></Button>{mediaPreview.kind === "image" ? <img src={mediaPreview.url} alt="Photo preview" className="max-h-64 w-full rounded-xl object-cover" onError={() => setRecordingError("This image format could not be previewed in this browser. The original file is still available to send.")} /> : <video src={mediaPreview.url} controls className="max-h-64 w-full rounded-xl bg-black" onError={() => setRecordingError("This video format could not be previewed in this browser. The original file is still available to send.")} />}<div className="mt-2 flex items-center gap-2"><input value={mediaCaption} onChange={(e) => setMediaCaption(e.target.value)} placeholder="Add a caption" className="min-h-10 flex-1 rounded-full border border-border bg-white px-4 text-sm text-fg outline-none focus:border-primary" aria-label="Media caption" /><Button type="button" size="icon" className="size-10 shrink-0 rounded-full" onClick={sendMediaPreview} aria-label="Send media"><Send className="size-4" /></Button></div></div></div>}
      {stickerTrayOpen && <div className="border-t border-border bg-surface px-3 py-3"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold text-fg">Stickers</p><p className="text-[11px] text-subtle">Tap to send · save favorites for quick access</p></div><Button type="button" size="sm" variant="secondary" onClick={() => gifRef.current?.click()}>Import many</Button></div><div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-mist p-1"><Button type="button" size="sm" variant={stickerTab === "flink" ? "default" : "ghost"} onClick={() => setStickerTab("flink")}>Flink</Button><Button type="button" size="sm" variant={stickerTab === "saved" ? "default" : "ghost"} onClick={() => setStickerTab("saved")}>Imported {stickers.length ? `(${stickers.length})` : ""}</Button><Button type="button" size="sm" variant={stickerTab === "favorites" ? "default" : "ghost"} onClick={() => setStickerTab("favorites")}>Favorites {favoriteStickers.length ? `(${favoriteStickers.length})` : ""}</Button></div><div className="grid max-h-72 grid-cols-5 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">{(stickerTab === "flink" ? flinkStarterStickers : stickerTab === "favorites" ? favoriteStickers : stickers).map((sticker, index) => <div key={`${sticker.slice(0, 20)}-${index}`} className="relative aspect-square rounded-2xl border border-border bg-mist p-1.5 hover:border-primary"><button type="button" className="size-full" onClick={() => void sendSavedSticker(sticker)}><img src={sticker} alt="Sticker" className="size-full object-contain" /></button>{stickerTab !== "favorites" && <button type="button" className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] text-white" onClick={() => void favoriteSticker(sticker)} aria-label="Save sticker to favorites">★</button>}</div>)}</div></div>}
      {replyingTo && <div className="flex items-center gap-2 border-t border-border bg-primary/5 px-3 py-2 text-xs"><Reply className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate">Replying to {replyingTo.from}: {replyingTo.text || replyingTo.caption || replyingTo.fileName || replyingTo.kind}</span><Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X className="size-4" /></Button></div>}
      <form className="flex items-end gap-2 border-t border-border bg-[#fff8fa] px-2 py-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void sendText(draft, replyingTo ?? undefined); setDraft(""); setReplyingTo(null); } }}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareMedia(f, "image"); e.target.value = ""; }} />
        <input ref={voiceRef} type="file" accept="audio/*" capture className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareVoice(f); e.target.value = ""; }} />
        <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareMedia(f, "video"); e.target.value = ""; }} />
        <input ref={gifRef} type="file" accept="*/*" multiple className="hidden" onChange={(e) => { void importStickers(e.target.files || undefined); e.target.value = ""; }} />
        <input ref={fileUploadRef} type="file" accept="*/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendFile(f); e.target.value = ""; }} />
        <div className="relative flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="size-10 rounded-full text-primary hover:bg-primary/10" onClick={() => setFileMenuOpen((open) => !open)} aria-label="Attach photo, video, or file"><Paperclip className="size-5" /></Button><Button type="button" variant="ghost" size="icon" className="size-10 rounded-full text-primary hover:bg-primary/10" onClick={() => setEmojiComposerOpen((open) => !open)} aria-label="Add emoji"><Smile className="size-5" /></Button><Button type="button" variant="ghost" size="sm" className="h-9 rounded-full px-2 font-bold text-[11px] text-primary hover:bg-primary/10" onClick={() => setStickerTrayOpen((open) => !open)} aria-label="Open sticker tray">Sticker</Button>{fileMenuOpen && <div className="absolute bottom-12 left-0 z-10 min-w-[150px] rounded-[16px] border border-border bg-surface p-2 shadow-lg"><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { fileRef.current?.click(); setFileMenuOpen(false); }}><FileText className="size-4 text-primary" />Photo</button><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { videoRef.current?.click(); setFileMenuOpen(false); }}><Film className="size-4 text-primary" />Video</button><button type="button" className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { fileUploadRef.current?.click(); setFileMenuOpen(false); }}><FileText className="size-4 text-primary" />File</button></div>}{emojiComposerOpen && <div className="absolute bottom-12 left-10 z-10 grid w-64 grid-cols-8 gap-1 rounded-2xl border border-border bg-surface p-3 shadow-lg">{["😀", "😂", "😍", "🥹", "😎", "😢", "😡", "👍", "👎", "👏", "🙏", "🔥", "🎉", "❤️", "✨", "🚀", "💬", "🤝", "✅", "❌", "🙌", "💯", "🤣", "😘"].map((emoji) => <button key={emoji} type="button" className="rounded-lg p-1 text-xl hover:bg-mist" onClick={() => { setDraft((value) => `${value}${emoji}`); setEmojiComposerOpen(false); }}>{emoji}</button>)}</div>}</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder={recordingVoice ? `Recording… ${recordingSeconds}s` : "Type a message"} className="max-h-28 min-h-10 flex-1 resize-none rounded-[22px] border border-border bg-white px-4 py-2.5 text-[15px] text-fg outline-none placeholder:text-muted focus:border-primary" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (draft.trim()) { void sendText(draft, replyingTo ?? undefined); setDraft(""); setReplyingTo(null); } } }} />
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
  return parts.map((part, index) => {
    if (!/^https?:\/\//.test(part)) return <span key={`${part}-${index}`}>{part}</span>;
    let host = part;
    let label = "Open shared link";
    try { const url = new URL(part); host = url.hostname.replace(/^www\./, ""); if (url.hash.startsWith("#room/")) label = "Join Flink group room"; } catch { /* keep raw URL */ }
    return <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="my-1 flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-primary no-underline"><span className="flex size-7 items-center justify-center rounded-lg bg-primary/10"><LinkIcon /></span><span className="min-w-0"><span className="block text-xs font-semibold">{label}</span><span className="block max-w-[220px] truncate text-[11px] opacity-70">{host}</span></span></a>;
  });
}

function LinkIcon() { return <span className="text-xs">↗</span>; }

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}


function compressSticker(file: File) {
  return new Promise<string>((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || MAX_STICKER_DIMENSION;
      const height = image.naturalHeight || MAX_STICKER_DIMENSION;
      const scale = Math.min(1, MAX_STICKER_DIMENSION / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(sourceUrl);
      resolve(canvas.toDataURL("image/webp", 0.72));
    };
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error("Could not read sticker")); };
    image.src = sourceUrl;
  });
}
