# AGENTS.MD - 项目需求与系统演进规范

## 1. 项目基础信息与仓库地址

- **项目名称**：SessionSwitch - 网站多账号登录会话切换器
- **GitHub 仓库**：[https://github.com/aruiplex/sessions.git](https://github.com/aruiplex/sessions.git)
- **本地工作目录**：`/Users/aruix/Documents/sessions`
- **目标平台**：Google Chrome / Microsoft Edge / Brave / Arc 等 Chromium 内核浏览器（基于 Manifest V3 规范）
- **本地共享数据存储**：`~/.sessionswitch/shared_sessions.json`

---

## 2. 用户需求全景与迭代历程

### 需求 1：多账号会话保存与随时切换工具
- **用户原话**：“我想做一个工具，可以在一个网站上保存多份登录记录，并且随时切换。”
- **技术落地**：
  - 构建 Chromium 浏览器扩展（Manifest V3），免去复杂的外部脚本，在当前网页右上角即可弹窗操作。
  - **三维凭证完整捕获与回填**：
    - **Cookies**：通过 `chrome.cookies` 原生 API，完整读取与写入普通 Cookie、`HttpOnly` Cookie、`Secure` Cookie、跨子域名 Cookie。
    - **LocalStorage**：通过 `chrome.scripting` 安全上下文注入，捕获现代前端单页应用（SPA）、JWT Token、Pinia/Vuex/Redux 状态。
    - **SessionStorage**：同步恢复临时会话级状态。
  - 一键切换并强制刷新标签页，秒级生效。

---

### 需求 2：Git 版本控制管理
- **用户原话**：“你用 git 管理。”
- **技术落地**：
  - 初始化 Git 本地仓库，配置 `.gitignore` 规则（过滤 `.DS_Store`、打包文件和日志文件）。
  - 每一个功能模块与缺陷修复均严格按照语义化提交规范（Conventional Commits）入库。

---

### 需求 3：排查本地各 Chrome Profile 的目标站点账号
- **用户原话**：“你能看到现在我的 chrome 中所有 profile 中，对于 learningmall.cn/zh 的账号信息吗？”
- **技术落地**：
  - 扫描本地 `~/Library/Application Support/Google/Chrome` 下的各 Profile 配置（Default, Profile 1, Profile 4, Profile 5, Profile 6）。
  - 识别出保存的用户名：`CHENGRUI.ZHANG18`、`YUXIN.DONG18`、`Liming.pang25`、`Huazhen.Li24` 等，以及通过西浦统一认证单点登录（UIM/SSO）关联的凭据。
  - 明确了多 Profile 分散保存导致的切换繁琐痛点，确立了聚合切换的产品价值。

---

### 需求 4：清空当前登录以录入新账号（向导模式）
- **用户原话**：“可以再添加一个功能吗？把当前的登录状态清除，我再登下一个账号，保存在这个插件中。”
- **技术落地**：
  - 顶部增加高对比度的 **「✨ 清空并录入新账号」** 专属功能按钮。
  - **深度凭据清理**：不仅清理当前站点的 Cookie、LocalStorage、SessionStorage 与 IndexedDB，还特别针对统一认证系统（如西浦 CAS/SSO `uim.xjtlu.edu.cn`）一并清理 `TGC`、`SESSION` 票据，彻底杜绝“注销后刷新又自动静默登录回旧账号”的问题。
  - 刷新网页回到纯净登录页，插件自动进入“新账号录入向导”，指导用户登录后点击「保存当前账号」完成录入。

---

### 需求 5：确认弹窗无响应交互缺陷修复
- **用户原话**：“我点击清空并录入新账号后，并点击了确认，但是没有任何反应”
- **缺陷分析**：确认弹窗点击确定时，先行调用了 `closeConfirmModal()`，该方法在关闭时将待执行回调重置为 `null`，导致后续判断失效，任务未真正执行。
- **技术修复**：
  - 调整执行时序，预先暂存任务句柄再关闭弹窗并执行；
  - 动态获取当前活动 Tab 实例，确保清理完后必定强制执行标签页重新加载。

---

### 需求 6：拒绝手动导入导出，全自动跨 Profile 本地共享（方案 B）
- **用户原话**：“我不想手动导入，能自动做的不要手动，你按照方案 B 来做”
- **核心诉求**：多 Profile 之间沙箱隔离，用户拒绝手动导出 JSON 再导入，要求完全自动化。
- **技术落地**：
  - **轻量本地同步守护进程 (`sync_server.js`)**：编写原生 Node.js 后台中间件，仅监听本地私有环回地址 `127.0.0.1:49152`（零公网暴露，常驻内存仅约 15MB）。
  - **macOS LaunchAgent 开机守护**：配置 `~/Library/LaunchAgents/com.sessionswitch.sync.plist`，实现系统开机静默启动、崩溃自启。
  - **公共数据中心**：数据持久化于 `~/.sessionswitch/shared_sessions.json`。
  - **插件自动双向同步**：各 Profile 打开插件时自动拉取公共库做双向合并；保存时自动推送到公共库；图标展示绿色 `☁️ 自动同步` 徽章。

---

### 需求 7：生态多域名智能聚合与跨域直达
- **用户原话**：“我在两个 profile 中都重新 load 插件，显示打开了自动同步，但是并不能互相看到登录信息”
- **根因分析**：用户在 Profile 1 登录后停留在教学系统 `core.xjtlu.edu.cn` 并保存账号；而在 Profile 2 中停留在门户首页 `learningmall.cn/zh`。原系统采用严格单一域名匹配，导致在门户首页误判为“0 个账号”。
- **技术落地**：
  - **域名生态群组 (`DOMAIN_CLUSTERS`)**：将 `learningmall.cn`、`www.learningmall.cn`、`core.xjtlu.edu.cn`、`premium.learningmall.cn` 绑定为同一生态。
  - **智能聚合呈现**：无论在门户还是教学系统，自动聚合显示该生态下的所有账号，并标明 `🔗 来自 core.xjtlu.edu.cn`。
  - **跨域一键直达**：在门户首页点击切换账号，插件不仅写入凭证，还会自动直达跳转至该账号的课程主页（`core.xjtlu.edu.cn/my/`），免去二次点击登录。

---

## 3. 技术架构与关键实现细节

```mermaid
flowchart TD
    subgraph ChromeProfile1 [Chrome Profile 1 (Default)]
        Ext1[SessionSwitch 插件]
    end

    subgraph ChromeProfile2 [Chrome Profile 2]
        Ext2[SessionSwitch 插件]
    end

    subgraph ChromeProfileN [Chrome Profile N]
        ExtN[SessionSwitch 插件]
    end

    subgraph LocalSyncDaemon [macOS 本地同步守护系统]
        LaunchAgent[macOS LaunchAgent<br/>com.sessionswitch.sync.plist]
        SyncServer[本地同步服务 sync_server.js<br/>127.0.0.1:49152]
        SharedJSON[(集中存储文件<br/>~/.sessionswitch/shared_sessions.json)]
    end

    LaunchAgent -->|开机静默常驻/故障自启| SyncServer
    SyncServer <-->|原子读写与版本合并| SharedJSON

    Ext1 <-->|HTTP REST API / 双向合并| SyncServer
    Ext2 <-->|HTTP REST API / 双向合并| SyncServer
    ExtN <-->|HTTP REST API / 双向合并| SyncServer
```

### 关键机制设计：
1. **原子写入（Atomic Write）**：同步服务写入 `shared_sessions.json` 时采用“临时文件写入 + 原子重命名（renameSync）”策略，避免断电或崩溃导致 JSON 损坏。
2. **时序合并算法（Timestamp-based Merge）**：不同 Profile 修改同一账号时，以 `updatedAt` 时间戳更新者为准；新账号自动追加，保证多 Profile 无损并集。
3. **SSO 关联探测与深度注销**：针对西浦等统一认证体系，注销时递归扫描关联 SSO 域名，彻底清除 `TGC`、`SESSION` 等认证票据。
4. **离线高可用降级**：若后台同步服务意外未开启，插件自动静默降级为 Profile 内部独立的 `chrome.storage.local`，界面展示 `💻 本地模式`，绝不影响基础使用。

---

## 4. 项目文件索引

| 文件 | 描述 |
| :--- | :--- |
| `manifest.json` | 扩展 MV3 配置文件，声明 cookies、storage、scripting 权限与后台 Worker |
| `background.js` | 后台服务线程，监听活动标签页、更新工具栏角标、轮询同步状态 |
| `popup.html` | 弹窗视图界面，包含当前站点、全部站点、备份管理三大视图 |
| `popup.css` | 现代化 UI 样式，响应式卡片布局与交互微动效 |
| `popup.js` | 核心业务控制逻辑（凭据采集、注入回填、域名集群匹配、双向同步） |
| `sync_server.js` | 本地轻量跨 Profile 同步中间件（HTTP 127.0.0.1:49152） |
| `install_service.sh` | macOS LaunchAgent 守护服务一键安装脚本 |
| `uninstall_service.sh` | 守护服务卸载与停止脚本 |
| `icons/` | 16/32/48/128 高清扩展图标 |
| `README.md` | 用户使用指南与安装文档 |
| `agents.md` | 本文档（需求演进全景与架构规范） |

---

## 5. 维护与操作指南

### Git 远程推送说明
若需将本地提交推送到 GitHub 远程仓库，运行以下命令即可：
```bash
git remote add origin https://github.com/aruiplex/sessions.git
git branch -M main
git push -u origin main
```

### 本地同步服务控制命令
- **查看服务运行状态**：`curl -s http://127.0.0.1:49152/api/status`
- **查看服务运行日志**：`tail -f ~/.sessionswitch/sync.log`
- **重新安装/重启守护服务**：`./install_service.sh`
- **停止守护服务**：`./uninstall_service.sh`
