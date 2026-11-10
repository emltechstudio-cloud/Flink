import { useState } from "react";
import { Bell, Download, LogOut, Plus, Smartphone, UserRound, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FlinkMark } from "./mark";
import { useFlink } from "@/lib/flink/store";
import { formatFlinkNumber } from "@/lib/utils";
import { installApp } from "@/pwa";
import { registerFlinkPush } from "@/lib/flink/push";
import { isRingtoneEnabled, setRingtoneEnabled } from "@/lib/flink/ringtone";

export function YouView() {
  const { profile, contacts, peerStatuses, downloadSim, logout, upsertContact } = useFlink();
  const [contactName, setContactName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [ringtoneEnabled, setRingtoneEnabledState] = useState(() => isRingtoneEnabled());
  if (!profile) return null;
  const token = profile.accessToken;
  async function enableNotifications() {
    const enabled = await registerFlinkPush(token, true);
    if (enabled) toast.success("Flink notifications are enabled");
    else toast.error("Notifications could not be enabled on this browser");
  }
  async function saveContact() {
    const number = contactNumber.replace(/\D/g, "");
    if (!/^\d{6}$/.test(number)) {
      toast.error("Enter a six-digit Flink number");
      return;
    }
    await upsertContact(number, contactName.trim() || number);
    setContactName("");
    setContactNumber("");
    toast.success("Contact saved");
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-[20px] bg-primary text-primary-fg">
          <FlinkMark size={32} />
        </div>
        <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Your number</p>
        <p className="font-display mt-2 text-5xl tracking-[0.12em] text-primary tabular-nums">
          {formatFlinkNumber(profile.flinkNumber)}
        </p>
        <p className="mt-3 max-w-xs text-sm text-muted">
          People use this number to start a direct chat. There is no public profile, feed, or online lamp.
        </p>
      </div>
      <section className="mt-8 rounded-[22px] border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><UserRound className="size-4 text-primary" /><h2 className="font-semibold">Contacts</h2></div>
        <div className="space-y-2">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name" className="min-h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-primary" />
          <div className="flex gap-2"><input value={contactNumber} onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="Six-digit Flink number" className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-primary" /><Button type="button" size="icon" onClick={() => void saveContact()} aria-label="Save contact"><Plus className="size-4" /></Button></div>
        </div>
        <div className="mt-3 space-y-2">{contacts.length === 0 ? <p className="text-xs text-muted">No saved contacts yet.</p> : contacts.map((contact) => { const status = peerStatuses.get(contact.flinkNumber); return <div key={contact.flinkNumber} className="flex items-center justify-between rounded-xl bg-mist px-3 py-2"><div><p className="text-sm font-semibold">{contact.name}</p><p className="text-xs text-muted">{formatFlinkNumber(contact.flinkNumber)}</p></div><span className={`text-xs font-semibold ${status?.online ? "text-primary" : "text-muted"}`}>{status?.online ? "Online" : "Saved"}</span></div>; })}</div>
      </section>
      <div className="mt-8 space-y-2">
        <Button className="w-full" onClick={downloadSim}>
          <Download className="size-4" />
          Download Flink SIM
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void installApp()}>
          <Smartphone className="size-4" />
          Install Flink on this device
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => void enableNotifications()}>
          <Bell className="size-4" />
          Enable notifications
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            const next = !ringtoneEnabled;
            setRingtoneEnabled(next);
            setRingtoneEnabledState(next);
          }}
        >
          {ringtoneEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          {ringtoneEnabled ? "Ringtone on" : "Ringtone off"}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (window.confirm("Leave this device? Local conversations stay until you clear the browser.")) {
              void logout();
            }
          }}
        >
          <LogOut className="size-4" />
          Leave this device
        </Button>
      </div>
      <p className="mt-8 text-center text-xs leading-relaxed text-subtle">
        Conversations live on this device. The Flink service only holds your number, groups, and the handshake that
        starts a call.
      </p>
    </div>
  );
}
