# ZenPilot · 禅效通 (ZenTao Efficiency & Automation Studio)

<p align="center">
  <img src="static/images/logo.png" width="96" height="96" alt="ZenPilot Logo" style="border-radius: 16px; box-shadow: 0 8px 24px rgba(37,99,235,0.2);" />
</p>

<p align="center">
  <strong>专为禅道打造的高效研发效能驾驶舱与自动化助手</strong><br>
  待办任务智能报工流转 · 多维过滤与批量修改 · 工作周报一键导出 · DeepSeek AI 研发助手
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Flask-2.x-000000?style=flat-square&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/ZenTao-兼容全版本-0080FF?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

## 📖 项目简介

**ZenPilot (禅效通)** 是一款针对博科国信云禅道（以及标准开源版/企业版/旗舰版禅道）深度定制的高效效能控制台。它通过直观优雅的现代化 Web 驾驶舱，彻底解决日常禅道操作繁琐、任务流转卡顿、跨项目批量改动耗时、周报手动统计汇总低效等痛点。

---

## 🚀 核心功能特性

### 1. ⚡ 待办任务智能报工流转（一键批量完成）
- **自动检索待办**：一键拉取当前登录人名下所有「未开始」与「进行中」的任务，清晰展示预计耗时与已消耗工时合计。
- **智能报工流转**：
  - 「未开始」任务自动先流转为「进行中」；
  - 自动读取**预计工时**填入消耗工时完成报工流转；
  - **防错安全机制**：若任务未填写预计工时（或为 0），系统自动安全跳过，防止工时填报失真；
- **沉浸式实时进度条**：批量执行时提供高质感进度面板，实时展示已执行数/总数、百分比进度、当前任务卡片及执行日志。

### 2. 🎯 多维检索与目标用户过滤
- **指定用户查询**：支持先选定目标用户（首项默认当前用户「🌟 我」，支持拼音/姓名/账号模糊搜索他人）。
- **动态任务范围联动**：根据选定用户动态联动「由其完成 (`finishedBy`)」、「指派给其 (`assignedTo`)」、「由其创建 (`openedBy`)」、「由其关闭 (`closedBy`)」及「全部任务」。
- **三层严格去重**：打通底层原生 `/user-task-{uid}-{view_type}` 分页协议，并在采集层、服务层、渲染层实现三层去重，彻底消除重复条目。
- **多条件组合**：支持与预计年份、任务状态、所属项目（支持可搜索下拉）、关键词进行精确复合筛选。

### 3. 🛠️ 配置化批量修改与行内直接重命名
- **丰富字段支持**：支持批量修改任务名称、所属项目、指派人、任务状态、所属执行/迭代、预计工时、优先级、截止日期。
- **名称灵活编辑**：支持统一重命名、添加前缀、添加后缀、关键字查找替换，同时支持在表格行内直接双击/点击修改任务名称并暂存提交。
- **多选/全选批量流转**：实时统计已勾选任务数量，支持一键全选所有查询结果并批量保存。

### 4. 📊 本周工作周报一键汇总与高品质导出
- **自动化提取**：自动检索本周实际消耗工时、完成任务列表及关联项目。
- **高品质 Excel 导出**：导出标准格式的应用组周报，包含项目归类、耗时明细、完成状态与时间统计。

### 5. 🤖 DeepSeek 智能研发效能 Agent 助手
- **禅道效能专家**：集成 DeepSeek 智能大模型，支持快捷查询工时诊断、任务进度建议、研发日报总结等。

---

## 📂 项目结构

```text
ZenPilot/
├── static/
│   ├── css/
│   │   └── style.css          # 现代化 UI 样式系统（微动效、自适应响应式、高质感卡片）
│   ├── js/
│   │   └── app.js             # 前端交互、NDJSON 流式进度条、可搜索下拉组件
│   └── images/
│       └── logo.png           # 极简 ZenPilot 品牌 Logo
├── templates/
│   └── index.html             # 单页效能驾驶舱模板
├── server.py                  # Flask 后端服务、RESTful API、会话隔离与代理
├── zentao_client.py           # 禅道 API 客户端核心封装（登录、分页采集、UID映射、工时流转）
├── zentao_tool.py             # 命令行 CLI 自动化工具
├── weekly_report.py           # 工作周报数据聚合与 Excel 导出引擎
├── ai_agent.py                # DeepSeek AI 研发效能助手集成
├── start.bat                  # Windows 一键启动脚本
├── requirements.txt           # Python 依赖清单
├── Dockerfile                 # 容器构建镜像定义
├── docker-compose.yml         # Docker 编排配置
└── README.md                  # 项目使用与部署说明
```

---

## 🏁 快速上手

### 方式一：Windows 一键启动（最推荐）
在项目根目录下双击运行：
```cmd
start.bat
```
脚本将自动启动后台服务并在默认浏览器中打开控制台：
👉 **http://127.0.0.1:5000**

---

### 方式二：命令行启动
```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 运行服务端
python server.py
```
访问浏览器：**http://127.0.0.1:5000**

---

### 方式三：Docker 容器一键部署
```bash
# 构建并启动
docker-compose up -d --build

# 访问地址：http://服务器IP:5000
```

---

## 🔒 安全与隐私设计
1. **零服务端持久化**：系统不硬编码、不在服务端保存任何用户的明文密码与敏感凭据。
2. **多用户浏览器会话完全隔离**：每个浏览器客户端通过独立的 Session 隔离 Cookie 与 Token，互不干扰、互不挤占。
3. **原生权限继承**：所有操作均通过用户自身禅道权限执行，严格遵循企业内网数据安全规范。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
