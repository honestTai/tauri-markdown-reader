/**
 * PlantUML 编码单测(阶段 6.6)
 *
 * 对齐 iOS PlantUMLRenderURLTests:
 *   - encodePlantUml 输出只含 PlantUML 字母表字符
 *   - 相同输入确定性输出
 *   - URL 拼接正确
 */
import { describe, it, expect } from "vitest";
import {
  encodePlantUml,
  plantumlPngUrl,
  plantumlSvgUrl,
  DEFAULT_PLANTUML_SERVER,
} from "../plantuml.js";

describe("encodePlantUml", () => {
  it("输出只含 PlantUML 字母表字符", () => {
    const encoded = encodePlantUml("@startuml\nA->B\n@enduml");
    expect(encoded).toMatch(/^[0-9A-Za-z_\-]+$/);
  });

  it("相同输入确定性输出", () => {
    const a = encodePlantUml("hello");
    const b = encodePlantUml("hello");
    expect(a).toBe(b);
  });

  it("不同输入产出不同编码", () => {
    const a = encodePlantUml("@startuml\nA->B\n@enduml");
    const b = encodePlantUml("@startuml\nA->C\n@enduml");
    expect(a).not.toBe(b);
  });
});

describe("plantumlPngUrl / plantumlSvgUrl", () => {
  it("PNG URL 拼接正确", () => {
    const url = plantumlPngUrl("@startuml\nA->B\n@enduml");
    expect(url.startsWith(DEFAULT_PLANTUML_SERVER + "/png/")).toBe(true);
  });

  it("SVG URL 拼接正确", () => {
    const url = plantumlSvgUrl("@startuml\nA->B\n@enduml");
    expect(url.startsWith(DEFAULT_PLANTUML_SERVER + "/svg/")).toBe(true);
  });

  it("支持自定义 server", () => {
    const url = plantumlPngUrl("A", "https://my.server/plantuml");
    expect(url.startsWith("https://my.server/plantuml/png/")).toBe(true);
  });
});
