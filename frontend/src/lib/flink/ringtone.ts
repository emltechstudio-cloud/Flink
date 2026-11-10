const RINGTONE_KEY = "flink_ringtone_enabled";
let context: AudioContext | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;

export function isRingtoneEnabled() {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(RINGTONE_KEY) !== "off";
}

export function setRingtoneEnabled(enabled: boolean) {
  if (typeof window !== "undefined") {
    localStorage.setItem(RINGTONE_KEY, enabled ? "on" : "off");
  }
  if (!enabled) stopRingtone();
}

function tone(duration = 180) {
  if (!context) {
    const AudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
  }
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + duration / 1000);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration / 1000);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration / 1000 + 0.02);
}

export function startRingtone() {
  if (typeof window === "undefined" || active || !isRingtoneEnabled()) return;
  active = true;
  const ring = () => {
    if (!active) return;
    tone();
    timer = setTimeout(() => {
      tone();
      timer = setTimeout(ring, 2100);
    }, 240);
  };
  ring();
}

export function stopRingtone() {
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
