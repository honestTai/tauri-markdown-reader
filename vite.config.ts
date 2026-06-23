import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 前端 Vite 配置
// Tauri 约定：dev 时前端跑在 1420 端口，Tauri 窗口加载 http://localhost:1420
// clearScreen 防止 Tauri CLI 的输出被 Vite 清屏冲掉
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
