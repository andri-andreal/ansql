import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { previewTransfer, runTransfer } from "../lib/tauri-commands";
import type {
  TablePreview,
  TransferJob,
  TransferOptions,
  TransferProgress,
  TransferReport,
} from "../types";

export function useTransfer() {
  const [progress, setProgress] = useState<Record<string, TransferProgress>>({});
  const [report, setReport] = useState<TransferReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  const preview = useCallback(
    async (
      sourceSession: string,
      targetSession: string,
      jobs: TransferJob[],
      options: TransferOptions
    ): Promise<TablePreview[]> => {
      setError(null);
      try {
        return await previewTransfer(sourceSession, targetSession, jobs, options);
      } catch (e) {
        setError(String(e));
        return [];
      }
    },
    []
  );

  const run = useCallback(
    async (
      sourceSession: string,
      targetSession: string,
      jobs: TransferJob[],
      options: TransferOptions
    ): Promise<TransferReport | null> => {
      setError(null);
      setProgress({});
      setReport(null);
      setRunning(true);

      // Subscribe first so we don't miss early progress events. If subscribing
      // itself fails, reset running so the UI doesn't stay stuck in "Transferring…".
      try {
        unlistenRef.current = await listen<TransferProgress>(
          "transfer://progress",
          (event) => {
            const p = event.payload;
            setProgress((prev) => ({ ...prev, [p.table]: p }));
          }
        );
      } catch (e) {
        setError(String(e));
        setRunning(false);
        return null;
      }

      try {
        const result = await runTransfer(sourceSession, targetSession, jobs, options);
        setReport(result);
        return result;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setRunning(false);
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    },
    []
  );

  return { preview, run, progress, report, running, error };
}
