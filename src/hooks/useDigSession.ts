import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Debt } from "../types";
import * as db from "../db";
import { checkExcerpt, checkIsReady } from "../richtext";
import { minutesBetween, parseUtc } from "../time";
import { notify } from "../notify";
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
}: Args) {
  const [now, setNow] = useState(() => Date.now());
  const [digFinishRequested, setDigFinishRequested] = useState(false);
  const [forceWriter, setForceWriter] = useState<null | "check">(null);
  const [pauseDigModal, setPauseDigModal] = useState(false);
  const [digFloat, setDigFloatState] = useState(() => digFloatEnabled());
  const [digWindowOn, setDigWindowOn] = useState(false);
  const digNotifiedRef = useRef(false);

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
      notify(t("timeboxEnded"), activeDig.title);
      void getCurrentWindow()
        .show()
        .then(() => getCurrentWindow().setFocus());
    }
    if (!digExpired) digNotifiedRef.current = false;
  }, [digExpired, activeDig?.id]);

  useEffect(() => {
    let cancelled = false;
    const want = Boolean(activeDig && !digModalOpen && digFloat);
    void setDigWindowVisible(want).then((ok) => {
      if (!cancelled) setDigWindowOn(want && ok);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDig?.id, digModalOpen, digFloat]);

  useEffect(() => {
    return subscribeDigWidgetEvents({
      onFinishEarly: () => {
        setDigFinishRequested(true);
        const main = getCurrentWindow();
        void main.show().then(() => main.setFocus());
      },
      onDock: () => {
        setDigFloatEnabled(false);
        setDigFloatState(false);
        void setDigWindowVisible(false).then(() => setDigWindowOn(false));
      },
    });
  }, []);

  useEffect(() => {
    if (!digWindowOn) return;
    const armedAt = Date.now() + 400;
    const dock = () => {
      if (Date.now() < armedAt) return;
      setDigFloat(false);
      void setDigWindowVisible(false).then(() => setDigWindowOn(false));
    };
    window.addEventListener("pointerdown", dock);
    return () => window.removeEventListener("pointerdown", dock);
  }, [digWindowOn]);

  const startDig = async (id: number, minutes: number) => {
    await db.startDig(id, minutes);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    setNow(Date.now());
    await refresh();
    showToast(t("toastDigStart", { n: minutes }));
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
    if (log) await db.appendNoteLog(activeDig.id, log);
    await db.endDig(activeDig.id, digMinutesSpent);
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
  };

  const resolveDig = async () => {
    if (!activeDig) return;
    if (!checkIsReady(activeDig.check_content)) {
      setSelectedId(activeDig.id);
      setForceWriter("check");
      setPauseDigModal(true);
      showToast(t("toastNeedCheck"));
      return;
    }
    await db.endDig(activeDig.id, digMinutesSpent);
    await db.resolveDebt(activeDig.id, checkExcerpt(activeDig.check_content));
    setDigFinishRequested(false);
    setPauseDigModal(false);
    await refresh();
    showToast(t("toastResolved"));
  };

  const needCheckFromModal = () => {
    if (!activeDig) return;
    setSelectedId(activeDig.id);
    setForceWriter("check");
    setPauseDigModal(true);
    showToast(t("toastWriteCheck"));
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
    needCheckFromModal,
    clearDigUi,
    setDigFinishRequested,
  };
}
