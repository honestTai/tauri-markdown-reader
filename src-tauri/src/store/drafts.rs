//! Agent 写回草稿解析与暂存（阶段 5）
//!
//! 对齐 iOS MacAgentDraftResolver + ClientAgentRuntime 草稿生命周期：
//!   1. Agent 调 document_propose_replace / document_propose_create（sidecar 反向 RPC）
//!   2. Rust 在 dispatch_tool_call 里调 resolve_*_draft，产出 ResolvedDraft 并暂存进 registry
//!   3. tool_result 带 draftId + canApply + missingSearches
//!   4. 前端用 propose_agent_draft 命令取 ResolvedDraft 做 diff 预览
//!   5. 用户确认 → apply_agent_draft(draftId)：
//!      - WholeDocument / SelectedText / SearchReplace → 先 backup_to_version 再写文件
//!      - Create → create_document
//!   6. discard_agent_draft(draftId) 移出 registry
//!
//! 解析模式：
//!   - wholeDocument：Agent 给完整新内容
//!   - selectedText：Agent 给 selectionText + 替换文本
//!   - searchReplace：Agent 给 blocks=[{search, replace}]
//!
//! 设计：解析是纯函数；registry 是进程级 Mutex<HashMap>；草稿不落盘

use crate::models::agent::{DraftMode, ResolvedDraft, StagedDraft};
use crate::store::error::{AppError, AppResult};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

/// SEARCH/REPLACE 块输入（对齐 sidecar tools.ts 的 blocks schema）
#[derive(Debug, Clone)]
pub struct SearchReplaceBlock {
    pub search: String,
    pub replace: String,
}

/// 选区信息（对齐 iOS MacEditorTextSelection.replacingSelection）
#[derive(Debug, Clone, Default)]
pub struct EditorSelection {
    pub replacing_selection: Option<String>,
}

/// 全局草稿注册表（进程级单例）
struct StagedDraftRegistry(Mutex<HashMap<String, StagedDraft>>);

fn registry() -> &'static StagedDraftRegistry {
    static REG: OnceLock<StagedDraftRegistry> = OnceLock::new();
    REG.get_or_init(|| StagedDraftRegistry(Mutex::new(HashMap::new())))
}

/// 暂存一条草稿，返回它的 ResolvedDraft
pub fn stage_draft(draft: StagedDraft) -> AppResult<ResolvedDraft> {
    let id = draft.resolved.id.clone();
    registry()
        .0
        .lock()
        .map_err(|e| AppError::Sidecar(format!("草稿注册表锁中毒: {e}")))?
        .insert(id.clone(), draft);
    let resolved = get_draft(&id)?.ok_or_else(|| AppError::NotFound("草稿暂存失败".into()))?;
    Ok(resolved)
}

/// 取一条已暂存的 ResolvedDraft（前端 propose_agent_draft 用）
pub fn get_draft(id: &str) -> AppResult<Option<ResolvedDraft>> {
    let g = registry()
        .0
        .lock()
        .map_err(|e| AppError::Sidecar(format!("草稿注册表锁中毒: {e}")))?;
    Ok(g.get(id).map(|s| s.resolved.clone()))
}

/// 取一条已暂存的完整 StagedDraft（apply_agent_draft 内部用）
pub(crate) fn take_staged(id: &str) -> AppResult<Option<StagedDraft>> {
    let mut g = registry()
        .0
        .lock()
        .map_err(|e| AppError::Sidecar(format!("草稿注册表锁中毒: {e}")))?;
    Ok(g.remove(id))
}

/// 丢弃草稿（discard_agent_draft）
pub fn discard_draft(id: &str) -> AppResult<bool> {
    let mut g = registry()
        .0
        .lock()
        .map_err(|e| AppError::Sidecar(format!("草稿注册表锁中毒: {e}")))?;
    Ok(g.remove(id).is_some())
}

/// 生成新草稿 id
pub fn new_draft_id() -> String {
    Uuid::new_v4().to_string()
}

/// 当前暂存草稿数（测试用）
#[allow(dead_code)]
pub fn staged_count() -> AppResult<usize> {
    let g = registry()
        .0
        .lock()
        .map_err(|e| AppError::Sidecar(format!("草稿注册表锁中毒: {e}")))?;
    Ok(g.len())
}

// ============ 解析逻辑（纯函数） ============

/// 解析 SEARCH/REPLACE 块（对齐 iOS applySearchReplaceBlocks）
///
/// 对每个 block：search 在 current_content 中首次出现则替换，否则记入 missing。
pub fn apply_search_replace_blocks(
    current_content: &str,
    blocks: &[SearchReplaceBlock],
) -> (String, Vec<String>, u32) {
    let mut content = current_content.to_string();
    let mut missing = Vec::new();
    let mut hits = 0u32;
    for b in blocks {
        if b.search.is_empty() {
            missing.push(b.search.clone());
            continue;
        }
        if let Some(idx) = content.find(&b.search) {
            let mut new_content = String::with_capacity(content.len() + b.replace.len());
            new_content.push_str(&content[..idx]);
            new_content.push_str(&b.replace);
            new_content.push_str(&content[idx + b.search.len()..]);
            content = new_content;
            hits += 1;
        } else {
            missing.push(b.search.clone());
        }
    }
    (content, missing, hits)
}

/// 解析 SEARCH/REPLACE 草稿 → ResolvedDraft + StagedDraft
///
/// 调用方负责传入 current_content（从 library 读出）
pub fn resolve_replace_draft(
    document_id: &str,
    current_content: &str,
    blocks: Vec<SearchReplaceBlock>,
    selection: Option<EditorSelection>,
    note: Option<String>,
) -> AppResult<(ResolvedDraft, StagedDraft)> {
    let id = new_draft_id();

    let (mode, content, missing, hits): (DraftMode, String, Vec<String>, u32) =
        if let Some(sel) = selection.as_ref().and_then(|s| s.replacing_selection.as_deref()) {
            if sel.is_empty() {
                return Err(AppError::InvalidArgument(
                    "selectedText 模式下 replacingSelection 不能为空".into(),
                ));
            }
            let (c, missing, hits) = apply_search_replace_blocks(
                current_content,
                &[SearchReplaceBlock {
                    search: sel.to_string(),
                    replace: blocks
                        .first()
                        .map(|b| b.replace.clone())
                        .unwrap_or_default(),
                }],
            );
            (DraftMode::SelectedText, c, missing, hits)
        } else if !blocks.is_empty() {
            let (c, missing, hits) = apply_search_replace_blocks(current_content, &blocks);
            (DraftMode::SearchReplace, c, missing, hits)
        } else {
            (
                DraftMode::WholeDocument,
                current_content.to_string(),
                Vec::new(),
                0,
            )
        };

    let can_apply = missing.is_empty();
    let resolved = ResolvedDraft {
        id: id.clone(),
        mode,
        document_id: Some(document_id.to_string()),
        title: None,
        content,
        missing_searches: missing,
        replacement_count: hits,
        can_apply,
        note,
    };
    let staged = StagedDraft {
        resolved: resolved.clone(),
        target_document_id: Some(document_id.to_string()),
        selection_text: selection
            .and_then(|s| s.replacing_selection)
            .filter(|s| !s.is_empty()),
        created_at: crate::store::library::chrono_now_millis(),
    };
    Ok((resolved, staged))
}

/// 解析整文档替换草稿（Agent 直接给完整新内容）
pub fn resolve_whole_document_draft(
    document_id: &str,
    new_content: String,
    note: Option<String>,
) -> AppResult<(ResolvedDraft, StagedDraft)> {
    let id = new_draft_id();
    let resolved = ResolvedDraft {
        id: id.clone(),
        mode: DraftMode::WholeDocument,
        document_id: Some(document_id.to_string()),
        title: None,
        content: new_content,
        missing_searches: Vec::new(),
        replacement_count: 0,
        can_apply: true,
        note,
    };
    let staged = StagedDraft {
        resolved: resolved.clone(),
        target_document_id: Some(document_id.to_string()),
        selection_text: None,
        created_at: crate::store::library::chrono_now_millis(),
    };
    Ok((resolved, staged))
}

/// 解析创建新文档草稿（对齐 document_propose_create）
pub fn resolve_create_draft(
    title: &str,
    content: String,
    note: Option<String>,
) -> AppResult<(ResolvedDraft, StagedDraft)> {
    if title.trim().is_empty() {
        return Err(AppError::InvalidArgument("创建草稿缺少 title".into()));
    }
    let id = new_draft_id();
    let resolved = ResolvedDraft {
        id: id.clone(),
        mode: DraftMode::Create,
        document_id: None,
        title: Some(title.to_string()),
        content,
        missing_searches: Vec::new(),
        replacement_count: 0,
        can_apply: true,
        note,
    };
    let staged = StagedDraft {
        resolved: resolved.clone(),
        target_document_id: None,
        selection_text: None,
        created_at: crate::store::library::chrono_now_millis(),
    };
    Ok((resolved, staged))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_replace_全部命中() {
        let content = "你好世界\n第二段\n第三段";
        let blocks = vec![
            SearchReplaceBlock { search: "你好".into(), replace: "Hello".into() },
            SearchReplaceBlock { search: "第三段".into(), replace: "Third".into() },
        ];
        let (new, missing, hits) = apply_search_replace_blocks(content, &blocks);
        assert_eq!(new, "Hello世界\n第二段\nThird");
        assert!(missing.is_empty());
        assert_eq!(hits, 2);
    }

    #[test]
    fn search_replace_部分未命中() {
        let content = "aaa bbb";
        let blocks = vec![
            SearchReplaceBlock { search: "aaa".into(), replace: "AAA".into() },
            SearchReplaceBlock { search: "zzz".into(), replace: "ZZZ".into() },
        ];
        let (new, missing, hits) = apply_search_replace_blocks(content, &blocks);
        assert_eq!(new, "AAA bbb");
        assert_eq!(missing, vec!["zzz".to_string()]);
        assert_eq!(hits, 1);
    }

    #[test]
    fn search_replace_只替换首次出现() {
        let content = "x x x";
        let blocks = vec![SearchReplaceBlock { search: "x".into(), replace: "Y".into() }];
        let (new, missing, hits) = apply_search_replace_blocks(content, &blocks);
        assert_eq!(new, "Y x x");
        assert!(missing.is_empty());
        assert_eq!(hits, 1);
    }

    #[test]
    fn resolve_replace_选区模式() {
        let current = "标题\n正文\n结尾";
        let (resolved, _) = resolve_replace_draft(
            "doc1",
            current,
            vec![SearchReplaceBlock { search: "ignored".into(), replace: "新正文".into() }],
            Some(EditorSelection { replacing_selection: Some("正文".into()) }),
            None,
        )
        .unwrap();
        assert_eq!(resolved.mode, DraftMode::SelectedText);
        assert_eq!(resolved.content, "标题\n新正文\n结尾");
        assert!(resolved.can_apply);
        assert_eq!(resolved.replacement_count, 1);
    }

    #[test]
    fn resolve_replace_选区未命中则不能应用() {
        let current = "标题\n结尾";
        let (resolved, _) = resolve_replace_draft(
            "doc1",
            current,
            vec![SearchReplaceBlock { search: "x".into(), replace: "y".into() }],
            Some(EditorSelection { replacing_selection: Some("不存在".into()) }),
            None,
        )
        .unwrap();
        assert!(!resolved.can_apply);
        assert_eq!(resolved.missing_searches, vec!["不存在".to_string()]);
    }

    #[test]
    fn resolve_whole_document_模式正确() {
        let (resolved, _) =
            resolve_whole_document_draft("doc1", "# 全新内容".into(), Some("note".into())).unwrap();
        assert_eq!(resolved.mode, DraftMode::WholeDocument);
        assert_eq!(resolved.content, "# 全新内容");
        assert!(resolved.can_apply);
        assert_eq!(resolved.note.as_deref(), Some("note"));
    }

    #[test]
    fn resolve_create_空标题报错() {
        let r = resolve_create_draft("  ", "content".into(), None);
        assert!(r.is_err());
    }

    #[test]
    fn stage_and_take_草稿生命周期() {
        let (resolved, staged) =
            resolve_whole_document_draft("doc-stage", "# hi".into(), None).unwrap();
        let staged_back = stage_draft(staged).unwrap();
        assert_eq!(staged_back.id, resolved.id);

        let got = get_draft(&resolved.id).unwrap().unwrap();
        assert_eq!(got.content, "# hi");

        let taken = take_staged(&resolved.id).unwrap().unwrap();
        assert_eq!(taken.resolved.content, "# hi");

        let again = take_staged(&resolved.id).unwrap();
        assert!(again.is_none());
    }

    #[test]
    fn discard_移除草稿() {
        let (resolved, staged) =
            resolve_create_draft("待删", "x".into(), None).unwrap();
        let _ = stage_draft(staged).unwrap();
        let ok = discard_draft(&resolved.id).unwrap();
        assert!(ok);
        let ok2 = discard_draft(&resolved.id).unwrap();
        assert!(!ok2);
    }
}
