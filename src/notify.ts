import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let alertCtx: AudioContext | null = null;

export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

/** Call from a click (start dig) so the in-app chime can play when the timer ends. */
export function unlockAlertSound() {
  try {
    if (!alertCtx) alertCtx = new AudioContext();
    if (alertCtx.state === "suspended") void alertCtx.resume();
  } catch {
    /* ignore */
  }
}

function beep(ctx: AudioContext, at: number, freq: number, dur: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function chimeInApp() {
  try {
    if (!alertCtx) alertCtx = new AudioContext();
    const ctx = alertCtx;
    void ctx.resume().then(() => {
      const t0 = ctx.currentTime;
      beep(ctx, t0, 880, 0.18);
      beep(ctx, t0 + 0.22, 1174, 0.28);
    });
  } catch {
    /* ignore */
  }
}

export async function notify(title: string, body: string) {
  try {
    if (await ensureNotifyPermission()) {
      sendNotification({ title, body, sound: "Submarine" });
    }
  } catch {
    /* notifications are best-effort */
  }
}
