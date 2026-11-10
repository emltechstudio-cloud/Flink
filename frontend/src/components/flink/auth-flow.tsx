import { useRef, useState } from "react";
import { Fingerprint, KeyRound, Upload, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlinkMark } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";

type Panel = "welcome" | "create" | "password" | "sim" | "created";

export function AuthFlow() {
  const { createAccount, continueDevice, continuePassword, continueSimFile, busy, notice, profile, downloadSim } =
    useFlink();
  const [panel, setPanel] = useState<Panel>("welcome");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [number, setNumber] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onCreate() {
    setLocalError(null);
    if (password.length < 8) {
      setLocalError("Use at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setLocalError("Passwords do not match");
      return;
    }
    try {
      await createAccount(password);
      setPanel("created");
    } catch {
      // The store exposes the failure in its notice state.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="mb-7 flex size-20 items-center justify-center rounded-[24px] bg-primary text-primary-fg shadow-[0_8px_32px_rgba(123,21,53,0.18)]">
        <FlinkMark size={40} />
      </div>

      {panel === "welcome" && (
        <div className="w-full max-w-[340px] animate-[fadein_250ms_cubic-bezier(0.22,1,0.36,1)]">
          <h1 className="font-display text-center text-[2rem] leading-tight font-medium tracking-[-0.03em] text-fg">
            Flink
          </h1>
          <p className="mt-2 mb-8 text-center text-[15px] leading-relaxed text-muted">
            Your internet phone. Chat, call, video call, or share a room — no phone number required.
          </p>
          <Button className="w-full" size="lg" onClick={() => setPanel("create")} disabled={busy}>
            Create a Flink number
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-border" />
            continue
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex flex-col gap-2.5">
            <Button variant="secondary" className="w-full" onClick={() => void continueDevice().catch(() => undefined)} disabled={busy}>
              <Fingerprint className="size-4" />
              This device
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setPanel("sim")}>
              <WalletCards className="size-4" />
              Flink SIM
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setPanel("password")}>
              <KeyRound className="size-4" />
              Number and password
            </Button>
          </div>
        </div>
      )}

      {panel === "create" && (
        <div className="w-full max-w-[340px]">
          <h2 className="font-display mb-1 text-center text-2xl font-medium">Create your number</h2>
          <p className="mb-6 text-center text-sm text-muted">
            A six-digit identity, a password, and a SIM you keep.
          </p>
          <Label htmlFor="pw">Password</Label>
          <Input
            id="pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4"
          />
          <Label htmlFor="pw2">Confirm</Label>
          <Input
            id="pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mb-5"
          />
          <Button className="w-full" onClick={() => void onCreate()} disabled={busy}>
            {busy ? "Creating…" : "Issue my number"}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setPanel("welcome")}>
            Back
          </Button>
        </div>
      )}

      {panel === "password" && (
        <div className="w-full max-w-[340px]">
          <h2 className="font-display mb-6 text-center text-2xl font-medium">Continue with password</h2>
          <Label htmlFor="num">Flink number</Label>
          <Input
            id="num"
            inputMode="numeric"
            maxLength={7}
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mb-4 tracking-[0.3em] text-center text-lg"
            placeholder="000000"
          />
          <Label htmlFor="lpw">Password</Label>
          <Input
            id="lpw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-5"
          />
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void continuePassword(number, password).catch(() => undefined)}
          >
            Continue
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setPanel("welcome")}>
            Back
          </Button>
        </div>
      )}

      {panel === "sim" && (
        <div className="w-full max-w-[340px] text-center">
          <h2 className="font-display mb-2 text-2xl font-medium">Import a Flink SIM</h2>
          <p className="mb-6 text-sm text-muted">
            A signed SIM file restores this number on a new device.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.sim.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void continueSimFile(file).catch(() => undefined);
            }}
          />
          <Button className="w-full" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="size-4" />
            Choose SIM file
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setPanel("welcome")}>
            Back
          </Button>
        </div>
      )}

      {panel === "created" && profile && (
        <div className="w-full max-w-[340px] text-center">
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Your Flink number</p>
          <p className="font-display my-4 text-5xl tracking-[0.12em] text-primary">
            {formatFlinkNumber(profile.flinkNumber)}
          </p>
          <p className="mb-6 text-sm text-muted">
            Save your SIM. It is the only way to restore this number besides this device and your password.
          </p>
          <Button className="w-full" onClick={downloadSim}>
            Download Flink SIM
          </Button>
          <Button variant="secondary" className="mt-2.5 w-full" onClick={() => useFlink.setState({ view: "home" })}>
            Enter Flink
          </Button>
        </div>
      )}

      {(localError || notice) && (
        <p className="mt-4 max-w-[340px] text-center text-sm text-danger">{localError || notice}</p>
      )}
    </div>
  );
}
