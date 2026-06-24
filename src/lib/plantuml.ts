/**
 * PlantUML 编码(阶段 6.6)
 *
 * 对齐 iOS PlantUMLRenderURL:
 *   - 用 pako 把 PlantUML 源码做 zlib deflate
 *   - 按 PlantUML 字母表编码成 URL 安全字符串
 *   - 拼成 plantuml.com 的 PNG URL(用户可自建 server 时替换)
 *
 * PlantUML 编码参考:https://plantuml.com/text-encoding
 */

import pako from "pako";

/** PlantUML 自定义字母表(0-63) */
const PLANTUML_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** 6-bit 编码:3 字节 → 4 字符 */
function encode64(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i] ?? 0;
    const b2 = data[i + 1] ?? 0;
    const b3 = data[i + 2] ?? 0;
    out += PLANTUML_ALPHABET[b1 >> 2];
    out += PLANTUML_ALPHABET[((b1 & 0x03) << 4) | (b2 >> 4)];
    out += PLANTUML_ALPHABET[((b2 & 0x0f) << 2) | (b3 >> 6)];
    out += PLANTUML_ALPHABET[b3 & 0x3f];
  }
  return out;
}

/**
 * 把 PlantUML 源码编码成 PlantUML server 可识别的字符串
 *
 * 对齐 iOS PlantUMLRenderURL.encodePlantUML:
 *   1. UTF-8 encode
 *   2. zlib deflate(原始,无 header)
 *   3. 6-bit 编码
 */
export function encodePlantUml(source: string): string {
  const utf8 = new TextEncoder().encode(source);
  const deflated = pako.deflate(utf8, { level: 9, raw: true });
  return encode64(deflated);
}

/** 默认 PlantUML server(可被用户配置覆盖) */
export const DEFAULT_PLANTUML_SERVER = "https://www.plantuml.com/plantuml";

/**
 * 生成 PlantUML PNG URL
 *
 * 对齐 iOS PlantUMLRenderURL.pngURL(for:)
 */
export function plantumlPngUrl(source: string, server: string = DEFAULT_PLANTUML_SERVER): string {
  const encoded = encodePlantUml(source);
  return `${server}/png/${encoded}`;
}

/** 生成 PlantUML SVG URL(矢量,推荐) */
export function plantumlSvgUrl(source: string, server: string = DEFAULT_PLANTUML_SERVER): string {
  const encoded = encodePlantUml(source);
  return `${server}/svg/${encoded}`;
}
