//! 文档内容指纹
//!
//! 对齐 iOS ClientDocumentIndex.fingerprint：
//!   - SHA-256 哈希
//!   - 用于判定文档是否变更，未变更则跳过重新分块
//!
//! 用 sha2 crate，不引入更重的依赖

use sha2::{Digest, Sha256};

/// 计算文本内容的 SHA-256 指纹（hex 小写）
pub fn fingerprint(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let bytes = hasher.finalize();
    // 转成 hex 字符串
    let mut out = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 相同内容指纹相同() {
        assert_eq!(fingerprint("hello"), fingerprint("hello"));
    }

    #[test]
    fn 不同内容指纹不同() {
        assert_ne!(fingerprint("hello"), fingerprint("world"));
    }

    #[test]
    fn 指纹长度为64() {
        assert_eq!(fingerprint("").len(), 64);
    }

    #[test]
    fn 空字符串指纹稳定() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            fingerprint(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn 中文内容指纹稳定() {
        let a = fingerprint("你好世界");
        let b = fingerprint("你好世界");
        assert_eq!(a, b);
        assert_ne!(a, fingerprint("你好世界2"));
    }
}
