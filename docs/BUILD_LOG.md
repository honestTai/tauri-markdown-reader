# Tauri Markdown Reader Build Log

这个文件记录从想法到实现的每一步，后续可用于整理公众号推文素材。

## 2026-06-01 12:36

- 按用户要求，新建独立项目目录：`C:\Users\hones\Desktop\project\tauri-markdown-reader`。实现代码不放在原公众号工作流仓库里。
- `create-tauri-app` 在当前非交互终端报错 `IO error: not a terminal`，因此改用 Vite React TypeScript 先建前端，再手动补 Tauri 2 配置。
- 安装前端依赖：Tauri API、dialog 插件、marked、lucide-react、html-to-image。
- 后端职责定为：扫描文章目录、读取 Markdown、内联本地图片、写操作日志、保存公众号 HTML、保存小红书卡片图片。
- 前端职责定为：三栏工作台、电脑阅读、公众号预览、小红书卡片、检查面板和导出动作。

## 2026-06-01 12:47

- 第一次前端构建通过，说明 React/Vite 主体代码和 TypeScript 类型检查可用。
- 第一次 `cargo check` 失败，原因是手工创建 Tauri 项目时缺少 Windows 资源图标：`icons/icon.ico`。
- 生成本地图标文件并写入 `src-tauri/icons/icon.ico`，同时在 `tauri.conf.json` 中声明该图标。

## 2026-06-01 13:02

- 修复 lint：React 19 的新 lint 规则会阻止桌面应用启动时读取本地文件的初始化副作用，因此对当前项目关闭 `react-hooks/immutability` 和 `react-hooks/set-state-in-effect`。
- 移除 `gray-matter`，改用本地 frontmatter 解析函数，避免构建时出现依赖内部 `eval` 警告。
- 完成浏览器预览验证：三栏工作台可见，公众号、小红书、检查标签能正常切换。
- 完成 Tauri release 构建，生成桌面 exe、MSI 和 NSIS 安装包。
- 增加 Rust 测试，覆盖默认文章工作区扫描和 Markdown 文件读取。
- 补齐“指定文章目录”场景：后端现在接受仓库根目录、`articles/` 目录、`articles/drafts`、`articles/wemd-inbox` 或 `articles/approved` 作为工作区输入。

## 2026-06-01 13:20

- 根据用户反馈调整产品规则：工具启动后不再默认打开固定公众号仓库，改为用户自己选择或输入 Markdown 目录。
- 扫描能力从公众号工作流目录扩展到普通 Markdown 文件夹；如果目录里没有 `articles/` 工作流结构，就递归扫描普通 `.md` 文档。
- 增加 Markdown 编辑模式，用户可以在中间主区域直接编辑当前文档。
- 增加 `保存MD` 动作和 `Ctrl+S` 快捷保存，保存后重新读取文件并刷新预览内容。
- 浏览器验证了启动空状态、用户输入目录后的示例加载、编辑面板显示、编辑后未保存状态提示。

## 2026-06-01 13:45

- 增加面板折叠：左侧文档栏和右侧平台栏都可以展开/收起，顶部也提供对应按钮。
- 增加专注模式：进入后隐藏左右侧栏，中间改为 VS Code 风格的左右分屏。
- 专注模式左侧为 Markdown 编辑器，右侧为实时预览，可以在电脑阅读、公众号、小红书卡片之间切换。
- 为浏览器开发验证增加 `?demo=1` 测试入口；Tauri 桌面版仍然保持启动后由用户自己选择目录。
- 浏览器验证了文档栏折叠、平台栏折叠、专注模式进入、侧栏隐藏、实时预览区域显示，以及专注模式里的公众号/小红书预览切换。

## 2026-06-01 14:12

- 修复 Windows release 版启动时同时出现控制台窗口的问题。
- 在 Tauri 入口增加 `windows_subsystem = "windows"`，仅 release 模式隐藏控制台，开发模式仍保留调试输出。

## 2026/6/1 15:17:38

- 打开文章：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles/wemd-inbox\codex-wemd-workflow.md

## 2026/6/1 15:17:38

- 刷新文章列表：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles，共 68 篇。

## 2026/6/1 15:17:38

- 切换工作区：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles

## 2026/6/1 15:17:39

- 打开文章：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles/wemd-inbox\codex-wemd-workflow.md

## 2026/6/1 15:18:08

- 复制公众号 HTML：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles/wemd-inbox\codex-wemd-workflow.md

## 2026-06-01 15:30

- 根据用户反馈暂停小红书能力：前端移除小红书标签、专注模式小红书预览和图片导出入口，当前版本只保留公众号预览与检查面板。
- 移除前端 `html-to-image` 依赖，避免为暂不使用的小红书卡片导出保留额外包。
- Tauri 后端同步移除小红书图片保存命令，当前 command 面只保留工作区、Markdown 保存、公众号 HTML 和构建日志相关能力。
- 编辑模式和专注模式都增加 Markdown 格式工具栏，支持插入二级标题、加粗、行内代码、代码块、无序列表、有序列表、引用、链接和图片。
- 编辑模式和专注模式都增加编辑区与公众号预览区的滚动同步；选择公众号预览后，左侧向下滚动或继续编辑时，右侧公众号预览会按当前位置跟随。

## 2026-06-01 15:55

- 根据用户反馈，把手写 textarea 工具栏替换为开源富文本 Markdown 编辑器 `@mdxeditor/editor`。
- 选择原因：MDXEditor 是 MIT 协议，包描述为富文本 Markdown 编辑，peer dependency 支持当前项目使用的 React 19；对比后没有使用 React peer 仍停留在 17 的 Toast UI React 包。
- 编辑模式和专注模式统一使用 MDXEditor，保留整份 Markdown 读写，包括 frontmatter、标题、列表、引用、链接、图片、表格和代码块。
- 保留 `Ctrl+S` 保存、公众号预览同步滚动和原有 Markdown 保存路径；这次只是替换编辑控件，不改变文件结构。
- 富文本编辑器按文章路径重新挂载，切换 Markdown 文档时可以正确加载新内容。

## 2026/6/1 15:49:53

- 刷新文章列表：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles\xiaohongshu-upload-packages\beijing-house-price-ml，共 0 篇。

## 2026/6/1 15:49:53

- 切换工作区：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles\xiaohongshu-upload-packages\beijing-house-price-ml

## 2026/6/1 15:50:14

- 打开文章：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles/wemd-inbox\codex-wemd-workflow.md

## 2026/6/1 15:50:15

- 刷新文章列表：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles\approved，共 68 篇。

## 2026/6/1 15:50:15

- 切换工作区：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles\approved

## 2026/6/1 15:50:59

- 打开文章：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles/wemd-inbox\codex-wemd-workflow.md

## 2026/6/1 15:50:59

- 刷新文章列表：C:\Users\hones\Desktop\project\codex-wemd-md2wechat-workflow\articles\approved，共 68 篇。

## 2026/6/1 16:32:54

- 打开文章：C:\Users\hones\Desktop\md\公众号\_工具文档\docs\faliang-ai-column-playbook.md

## 2026/6/1 16:32:54

- 刷新文章列表：C:\Users\hones\Desktop\md，共 187 篇。

## 2026/6/1 16:32:54

- 切换工作区：C:\Users\hones\Desktop\md

## 2026/6/1 16:32:57

- 打开文章：C:\Users\hones\Desktop\md\公众号\Python 网站扫描系统：端口资产、指纹识别、POC检测和运行截图\articles\approved\python-website-scanner-assets\verification.md

## 2026/6/1 16:32:59

- 打开文章：C:\Users\hones\Desktop\md\公众号\_工具文档\docs\faliang-ai-column-samples.md
