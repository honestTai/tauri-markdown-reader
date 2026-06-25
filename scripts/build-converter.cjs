/**
 * Python 转换器打包脚本
 *
 * 用 PyInstaller 将 flowmark-converter/ 打包为独立 .exe，
 * 输出到 src-tauri/resources/flowmark-converter.exe。
 * Tauri release 打包时通过 bundle.resources 随安装包分发。
 *
 * 用法: node scripts/build-converter.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const converterDir = path.join(root, "flowmark-converter");
const entry = path.join(converterDir, "main.py");
const outDir = path.join(root, "src-tauri", "resources");
const outName = "flowmark-converter";

// 确保资源目录存在
fs.mkdirSync(outDir, { recursive: true });

// 检查 PyInstaller 是否可用
let pyinstallerCmd = "pyinstaller";
try {
  execSync("pyinstaller --version", { stdio: "pipe" });
} catch {
  // 尝试 python -m PyInstaller
  try {
    execSync("python -m PyInstaller --version", { stdio: "pipe" });
    pyinstallerCmd = "python -m PyInstaller";
  } catch {
    console.error("[build-converter] 缺少 PyInstaller，请先 pip install pyinstaller");
    process.exit(1);
  }
}

console.log("[build-converter] 开始打包 Python 转换器...");

// 临时构建目录
const buildDir = path.join(root, ".pyinstaller-build");
fs.mkdirSync(buildDir, { recursive: true });

try {
  // 执行 PyInstaller
  execSync(
    [
      pyinstallerCmd,
      "--onefile",               // 单文件 exe
      "--console",               // 保留 stdio（Rust 通过 stdin/stdout 通信）
      "--name", outName,
      "--distpath", outDir,      // 直接输出到 resources/
      "--workpath", buildDir,    // 临时构建文件
      "--specpath", buildDir,
      "--paths", converterDir,   // 让 PyInstaller 能找到 rpc.py 和 parsers/
      "--clean",                 // 清理旧构建
      // 隐藏导入（确保依赖被打包）
      "--hidden-import", "docx",
      "--hidden-import", "pdfplumber",
      "--hidden-import", "rapidocr_onnxruntime",
      "--hidden-import", "PIL",
      "--hidden-import", "urllib.request",
      // 排除不需要的大型库减小体积
      "--exclude-module", "tkinter",
      "--exclude-module", "matplotlib",
      "--exclude-module", "numpy",
      "--exclude-module", "scipy",
      "--exclude-module", "pandas",
      entry,
    ].join(" "),
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    }
  );

  // 清理临时目录
  fs.rmSync(buildDir, { recursive: true, force: true });

  const exePath = path.join(outDir, `${outName}.exe`);
  if (fs.existsSync(exePath)) {
    const sizeKB = (fs.statSync(exePath).size / 1024).toFixed(0);
    console.log(`[build-converter] 已生成 ${exePath} (${sizeKB} KB)`);
  } else {
    console.error("[build-converter] 未找到输出文件，打包可能失败");
    process.exit(1);
  }
} catch (e) {
  console.error("[build-converter] 打包失败:", e.message);
  // 清理临时目录
  try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
}
