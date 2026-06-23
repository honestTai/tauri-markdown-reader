//! Markdown 分块策略
//!
//! 对齐 iOS ClientDocumentIndex 的分块逻辑：
//!   - 按标题层级（# / ## / ### ...）切分
//!   - 每个标题块下的段落归到该标题
//!   - 标题前的"前言"作为独立块
//!
//! 纯函数，无 I/O，便于单元测试。

/// 单个分块
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// 所属标题（None 表示文档前言）
    pub heading: Option<String>,
    /// 块内文本（不含标题行本身）
    pub text: String,
}

/// 单个 chunk 的最大字符数，超出则按段落进一步切分
const MAX_CHUNK_CHARS: usize = 1200;

/// 把 Markdown 文本切成 chunks
pub fn chunk_markdown(text: &str) -> Vec<Chunk> {
    let mut raw: Vec<(Option<String>, String)> = Vec::new();
    let mut cur_heading: Option<String> = None;
    let mut buf = String::new();

    let flush = |heading: &Option<String>, buf: &mut String, out: &mut Vec<(Option<String>, String)>| {
        if buf.is_empty() {
            return;
        }
        out.push((heading.clone(), std::mem::take(buf)));
    };

    for line in text.lines() {
        if atx_heading_level(line).is_some() {
            flush(&cur_heading, &mut buf, &mut raw);
            let heading_text = line.trim_start_matches('#').trim().to_string();
            cur_heading = Some(heading_text);
        } else {
            if !buf.is_empty() {
                buf.push('\n');
            }
            buf.push_str(line);
        }
    }
    flush(&cur_heading, &mut buf, &mut raw);

    let mut chunks = Vec::with_capacity(raw.len());
    for (heading, text) in raw {
        if text.chars().count() <= MAX_CHUNK_CHARS {
            chunks.push(Chunk { heading, text });
        } else {
            for sub in split_long_text(&text, MAX_CHUNK_CHARS) {
                chunks.push(Chunk { heading: heading.clone(), text: sub });
            }
        }
    }
    chunks
}

/// 判断是否是 ATX 标题行，返回 # 的数量（1..=6），否则 None
fn atx_heading_level(line: &str) -> Option<u8> {
    let trimmed = line.trim_start();
    let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') {
        Some(hashes as u8)
    } else {
        None
    }
}

/// 把过长的文本按段落切分，返回多个子串
fn split_long_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();

    for para in split_paragraphs(text) {
        let para_len = para.chars().count();
        if !current.is_empty() && current.chars().count() + para_len + 1 > max_chars {
            out.push(std::mem::take(&mut current));
        }
        if current.is_empty() {
            current.push_str(&para);
        } else {
            current.push('\n');
            current.push_str(&para);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }

    let mut final_out = Vec::with_capacity(out.len());
    for sub in out {
        if sub.chars().count() <= max_chars {
            final_out.push(sub);
        } else {
            let mut buf = String::new();
            for ch in sub.chars() {
                buf.push(ch);
                if buf.chars().count() >= max_chars {
                    final_out.push(std::mem::take(&mut buf));
                }
            }
            if !buf.is_empty() {
                final_out.push(buf);
            }
        }
    }
    final_out
}

/// 按空行切段落（保留段内换行）
fn split_paragraphs(text: &str) -> Vec<String> {
    let mut paras = Vec::new();
    let mut cur = String::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !cur.is_empty() {
                paras.push(std::mem::take(&mut cur));
            }
        } else {
            if !cur.is_empty() {
                cur.push('\n');
            }
            cur.push_str(line);
        }
    }
    if !cur.is_empty() {
        paras.push(cur);
    }
    if paras.is_empty() {
        paras.push(String::new());
    }
    paras
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_returns_empty() {
        assert!(chunk_markdown("").is_empty());
    }

    #[test]
    fn no_heading_single_chunk() {
        let chunks = chunk_markdown("第一行\n第二行\n\n第三段");
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].heading.is_none());
        assert!(chunks[0].text.contains("第一行"));
    }

    #[test]
    fn single_heading_chunk() {
        let chunks = chunk_markdown("# 标题\n内容一\n内容二");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].heading.as_deref(), Some("标题"));
        assert_eq!(chunks[0].text, "内容一\n内容二");
    }

    #[test]
    fn multi_heading_split() {
        let md = "# 一级\n内容 A\n## 二级\n内容 B\n# 又一个\n内容 C";
        let chunks = chunk_markdown(md);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].heading.as_deref(), Some("一级"));
        assert_eq!(chunks[1].heading.as_deref(), Some("二级"));
        assert_eq!(chunks[2].heading.as_deref(), Some("又一个"));
    }

    #[test]
    fn preface_before_heading() {
        let md = "前言内容\n# 标题\n正文";
        let chunks = chunk_markdown(md);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].heading.is_none());
        assert!(chunks[0].text.contains("前言"));
        assert_eq!(chunks[1].heading.as_deref(), Some("标题"));
    }

    #[test]
    fn atx_level_detection() {
        assert_eq!(atx_heading_level("# a"), Some(1));
        assert_eq!(atx_heading_level("### a"), Some(3));
        assert_eq!(atx_heading_level("###### a"), Some(6));
        assert_eq!(atx_heading_level("####### a"), None);
        assert_eq!(atx_heading_level("#tag"), None);
        assert_eq!(atx_heading_level("普通文本"), None);
        assert_eq!(atx_heading_level(""), None);
    }

    #[test]
    fn long_text_split_by_paragraph() {
        // 单块超长（MAX_CHUNK_CHARS=1200），需触发二次切分
        let para: String = "测试中文长文本分块逻辑".repeat(60); // 60 * 10 = 600 字符
        assert!(para.chars().count() >= 600);
        let mut md = String::from("# 标题\n\n");
        for _ in 0..4 {
            md.push_str(&para);
            md.push_str("\n\n");
        }
        let chunks = chunk_markdown(&md);
        assert!(chunks.len() > 1, "长文本应被切成多块，实际 {}", chunks.len());
        for c in &chunks {
            assert_eq!(c.heading.as_deref(), Some("标题"));
        }
    }
}
