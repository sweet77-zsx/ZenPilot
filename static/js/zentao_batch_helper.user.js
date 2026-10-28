// ==UserScript==
// @name         禅道任务高级批量编辑与一键完成助手 (ZenTao Batch Assistant)
// @namespace    https://github.com/ZenPilot-Studio/ZenPilot
// @version      1.1.0
// @description  直接在禅道网站上一键批量操作：1. 一键批量完成报工(未开始自动切进行中、按预计工时自动报工、人工步骤间隔防频控)；2. 批量修改字段(名称重命名/前后缀/替换、指派人含Closed、状态流转、所属项目/迭代、工时、优先级等)，具备防字段覆盖与权威原值守护。
// @author       ZenPilot
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 1. 智能检测当前页面是否为禅道系统
    function isZenTaoPage() {
        if (window.config && (window.config.webRoot !== undefined || window.config.router !== undefined)) return true;
        if (document.querySelector('meta[name="renderer"][content*="webkit"]') && document.querySelector('#mainmenu, #navbar, #header, .main-header')) return true;
        if (document.title.includes('禅道') || document.title.includes('ZenTao')) return true;
        const pageHtml = document.documentElement.innerHTML.slice(0, 3000);
        return pageHtml.includes('zentao') || pageHtml.includes('zentaosid') || pageHtml.includes('task-view');
    }

    if (!isZenTaoPage()) {
        return;
    }

    // 2. 基础路径解析 (自动识别根目录部署或二级目录部署如 /zentao/)
    function getZenTaoWebRoot() {
        if (window.config && window.config.webRoot) {
            return window.config.webRoot.replace(/\/+$/, '');
        }
        const pathname = window.location.pathname;
        const match = pathname.match(/^(.*?)\/(?:execution|project|my|task|bug|story|qa|doc|company)-/i);
        if (match && match[1]) {
            return match[1];
        }
        return '';
    }

    const WEB_ROOT = getZenTaoWebRoot();

    // 辅助工具：构建 API URL
    function buildUrl(endpoint) {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        return `${WEB_ROOT}${cleanEndpoint}`;
    }

    // 延迟工具函数
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // 3. 注入浮动 UI 样式
    const CSS_STYLES = `
    #zt-batch-fab {
        position: fixed;
        right: 24px;
        bottom: 72px;
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 8px;
        background: linear-gradient(135deg, #1d4ed8, #2563eb);
        color: #ffffff;
        padding: 10px 16px;
        border-radius: 30px;
        box-shadow: 0 4px 18px rgba(37, 99, 235, 0.4);
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 13px;
        font-weight: 600;
        user-select: none;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        border: 1px solid rgba(255, 255, 255, 0.2);
    }
    #zt-batch-fab:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 6px 24px rgba(37, 99, 235, 0.55);
        background: linear-gradient(135deg, #1e40af, #1d4ed8);
    }
    #zt-batch-panel {
        position: fixed;
        right: 24px;
        bottom: 125px;
        width: 460px;
        max-width: calc(100vw - 48px);
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.06);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #1e293b;
        display: none;
        flex-direction: column;
        overflow: hidden;
        animation: ztFadeInUp 0.2s ease-out forwards;
    }
    @keyframes ztFadeInUp {
        from { opacity: 0; transform: translateY(12px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .zt-panel-header {
        background: linear-gradient(135deg, #0f172a, #1e293b);
        color: #ffffff;
        padding: 12px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #334155;
    }
    .zt-panel-title {
        font-size: 14px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .zt-panel-close {
        cursor: pointer;
        font-size: 18px;
        color: #94a3b8;
        line-height: 1;
        transition: color 0.15s;
    }
    .zt-panel-close:hover { color: #f87171; }
    
    /* 顶部切换选项卡 */
    .zt-panel-tabs {
        display: flex;
        background: #f1f5f9;
        border-bottom: 1px solid #cbd5e1;
    }
    .zt-tab-item {
        flex: 1;
        text-align: center;
        padding: 10px 8px;
        font-size: 13px;
        font-weight: 600;
        color: #64748b;
        cursor: pointer;
        transition: all 0.15s ease;
        border-bottom: 2px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        user-select: none;
    }
    .zt-tab-item:hover {
        color: #1e293b;
        background: #e2e8f0;
    }
    .zt-tab-item.active {
        color: #2563eb;
        background: #ffffff;
        border-bottom-color: #2563eb;
    }

    .zt-panel-body {
        padding: 16px;
        max-height: 520px;
        overflow-y: auto;
    }
    .zt-form-group {
        margin-bottom: 12px;
    }
    .zt-form-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        font-weight: 600;
        color: #475569;
        margin-bottom: 5px;
    }
    .zt-control {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 13px;
        color: #1e293b;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
        background: #ffffff;
    }
    .zt-control:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }
    .zt-tip-card {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 11px;
        color: #1e40af;
        line-height: 1.5;
        margin-bottom: 12px;
    }
    .zt-btn {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    }
    .zt-btn-primary {
        background: #2563eb;
        color: #ffffff;
    }
    .zt-btn-primary:hover { background: #1d4ed8; }
    .zt-btn-secondary {
        background: #f1f5f9;
        color: #475569;
        border-color: #e2e8f0;
    }
    .zt-btn-secondary:hover { background: #e2e8f0; color: #1e293b; }
    
    .zt-btn-finish {
        width: 100%;
        padding: 10px;
        font-size: 14px;
        font-weight: 700;
        background: linear-gradient(135deg, #10b981, #059669);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
    }
    .zt-btn-finish:hover {
        background: linear-gradient(135deg, #059669, #047857);
    }
    
    .zt-btn-action {
        width: 100%;
        padding: 10px;
        font-size: 14px;
        font-weight: 700;
        background: linear-gradient(135deg, #d97706, #f59e0b);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.35);
    }
    .zt-btn-action:hover {
        background: linear-gradient(135deg, #b45309, #d97706);
    }
    .zt-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .zt-progress-box {
        margin-top: 12px;
        padding: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        display: none;
    }
    .zt-progress-track {
        height: 6px;
        background: #e2e8f0;
        border-radius: 3px;
        overflow: hidden;
        margin: 6px 0;
    }
    .zt-progress-bar {
        height: 100%;
        background: #2563eb;
        width: 0%;
        transition: width 0.2s ease;
    }
    .zt-log-area {
        max-height: 140px;
        overflow-y: auto;
        font-family: Consolas, monospace;
        font-size: 11px;
        color: #475569;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        padding: 6px 8px;
        border-radius: 4px;
        margin-top: 6px;
    }
    .zt-log-item { margin-bottom: 3px; line-height: 1.4; }
    .zt-log-success { color: #15803d; }
    .zt-log-skipped { color: #854d0e; }
    .zt-log-failed { color: #b91c1c; }
    .zt-quick-link {
        color: #2563eb;
        text-decoration: none;
        cursor: pointer;
        font-size: 11px;
    }
    .zt-quick-link:hover { text-decoration: underline; }
    `;

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS_STYLES;
    document.head.appendChild(styleEl);

    // 4. 创建浮动图标与主控制面板 DOM
    const fab = document.createElement('div');
    fab.id = 'zt-batch-fab';
    fab.innerHTML = `<span>⚡</span><span>批量操作助手</span><span id="zt-fab-badge" style="background:#ef4444; color:#fff; border-radius:10px; padding:1px 6px; font-size:10px; display:none;">0</span>`;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'zt-batch-panel';
    panel.innerHTML = `
        <div class="zt-panel-header">
            <div class="zt-panel-title">
                <span>⚡ 禅道任务高级批量操作面板</span>
                <span style="font-size: 10px; background: rgba(255,255,255,0.15); padding: 1px 6px; border-radius: 4px;">v1.1</span>
            </div>
            <div class="zt-panel-close" id="zt-btn-close">&times;</div>
        </div>

        <!-- 顶部功能切换标签 -->
        <div class="zt-panel-tabs">
            <div class="zt-tab-item active" id="zt-tab-btn-finish" data-tab="finish">
                <span>⚡ 一键批量完成报工</span>
            </div>
            <div class="zt-tab-item" id="zt-tab-btn-edit" data-tab="edit">
                <span>🛠️ 批量修改字段</span>
            </div>
        </div>

        <div class="zt-panel-body">
            <!-- 公共部分：任务选择 -->
            <div class="zt-form-group">
                <div class="zt-form-label">
                    <span>🎯 目标任务 ID 列表:</span>
                    <div>
                        <span class="zt-quick-link" id="zt-btn-pick-page" title="提取当前页面中已勾选复选框的任务">🔍 提取已勾选</span>
                        <span style="color:#cbd5e1; margin:0 3px;">|</span>
                        <span class="zt-quick-link" id="zt-btn-pick-pending" title="智能识别当前页面所有未开始/进行中的待办任务">⚡ 提取本页待办</span>
                        <span style="color:#cbd5e1; margin:0 3px;">|</span>
                        <span class="zt-quick-link" id="zt-btn-check-all-page" title="勾选当前页面所有表格复选框">全选本页</span>
                    </div>
                </div>
                <input type="text" id="zt-task-ids" class="zt-control" placeholder="逗号或空格分隔的任务ID，如: 1024, 1025, 1028">
                <div style="font-size:11px; color:#64748b; margin-top:3px; display:flex; justify-content:space-between;">
                    <span id="zt-task-count-hint">已输入 0 个任务</span>
                    <span class="zt-quick-link" id="zt-btn-clear-ids">清空</span>
                </div>
            </div>

            <!-- ===================== TAB 1: 一键批量完成报工 ===================== -->
            <div id="zt-tab-view-finish">
                <div class="zt-tip-card">
                    💡 <strong>智能报工流转规则：</strong><br>
                    1. 任务若处于「未开始」将自动流转为「进行中」；<br>
                    2. 自动提取任务<b>预计工时</b>填入消耗时间报工并完成；<br>
                    3. 每步之间自动执行模拟人工间隔，严密防范高频频控与网络阻塞。
                </div>

                <div class="zt-form-group">
                    <div class="zt-form-label">
                        <span>⏱️ 步骤间隔时间 (模拟人工操作):</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="number" id="zt-finish-interval" class="zt-control" style="width: 100px;" value="1.0" min="0" max="60" step="0.5">
                        <span style="font-size: 12px; color: #64748b;">秒/步 (推荐 0.5s ~ 1.5s)</span>
                    </div>
                </div>

                <div class="zt-form-group">
                    <div class="zt-form-label">
                        <span>📊 报工工时取值策略:</span>
                    </div>
                    <select id="zt-finish-hour-mode" class="zt-control">
                        <option value="auto_strict" selected>自动按任务预计工时报工 (无工时则自动跳过)</option>
                        <option value="auto_fallback">自动按预计工时 (若未填工时则按默认工时报工)</option>
                        <option value="custom">统一指定本次报工工时</option>
                    </select>
                </div>

                <div class="zt-form-group" id="zt-finish-custom-box" style="display: none;">
                    <div class="zt-form-label">
                        <span>本次报工工时 (小时):</span>
                    </div>
                    <input type="number" id="zt-finish-custom-hours" class="zt-control" value="2.0" step="0.5" min="0.5" placeholder="如 2.0">
                </div>

                <div class="zt-form-group">
                    <div class="zt-form-label">
                        <span>📝 完成备注 (选填):</span>
                    </div>
                    <input type="text" id="zt-finish-comment" class="zt-control" placeholder="选填，如：开发已自测完成 (留空无备注)">
                </div>

                <div class="zt-form-group" style="margin-top: 14px;">
                    <button type="button" class="zt-btn zt-btn-finish" id="zt-btn-run-finish">
                        ⚡ 一键批量完成已选任务 (自动进行中 ➔ 报工完成)
                    </button>
                </div>
            </div>

            <!-- ===================== TAB 2: 批量修改字段 ===================== -->
            <div id="zt-tab-view-edit" style="display: none;">
                <!-- 选择操作字段 -->
                <div class="zt-form-group">
                    <div class="zt-form-label">
                        <span>🛠️ 选择修改字段:</span>
                    </div>
                    <select id="zt-field-select" class="zt-control">
                        <option value="name" selected>任务名称 (name) - 支持前后缀/替换</option>
                        <option value="status">任务状态 (status) - 一键进行中/完成报工/关闭</option>
                        <option value="assignedTo">指派给 (assignedTo) - 含Closed/指定人</option>
                        <option value="finishedBy">实际完成人 (finishedBy)</option>
                        <option value="project">所属项目 (project ID)</option>
                        <option value="execution">所属执行/迭代 (execution ID)</option>
                        <option value="estimate">预计工时 (estimate)</option>
                        <option value="pri">优先级 (pri: 1-4)</option>
                        <option value="deadline">截止日期 (deadline)</option>
                    </select>
                </div>

                <!-- 动态值输入区 -->
                <div class="zt-form-group" id="zt-dynamic-container">
                    <!-- 由 JS 动态渲染 -->
                </div>

                <!-- 选填修改备注 -->
                <div class="zt-form-group">
                    <div class="zt-form-label">
                        <span>💬 选填修改备注 (历史记录留痕):</span>
                    </div>
                    <input type="text" id="zt-edit-comment-input" class="zt-control" placeholder="留空则不写入备注">
                </div>

                <!-- 批量执行触发按钮 -->
                <div class="zt-form-group" style="margin-top: 14px;">
                    <button type="button" class="zt-btn zt-btn-action" id="zt-btn-run-edit">
                        🚀 开始批量执行字段修改
                    </button>
                </div>
            </div>

            <!-- 实时进度与日志区 (两 Tab 共享) -->
            <div class="zt-progress-box" id="zt-progress-box">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600;">
                    <span id="zt-progress-text">正在处理...</span>
                    <span id="zt-progress-ratio">0 / 0</span>
                </div>
                <div class="zt-progress-track">
                    <div class="zt-progress-bar" id="zt-progress-bar"></div>
                </div>
                <div class="zt-log-area" id="zt-log-area">
                    <!-- 动态注入流水日志 -->
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // 5. 抓取当前页面中任务 ID
    // A: 获取已勾选的任务
    function getCheckedTaskIdsOnPage() {
        const idSet = new Set();
        const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach((cb) => {
            const val = (cb.value || '').trim();
            const name = (cb.name || '').toLowerCase();
            if (/^\d+$/.test(val) && (name.includes('task') || name.includes('id') || cb.closest('tr')?.getAttribute('data-id'))) {
                idSet.add(val);
            }
        });

        if (idSet.size === 0) {
            const selectedRows = document.querySelectorAll('tr.active[data-id], tr.selected[data-id]');
            selectedRows.forEach(tr => {
                const rowId = tr.getAttribute('data-id');
                if (rowId && /^\d+$/.test(rowId)) idSet.add(rowId);
            });
        }

        return Array.from(idSet);
    }

    // B: 智能提取当前页面所有未完成的待办任务 (未开始 wait、进行中 doing、暂停 pause)
    function getPendingTaskIdsOnPage() {
        const idSet = new Set();
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach(tr => {
            const rowText = (tr.innerText || '').toLowerCase();
            // 排除已完成与已关闭状态
            if (rowText.includes('已完成') || rowText.includes('已关闭') || rowText.includes('done') || rowText.includes('closed')) {
                return;
            }

            const cb = tr.querySelector('input[type="checkbox"]');
            let rowId = (cb && cb.value) || tr.getAttribute('data-id');
            if (!rowId || !/^\d+$/.test(rowId)) {
                // 尝试从行内超链接提取
                const link = tr.querySelector('a[href*="task-view-"], a[href*="taskID="]');
                if (link) {
                    const m = link.href.match(/task-view-(\d+)/) || link.href.match(/taskID=(\d+)/);
                    if (m && m[1]) rowId = m[1];
                }
            }

            if (rowId && /^\d+$/.test(rowId)) {
                idSet.add(rowId);
            }
        });

        // 兜底：如果没匹配到结构化行，提取页面中所有数字复选框
        if (idSet.size === 0) {
            return getCheckedTaskIdsOnPage();
        }
        return Array.from(idSet);
    }

    // C: 全选页面所有任务复选框
    function checkAllTasksOnPage() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        let count = 0;
        checkboxes.forEach((cb) => {
            const val = (cb.value || '').trim();
            const name = (cb.name || '').toLowerCase();
            if (/^\d+$/.test(val) && (name.includes('task') || name.includes('id') || cb.closest('tr')?.getAttribute('data-id'))) {
                cb.checked = true;
                count++;
            }
        });
        updateTaskIdsFromPage();
        return count;
    }

    function updateTaskIdsFromPage() {
        const ids = getCheckedTaskIdsOnPage();
        const input = document.getElementById('zt-task-ids');
        if (ids.length > 0) {
            input.value = ids.join(', ');
            updateTaskCountHint();
            const badge = document.getElementById('zt-fab-badge');
            if (badge) {
                badge.style.display = 'inline-block';
                badge.textContent = ids.length;
            }
        }
    }

    function updateTaskCountHint() {
        const input = document.getElementById('zt-task-ids');
        const raw = (input ? input.value : '').trim();
        const ids = parseTaskIds(raw);
        const hint = document.getElementById('zt-task-count-hint');
        if (hint) {
            hint.textContent = `已识别 ${ids.length} 个任务`;
        }
    }

    function parseTaskIds(rawStr) {
        if (!rawStr) return [];
        return rawStr
            .split(/[,，\s\n\r]+/)
            .map((s) => s.replace(/[^0-9]/g, '').trim())
            .filter((s) => s.length > 0);
    }

    // 6. 动态值输入区切换渲染 (批量修改 Tab 专用)
    function renderDynamicInput(fieldName) {
        const container = document.getElementById('zt-dynamic-container');
        if (!container) return;

        let html = '';
        if (fieldName === 'name') {
            html = `
                <div class="zt-form-label"><span>任务名称修改模式:</span></div>
                <div style="display:flex; gap:6px; margin-bottom:6px;">
                    <select id="zt-name-mode" class="zt-control" style="width:130px;">
                        <option value="direct" selected>统一重命名</option>
                        <option value="prefix">添加前缀</option>
                        <option value="suffix">添加后缀</option>
                        <option value="replace">文本替换</option>
                    </select>
                    <input type="text" id="zt-name-val" class="zt-control" placeholder="输入新的任务名称" style="flex:1;">
                </div>
                <div id="zt-name-replace-box" style="display:none; gap:6px; margin-bottom:6px; align-items:center;">
                    <input type="text" id="zt-replace-from" class="zt-control" placeholder="待替换的原词" style="flex:1;">
                    <span style="color:#64748b; font-weight:bold;">➔</span>
                    <input type="text" id="zt-replace-to" class="zt-control" placeholder="替换为新词 (留空删除)" style="flex:1;">
                </div>
                <label style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:#475569; cursor:pointer;">
                    <input type="checkbox" id="zt-sync-desc" checked>
                    <span>同步将任务描述修改为与新名称一致</span>
                </label>
            `;
        } else if (fieldName === 'status') {
            html = `
                <div class="zt-form-label"><span>流转目标状态:</span></div>
                <select id="zt-field-val" class="zt-control">
                    <option value="done" selected>✅ 已完成 (done) - 自动报工</option>
                    <option value="doing">⚡ 进行中 (doing)</option>
                    <option value="closed">🔒 已关闭 (closed) - 自动指派 Closed</option>
                    <option value="wait">⏸️ 未开始 (wait)</option>
                    <option value="pause">☕ 已暂停 (pause)</option>
                </select>
                <div id="zt-done-extra-box" style="margin-top:6px; font-size:12px; color:#475569;">
                    <span>完成报工工时(小时): </span>
                    <input type="number" id="zt-finish-consumed" class="zt-control" style="width:100px; display:inline-block; padding:3px 6px;" value="1.0" step="0.5" min="0.5">
                    <span style="font-size:11px; color:#94a3b8; margin-left:4px;">(留空默认按预计工时)</span>
                </div>
            `;
        } else if (fieldName === 'assignedTo') {
            const myAccount = (window.config && window.config.user && window.config.user.account) ? window.config.user.account : '';
            html = `
                <div class="zt-form-label"><span>指派给用户账号:</span></div>
                <div style="display:flex; gap:6px;">
                    <input type="text" id="zt-field-val" class="zt-control" placeholder="输入用户账号 (如 closed 或 dev_user)" value="closed">
                    ${myAccount ? `<button type="button" class="zt-btn zt-btn-secondary" id="zt-btn-assign-me" style="white-space:nowrap;">指派给我</button>` : ''}
                </div>
                <div style="font-size:11px; color:#64748b; margin-top:4px;">提示：填 closed 可直接锁定归档该任务</div>
            `;
        } else if (fieldName === 'finishedBy') {
            const myAccount = (window.config && window.config.user && window.config.user.account) ? window.config.user.account : '';
            html = `
                <div class="zt-form-label"><span>实际完成人账号:</span></div>
                <div style="display:flex; gap:6px;">
                    <input type="text" id="zt-field-val" class="zt-control" placeholder="输入用户账号，留空表示置空" value="${myAccount}">
                    ${myAccount ? `<button type="button" class="zt-btn zt-btn-secondary" id="zt-btn-finished-me" style="white-space:nowrap;">设为本人</button>` : ''}
                </div>
            `;
        } else if (fieldName === 'project') {
            html = `
                <div class="zt-form-label"><span>所属目标项目 ID:</span></div>
                <input type="number" id="zt-field-val" class="zt-control" placeholder="输入目标项目数字 ID (如 183)">
            `;
        } else if (fieldName === 'execution') {
            html = `
                <div class="zt-form-label"><span>所属执行/迭代 ID:</span></div>
                <input type="number" id="zt-field-val" class="zt-control" placeholder="输入目标执行/Sprint 数字 ID (如 205)">
            `;
        } else if (fieldName === 'estimate') {
            html = `
                <div class="zt-form-label"><span>最初预计工时 (小时):</span></div>
                <input type="number" id="zt-field-val" class="zt-control" step="0.5" min="0.5" placeholder="如: 4.0">
            `;
        } else if (fieldName === 'pri') {
            html = `
                <div class="zt-form-label"><span>优先级:</span></div>
                <select id="zt-field-val" class="zt-control">
                    <option value="1">1 (最高紧急)</option>
                    <option value="2">2 (高)</option>
                    <option value="3" selected>3 (普通中等)</option>
                    <option value="4">4 (低)</option>
                </select>
            `;
        } else if (fieldName === 'deadline') {
            html = `
                <div class="zt-form-label"><span>截止日期:</span></div>
                <input type="date" id="zt-field-val" class="zt-control">
            `;
        }

        container.innerHTML = html;

        // 联动事件
        const nameModeSelect = document.getElementById('zt-name-mode');
        const nameValInput = document.getElementById('zt-name-val');
        const replaceBox = document.getElementById('zt-name-replace-box');
        if (nameModeSelect) {
            nameModeSelect.addEventListener('change', () => {
                const mode = nameModeSelect.value;
                if (mode === 'replace') {
                    nameValInput.style.display = 'none';
                    replaceBox.style.display = 'flex';
                } else {
                    nameValInput.style.display = 'block';
                    replaceBox.style.display = 'none';
                    if (mode === 'prefix') nameValInput.placeholder = '输入要添加的前缀，如 【2026】';
                    else if (mode === 'suffix') nameValInput.placeholder = '输入要添加的后缀，如 (已验证)';
                    else nameValInput.placeholder = '输入新的统一任务名称';
                }
            });
        }

        const btnAssignMe = document.getElementById('zt-btn-assign-me');
        if (btnAssignMe) {
            btnAssignMe.onclick = () => {
                const valInput = document.getElementById('zt-field-val');
                if (valInput && window.config && window.config.user) {
                    valInput.value = window.config.user.account;
                }
            };
        }

        const btnFinishedMe = document.getElementById('zt-btn-finished-me');
        if (btnFinishedMe) {
            btnFinishedMe.onclick = () => {
                const valInput = document.getElementById('zt-field-val');
                if (valInput && window.config && window.config.user) {
                    valInput.value = window.config.user.account;
                }
            };
        }
    }

    // 7. 核心业务网络层：任务详情获取与防护提交
    async function fetchTaskDetail(taskId) {
        try {
            const res = await fetch(buildUrl(`/task-view-${taskId}.json`), {
                headers: { 'Accept': 'application/json, text/plain, */*' },
                credentials: 'same-origin'
            });
            if (!res.ok) return null;
            const text = await res.text();
            const data = JSON.parse(text);
            return data.task || data;
        } catch (e) {
            return null;
        }
    }

    // 解析任务原生编辑表单，提取完整隐藏上下文
    async function fetchTaskEditFormData(taskId) {
        try {
            const res = await fetch(buildUrl(`/task-edit-${taskId}.html`), {
                credentials: 'same-origin'
            });
            if (!res.ok) return null;
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const form = doc.querySelector('form');
            if (!form) return null;

            const formData = new FormData();
            const elements = form.querySelectorAll('input, select, textarea');
            elements.forEach((el) => {
                const name = el.getAttribute('name');
                if (!name || el.disabled) return;
                if (el.tagName === 'SELECT') {
                    const selected = Array.from(el.querySelectorAll('option:checked')).map((o) => o.value);
                    if (el.multiple || name.endsWith('[]')) {
                        selected.forEach((val) => formData.append(name, val));
                    } else {
                        formData.set(name, selected[0] || '');
                    }
                } else if (el.type === 'checkbox' || el.type === 'radio') {
                    if (el.checked) formData.set(name, el.value);
                } else {
                    formData.set(name, el.value || '');
                }
            });
            return formData;
        } catch (e) {
            return null;
        }
    }

    // 8. 通用表单安全提交 (保留权威上下文，严防覆盖与空值篡改)
    async function submitTaskEditSafe(taskId, task, updateFields, comment = '') {
        const formData = (await fetchTaskEditFormData(taskId)) || new FormData();

        // 权威原值守护列表：若未明确在 updateFields 中修改，严禁清空
        const CRITICAL_FIELDS = [
            'finishedBy', 'finishedDate', 'assignedTo', 'status',
            'closedBy', 'closedDate', 'closedReason', 'canceledBy', 'canceledDate',
            'pri', 'estimate', 'consumed', 'left', 'estStarted', 'realStarted', 'deadline',
            'project', 'execution', 'module', 'type', 'story'
        ];

        CRITICAL_FIELDS.forEach((cf) => {
            if (!(cf in updateFields)) {
                const curVal = task[cf];
                if (curVal !== undefined && curVal !== null && curVal !== '') {
                    formData.set(cf, String(curVal));
                }
            }
        });

        // 基础名称保护
        if (!('name' in updateFields)) {
            formData.set('name', task.name || '');
        }

        // 描述保护：若未修改描述，删除表单中的 desc 避免富文本格式被破坏
        if (!('desc' in updateFields)) {
            formData.delete('desc');
        }

        // 应用待更新的字段
        for (const [k, v] of Object.entries(updateFields)) {
            formData.set(k, String(v));
        }

        if (comment) {
            formData.set('comment', comment);
        }

        // 优先提交到 .json
        try {
            const resJson = await fetch(buildUrl(`/task-edit-${taskId}.json`), {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });
            const textJson = await resJson.text();
            if (textJson.includes('user-deny')) {
                return { ok: false, status: 'failed', msg: '权限不足：当前账号无权编辑该任务' };
            }
            if (resJson.ok || textJson.includes('locate') || textJson.includes('success')) {
                return { ok: true, status: 'success', msg: '修改成功' };
            }
        } catch (e) {
            // 继续降级尝试 HTML 表单
        }

        // 降级提交到 .html
        try {
            const resHtml = await fetch(buildUrl(`/task-edit-${taskId}.html`), {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });
            const textHtml = await resHtml.text();
            if (textHtml.includes('user-deny')) {
                return { ok: false, status: 'failed', msg: '权限不足：当前账号无权编辑该任务' };
            }
            if (resHtml.ok || textHtml.includes('locate')) {
                return { ok: true, status: 'success', msg: '修改成功 (表单通道)' };
            }
            return { ok: false, status: 'failed', msg: '禅道服务端拒绝了修改请求' };
        } catch (e) {
            return { ok: false, status: 'failed', msg: `请求异常: ${e.message || e}` };
        }
    }

    // 9. 单个任务字段修改执行器 (Tab 2 批量修改用)
    async function executeSingleTaskUpdate(taskId, field, valueObj) {
        const task = await fetchTaskDetail(taskId);
        if (!task) {
            return { ok: false, status: 'failed', msg: `未获取到任务 #${taskId} 详情` };
        }

        const taskName = task.name || `任务#${taskId}`;
        const projectId = task.project || 0;
        const comment = valueObj.comment || '';

        // A. 任务名称修改
        if (field === 'name') {
            const mode = valueObj.mode || 'direct';
            let targetName = taskName;
            if (mode === 'prefix') {
                targetName = `${valueObj.value}${taskName}`;
            } else if (mode === 'suffix') {
                targetName = `${taskName}${valueObj.value}`;
            } else if (mode === 'replace') {
                const fromStr = valueObj.replaceFrom || '';
                const toStr = valueObj.replaceTo || '';
                if (!fromStr) {
                    return { ok: false, status: 'failed', msg: '查找替换的原词不能为空' };
                }
                if (!taskName.includes(fromStr)) {
                    return { ok: true, status: 'skipped', msg: `未包含待替换字符「${fromStr}」，跳过` };
                }
                targetName = taskName.replaceAll(fromStr, toStr);
            } else {
                targetName = String(valueObj.value || '').trim();
            }

            if (!targetName) {
                return { ok: false, status: 'failed', msg: '新名称不能为空' };
            }

            const oldDesc = String(task.desc || '').trim();
            const nameChanged = targetName !== taskName;
            const descChanged = valueObj.syncDesc && oldDesc !== targetName;

            if (!nameChanged && !descChanged) {
                return { ok: true, status: 'skipped', msg: '新旧名称一致，未做修改' };
            }

            const updateMap = { name: targetName };
            if (valueObj.syncDesc) {
                updateMap.desc = targetName;
            }
            return await submitTaskEditSafe(taskId, task, updateMap, comment);
        }

        // B. 状态流转 (doing, done, closed 等)
        if (field === 'status') {
            const targetStatus = valueObj.value;
            const oldStatus = task.status;
            if (oldStatus === targetStatus) {
                return { ok: true, status: 'skipped', msg: `当前状态已为 ${targetStatus}，跳过` };
            }

            // 1. 进行中
            if (targetStatus === 'doing') {
                const startData = new FormData();
                startData.append('consumed', 0);
                startData.append('left', task.left || 1);
                startData.append('realStarted', '');
                startData.append('comment', comment);

                const res = await fetch(buildUrl(`/task-start-${taskId}.json`), {
                    method: 'POST',
                    body: startData,
                    credentials: 'same-origin'
                });
                const resText = await res.text();
                return { ok: resText.includes('success') || res.ok, status: 'success', msg: '已启动为进行中' };
            }

            // 2. 完成并报工
            if (targetStatus === 'done') {
                const alreadyConsumed = parseFloat(task.consumed || 0);
                const addConsumed = parseFloat(valueObj.consumed || task.estimate || 1.0);
                const totalConsumed = alreadyConsumed + addConsumed;

                const finishData = new FormData();
                finishData.append('consumed', totalConsumed);
                finishData.append('currentConsumed', addConsumed);
                finishData.append('assignedTo', task.openedBy || '');
                finishData.append('comment', comment);

                const res = await fetch(buildUrl(`/task-finish-${taskId}.json`), {
                    method: 'POST',
                    body: finishData,
                    credentials: 'same-origin'
                });
                const resText = await res.text();
                return { ok: resText.includes('success') || res.ok, status: 'success', msg: `已完成报工 (工时 +${addConsumed}h)` };
            }

            // 3. 关闭
            if (targetStatus === 'closed') {
                const assignData = new FormData();
                assignData.append('assignedTo', 'closed');
                assignData.append('status', 'closed');
                assignData.append('left', '0');
                assignData.append('comment', comment);

                const res = await fetch(buildUrl(`/task-assignTo-${projectId}-${taskId}.json`), {
                    method: 'POST',
                    body: assignData,
                    credentials: 'same-origin'
                });
                const resText = await res.text();
                if (resText.includes('locate') || res.ok) {
                    return { ok: true, status: 'success', msg: '已关闭任务并指派为 Closed' };
                }
                return await submitTaskEditSafe(taskId, task, { status: 'closed', assignedTo: 'closed' }, comment);
            }

            return await submitTaskEditSafe(taskId, task, { status: targetStatus }, comment);
        }

        // C. 指派给 (assignedTo)
        if (field === 'assignedTo') {
            const targetAssigned = String(valueObj.value || '').trim();
            const oldAssigned = String(task.assignedTo || '').trim();
            if (oldAssigned === targetAssigned) {
                return { ok: true, status: 'skipped', msg: `指派人已是 ${targetAssigned}，跳过` };
            }

            const assignData = new FormData();
            assignData.append('assignedTo', targetAssigned);
            assignData.append('status', targetAssigned === 'closed' ? 'closed' : task.status || 'wait');
            assignData.append('left', task.left || '0');
            assignData.append('comment', comment);

            const res = await fetch(buildUrl(`/task-assignTo-${projectId}-${taskId}.json`), {
                method: 'POST',
                body: assignData,
                credentials: 'same-origin'
            });
            const resText = await res.text();
            if (resText.includes('locate') || resText.includes('success') || res.ok) {
                return { ok: true, status: 'success', msg: `已成功指派给 ${targetAssigned}` };
            }
            return await submitTaskEditSafe(taskId, task, { assignedTo: targetAssigned }, comment);
        }

        // D. 实际完成人 (finishedBy)
        if (field === 'finishedBy') {
            const targetFinished = String(valueObj.value || '').trim();
            const oldFinished = String(task.finishedBy || '').trim();
            if (oldFinished === targetFinished) {
                return { ok: true, status: 'skipped', msg: `完成人已是 ${targetFinished}，跳过` };
            }
            return await submitTaskEditSafe(taskId, task, { finishedBy: targetFinished }, comment);
        }

        // E. 通用字段 (project, execution, estimate, pri, deadline)
        const oldVal = String(task[field] || '').trim();
        const targetVal = String(valueObj.value || '').trim();
        if (oldVal === targetVal) {
            return { ok: true, status: 'skipped', msg: `字段值未发生变动，跳过` };
        }
        return await submitTaskEditSafe(taskId, task, { [field]: targetVal }, comment);
    }

    // 10. 一键批量完成报工执行器 (Tab 1 专属：进行中 ➔ 报工完成)
    async function executeSingleAutoFinish(taskId, options) {
        const task = await fetchTaskDetail(taskId);
        if (!task) {
            return { ok: false, status: 'failed', msg: `未获取到任务 #${taskId} 详情` };
        }

        const taskName = task.name || `任务#${taskId}`;
        const currentStatus = task.status || 'wait';

        // 已经完成或关闭
        if (currentStatus === 'done') {
            return { ok: true, status: 'skipped', msg: `状态已是【已完成】，无需重复流转` };
        }
        if (currentStatus === 'closed') {
            return { ok: true, status: 'skipped', msg: `状态为【已关闭】，无需流转` };
        }

        // 计算本次报工工时
        let estimateVal = 0.0;
        try {
            const rawEst = task.estimate;
            estimateVal = (rawEst !== null && rawEst !== undefined && rawEst !== '') ? parseFloat(rawEst) : 0.0;
        } catch (e) {
            estimateVal = 0.0;
        }

        let consumedVal = 0.0;
        const mode = options.hourMode || 'auto_strict';
        if (mode === 'custom') {
            consumedVal = parseFloat(options.customHours || 1.0);
        } else if (mode === 'auto_fallback') {
            consumedVal = estimateVal > 0 ? estimateVal : parseFloat(options.customHours || 1.0);
        } else {
            // 严格按预计工时
            if (estimateVal <= 0) {
                return { ok: false, status: 'skipped', msg: `缺少预计消耗时间(未填写或为0)，已按规则跳过` };
            }
            consumedVal = estimateVal;
        }

        const intervalSeconds = parseFloat(options.interval || 1.0);
        const comment = options.comment || '';

        // 步骤 1: 若任务处于未开始 (wait)，先启动为进行中 (doing)
        if (currentStatus === 'wait') {
            const startData = new FormData();
            startData.append('consumed', 0);
            startData.append('left', estimateVal > 0 ? estimateVal : consumedVal);
            startData.append('realStarted', '');

            await fetch(buildUrl(`/task-start-${taskId}.json`), {
                method: 'POST',
                body: startData,
                credentials: 'same-origin'
            });

            // 模拟人工操作暂停间隔
            if (intervalSeconds > 0) {
                await sleep(intervalSeconds * 1000);
            }
        }

        // 步骤 2: 完成任务并报工
        const alreadyConsumed = parseFloat(task.consumed || 0);
        const totalConsumed = alreadyConsumed + consumedVal;

        const finishData = new FormData();
        finishData.append('consumed', totalConsumed);
        finishData.append('currentConsumed', consumedVal);
        finishData.append('assignedTo', task.openedBy || '');
        if (comment) finishData.append('comment', comment);

        try {
            const res = await fetch(buildUrl(`/task-finish-${taskId}.json`), {
                method: 'POST',
                body: finishData,
                credentials: 'same-origin'
            });
            const resText = await res.text();
            if (resText.includes('success') || resText.includes('locate') || res.ok) {
                return { ok: true, status: 'success', msg: `已流转完成并报工 (+${consumedVal}h)` };
            }
            return { ok: false, status: 'failed', msg: `报工完成响应异常: ${resText.slice(0, 100)}` };
        } catch (e) {
            return { ok: false, status: 'failed', msg: `网络异常: ${e.message || e}` };
        }
    }

    // 11. 事件绑定与主控制器
    function initEvents() {
        const fab = document.getElementById('zt-batch-fab');
        const panel = document.getElementById('zt-batch-panel');
        const btnClose = document.getElementById('zt-btn-close');
        const btnPickPage = document.getElementById('zt-btn-pick-page');
        const btnPickPending = document.getElementById('zt-btn-pick-pending');
        const btnCheckAll = document.getElementById('zt-btn-check-all-page');
        const btnClearIds = document.getElementById('zt-btn-clear-ids');
        const taskIdsInput = document.getElementById('zt-task-ids');

        // Tab 切换
        const tabBtnFinish = document.getElementById('zt-tab-btn-finish');
        const tabBtnEdit = document.getElementById('zt-tab-btn-edit');
        const tabViewFinish = document.getElementById('zt-tab-view-finish');
        const tabViewEdit = document.getElementById('zt-tab-view-edit');

        tabBtnFinish.onclick = () => {
            tabBtnFinish.classList.add('active');
            tabBtnEdit.classList.remove('active');
            tabViewFinish.style.display = 'block';
            tabViewEdit.style.display = 'none';
        };

        tabBtnEdit.onclick = () => {
            tabBtnEdit.classList.add('active');
            tabBtnFinish.classList.remove('active');
            tabViewEdit.style.display = 'block';
            tabViewFinish.style.display = 'none';
        };

        // 面板展开/收起
        fab.onclick = () => {
            const isHidden = panel.style.display === 'none' || !panel.style.display;
            panel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) {
                updateTaskIdsFromPage();
            }
        };

        btnClose.onclick = () => {
            panel.style.display = 'none';
        };

        // 提取已勾选
        btnPickPage.onclick = () => {
            const ids = getCheckedTaskIdsOnPage();
            if (ids.length === 0) {
                alert('当前页面未检测到被勾选的任务！请先勾选任务表格中的复选框。');
            } else {
                taskIdsInput.value = ids.join(', ');
                updateTaskCountHint();
            }
        };

        // 智能提取本页所有待办任务
        btnPickPending.onclick = () => {
            const ids = getPendingTaskIdsOnPage();
            if (ids.length === 0) {
                alert('未在当前表格中检测到未完成的待办任务！');
            } else {
                taskIdsInput.value = ids.join(', ');
                updateTaskCountHint();
                alert(`🎯 已自动提取本页 ${ids.length} 个未完成的待办任务！`);
            }
        };

        // 全选本页
        btnCheckAll.onclick = () => {
            const total = checkAllTasksOnPage();
            alert(`已全选当前页面中的 ${total} 个任务`);
        };

        btnClearIds.onclick = () => {
            taskIdsInput.value = '';
            updateTaskCountHint();
        };

        taskIdsInput.addEventListener('input', updateTaskCountHint);

        // Tab 1: 工时模式切换
        const finishHourMode = document.getElementById('zt-finish-hour-mode');
        const finishCustomBox = document.getElementById('zt-finish-custom-box');
        if (finishHourMode && finishCustomBox) {
            finishHourMode.addEventListener('change', () => {
                if (finishHourMode.value === 'custom' || finishHourMode.value === 'auto_fallback') {
                    finishCustomBox.style.display = 'block';
                } else {
                    finishCustomBox.style.display = 'none';
                }
            });
        }

        // Tab 2: 字段下拉切换
        const fieldSelect = document.getElementById('zt-field-select');
        fieldSelect.addEventListener('change', () => {
            renderDynamicInput(fieldSelect.value);
        });
        renderDynamicInput(fieldSelect.value);

        // ==========================================
        // 核心执行 1: 一键批量完成已选任务
        // ==========================================
        const btnRunFinish = document.getElementById('zt-btn-run-finish');
        btnRunFinish.onclick = async () => {
            const taskIds = parseTaskIds(taskIdsInput.value);
            if (taskIds.length === 0) {
                alert('请先输入或从页面中勾选需要批量完成的任务 ID！');
                taskIdsInput.focus();
                return;
            }

            const interval = parseFloat(document.getElementById('zt-finish-interval')?.value || 1.0);
            const hourMode = document.getElementById('zt-finish-hour-mode')?.value || 'auto_strict';
            const customHours = parseFloat(document.getElementById('zt-finish-custom-hours')?.value || 1.0);
            const comment = (document.getElementById('zt-finish-comment')?.value || '').trim();

            const confirmMsg = `确定要一键批量完成勾选的 ${taskIds.length} 个任务吗？\n` +
                `• 步骤间隔时间：${interval} 秒/步 (模拟人工操作)\n` +
                `• 报工工时规则：${hourMode === 'auto_strict' ? '严格按任务预计工时 (无工时自动跳过)' : (hourMode === 'custom' ? `统一指定 ${customHours}h` : `预计工时优先，兜底 ${customHours}h`)}\n` +
                `• 完成备注：${comment || '无'}`;
            if (!confirm(confirmMsg)) return;

            const progressBox = document.getElementById('zt-progress-box');
            const progressBar = document.getElementById('zt-progress-bar');
            const progressText = document.getElementById('zt-progress-text');
            const progressRatio = document.getElementById('zt-progress-ratio');
            const logArea = document.getElementById('zt-log-area');

            progressBox.style.display = 'block';
            logArea.innerHTML = '';
            btnRunFinish.disabled = true;

            let successCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            const total = taskIds.length;

            for (let i = 0; i < total; i++) {
                const tid = taskIds[i];
                const current = i + 1;
                const pct = Math.round((current / total) * 100);

                progressRatio.textContent = `${current} / ${total}`;
                progressBar.style.width = `${pct}%`;
                progressText.textContent = `[${current}/${total}] 正在流转并报工任务 #${tid}...`;

                try {
                    const res = await executeSingleAutoFinish(tid, {
                        interval,
                        hourMode,
                        customHours,
                        comment
                    });

                    const logItem = document.createElement('div');
                    logItem.className = 'zt-log-item';

                    if (res.status === 'success') {
                        successCount++;
                        logItem.className += ' zt-log-success';
                        logItem.textContent = `[完成] #${tid} - ${res.msg}`;
                    } else if (res.status === 'skipped') {
                        skippedCount++;
                        logItem.className += ' zt-log-skipped';
                        logItem.textContent = `[跳过] #${tid} - ${res.msg}`;
                    } else {
                        failedCount++;
                        logItem.className += ' zt-log-failed';
                        logItem.textContent = `[失败] #${tid} - ${res.msg}`;
                    }
                    logArea.appendChild(logItem);
                    logArea.scrollTop = logArea.scrollHeight;
                } catch (e) {
                    failedCount++;
                    const logItem = document.createElement('div');
                    logItem.className = 'zt-log-item zt-log-failed';
                    logItem.textContent = `[异常] #${tid} - ${e.message || e}`;
                    logArea.appendChild(logItem);
                }

                // 任务间休眠间隔
                if (interval > 0 && i < total - 1) {
                    await sleep(interval * 1000);
                }
            }

            btnRunFinish.disabled = false;
            progressText.textContent = `批量完成处理完毕！`;

            const summaryMsg = `🎉 批量完成报工处理完毕！\n• 成功完成: ${successCount} 个\n• 规则跳过: ${skippedCount} 个\n• 执行失败: ${failedCount} 个\n\n是否立即刷新当前网页查看最新流转状态？`;
            if (confirm(summaryMsg)) {
                window.location.reload();
            }
        };

        // ==========================================
        // 核心执行 2: 批量修改字段
        // ==========================================
        const btnRunEdit = document.getElementById('zt-btn-run-edit');
        btnRunEdit.onclick = async () => {
            const taskIds = parseTaskIds(taskIdsInput.value);
            if (taskIds.length === 0) {
                alert('请先输入或从页面中勾选需要批量修改的任务 ID！');
                taskIdsInput.focus();
                return;
            }

            const field = fieldSelect.value;
            const fieldText = fieldSelect.options[fieldSelect.selectedIndex].text;
            const comment = (document.getElementById('zt-edit-comment-input')?.value || '').trim();

            const valueObj = { comment: comment };
            if (field === 'name') {
                const modeSelect = document.getElementById('zt-name-mode');
                valueObj.mode = modeSelect ? modeSelect.value : 'direct';
                valueObj.value = (document.getElementById('zt-name-val')?.value || '').trim();
                valueObj.replaceFrom = (document.getElementById('zt-replace-from')?.value || '').trim();
                valueObj.replaceTo = (document.getElementById('zt-replace-to')?.value || '').trim();
                valueObj.syncDesc = !!document.getElementById('zt-sync-desc')?.checked;

                if (valueObj.mode === 'replace' && !valueObj.replaceFrom) {
                    alert('请输入要查找并替换的原词！');
                    return;
                }
                if (valueObj.mode !== 'replace' && !valueObj.value) {
                    alert('请输入目标名称或前后缀！');
                    return;
                }
            } else if (field === 'status') {
                valueObj.value = document.getElementById('zt-field-val')?.value;
                valueObj.consumed = parseFloat(document.getElementById('zt-finish-consumed')?.value || 1.0);
            } else {
                valueObj.value = (document.getElementById('zt-field-val')?.value || '').trim();
            }

            const confirmMsg = `确定要对已选的 ${taskIds.length} 个任务执行批量修改吗？\n• 修改字段：${fieldText}\n• 修改备注：${comment || '无'}`;
            if (!confirm(confirmMsg)) return;

            const progressBox = document.getElementById('zt-progress-box');
            const progressBar = document.getElementById('zt-progress-bar');
            const progressText = document.getElementById('zt-progress-text');
            const progressRatio = document.getElementById('zt-progress-ratio');
            const logArea = document.getElementById('zt-log-area');

            progressBox.style.display = 'block';
            logArea.innerHTML = '';
            btnRunEdit.disabled = true;

            let successCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            const total = taskIds.length;

            for (let i = 0; i < total; i++) {
                const tid = taskIds[i];
                const current = i + 1;
                const pct = Math.round((current / total) * 100);

                progressRatio.textContent = `${current} / ${total}`;
                progressBar.style.width = `${pct}%`;
                progressText.textContent = `[${current}/${total}] 正在处理任务 #${tid}...`;

                try {
                    const res = await executeSingleTaskUpdate(tid, field, valueObj);
                    const logItem = document.createElement('div');
                    logItem.className = 'zt-log-item';

                    if (res.status === 'success') {
                        successCount++;
                        logItem.className += ' zt-log-success';
                        logItem.textContent = `[成功] #${tid} - ${res.msg}`;
                    } else if (res.status === 'skipped') {
                        skippedCount++;
                        logItem.className += ' zt-log-skipped';
                        logItem.textContent = `[跳过] #${tid} - ${res.msg}`;
                    } else {
                        failedCount++;
                        logItem.className += ' zt-log-failed';
                        logItem.textContent = `[失败] #${tid} - ${res.msg}`;
                    }
                    logArea.appendChild(logItem);
                    logArea.scrollTop = logArea.scrollHeight;
                } catch (e) {
                    failedCount++;
                    const logItem = document.createElement('div');
                    logItem.className = 'zt-log-item zt-log-failed';
                    logItem.textContent = `[异常] #${tid} - ${e.message || e}`;
                    logArea.appendChild(logItem);
                }

                if (i < total - 1) {
                    await sleep(150);
                }
            }

            btnRunEdit.disabled = false;
            progressText.textContent = `批量处理完成！`;

            const summaryMsg = `🎉 批量字段修改处理完毕！\n• 成功修改: ${successCount} 条\n• 同值跳过: ${skippedCount} 条\n• 执行失败: ${failedCount} 条\n\n是否立即刷新当前网页查看最新数据？`;
            if (confirm(summaryMsg)) {
                window.location.reload();
            }
        };
    }

    // 页面完全加载后挂载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEvents);
    } else {
        initEvents();
    }
})();
