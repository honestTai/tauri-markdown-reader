/**
 * sidecar 构建脚本
 *
 * 把 src-sidecar/*.ts 打成单文件 CommonJS，输出到 src-tauri/resources/flowmark-agent.cjs
 * Tauri 在 release 打包时通过 `bundle.resources` 把该文件随安装包分发
 *
 * 阶段 1 简化方案：用 esbuild（依赖少、速度快、零配置）
 * 后续阶段 4 引入 LangChain 后，esbuild 会自动 bundle 进来
 */

const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "src-sidecar", "server.ts");
const outDir = path.join(root, "src-tauri", "resources");
const outFile = path.join(outDir, "flowmark-agent.cjs");

fs.mkdirSync(outDir, { recursive: true });

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  console.error("[build-sidecar] 缺少 esbuild 依赖，请先 `pnpm add -D esbuild`");
  process.exit(1);
}

esbuild
  .build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: outFile,
    sourcemap: false,
    minify: true,
    // LangChain 体积大，先不 external，全量打进单文件
    // 若后续体积过大，再 external 到 node_modules
    logLevel: "info",
  })
  .then(() => {
    console.log(`[build-sidecar] 已生成 ${path.relative(root, outFile)}`);
  })
  .catch((e) => {
    console.error("[build-sidecar] 构建失败:", e);
    process.exit(1);
  });
