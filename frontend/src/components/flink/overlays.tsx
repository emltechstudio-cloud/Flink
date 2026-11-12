import { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronDown, Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff, Monitor, MonitorOff, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberAvatar } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";

export function IncomingSheet() {
  const { incoming, acceptIncoming, declineIncoming, contacts, roomParticipants } = useFlink();
  if (!incoming) return null;
  const name =
    incoming.groupName ||
    contacts.find((c) => c.flinkNumber === incoming.from)?.name ||
    formatFlinkNumber(incoming.from);
  const verb =
    incoming.mode === "voice" ? "a voice call" : incoming.mode === "video" ? "a video call" : "to talk";
  const participantCount = roomParticipants.size;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/50 p-4 md:items-center">
      <div className="w-full max-w-sm rounded-[28px] bg-surface p-6 text-center shadow-[0_8px_32px_rgba(123,21,53,0.2)]">
        <NumberAvatar seed={incoming.from} label={name} size={72} />
        <h2 className="font-display mt-4 text-2xl font-medium">{name}</h2>
        <p className="mt-1 text-sm text-muted">
          {incoming.groupName ? `${formatFlinkNumber(incoming.from)} in ${incoming.groupName}` : formatFlinkNumber(incoming.from)}{" "}
          wants {verb}.
        </p>
        {participantCount > 0 && (
          <p className="mt-2 flex items-center justify-center gap-1 text-sm text-muted">
            <Users className="size-4" />
            {participantCount} participant{participantCount > 1 ? "s" : ""}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={declineIncoming}>
            Decline
          </Button>
          <Button className="flex-1" onClick={() => void acceptIncoming()}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CallOverlay() {
  const { outgoing, session, callStatus, callConnectedAt, remoteMedia, hangup, cancelOutgoing, muted, videoOff, toggleMute, toggleVideo, toggleScreenShare, isScreenSharing, screenStream, roomParticipants, contacts } =
    useFlink();
  const [elapsed, setElapsed] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [audioOutputId, setAudioOutputId] = useState("default");
  const [speakerOn, setSpeakerOn] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const inCall = Boolean(session && outgoing && (outgoing.mode === "voice" || outgoing.mode === "video"));
  const audioRouteSupported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  useEffect(() => {
    if (localRef.current && session?.local) localRef.current.srcObject = session.local;
  }, [session, session?.local, inCall]);

  useEffect(() => {
    const first = remoteMedia[0];
    if (remoteRef.current && first) remoteRef.current.srcObject = first.stream;
  }, [remoteMedia]);

  useEffect(() => {
    setMinimized(false);
  }, [outgoing?.sessionId]);

  useEffect(() => {
    if (!inCall || !audioRouteSupported || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const updateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;
        setAudioOutputs(devices.filter((device) => device.kind === "audiooutput").map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio output ${index + 1}`,
        })));
      } catch {
        if (active) setAudioOutputs([]);
      }
    };
    void updateDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", updateDevices);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", updateDevices);
    };
  }, [inCall, audioRouteSupported]);

  useEffect(() => {
    if (!audioRouteSupported) return;
    document.querySelectorAll<HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> }>("[data-call-audio-output]").forEach((element) => {
      if (typeof element.setSinkId === "function") void element.setSinkId(audioOutputId).catch(() => {});
    });
  }, [audioOutputId, remoteMedia, audioRouteSupported]);

  useEffect(() => {
    if (screenRef.current && screenStream) screenRef.current.srcObject = screenStream;
  }, [screenStream]);

  useEffect(() => {
    if (!callConnectedAt) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [callConnectedAt]);

  if (!inCall || !outgoing) return null;
  const video = outgoing.mode === "video";
  const participantCount = Math.max(1, roomParticipants.size + 1);
  const peerName = contacts.find((contact) => contact.flinkNumber === outgoing.to)?.name || formatFlinkNumber(outgoing.to);
  const endCall = () => {
    if (session && remoteMedia.length) hangup();
    else cancelOutgoing();
  };

  return (
    <>
      <div className="hidden" aria-hidden="true">
        {remoteMedia.map((remote) => (
          <audio key={remote.id} autoPlay playsInline data-call-audio-output ref={(element) => { if (element) element.srcObject = remote.stream; }} />
        ))}
      </div>
      {minimized ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto flex max-w-md items-center gap-3 rounded-[20px] border border-border bg-surface p-3 text-fg shadow-[0_12px_36px_rgba(29,18,22,0.24)]" role="status" aria-label={`Call with ${peerName} is active`}>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setMinimized(false)} aria-label="Return to call">
            <NumberAvatar seed={outgoing.to} label={peerName} size={40} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{peerName}</span>
              <span className="block text-xs text-muted">{callStatus || "Call active"}{callConnectedAt ? ` · ${formatDuration(elapsed)}` : ""}</span>
            </span>
          </button>
          {audioRouteSupported && (
            <Button size="icon" variant="ghost" className={speakerOn ? "text-primary" : ""} onClick={() => {
              const newSpeakerOn = !speakerOn;
              setSpeakerOn(newSpeakerOn);
              const deviceId = newSpeakerOn ? audioOutputs.find(d => d.label.toLowerCase().includes("speaker"))?.deviceId : "default";
              if (deviceId) setAudioOutputId(deviceId);
            }} aria-label={speakerOn ? "Use earpiece" : "Use speaker"}>
              {speakerOn ? <Monitor className="size-4" /> : <AudioLines className="size-4" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => setMinimized(false)} aria-label="Expand call"><Maximize2 className="size-4" /></Button>
          <Button size="icon" variant="danger" onClick={endCall} aria-label="End call"><PhoneOff className="size-4" /></Button>
        </div>
      ) : (
    <div className="fixed inset-0 z-40 flex flex-col bg-call text-call-fg">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {audioRouteSupported && audioOutputs.length > 0 && (
          <label className="flex h-10 max-w-[min(52vw,220px)] items-center gap-2 rounded-full bg-call/80 px-3 text-sm" title="Choose audio output device">
            <AudioLines className="size-4 shrink-0" />
            <select value={audioOutputId} onChange={(event) => setAudioOutputId(event.target.value)} className="min-w-0 bg-transparent text-call-fg outline-none" aria-label="Audio output device">
              <option value="default" className="text-fg">Default audio</option>
              {audioOutputs.filter((device) => device.deviceId && device.deviceId !== "default").map((device) => (
                <option key={device.deviceId} value={device.deviceId} className="text-fg">{device.label}</option>
              ))}
            </select>
          </label>
        )}
        <Button size="icon" variant="secondary" className="border-0 bg-call-fg/10 text-call-fg" onClick={() => setMinimized(true)} aria-label="Minimize call"><ChevronDown className="size-5" /></Button>
      </div>
      <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full bg-call/80 px-3 py-1.5 text-sm">
        <Users className="size-4" />
        {participantCount} participant{participantCount > 1 ? "s" : ""}
      </div>
      <div className="relative min-h-0 flex-1">
        {video ? (
          <>
            {remoteMedia.length > 1 ? <div className="grid h-full auto-rows-fr grid-cols-1 gap-1 sm:grid-cols-2">{remoteMedia.map((remote) => <RemoteTile key={remote.id} stream={remote.stream} />)}</div> : <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />}
            {isScreenSharing && screenStream && (
              <video
                ref={screenRef}
                autoPlay
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
              />
            )}
            <video
              ref={localRef}
              autoPlay
              muted
              playsInline
              className="absolute right-4 bottom-28 h-36 w-28 rounded-[16px] object-cover ring-1 ring-call-fg/20"
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <NumberAvatar seed={outgoing.to} label={outgoing.to} size={120} />
            <p className="font-display mt-5 text-3xl">{peerName}</p>
            <p className="text-sm text-subtle">{formatFlinkNumber(outgoing.to)}</p>
            <p className="mt-3 rounded-full bg-call-fg/10 px-4 py-2 text-sm text-call-fg/80">{callStatus || "Waiting for them to answer"}{callConnectedAt && <span className="ml-2 tabular-nums">{formatDuration(elapsed)}</span>}</p>
          </div>
        )}
        {video && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-call/70 to-transparent p-5 pt-10 text-center">
            <p className="font-display text-xl">{peerName}</p>
            <p className="text-xs text-subtle">{formatFlinkNumber(outgoing.to)}</p>
            <p className="text-sm text-subtle">{callStatus || "Waiting for them to answer"}{callConnectedAt && <span className="ml-2 tabular-nums">{formatDuration(elapsed)}</span>}</p>
          </div>
        )}
        {isScreenSharing && (
          <div className="pointer-events-none absolute top-4 right-4 rounded-full bg-primary/80 px-3 py-1 text-sm text-primary-fg">
            <Monitor className="size-4" />
            Sharing screen
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 bg-gradient-to-t from-call to-transparent px-6 pt-4 pb-10">
        <Button
          size="round"
          variant="secondary"
          className={muted ? "bg-primary text-primary-fg" : "bg-call-fg/10 text-call-fg border-0"}
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </Button>
        {video && (
          <Button
            size="round"
            variant="secondary"
            className={videoOff ? "bg-primary text-primary-fg" : "bg-call-fg/10 text-call-fg border-0"}
            onClick={toggleVideo}
            aria-label={videoOff ? "Camera on" : "Camera off"}
          >
            {videoOff ? <VideoOff className="size-5" /> : <Video className="size-5" />}
          </Button>
        )}
        <Button
          size="round"
          variant="secondary"
          className={isScreenSharing ? "bg-primary text-primary-fg" : "bg-call-fg/10 text-call-fg border-0"}
          onClick={() => void toggleScreenShare()}
          aria-label={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          {isScreenSharing ? <MonitorOff className="size-5" /> : <Monitor className="size-5" />}
        </Button>
        {audioRouteSupported && (
          <Button
            size="round"
            variant="secondary"
            className={speakerOn ? "bg-primary text-primary-fg" : "bg-call-fg/10 text-call-fg border-0"}
            onClick={() => {
              const newSpeakerOn = !speakerOn;
              setSpeakerOn(newSpeakerOn);
              const deviceId = newSpeakerOn ? audioOutputs.find(d => d.label.toLowerCase().includes("speaker"))?.deviceId : "default";
              if (deviceId) setAudioOutputId(deviceId);
            }}
            aria-label={speakerOn ? "Use earpiece" : "Use speaker"}
          >
            {speakerOn ? <Monitor className="size-5" /> : <AudioLines className="size-5" />}
          </Button>
        )}
        <Button size="round" variant="danger" onClick={endCall} aria-label="End">
          <PhoneOff className="size-5" />
        </Button>
      </div>
    </div>
      )}
    </>
  );
}

function RemoteTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay muted playsInline className="h-full w-full object-cover" />;
}

export function WaitingBanner() {
  const { outgoing, session, callStatus, cancelOutgoing, sessionEnded, roomParticipants } = useFlink();
  if (!outgoing || !session) return null;
  if (outgoing.mode === "voice" || outgoing.mode === "video") return null;
  const participantCount = roomParticipants.size;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-mist px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <p className="text-muted">
          {sessionEnded ? "Chat connection ended - " : callStatus || `Waiting for ${formatFlinkNumber(outgoing.to)}`}
        </p>
        {participantCount > 0 && (
          <span className="flex items-center gap-1 text-muted">
            <Users className="size-4" />
            {participantCount}
          </span>
        )}
      </div>
      <button type="button" className="font-semibold text-primary" onClick={cancelOutgoing}>
        Cancel
      </button>
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
