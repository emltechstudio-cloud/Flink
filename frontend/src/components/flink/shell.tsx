import { useEffect } from "react";
import { Link2, MessageCircle, Phone, UserRound, Users } from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { useFlink } from "@/lib/flink/store";
import { AuthFlow } from "./auth-flow";
import { DialPad } from "./dial";
import { HistoryView } from "./history";
import { CallsView } from "./calls";
import { ChatView } from "./chat";
import { GroupsView } from "./groups";
import { RoomsView } from "./rooms";
import { YouView } from "./you";
import { CallOverlay, IncomingSheet, WaitingBanner } from "./overlays";
import { formatFlinkNumber } from "@/lib/utils";
import type { AppView } from "@/lib/flink/types";

const NAV: Array<{ id: AppView; label: string; icon: typeof MessageCircle }> = [
  { id: "history", label: "Chats", icon: MessageCircle },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "groups", label: "Groups", icon: Users },
  { id: "rooms", label: "Rooms", icon: Link2 },
  { id: "you", label: "You", icon: UserRound },
];

export function FlinkShell() {
  const { boot, bootApp, view, setView, profile } = useFlink();

  useEffect(() => {
    void bootApp();
  }, [bootApp]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-mist md:p-6">
      <div className="flex h-dvh w-full max-w-md flex-col overflow-hidden bg-bg shadow-[0_8px_32px_rgba(123,21,53,0.12)] md:h-[min(844px,calc(100dvh-48px))] md:rounded-[32px] md:border md:border-border">
        {boot === "loading" && <Splash />}
        {boot === "auth" && <AuthFlow />}
        {boot === "ready" && (
          <>
            {view !== "chat" && (
              <header className="flex items-center justify-between px-5 pt-5 pb-2">
                <div className="flex items-center text-primary">
                  <span className="font-display text-xl font-medium tracking-tight">Flink</span>
                </div>
                {profile && (
                  <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold tracking-[0.12em] text-primary tabular-nums">
                    {formatFlinkNumber(profile.flinkNumber)}
                  </span>
                )}
              </header>
            )}
            <WaitingBanner />
            <main className="flex min-h-0 flex-1 flex-col">
              {(view === "home" || view === "history") && <HistoryView />}
              {view === "calls" && <CallsView />}
              {view === "dial" && <DialPad />}
              {view === "chat" && <ChatView />}
              {view === "groups" && <GroupsView />}
              {view === "rooms" && <RoomsView />}
              {view === "you" && <YouView />}
            </main>
            {view !== "chat" && (
              <nav className="flex border-t border-border bg-surface px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                {NAV.map((item) => {
                  const Icon = item.icon;
                  const active = view === item.id || (item.id === "history" && view === "home");
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setView(item.id)}
                      className={cn(
                        "flex min-h-11 flex-1 flex-col items-center gap-1 rounded-[12px] text-[11px] font-semibold",
                        active ? "text-primary" : "text-subtle",
                      )}
                    >
                      <Icon className="size-5" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            )}
            <a
              href="https://emltechstudio.space"
              target="_blank"
              rel="noreferrer"
              className="bg-surface pb-2 text-center text-[10px] text-subtle"
            >
              EML Tech Studio
            </a>
          </>
        )}
      </div>
      <IncomingSheet />
      <CallOverlay />
      <Toaster position="top-center" richColors theme="light" />
    </div>
  );
}

function Splash() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex size-20 items-center justify-center rounded-[24px] bg-primary text-primary-fg">
        <img src="./icon.svg" alt="Flink" className="size-12" />
      </div>
      <p className="font-display text-2xl text-primary">Flink</p>
    </div>
  );
}
