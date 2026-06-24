/**
 * 操作历史面板(阶段 6.4 辅助)
 *
 * 对齐 iOS OperationHistoryStore 的展示:
 *   - load_operation_history → 列表
 *   - clear_operation_history → 清空
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UseLanguage } from "../hooks/useLanguage.js";
import type { OperationRecord } from "../types/index.js";

interface Props {
  lang: UseLanguage;
}

export function HistoryPane({ lang }: Props) {
  const { t } = lang;
  const [records, setRecords] = useState<OperationRecord[]>([]);

  const refresh = async () => {
    try {
      const r = await invoke<OperationRecord[]>("load_operation_history");
      setRecords(r);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleClear = async () => {
    await invoke("clear_operation_history");
    await refresh();
  };

  return (
    <div className="history-pane">
      <h2>{t("history.title")}
        <button onClick={handleClear} className="danger">{t("history.clear")}</button>
      </h2>
      {records.length === 0 ? (
        <p className="muted">{t("history.empty")}</p>
      ) : (
        <ul className="history-list">
          {records.map((r) => (
            <li key={r.id} className="history-item">
              <div className="history-kind">{t(`history.kind.${r.kind}`)}</div>
              <div className="history-summary">{r.summary}</div>
              <div className="muted">{new Date(r.timestamp).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
