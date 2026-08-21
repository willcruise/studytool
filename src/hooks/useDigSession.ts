import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Debt } from "../types";
import * as db from "../db";
import { checkExcerpt, checkIsReady } from "../richtext";
import { minutesBetween, parseUtc } from "../time";
import { chimeInApp, ensureNotifyPermission, notify, unlockAlertSound } from "../notify";
import type { TFn } from "../i18n";
import {
  digFloatEnabled,
  setDigFloatEnabled,
  setDigWindowVisible,
  subscribeDigWidgetEvents,
} from "../digFloat";

interface Args {
  openDebts: Debt[];
  allDebts: Debt[];
  setAllDebts: Dispatch<SetStateAction<Debt[]>>;
  refresh: () => Promise<void>;
  setSelectedId: (id: number | null) => void;
  showToast: (msg: string) => void;
  t: TFn;
  /** Flush the open detail editors so Check/Memo hit SQLite before wrap-up. */
  flushDetailRef: MutableRefObject<(() => Promise<void>) | null>;
}

/** Timebox state, floating timer, and wrap-up modal. Independent of board layout. */
export function useDigSession({
  openDebts,
  allDebts,
  setAllDebts,
  refresh,
  setSelectedId,
  showToast,
  t,
  flushDetailRef,
}: Args) {
  const [now, setNow] = useState(() => Date.now());
  const [digFinishRequested, setDigFinishRequested] = useState(false);
  const [forceWriter, setForceWriter] = useState<null | "check">(null);
  const [pauseDigModal, setPauseDigModal] = useState(false);
  const [digFloat, setDigFloatState] = useState(() => digFloatEnabled());
  const [digWindowOn, setDigWindowOn] = useState(false);
  const digNotifiedRef = useRef(false);
  const startingRef = useRef(false);

  const setDigFloat = (on: boolean) => {
    setDigFloatEnabled(on);
    setDigFloatState(on);
  };

  const activeDig = openDebts.find((d) => d.dig_until !== null) ?? null;
  const digExpired = activeDig !== null && now >= parseUtc(activeDig.dig_until!);
  const digModalOpen =
    activeDig !== null && (digExpired || digFinishRequested) && !pauseDigModal;
  const digMinutesSpent = activeDig
    ? Math.round(
        (Math.min(now, parseUtc(activeDig.dig_until!)) -
          parseUtc(activeDig.dig_started_at ?? activeDig.dig_until!)) /
          60000
      )
    : 0;

  useEffect(() => {
    if (!activeDig) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [activeDig?.id]);

  useEffect(() => {
    if (digExpired && activeDig && !digNotifiedRef.current) {
      digNotifiedRef.current = true;
      chimeInApp();
      showToast(t("toastTimeboxEnded", { title: activeDig.title }));
      void notify(t("timeboxEnded"), activeDig.title);
      void getCurrentWindow()
        .show()
        .then(() => getCurrentWindow().setFocus());
    }
    if (!digExpired) digNotifiedRef.current = false;
  }, [digExpired, activeDig?.id, showToast, t]);

  useEffect(() => {
    if (digExpired) setPauseDigModal(false);
  }, [digExpired]);

  useEffect(() => {
    let cancelled = false;
  const want = Boolean(activeDig && !digExpired && !digModalOpen && digFloat);
    void setDigWindowVisible(want).then((ok) => {
      if (!cancelled) setDigWindowOn(want && ok);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDig?.id, digModalOpen, digFloat]);

  useEffect(() => {
    if (!digModalOpen) return;
    void flushDetailRef.current?.();
  }, [digModalOpen]);

  const requestFinish = async () => {
    try {
      await flushDetailRef.current?.();
    } catch {
      /* still open wrap-up with whatever is already saved */
    }
    setPauseDigModal(false);
    setDigFinishRequested(true);
  };

  useEffect(() => {
    return subscribeDigWidgetEvents({
      onFinishEarly: () => {
        void requestFinish().then(() => {
          const main = getCurrentWindow();
          void main.show().then(() => main.setFocus());
        });
      },
      onDock: () => {
        setDigFloatEnabled(false);
        setDigFloatState(false);
        void setDigWindowVisible(false).then(() => setDigWindowOn(false));
      },
    });
  }, []);

  const startDig = async (id: number, minutes: number) => {
    if (startingRef.current || openDebts.some((d) => d.dig_until !== null)) {
      showToast(t("toastDigBusy"));
      return;
    }
    startingRef.current = true;
    try {
      unlockAlertSound();
      void ensureNotifyPermission();
      await db.startDig(id, minutes);
      setDigFinishRequested(false);
      setPauseDigModal(false);
      setNow(Date.now());
      await refresh();
      showToast(t("toastDigStart", { n: minutes }));
    } finally {
      startingRef.current = false;
    }
  };

  const settleDig = async (id: number) => {
    const current = allDebts.find((d) => d.id === id);
    if (!current?.dig_until) return;
    const spent =
      activeDig?.id === id
        ? digMinutesSpent
        : current.dig_started_at
          ? minutesBetween(current.dig_started_at)
          : 0;
    await db.endDig(id, spent);
    setAllDebts((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, dig_until: null, dig_started_at: null } : d
      )
    );
    setDigFinishRequested(false);
    setPauseDigModal(false);
  };

  const closeDig = async (log: string) => {
    if (!activeDig) return;
    try {
      await flushDetailRef.current?.();
    } catch {
      /* keep closing with whatever is already saved */
    }
    if (log) await db.appendNoteLog(activeDig.id, log);
    await db.endDig(activeDig.id, digMinutesSpent);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
  };

  const resolveDig = async () => {
    if (!activeDig) return;
    try {
      await flushDetailRef.current?.();
    } catch {
      /* fall through and read whatever SQLite has */
    }
    const latest = (await db.getDebt(activeDig.id)) ?? activeDig;
    const check = latest.check_content;
    if (!checkIsReady(check)) {
      setSelectedId(activeDig.id);
      setForceWriter("check");
      if (!digExpired) setPauseDigModal(true);
      showToast(t("toastNeedCheck"));
      return;
    }
    try {
      await db.endDig(activeDig.id, digMinutesSpent);
      await db.resolveDebt(activeDig.id, checkExcerpt(check) || t("checkFallback"));
      setDigFinishRequested(false);
      setPauseDigModal(false);
      await refresh();
      showToast(t("toastResolved"));
    } catch (err) {
      console.error(err);
      showToast(t("toastSaveFailed"));
    }
  };

  const resumeDig = () => {
    if (activeDig !== null && Date.now() >= parseUtc(activeDig.dig_until!)) return;
    setDigFinishRequested(false);
    setPauseDigModal(false);
  };

  const extendDig = async (minutes: number) => {
    if (!activeDig) return;
    await db.extendDig(activeDig.id, minutes);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    setNow(Date.now());
    await refresh();
    showToast(t("toastDigMore", { n: minutes }));
  };

  const restartDig = async (minutes: number) => {
    if (!activeDig) return;
    await db.restartDig(activeDig.id, minutes, digMinutesSpent);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    setNow(Date.now());
    await refresh();
    showToast(t("toastDigRestart", { n: minutes }));
  };

  const clearDigUi = () => {
    setDigFinishRequested(false);
    setPauseDigModal(false);
  };

  return {
    now,
    activeDig,
    digExpired,
    digModalOpen,
    digMinutesSpent,
    digFloat,
    setDigFloat,
    digWindowOn,
    forceWriter,
    setForceWriter,
    startDig,
    settleDig,
    closeDig,
    resolveDig,
    resumeDig,
    extendDig,
    restartDig,
    clearDigUi,
    setDigFinishRequested,
    requestFinish,
  };
}
