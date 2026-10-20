import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Video, VideoOff, Monitor, MonitorOff, Users } from "lucide-react";
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
  const { outgoing, session, callStatus, remoteMedia, hangup, cancelOutgoing, muted, videoOff, toggleMute, toggleVideo, toggleScreenShare, isScreenSharing, screenStream, roomParticipants, contacts } =
    useFlink();
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const inCall = Boolean(session && outgoing && (outgoing.mode === "voice" || outgoing.mode === "video"));

  useEffect(() => {
    if (localRef.current && session?.local) localRef.current.srcObject = session.local;
  }, [session, session?.local, inCall]);

  useEffect(() => {
    const first = remoteMedia[0];
    if (remoteRef.current && first) remoteRef.current.srcObject = first.stream;
    if (remoteAudioRef.current && first) remoteAudioRef.current.srcObject = first.stream;
  }, [remoteMedia]);

  useEffect(() => {
    if (screenRef.current && screenStream) screenRef.current.srcObject = screenStream;
  }, [screenStream]);

  if (!inCall || !outgoing) return null;
  const video = outgoing.mode === "video";
  const participantCount = Math.max(1, roomParticipants.size + 1);
  const peerName = contacts.find((contact) => contact.flinkNumber === outgoing.to)?.name || formatFlinkNumber(outgoing.to);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-call text-call-fg">
      <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full bg-call/80 px-3 py-1.5 text-sm">
        <Users className="size-4" />
        {participantCount} participant{participantCount > 1 ? "s" : ""}
      </div>
      <div className="relative min-h-0 flex-1">
        {video ? (
          <>
            <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />
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
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <NumberAvatar seed={outgoing.to} label={outgoing.to} size={120} />
            <p className="font-display mt-5 text-3xl">{peerName}</p>
            <p className="text-sm text-subtle">{formatFlinkNumber(outgoing.to)}</p>
            <p className="mt-2 text-sm text-subtle">{callStatus || "Connecting"}</p>
          </div>
        )}
        {video && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-call/70 to-transparent p-5 pt-10 text-center">
            <p className="font-display text-xl">{peerName}</p>
            <p className="text-xs text-subtle">{formatFlinkNumber(outgoing.to)}</p>
            <p className="text-sm text-subtle">{callStatus}</p>
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
        <Button size="round" variant="danger" onClick={session && remoteMedia.length ? hangup : cancelOutgoing} aria-label="End">
          <PhoneOff className="size-5" />
        </Button>
      </div>
    </div>
  );
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
