# ZenPilot · 禅效通 (ZenTao Efficiency & Automation Studio)

<p align="center">
  <img src="static/images/logo.png" width="96" height="96" alt="ZenPilot Logo" style="border-radius: 16px; box-shadow: 0 8px 24px rgba(37,99,235,0.2);" />
</p>

<p align="center">
  <strong>专为禅道系统打造的高效研发效能助手与自动化操作套件</strong><br>
  待办任务智能报工流转 · 多维过滤与批量修改 · 浏览器原生油猴脚本 · Gitee提交联动 · DeepSeek AI 研发助手
</p>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-Userscript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Flask-3.x-000000?style=flat-square&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/ZenTao-兼容全版本-0080FF?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

> ### ⚠️ 免责声明 (Disclaimer)
> **本贴涉及相关资料仅限学习研究使用，若本贴有冒犯到您的任何权益，请在站内私信删除本贴。本贴所有资料禁止商用，请支持正版软件等话语，避免法律纠纷。**
> 任何个人或组织因违反上述声明所导致的任何法律纠纷或后果，由使用者自行承担，与本项目原作者无关。

---

## 📖 项目简介

**ZenPilot (禅效通)** 是一款针对标准开源版、专业版、企业版及云禅道系统深度定制的高效效能辅助工具套件。

日常研发在使用禅道进行项目管理时，常面临 **“批量修改繁琐、任务流转操作步骤多、状态修改频繁卡顿、跨项目指派耗时、工时统计麻烦”** 等痛点。ZenPilot 提供 **两套使用模式**（包括**强烈推荐的浏览器油猴脚本模式**与**独立 Web 效能驾驶舱控制台模式**），帮助研发团队与个人大幅降低机械化操作负担。

---

## 🚀 两种使用方式（优先推荐方式一）

本项目贴合不同使用习惯，提供以下两种灵活使用方案：

### 🌟 方式一：浏览器油猴/Tampermonkey插件方式（强烈推荐 ⭐⭐⭐⭐⭐）

> **为什么最推荐插件方式？**
> - **零环境配置**：无需安装 Python、无需配置服务端、不占用任何系统端口；
> - **同源直接运行**：直接运行在当前已登录的禅道网页中，自动携带 Cookie/Session，避免任何跨域鉴权问题；
> - **无缝嵌入原生网页**：在禅道任务列表页面右下角以现代化轻量悬浮面板呈现，即开即用。

#### 安装与使用步骤：
1. **安装浏览器扩展**：在 Chrome / Edge / Firefox 等浏览器扩展商店安装 **Tampermonkey (油猴)**、**Violentmonkey (暴力猴)** 或 **ScriptCat (脚本猫)**；
2. **安装脚本**：
   - 如果已启动本地服务，直接在浏览器地址栏打开：[http://127.0.0.1:5000/static/js/zentao_batch_helper.user.js](http://127.0.0.1:5000/static/js/zentao_batch_helper.user.js) 点击安装；
   - 或打开浏览器扩展面板，点击 **“添加新脚本”**，将本项目中 [static/js/zentao_batch_helper.user.js](static/js/zentao_batch_helper.user.js) 的完整代码复制粘贴并保存；
3. **日常使用**：
   - 打开日常禅道网页（如“我的待办”、“执行看板”、“项目任务”列表），页面右下角会自动弹出 **`⚡ 批量操作助手`** 悬浮胶囊；
   - 点击即可展开面板，体验：
     - **一键批量完成报工**（自动流转未开始为进行中、按预计工时报工、设置模拟人工间隔防频控）；
     - **多维字段批量修改**（名称前后缀/文本查找替换、指派人含 Closed、状态流转、工时、优先级等）；
     - **智能提取**：支持一键提取页面已勾选任务、一键提取当前页所有待办未完成任务。

---

### 💻 方式二：独立 Web 效能驾驶舱服务方式（功能完整版）

> **适用场景**：需要大屏统一看板驾驶舱、跨项目复杂复合查询、自动生成导出 Excel 工作周报、与 Gitee 提交日志联动并调用 AI Agent 智能提炼任务工单。

#### 启动步骤：
1. **Windows 快捷启动**：
   直接双击运行根目录下的 `start.bat`。
2. **命令行启动**：
   ```bash
   # 安装依赖
   pip install -r requirements.txt

   # 启动 Web 服务
   python server.py
   ```
3. **Docker 容器部署**：
   ```bash
   docker-compose up -d --build
   ```
4. 访问本地控制台：👉 **http://127.0.0.1:5000**

---

## 🛠️ 核心功能全景

### 1. ⚡ 一键批量完成报工 (自动进行中 ➔ 报工完成)
- **智能流转**：勾选任务处于「未开始 (`wait`)」时，自动启动为「进行中 (`doing`)」；
- **智能工时核算**：自动抓取任务预计工时（`estimate`）作为本次消耗工时自动报工完成；
- **防频控模拟人工间隔**：支持配置步骤延时（如 `1.0s/步`），平滑化网络请求；
- **工时保护**：未填写预计工时的任务可自动跳过，防范误报工。

### 2. ✏️ 任务名称批量重命名与文本查找替换
- **4 种重命名模式**：
  - 统一重命名（全部任务赋指定新名称）；
  - 添加前缀（如 `【修复】` 或 `【2026】`）；
  - 添加后缀（如 `(已验证)` 或 `-待评审`）；
  - 关键字文本替换（查找指定词并替换为新词，留空则删除）；
- **描述同步联动**：可选勾选同步将任务富文本描述更新为与新名称一致。

### 3. 🎯 批量修改全量关键字段（防覆盖安全守护）
- **指派人修改**：支持指派给本人、指定账号或一键指派为 `closed`（归档锁定）；
- **实际完成人修改**：支持设为当前账号、其他账号或置空；
- **其他字段**：所属项目、所属执行/迭代、最初预计工时、优先级 (1-4)、截止日期、选填修改备注；
- **【核心安全防护】权威原值守护**：动态解析原生编辑表单，保留底层关联与上下文，未勾选修改的字段严禁清空回退，避免禅道数据污染。

### 4. 🐱 Gitee 代码提交看板与 AI 任务工单提炼
- 对接 Gitee OpenAPI v5，精准拉取登录人在企业组织下的提交流；
- 调度 DeepSeek AI Agent 深度提炼，将代码提交记录智能聚类为符合敏捷规范的禅道任务清单；
- 严格基于 Excel 模板规范填充导出或一键直导禅道。

### 5. 📊 研发工作周报一键汇总与导出
- 自动归纳当周完成任务、耗时统计、项目分布；
- 一键导出标准格式周报 Excel。

---

## 📂 项目结构说明

```text
ZenPilot/
├── static/
│   ├── css/
│   │   └── style.css                     # 现代化 UI 样式系统（微动效、响应式、高质感卡片）
│   ├── js/
│   │   ├── app.js                        # Web 控制台交互逻辑
│   │   └── zentao_batch_helper.user.js  # 【推荐】浏览器原生油猴用户脚本
│   └── images/
│       └── logo.png                      # ZenPilot Logo
├── templates/
│   └── index.html                        # Web 效能驾驶舱模板
├── server.py                             # 后端服务、RESTful API
├── zentao_client.py                      # 禅道 API 客户端（严格原值守护、双通道提交）
├── zentao_tool.py                        # 命令行 CLI 自动化工具
├── gitee_client.py                       # Gitee OpenAPI 客户端与提交记录解析
├── gitee_task_generator.py               # AI 任务工单提炼与模板填充
├── weekly_report.py                      # 工作周报数据聚合导出引擎
├── ai_agent.py                           # DeepSeek AI 研发助手
├── start.bat                             # Windows 一键启动脚本
├── requirements.txt                      # 依赖项清单
├── Dockerfile                            # Dockerfile 镜像构建
├── docker-compose.yml                    # Docker Compose 编排
└── README.md                             # 项目使用与部署说明
```

---

## 🔒 安全与隐私设计
1. **零服务端持久化**：系统不硬编码密码，不在服务端保存用户的明文密码与敏感凭据。
2. **原生权限继承**：所有操作均通过用户自身禅道权限执行，严格遵循企业内网数据安全规范。
3. **同源沙箱机制**：油猴脚本运行于用户浏览器原生环境，数据交互全程发生在用户本地与禅道服务端之间，无第三方数据中转。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
