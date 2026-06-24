/**
 * useLibrary:文档库状态 hook
 *
 * 对接 Rust 侧:
 *   - load_library_state / save_library_state
 *   - set_workspace_root / scan_workspace / import_all_from_workspace
 *   - read_document_content / write_document_content
 *   - create_document / delete_document
 *   - list_document_versions / restore_document_version
 *
 * 持有 library state + active document content,提供操作方法
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LibraryState, MarkdownDocument, DocumentVersion } from "../types/index.js";

export interface UseLibrary {
  library: LibraryState | null;
  activeDoc: MarkdownDocument | null;
  activeContent: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  pickWorkspace: (root: string) => Promise<void>;
  importAll: () => Promise<void>;
  createDocument: (title: string) => Promise<MarkdownDocument | null>;
  selectDocument: (docId: string) => Promise<void>;
  saveActiveContent: (content: string) => Promise<void>;
  deleteDocument: (docId: string) => Promise<void>;
  toggleStar: (docId: string) => Promise<void>;
  listVersions: (docId: string) => Promise<DocumentVersion[]>;
  restoreVersion: (docId: string, versionId: string) => Promise<void>;
}

export function useLibrary(): UseLibrary {
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [activeContent, setActiveContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lib = await invoke<LibraryState>("load_library_state");
      setLibrary(lib);
      if (lib.activeDocumentId) {
        await loadContent(lib, lib.activeDocumentId);
      } else {
        setActiveContent("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadContent = useCallback(async (lib: LibraryState, docId: string) => {
    try {
      const content = await invoke<string>("read_document_content", { library: lib, docId });
      setActiveContent(content);
    } catch (e) {
      setError(String(e));
      setActiveContent("");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeDoc = library?.documents.find((d) => d.id === library.activeDocumentId) ?? null;

  const pickWorkspace = useCallback(async (root: string) => {
    const lib = await invoke<LibraryState>("set_workspace_root", { library: library, root });
    setLibrary(lib);
    await refresh();
  }, [library, refresh]);

  const importAll = useCallback(async () => {
    if (!library) return;
    const lib = await invoke<LibraryState>("import_all_from_workspace", { library });
    setLibrary(lib);
  }, [library]);

  const createDocument = useCallback(async (title: string): Promise<MarkdownDocument | null> => {
    if (!library) return null;
    const lib = await invoke<LibraryState>("create_document", { library, title, content: null });
    // 新文档应该是最后一条
    const created = lib.documents[lib.documents.length - 1] ?? null;
    setLibrary({ ...lib, activeDocumentId: created?.id });
    if (created) {
      await loadContent({ ...lib, activeDocumentId: created.id }, created.id);
    }
    return created;
  }, [library, loadContent]);

  const selectDocument = useCallback(async (docId: string) => {
    if (!library) return;
    const next = { ...library, activeDocumentId: docId };
    setLibrary(next);
    await loadContent(next, docId);
    await invoke("save_library_state", { library: next });
  }, [library, loadContent]);

  const saveActiveContent = useCallback(async (content: string) => {
    if (!library || !library.activeDocumentId) return;
    const lib = await invoke<LibraryState>("write_document_content", {
      library,
      docId: library.activeDocumentId,
      content,
    });
    setLibrary(lib);
    setActiveContent(content);
  }, [library]);

  const deleteDocument = useCallback(async (docId: string) => {
    if (!library) return;
    const lib = await invoke<LibraryState>("delete_document", { library, docId });
    setLibrary(lib);
    if (lib.activeDocumentId === docId) {
      setActiveContent("");
    }
  }, [library]);

  const toggleStar = useCallback(async (docId: string) => {
    if (!library) return;
    const docs = library.documents.map((d) =>
      d.id === docId ? { ...d, starred: !d.starred } : d,
    );
    const next: LibraryState = { ...library, documents: docs };
    await invoke("save_library_state", { library: next });
    setLibrary(next);
  }, [library]);

  const listVersions = useCallback(async (docId: string) => {
    if (!library) return [];
    return await invoke<DocumentVersion[]>("list_document_versions", { library, docId });
  }, [library]);

  const restoreVersion = useCallback(async (docId: string, versionId: string) => {
    if (!library) return;
    const lib = await invoke<LibraryState>("restore_document_version", {
      library,
      docId,
      versionId,
    });
    setLibrary(lib);
    await loadContent(lib, docId);
  }, [library, loadContent]);

  return {
    library,
    activeDoc,
    activeContent,
    loading,
    error,
    refresh,
    pickWorkspace,
    importAll,
    createDocument,
    selectDocument,
    saveActiveContent,
    deleteDocument,
    toggleStar,
    listVersions,
    restoreVersion,
  };
}
