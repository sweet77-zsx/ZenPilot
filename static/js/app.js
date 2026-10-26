// 禅道自动化助手 前端核心交互逻辑
document.addEventListener('DOMContentLoaded', () => {
    // 自动兼容反向代理二级子路径 (如 /chandao) 或直接根路径访问
    const apiPrefix = window.location.pathname.replace(/\/+$/, '');
    const apiUrl = (path) => `${apiPrefix}${path}`;

    // 状态缓存
    let currentActiveTasks = [];
    let currentQueryTasks = [];
    let selectedTaskIds = new Set();
    let mySelectedTaskIds = new Set();
    let currentAccount = '';
    let currentUserRealname = '';
    let cachedProjects = [];
    let cachedUsers = [];
    let isUsersLoading = false;

    // 行内自定义编辑任务名称暂存池 Map<taskId, { id, originalName, newName }>
    const pendingNameChanges = new Map();

    // DOM 元素
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const userChip = document.getElementById('userChip');
    const userAvatar = document.getElementById('userAvatar');
    const userRealname = document.getElementById('userRealname');
    const userAccount = document.getElementById('userAccount');
    const btnRefreshStatus = document.getElementById('btnRefreshStatus');
    const myActiveBadge = document.getElementById('myActiveBadge');

    const inlineEditBar = document.getElementById('inlineEditBar');
    const modifiedNamesCount = document.getElementById('modifiedNamesCount');
    const btnCancelInlineEdit = document.getElementById('btnCancelInlineEdit');
    const btnSubmitInlineEdit = document.getElementById('btnSubmitInlineEdit');

    function updateInlineEditBar() {
        if (!inlineEditBar) return;
        const count = pendingNameChanges.size;
        if (count > 0) {
            inlineEditBar.style.display = 'flex';
            if (modifiedNamesCount) modifiedNamesCount.textContent = count;
        } else {
            inlineEditBar.style.display = 'none';
        }
    }

    const myTasksTableBody = document.getElementById('myTasksTableBody');
    const btnRefreshMyTasks = document.getElementById('btnRefreshMyTasks');
    const btnExecuteBatchFinish = document.getElementById('btnExecuteBatchFinish');
    const batchFinishInterval = document.getElementById('batchFinishInterval');
    const batchFinishComment = document.getElementById('batchFinishComment');
    const checkAllMyTasks = document.getElementById('checkAllMyTasks');
    const mySelectedCount = document.getElementById('mySelectedCount');
    const btnMySelectAll = document.getElementById('btnMySelectAll');
    const btnMyDeselectAll = document.getElementById('btnMyDeselectAll');

    const btnSearch = document.getElementById('btnSearch');
    const queryTableBody = document.getElementById('queryTableBody');
    const checkAllRows = document.getElementById('checkAllRows');
    const selectedCount = document.getElementById('selectedCount');
    const btnSelectAll = document.getElementById('btnSelectAll');
    const btnDeselectAll = document.getElementById('btnDeselectAll');
    const batchFieldSelect = document.getElementById('batchFieldSelect');
    const dynamicValueContainer = document.getElementById('dynamicValueContainer');
    const btnExecuteBatchUpdate = document.getElementById('btnExecuteBatchUpdate');

    const appModal = document.getElementById('appModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalConfirmBtn = document.getElementById('modalConfirmBtn');

    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingCard = document.getElementById('loadingCard');
    const loadingText = document.getElementById('loadingText');
    const loadingSpinnerBox = document.getElementById('loadingSpinnerBox');
    const loadingProgressBox = document.getElementById('loadingProgressBox');
    const progressTitle = document.getElementById('progressTitle');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const progressCurrent = document.getElementById('progressCurrent');
    const progressTotal = document.getElementById('progressTotal');
    const progressStatusBadge = document.getElementById('progressStatusBadge');
    const progressCurrentTask = document.getElementById('progressCurrentTask');
    const progressTaskName = document.getElementById('progressTaskName');

    // 状态映射字典
    const statusMap = {
        'wait': { label: '未开始', class: 'status-wait' },
        'doing': { label: '进行中', class: 'status-doing' },
        'done': { label: '已完成', class: 'status-done' },
        'closed': { label: '已关闭', class: 'status-closed' },
        'pause': { label: '已暂停', class: 'status-pause' },
        'cancel': { label: '已取消', class: 'status-closed' }
    };

    // 工具函数：普通转圈 Loading 显隐
    function showLoading(text = '正在处理中，请稍候...') {
        if (loadingSpinnerBox) loadingSpinnerBox.style.display = 'flex';
        if (loadingProgressBox) loadingProgressBox.style.display = 'none';
        if (loadingText) loadingText.textContent = text;
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    // 工具函数：批量执行带实时进度条的 Loading (展示已执行数/总数)
    function showProgressLoading(title = '⚡ 正在批量执行任务', current = 0, total = 0, text = '', currentTask = '') {
        if (loadingSpinnerBox) loadingSpinnerBox.style.display = 'none';
        if (loadingProgressBox) loadingProgressBox.style.display = 'block';
        if (progressTitle) progressTitle.textContent = title;
        updateProgress(current, total, text, currentTask);
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    // 更新进度条与计数
    function updateProgress(current = 0, total = 0, text = '', currentTask = '') {
        const cur = Math.max(0, parseInt(current, 10) || 0);
        const tot = Math.max(1, parseInt(total, 10) || 1);
        const percent = Math.min(100, Math.max(0, Math.round((cur / tot) * 100)));

        if (progressBar) progressBar.style.width = percent + '%';
        if (progressPercent) progressPercent.textContent = percent + '%';
        if (progressCurrent) progressCurrent.textContent = cur;
        if (progressTotal) progressTotal.textContent = total;
        if (text && loadingText) loadingText.textContent = text;

        if (progressCurrentTask && progressTaskName) {
            if (currentTask) {
                progressCurrentTask.style.display = 'flex';
                progressTaskName.textContent = currentTask;
            } else {
                progressCurrentTask.style.display = 'none';
            }
        }

        if (progressStatusBadge) {
            if (percent >= 100) {
                progressStatusBadge.textContent = '即将完成';
                progressStatusBadge.style.background = '#dcfce7';
                progressStatusBadge.style.color = '#15803d';
            } else {
                progressStatusBadge.textContent = '执行中';
                progressStatusBadge.style.background = '#e0f2fe';
                progressStatusBadge.style.color = '#0284c7';
            }
        }
    }

    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (loadingProgressBox) loadingProgressBox.style.display = 'none';
        if (loadingSpinnerBox) loadingSpinnerBox.style.display = 'flex';
        if (progressBar) progressBar.style.width = '0%';
        if (progressCurrentTask) progressCurrentTask.style.display = 'none';
    }

    // 读取后端流式输出的 NDJSON 数据并触发实时进度回调
    async function readNdJsonStream(response, onEvent) {
        if (!response.body) {
            return await response.json();
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let lastResult = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留尚未读完的不完整行
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const evt = JSON.parse(trimmed);
                    if (onEvent) onEvent(evt);
                    if (evt.type === 'done') {
                        lastResult = evt;
                    } else if (evt.type === 'error') {
                        throw new Error(evt.message || '批量执行异常');
                    }
                } catch (err) {
                    if (err.message && err.message !== 'Unexpected end of JSON input') {
                        console.error('Parse stream event error:', err, trimmed);
                    }
                }
            }
        }
        if (buffer && buffer.trim()) {
            try {
                const evt = JSON.parse(buffer.trim());
                if (onEvent) onEvent(evt);
                if (evt.type === 'done') lastResult = evt;
            } catch (e) {}
        }
        return lastResult;
    }

    // 工具函数：Modal 弹窗
    function showModal(title, htmlContent) {
        modalTitle.textContent = title;
        modalBody.innerHTML = htmlContent;
        appModal.style.display = 'flex';
    }

    function closeModal() {
        appModal.style.display = 'none';
    }

    modalCloseBtn.onclick = closeModal;
    modalConfirmBtn.onclick = closeModal;

    // 登录弹窗 DOM
    const loginModal = document.getElementById('loginModal');
    const loginModalTitle = document.getElementById('loginModalTitle');
    const loginModalCloseBtn = document.getElementById('loginModalCloseBtn');
    const loginCancelBtn = document.getElementById('loginCancelBtn');
    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const btnLogoutInModal = document.getElementById('btnLogoutInModal');
    const loginUrl = document.getElementById('loginUrl');
    const loginAccount = document.getElementById('loginAccount');
    const loginPassword = document.getElementById('loginPassword');
    const loginRemember = document.getElementById('loginRemember');
    const btnTogglePwd = document.getElementById('btnTogglePwd');
    const iconEyeOff = btnTogglePwd ? btnTogglePwd.querySelector('.icon-eye-off') : null;
    const iconEyeOn = btnTogglePwd ? btnTogglePwd.querySelector('.icon-eye-on') : null;

    function setPasswordVisibility(visible) {
        if (!loginPassword) return;
        loginPassword.type = visible ? 'text' : 'password';
        if (iconEyeOff && iconEyeOn) {
            iconEyeOff.style.display = visible ? 'none' : 'block';
            iconEyeOn.style.display = visible ? 'block' : 'none';
        }
        if (btnTogglePwd) {
            btnTogglePwd.title = visible ? '隐藏明文密码' : '显示明文密码';
        }
    }

    if (btnTogglePwd) {
        btnTogglePwd.addEventListener('click', (e) => {
            e.preventDefault();
            const isVisible = loginPassword.type === 'text';
            setPasswordVisibility(!isVisible);
        });
    }

    // 登录弹窗显隐
    function openLoginModal(isSwitch = false) {
        loginModalTitle.textContent = isSwitch ? '切换禅道登录人 / 账号管理' : '登录禅道账号';
        loginPassword.value = '';
        setPasswordVisibility(false);
        if (btnLogoutInModal) {
            btnLogoutInModal.style.display = isSwitch ? 'inline-flex' : 'none';
        }
        loginModal.style.display = 'flex';
        setTimeout(() => loginAccount.focus(), 50);
    }

    function closeLoginModal() {
        loginModal.style.display = 'none';
    }

    loginModalCloseBtn.onclick = closeLoginModal;
    loginCancelBtn.onclick = closeLoginModal;

    // 点击右上角用户头像胶囊，直接弹出切换登录人对话框
    if (userChip) {
        userChip.onclick = () => openLoginModal(true);
    }

    // 未登录时点击指示条也可登录
    const statusIndicator = document.querySelector('.status-indicator');
    if (statusIndicator) {
        statusIndicator.style.cursor = 'pointer';
        statusIndicator.onclick = () => {
            if (statusDot.className.includes('offline')) {
                openLoginModal(false);
            }
        };
    }

    const btnHeaderLogin = document.getElementById('btnHeaderLogin');
    if (btnHeaderLogin) {
        btnHeaderLogin.onclick = () => openLoginModal(false);
    }

    // 更新我的待办任务总预计工时与表格汇总行
    function updateMyTasksHoursSummary(tasks) {
        const totalEst = (tasks || []).reduce((sum, t) => sum + (parseFloat(t.estimate) || 0), 0);
        const totalConsumed = (tasks || []).reduce((sum, t) => sum + (parseFloat(t.consumed) || 0), 0);
        const formatHours = (num) => Math.round(num * 10) / 10;
        const estDisplay = formatHours(totalEst);
        const consumedDisplay = formatHours(totalConsumed);

        const myActiveTotalHours = document.getElementById('myActiveTotalHours');
        if (myActiveTotalHours) {
            myActiveTotalHours.innerHTML = `⏳ 总预计消耗工时: <strong>${estDisplay}</strong> h`;
        }

        const myTasksTableFoot = document.getElementById('myTasksTableFoot');
        const footTotalEstHours = document.getElementById('footTotalEstHours');
        const footTotalConsumedHours = document.getElementById('footTotalConsumedHours');
        if (myTasksTableFoot) {
            myTasksTableFoot.style.display = (tasks && tasks.length > 0) ? 'table-footer-group' : 'none';
            if (footTotalEstHours) footTotalEstHours.textContent = `${estDisplay} h`;
            if (footTotalConsumedHours) footTotalConsumedHours.textContent = `${consumedDisplay} h`;
        }
    }

    // 1. 初始化检查连接状态 (彻底杜绝任何全局默认账号)
    async function checkStatus() {
        try {
            const res = await fetch(apiUrl('/api/status'));
            const data = await res.json();

            // 仅使用当前客户端浏览器上次在此电脑登录过的账号与地址
            const localUrl = localStorage.getItem('zentao_last_url');
            const localAccount = localStorage.getItem('zentao_last_account');

            if (loginUrl) {
                if (localUrl) loginUrl.value = localUrl;
                else if (data.default_url) loginUrl.value = data.default_url;
            }
            if (loginAccount) {
                // 仅预填本浏览器上次输入的账号，若没有则为空，绝不预填他人账号
                loginAccount.value = localAccount || '';
            }

            if (data.connected) {
                statusDot.className = 'dot online';
                statusText.textContent = '已连接云禅道';
                userChip.style.display = 'flex';
                if (btnHeaderLogin) btnHeaderLogin.style.display = 'none';

                currentAccount = data.account;
                currentUserRealname = data.realname || data.account;
                userRealname.textContent = data.realname || data.account;
                userAccount.textContent = data.account;
                userAvatar.textContent = (data.realname || data.account).charAt(0);
                if (loginAccount) loginAccount.value = data.account;

                // 自动预填周报汇报人
                const reportReporterInput = document.getElementById('reportReporterInput');
                if (reportReporterInput && !reportReporterInput.value) {
                    reportReporterInput.value = data.realname || data.account || '';
                }

                // 实时加载所有项目与用户列表，并刷新目标用户下拉选择器
                loadProjects();
                loadUsers().then(() => {
                    initFilterUserSelect();
                });

                // 按当前登录账号隔离加载专属 AI 对话历史
                switchAiUserAccount(data.account, data.realname || data.account);
            } else {
                statusDot.className = 'dot offline';
                statusText.textContent = '未登录 (点击登录)';
                userChip.style.display = 'none';
                if (btnHeaderLogin) btnHeaderLogin.style.display = 'inline-flex';

                currentAccount = '';
                currentUserRealname = '';

                // 未登录状态下清空任务列表
                myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell">未登录禅道账号。请点击右上角【🔑 登录禅道】进行登录。</td></tr>`;
                myActiveBadge.textContent = '0';
                updateMyTasksHoursSummary([]);

                // 切换到未登录状态下的 AI 对话隔离空间
                switchAiUserAccount('', '');
            }
        } catch (e) {
            statusDot.className = 'dot offline';
            statusText.textContent = '连接异常 (点击重试)';
            userChip.style.display = 'none';
            if (btnHeaderLogin) btnHeaderLogin.style.display = 'inline-flex';

            currentAccount = '';
            currentUserRealname = '';
            switchAiUserAccount('', '');
        }
    }

    // 通用构建可搜索项目下拉选择组件
    function setupSearchableProjectSelect({
        wrapper,
        input,
        hiddenInput,
        clearBtn,
        dropdown,
        items = [],
        includeAll = true,
        defaultId = '',
        placeholder = '输入关键字搜索项目...',
        onSelect = null
    }) {
        if (!wrapper || !input || !hiddenInput || !dropdown) return null;

        let activeIndex = -1;
        let currentFiltered = [];

        function highlightMatch(text, keyword) {
            if (!keyword) return escapeHtml(text);
            const escapedText = escapeHtml(text);
            const lowerText = escapedText.toLowerCase();
            const lowerKey = keyword.toLowerCase();
            const idx = lowerText.indexOf(lowerKey);
            if (idx === -1) return escapedText;
            const before = escapedText.substring(0, idx);
            const match = escapedText.substring(idx, idx + keyword.length);
            const after = escapedText.substring(idx + keyword.length);
            return `${before}<span class="item-highlight">${match}</span>${after}`;
        }

        function renderList(keyword = '') {
            const kw = keyword.trim().toLowerCase();
            let matched = items.filter(p => {
                if (!kw) return true;
                return String(p.id).toLowerCase().includes(kw) || String(p.name).toLowerCase().includes(kw);
            });
            currentFiltered = matched;
            activeIndex = -1;

            let html = '';
            if (includeAll && !kw) {
                const isSelected = !hiddenInput.value;
                html += `
                    <div class="searchable-select-item ${isSelected ? 'is-selected' : ''}" data-id="" data-name="全部项目">
                        <span class="item-id-badge">ALL</span>
                        <span class="item-name">全部项目</span>
                    </div>
                `;
            }

            if (matched.length === 0) {
                html += `<div class="searchable-select-empty">未找到包含「${escapeHtml(keyword)}」的项目</div>`;
            } else {
                matched.forEach(p => {
                    const isSelected = String(hiddenInput.value) === String(p.id);
                    html += `
                        <div class="searchable-select-item ${isSelected ? 'is-selected' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                            <span class="item-id-badge">[${p.id}]</span>
                            <span class="item-name">${highlightMatch(p.name, keyword)}</span>
                        </div>
                    `;
                });
            }

            dropdown.innerHTML = html;

            // 绑定选项点击事件
            dropdown.querySelectorAll('.searchable-select-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // 阻止失焦导致下拉提前关闭
                    const id = el.getAttribute('data-id');
                    const name = el.getAttribute('data-name');
                    chooseItem(id, name);
                });
            });
        }

        function chooseItem(id, name) {
            hiddenInput.value = id || '';
            if (!id) {
                input.value = '';
                input.placeholder = placeholder;
                if (clearBtn) clearBtn.style.display = 'none';
            } else {
                input.value = `[${id}] ${name}`;
                if (clearBtn) clearBtn.style.display = 'block';
            }
            closeDropdown();
            if (onSelect) onSelect(id, name);
        }

        function openDropdown() {
            // 先关闭页面上其他打开的下拉
            document.querySelectorAll('.searchable-select-wrapper.is-open').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('is-open');
                    const dd = w.querySelector('.searchable-select-dropdown');
                    if (dd) dd.style.display = 'none';
                }
            });

            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            renderList(input.value.trim().replace(/^\[\d+\]\s*/, ''));
        }

        function closeDropdown() {
            wrapper.classList.remove('is-open');
            dropdown.style.display = 'none';
            activeIndex = -1;
            // 失焦时校验值与显示同步
            if (!hiddenInput.value) {
                input.value = '';
            } else {
                const found = items.find(p => String(p.id) === String(hiddenInput.value));
                if (found) {
                    input.value = `[${found.id}] ${found.name}`;
                    if (clearBtn) clearBtn.style.display = 'block';
                }
            }
        }

        // 绑定输入与聚焦事件
        input.addEventListener('focus', () => {
            openDropdown();
            input.select();
        });

        input.addEventListener('click', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            }
        });

        input.addEventListener('input', () => {
            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            const kw = input.value.trim();
            if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';
            renderList(kw);
        });

        // 键盘上下选择与回车确认
        input.addEventListener('keydown', (e) => {
            const listItems = dropdown.querySelectorAll('.searchable-select-item');
            if (listItems.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!wrapper.classList.contains('is-open')) {
                    openDropdown();
                    return;
                }
                activeIndex = (activeIndex + 1) % listItems.length;
                updateHoverState(listItems);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!wrapper.classList.contains('is-open')) {
                    openDropdown();
                    return;
                }
                activeIndex = (activeIndex - 1 + listItems.length) % listItems.length;
                updateHoverState(listItems);
            } else if (e.key === 'Enter') {
                if (wrapper.classList.contains('is-open') && activeIndex >= 0 && listItems[activeIndex]) {
                    e.preventDefault();
                    const el = listItems[activeIndex];
                    chooseItem(el.getAttribute('data-id'), el.getAttribute('data-name'));
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        function updateHoverState(listItems) {
            listItems.forEach((el, idx) => {
                if (idx === activeIndex) {
                    el.classList.add('is-hovered');
                    el.scrollIntoView({ block: 'nearest' });
                } else {
                    el.classList.remove('is-hovered');
                }
            });
        }

        // 清除按钮
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chooseItem('', '');
                input.focus();
            });
        }

        // 点击页面其他区域关闭
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown();
            }
        });

        // 初始选中项
        if (defaultId) {
            const found = items.find(p => String(p.id) === String(defaultId));
            if (found) {
                chooseItem(found.id, found.name);
            } else {
                chooseItem(defaultId, `项目 #${defaultId}`);
            }
        } else {
            chooseItem('', '');
        }

        return {
            setValue: (id) => {
                const found = items.find(p => String(p.id) === String(id));
                if (found) chooseItem(found.id, found.name);
                else if (!id) chooseItem('', '');
                else chooseItem(id, `项目 #${id}`);
            },
            updateItems: (newItems) => {
                items = newItems;
                renderList('');
            }
        };
    }

    // 通用构建可搜索用户下拉选择组件
    function setupSearchableUserSelect({
        wrapper,
        input,
        hiddenInput,
        clearBtn,
        dropdown,
        placeholder = '输入姓名/账号搜索用户...',
        includeMe = false,
        onSelect = null
    }) {
        if (!wrapper || !input || !hiddenInput || !dropdown) return null;

        let activeIndex = -1;
        let currentFiltered = [];

        function highlightMatch(text, keyword) {
            if (!keyword) return escapeHtml(text);
            const escapedText = escapeHtml(text);
            const lowerText = escapedText.toLowerCase();
            const lowerKey = keyword.toLowerCase();
            const idx = lowerText.indexOf(lowerKey);
            if (idx === -1) return escapedText;
            const before = escapedText.substring(0, idx);
            const match = escapedText.substring(idx, idx + keyword.length);
            const after = escapedText.substring(idx + keyword.length);
            return `${before}<span class="item-highlight">${match}</span>${after}`;
        }

        function renderList(keyword = '') {
            const kw = keyword.trim().toLowerCase();
            let matched = cachedUsers.filter(u => {
                if (!kw) return true;
                return String(u.account).toLowerCase().includes(kw) || String(u.realname).toLowerCase().includes(kw);
            });
            currentFiltered = matched;
            activeIndex = -1;

            let html = '';

            // 如果支持选择当前登录人“我”
            if (includeMe) {
                const isMatchMe = !kw || '我'.includes(kw) || 'me'.includes(kw) ||
                    (currentUserRealname && currentUserRealname.toLowerCase().includes(kw)) ||
                    (currentAccount && currentAccount.toLowerCase().includes(kw));
                if (isMatchMe) {
                    const isMeSelected = (!hiddenInput.value || (currentAccount && hiddenInput.value.toLowerCase() === currentAccount.toLowerCase()));
                    html += `
                        <div class="searchable-select-item ${isMeSelected ? 'is-selected' : ''}" data-account="${escapeHtml(currentAccount)}" data-realname="${escapeHtml(currentUserRealname || currentAccount)}" data-is-me="true">
                            <span class="item-id-badge" style="background:#fef3c7; color:#d97706; font-weight:700;">🌟 我</span>
                            <span class="item-name">当前登录用户 (${escapeHtml(currentUserRealname || currentAccount || '我')})</span>
                        </div>
                    `;
                }
            }

            if (cachedUsers.length === 0 && !html) {
                html = `<div class="searchable-select-empty" style="color:#2563eb;">⏳ 正在查询禅道所有用户...</div>`;
            } else if (matched.length === 0 && !html) {
                html = `<div class="searchable-select-empty">未找到匹配「${escapeHtml(keyword)}」的用户</div>`;
            } else {
                matched.forEach(u => {
                    // 若已在首项单独显示“我”，列表中对应当前用户项显示高亮区分
                    const isSelected = String(hiddenInput.value).toLowerCase() === String(u.account).toLowerCase();
                    const isCurrentUser = currentAccount && String(u.account).toLowerCase() === currentAccount.toLowerCase();
                    html += `
                        <div class="searchable-select-item ${isSelected ? 'is-selected' : ''}" data-account="${escapeHtml(u.account)}" data-realname="${escapeHtml(u.realname)}" ${isCurrentUser ? 'data-is-me="true"' : ''}>
                            <span class="item-id-badge" style="background:#eff6ff; color:#2563eb; font-weight:600;">@${escapeHtml(u.account)}</span>
                            <span class="item-name">${highlightMatch(u.realname, keyword)} ${isCurrentUser ? '<small style="color:#f59e0b; font-weight:600;">(我)</small>' : ''}</span>
                        </div>
                    `;
                });
            }

            dropdown.innerHTML = html;

            dropdown.querySelectorAll('.searchable-select-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const account = el.getAttribute('data-account');
                    const realname = el.getAttribute('data-realname');
                    const isMe = el.getAttribute('data-is-me') === 'true';
                    chooseItem(account, realname, isMe);
                });
            });
        }

        function chooseItem(account, realname, isMe = false) {
            const reallyMe = isMe || (includeMe && (!account || (currentAccount && String(account).toLowerCase() === currentAccount.toLowerCase())));
            if (reallyMe) {
                hiddenInput.value = currentAccount || '';
                input.value = `我 (${currentUserRealname || currentAccount || '当前登录用户'})`;
                if (clearBtn) clearBtn.style.display = 'none';
                closeDropdown();
                if (onSelect) onSelect(currentAccount, currentUserRealname || currentAccount, true);
                return;
            }

            hiddenInput.value = account || '';
            if (!account) {
                input.value = '';
                input.placeholder = placeholder;
                if (clearBtn) clearBtn.style.display = 'none';
            } else {
                input.value = `${realname} (${account})`;
                if (clearBtn) clearBtn.style.display = 'block';
            }
            closeDropdown();
            if (onSelect) onSelect(account, realname, false);
        }

        function openDropdown() {
            document.querySelectorAll('.searchable-select-wrapper.is-open').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('is-open');
                    const dd = w.querySelector('.searchable-select-dropdown');
                    if (dd) dd.style.display = 'none';
                }
            });

            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            if (cachedUsers.length === 0) {
                renderList('');
                loadUsers().then(() => {
                    if (wrapper.classList.contains('is-open')) {
                        renderList(input.value.trim().replace(/\s*\([^)]*\)$/, ''));
                    }
                });
            } else {
                renderList(input.value.trim().replace(/\s*\([^)]*\)$/, ''));
            }
        }

        function closeDropdown() {
            wrapper.classList.remove('is-open');
            dropdown.style.display = 'none';
            activeIndex = -1;
            if (!hiddenInput.value && input.value.trim()) {
                const typed = input.value.trim();
                const exact = cachedUsers.find(u => u.account.toLowerCase() === typed.toLowerCase() || u.realname.toLowerCase() === typed.toLowerCase());
                if (exact) {
                    chooseItem(exact.account, exact.realname, false);
                } else {
                    hiddenInput.value = typed;
                }
            }
        }

        input.addEventListener('focus', openDropdown);
        input.addEventListener('click', openDropdown);

        input.addEventListener('input', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            } else {
                renderList(input.value.trim());
            }
            if (clearBtn) {
                clearBtn.style.display = input.value.trim() ? 'block' : 'none';
            }
            if (!input.value.trim()) {
                hiddenInput.value = '';
            }
        });

        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.searchable-select-item');
            if (!items || items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!wrapper.classList.contains('is-open')) {
                    openDropdown();
                    return;
                }
                activeIndex = (activeIndex + 1) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!wrapper.classList.contains('is-open')) return;
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateActiveItem(items);
            } else if (e.key === 'Enter') {
                if (wrapper.classList.contains('is-open') && activeIndex >= 0 && items[activeIndex]) {
                    e.preventDefault();
                    const target = items[activeIndex];
                    chooseItem(target.getAttribute('data-account'), target.getAttribute('data-realname'), target.getAttribute('data-is-me') === 'true');
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        function updateActiveItem(items) {
            items.forEach((it, idx) => {
                if (idx === activeIndex) {
                    it.classList.add('is-active');
                    it.scrollIntoView({ block: 'nearest' });
                } else {
                    it.classList.remove('is-active');
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (includeMe) {
                    chooseItem(currentAccount, currentUserRealname, true);
                } else {
                    chooseItem('', '');
                }
                input.focus();
                openDropdown();
            });
        }

        const arrow = wrapper.querySelector('.searchable-select-arrow');
        if (arrow) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                if (wrapper.classList.contains('is-open')) {
                    closeDropdown();
                } else {
                    input.focus();
                    openDropdown();
                }
            });
        }

        // 初始化默认选“我”
        if (includeMe && (!hiddenInput.value || hiddenInput.value === currentAccount)) {
            chooseItem(currentAccount, currentUserRealname, true);
        }

        return {
            chooseItem,
            renderList,
            refreshMe: () => {
                if (includeMe && (!hiddenInput.value || hiddenInput.value === currentAccount)) {
                    chooseItem(currentAccount, currentUserRealname, true);
                }
            }
        };
    }

    // 动态刷新任务范围类型下拉框的选项文案
    function updateViewTypeOptions(displayName, isMe) {
        const sel = document.getElementById('filterViewType');
        if (!sel) return;
        const currentVal = sel.value;
        const nameText = isMe ? '我' : (displayName || '选定用户');
        const allText = isMe ? '我的全部任务' : `${nameText}的全部任务`;

        sel.innerHTML = `
            <option value="finishedBy">由${nameText}完成 (finishedBy)</option>
            <option value="assignedTo">指派给${nameText} (assignedTo)</option>
            <option value="openedBy">由${nameText}创建 (openedBy)</option>
            <option value="closedBy">由${nameText}关闭 (closedBy)</option>
            <option value="all">${allText} (all)</option>
        `;

        if (['finishedBy', 'assignedTo', 'openedBy', 'closedBy', 'all'].includes(currentVal)) {
            sel.value = currentVal;
        } else {
            sel.value = 'finishedBy';
        }
    }

    let filterProjectSelectInstance = null;
    let filterUserSelectInstance = null;

    // 初始化多维查询的目标用户下拉选择器
    function initFilterUserSelect() {
        const wrapper = document.getElementById('filterUserWrapper');
        const input = document.getElementById('filterUserInput');
        const hidden = document.getElementById('filterUserAccount');
        const clearBtn = document.getElementById('filterUserClear');
        const dropdown = document.getElementById('filterUserDropdown');

        if (!wrapper || !input || !hidden || !dropdown) return;

        if (filterUserSelectInstance) {
            filterUserSelectInstance.refreshMe();
            return;
        }

        filterUserSelectInstance = setupSearchableUserSelect({
            wrapper,
            input,
            hiddenInput: hidden,
            clearBtn,
            dropdown,
            placeholder: '输入姓名/账号选择用户 (默认我)',
            includeMe: true,
            onSelect: (account, realname, isMe) => {
                updateViewTypeOptions(realname, isMe);
            }
        });

        // 默认初始化文案
        updateViewTypeOptions(currentUserRealname || currentAccount, true);
    }

    // 实时查询所有项目列表并初始化可搜索下拉组件
    async function loadProjects() {
        try {
            const res = await fetch(apiUrl('/api/projects'));
            const data = await res.json();
            if (data.success && data.projects) {
                cachedProjects = data.projects;

                // 1. 初始化多维查询中的可搜索项目下拉框
                const filterWrapper = document.getElementById('filterProjectWrapper');
                const filterInput = document.getElementById('filterProjectInput');
                const filterHidden = document.getElementById('filterProjectId');
                const filterClear = document.getElementById('filterProjectClear');
                const filterDropdown = document.getElementById('filterProjectDropdown');

                if (filterWrapper && filterInput && filterHidden && filterDropdown) {
                    const currentVal = filterHidden.value;
                    filterProjectSelectInstance = setupSearchableProjectSelect({
                        wrapper: filterWrapper,
                        input: filterInput,
                        hiddenInput: filterHidden,
                        clearBtn: filterClear,
                        dropdown: filterDropdown,
                        items: cachedProjects,
                        includeAll: true,
                        defaultId: currentVal || '',
                        placeholder: '输入名称/ID搜索项目 (全部)'
                    });
                }

                // 2. 如果当前批量修改选的是项目，也刷新动态输入框为可搜索选择器
                if (batchFieldSelect && batchFieldSelect.value === 'project') {
                    renderDynamicValueInput('project');
                }
            }
        } catch (e) {
            console.error('加载项目列表失败:', e);
        }
    }

    // 异步查询所有用户列表供指派人搜索与下拉选择使用
    async function loadUsers(force = false) {
        if (cachedUsers.length > 0 && !force) return cachedUsers;
        if (isUsersLoading) return cachedUsers;
        isUsersLoading = true;
        try {
            const res = await fetch(apiUrl('/api/users'));
            const data = await res.json();
            if (data.success && Array.isArray(data.users)) {
                cachedUsers = data.users;
            }
        } catch (e) {
            console.error('加载用户列表失败:', e);
        } finally {
            isUsersLoading = false;
        }
        return cachedUsers;
    }

    // 提交登录/切换
    loginSubmitBtn.onclick = async () => {
        const url = loginUrl.value.trim();
        const account = loginAccount.value.trim();
        const password = loginPassword.value.trim();
        const remember = loginRemember.checked;

        if (!url || !account || !password) {
            alert('禅道地址、账号与密码均不能为空！');
            return;
        }

        showLoading('正在登录禅道，请稍候...');
        try {
            const res = await fetch(apiUrl('/api/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, account, password, remember })
            });
            const data = await res.json();
            hideLoading();

            if (data.success) {
                closeLoginModal();
                // 仅在当前用户本地浏览器记录账号，方便下次快捷登录，不影响他人
                localStorage.setItem('zentao_last_url', url);
                localStorage.setItem('zentao_last_account', account);
                alert(`登录成功！当前登录人：${data.realname} (${data.account})`);
                await checkStatus();
                // 自动刷新当前选项卡任务数据与项目列表
                loadMyActiveTasks();
                loadProjects();
                btnSearch.click();
            } else {
                alert('登录失败: ' + data.message);
            }
        } catch (e) {
            hideLoading();
            alert('网络请求异常: ' + e);
        }
    };

    // 退出登录
    if (btnLogoutInModal) {
        btnLogoutInModal.onclick = async () => {
            const name = userRealname.textContent || currentAccount;
            if (!confirm(`确定要退出当前登录账号「${name}」吗？`)) return;

            showLoading('正在退出登录...');
            try {
                await fetch(apiUrl('/api/logout'), { method: 'POST' });
                hideLoading();
                closeLoginModal();
                currentAccount = '';
                currentUserRealname = '';
                switchAiUserAccount('', '');
                await checkStatus();
                myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell">已退出登录。可点击右上角登录状态重新登录。</td></tr>`;
                myActiveBadge.textContent = '0';
                openLoginModal(false);
            } catch (e) {
                hideLoading();
                alert('退出异常: ' + e);
            }
        };
    }

    btnRefreshStatus.onclick = checkStatus;

    // 2. Tab 切换
    document.querySelectorAll('.tab-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tab-finish') {
                loadMyActiveTasks();
            }
        });
    });

    // 3. 模块一：待办任务勾选与统计逻辑
    function updateMySelectedCount() {
        const total = currentActiveTasks.length;
        const count = mySelectedTaskIds.size;
        if (mySelectedCount) {
            mySelectedCount.textContent = count;
        }

        // 更新表头全选框状态 (支持 indeterminate 状态)
        if (checkAllMyTasks) {
            if (total === 0 || count === 0) {
                checkAllMyTasks.checked = false;
                checkAllMyTasks.indeterminate = false;
            } else if (count === total) {
                checkAllMyTasks.checked = true;
                checkAllMyTasks.indeterminate = false;
            } else {
                checkAllMyTasks.checked = false;
                checkAllMyTasks.indeterminate = true;
            }
        }

        // 动态更新一键批量完成按钮文案与状态
        if (btnExecuteBatchFinish) {
            if (count > 0) {
                btnExecuteBatchFinish.innerHTML = `⚡ 一键批量完成已选 (<strong>${count}</strong> 个任务)`;
                btnExecuteBatchFinish.disabled = false;
            } else {
                btnExecuteBatchFinish.innerHTML = `⚡ 一键批量完成 (请先勾选待办)`;
                btnExecuteBatchFinish.disabled = false;
            }
        }
    }

    // 全选/取消全选待办任务
    if (checkAllMyTasks) {
        checkAllMyTasks.addEventListener('change', (e) => {
            const checked = e.target.checked;
            if (checked) {
                currentActiveTasks.forEach(t => mySelectedTaskIds.add(String(t.id)));
            } else {
                mySelectedTaskIds.clear();
            }
            if (myTasksTableBody) {
                myTasksTableBody.querySelectorAll('.my-task-checkbox').forEach(cb => {
                    cb.checked = checked;
                    const tr = cb.closest('tr');
                    if (tr) {
                        if (checked) tr.classList.add('row-selected');
                        else tr.classList.remove('row-selected');
                    }
                });
            }
            updateMySelectedCount();
        });
    }

    if (btnMySelectAll) {
        btnMySelectAll.onclick = () => {
            currentActiveTasks.forEach(t => mySelectedTaskIds.add(String(t.id)));
            if (myTasksTableBody) {
                myTasksTableBody.querySelectorAll('.my-task-checkbox').forEach(cb => {
                    cb.checked = true;
                    const tr = cb.closest('tr');
                    if (tr) tr.classList.add('row-selected');
                });
            }
            updateMySelectedCount();
        };
    }

    if (btnMyDeselectAll) {
        btnMyDeselectAll.onclick = () => {
            mySelectedTaskIds.clear();
            if (myTasksTableBody) {
                myTasksTableBody.querySelectorAll('.my-task-checkbox').forEach(cb => {
                    cb.checked = false;
                    const tr = cb.closest('tr');
                    if (tr) tr.classList.remove('row-selected');
                });
            }
            updateMySelectedCount();
        };
    }

    // 加载我的待办未完成任务
    async function loadMyActiveTasks() {
        myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell">正在查询指派给您的待办任务...</td></tr>`;
        try {
            const res = await fetch(apiUrl('/api/my-active-tasks'));
            const json = await res.json();
            if (json.success) {
                currentActiveTasks = json.tasks || [];
                myActiveBadge.textContent = currentActiveTasks.length;

                // 默认全选拉取到的所有待办任务，方便用户一键批量流转，也可以单独勾选取消
                mySelectedTaskIds.clear();
                currentActiveTasks.forEach(t => mySelectedTaskIds.add(String(t.id)));

                renderMyTasks(currentActiveTasks);
                updateMySelectedCount();
            } else {
                myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell" style="color:red;">查询失败: ${json.message}</td></tr>`;
                mySelectedTaskIds.clear();
                updateMySelectedCount();
            }
        } catch (e) {
            myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell" style="color:red;">网络异常: ${e}</td></tr>`;
            mySelectedTaskIds.clear();
            updateMySelectedCount();
        }
    }

    function renderMyTasks(tasks) {
        updateMyTasksHoursSummary(tasks);

        if (!tasks || tasks.length === 0) {
            myTasksTableBody.innerHTML = `<tr><td colspan="8" class="empty-cell">🎉 当前没有指派给您的未完成任务！太棒了！</td></tr>`;
            updateMySelectedCount();
            return;
        }

        let html = '';
        tasks.forEach(t => {
            const st = statusMap[t.status] || { label: t.status, class: 'status-wait' };
            const estVal = parseFloat(t.estimate) || 0;
            const hasEst = estVal > 0;

            const estTag = hasEst
                ? `<span class="est-tag est-valid">⚡ ${estVal}h (可自动报工)</span>`
                : `<span class="est-tag est-missing">⚠️ 未填写 (将跳过)</span>`;

            const taskIdStr = String(t.id);
            const isChecked = mySelectedTaskIds.has(taskIdStr);

            html += `
                <tr data-task-id="${t.id}" class="${isChecked ? 'row-selected' : ''}">
                    <td style="text-align:center;">
                        <input type="checkbox" class="my-task-checkbox" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
                    </td>
                    <td><strong>#${t.id}</strong></td>
                    <td>${escapeHtml(t.name)}</td>
                    <td><span class="status-tag ${st.class}">${st.label}</span></td>
                    <td>${estTag}</td>
                    <td>${t.consumed || 0}h</td>
                    <td>${t.openedBy || '-'}</td>
                    <td>${t.deadline || '-'}</td>
                </tr>
            `;
        });
        myTasksTableBody.innerHTML = html;

        // 绑定每行复选框变更事件
        myTasksTableBody.querySelectorAll('.my-task-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.getAttribute('data-id');
                const tr = e.target.closest('tr');
                if (e.target.checked) {
                    mySelectedTaskIds.add(id);
                    if (tr) tr.classList.add('row-selected');
                } else {
                    mySelectedTaskIds.delete(id);
                    if (tr) tr.classList.remove('row-selected');
                }
                updateMySelectedCount();
            });
        });

        updateMySelectedCount();
    }

    btnRefreshMyTasks.onclick = loadMyActiveTasks;

    // 4. 模块一核心操作：一键批量完成勾选的待办任务
    btnExecuteBatchFinish.onclick = async () => {
        if (currentActiveTasks.length === 0) {
            alert('当前没有待完成的待办任务！');
            return;
        }

        if (mySelectedTaskIds.size === 0) {
            alert('请先勾选需要批量完成的待办任务！');
            return;
        }

        const selectedTasks = currentActiveTasks.filter(t => mySelectedTaskIds.has(String(t.id)));
        const validCount = selectedTasks.filter(t => (parseFloat(t.estimate) || 0) > 0).length;
        const skipCount = selectedTasks.length - validCount;

        // 获取参数：每步间隔时间与可选备注
        let intervalSec = batchFinishInterval ? parseFloat(batchFinishInterval.value) : 1.0;
        if (isNaN(intervalSec) || intervalSec < 0) {
            intervalSec = 1.0;
        }
        const commentText = batchFinishComment ? batchFinishComment.value.trim() : '';

        const approxSeconds = Math.round(validCount * (intervalSec > 0 ? (intervalSec * 1.5 + 0.5) : 0.5));
        const confirmMsg = `已勾选 ${selectedTasks.length} 个待办任务：\n` +
            `• 符合预计耗时、将自动流转并报工完成：${validCount} 个\n` +
            `• 缺少预计工时、将被自动跳过：${skipCount} 个\n` +
            `• 步骤间隔时间：${intervalSec} 秒/步 (防脚本检测)\n` +
            `• 完成备注：${commentText ? commentText : '无备注 (留空未填)'}\n` +
            (intervalSec > 0 && validCount > 0 ? `• 预计总耗时：约 ${approxSeconds} 秒 (已启用连接断线自动恢复)\n\n` : `\n`) +
            `确定要立即执行批量完成已选的 ${selectedTasks.length} 个任务吗？`;

        if (!confirm(confirmMsg)) return;

        showProgressLoading('⚡ 批量流转完成已选任务', 0, selectedTasks.length, `正在准备执行（每步间隔 ${intervalSec}s）...`);

        try {
            const res = await fetch(apiUrl('/api/batch-finish'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_ids: Array.from(mySelectedTaskIds),
                    interval_seconds: intervalSec,
                    comment: commentText,
                    stream: true
                })
            });

            let finalDone = null;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('ndjson')) {
                finalDone = await readNdJsonStream(res, (evt) => {
                    if (evt.type === 'start') {
                        updateProgress(0, evt.total, `准备处理 ${evt.total} 条任务...`);
                    } else if (evt.type === 'progress') {
                        const taskDesc = evt.task ? `#${evt.task.id} ${evt.task.name}` : '';
                        updateProgress(evt.current, evt.total, evt.message || `正在流转任务...`, taskDesc);
                    }
                });
            } else {
                finalDone = await res.json();
            }
            hideLoading();
            const resJson = finalDone || {};

            if (resJson.success) {
                const data = resJson.data;
                const successList = data.success || [];
                const skippedList = data.skipped || [];
                const failedList = data.failed || [];

                // 构建弹窗提示内容
                let modalHtml = `
                    <div class="summary-stat-grid">
                        <div class="stat-box success">
                            <span class="stat-num">${successList.length}</span>
                            <span class="stat-label">成功完成并报工</span>
                        </div>
                        <div class="stat-box warning">
                            <span class="stat-num">${skippedList.length}</span>
                            <span class="stat-label">跳过 (无预计工时)</span>
                        </div>
                        <div class="stat-box danger">
                            <span class="stat-num">${failedList.length}</span>
                            <span class="stat-label">执行失败</span>
                        </div>
                    </div>
                `;

                if (skippedList.length > 0) {
                    modalHtml += `
                        <div class="skipped-list">
                            <div class="skipped-title">⚠️ 以下 ${skippedList.length} 个任务因未填写预计消耗时间已被安全跳过：</div>
                    `;
                    skippedList.forEach(s => {
                        modalHtml += `<div class="skipped-item"><strong>#${s.id}</strong> ${escapeHtml(s.name)} <span style="color:#b45309;">(${s.reason})</span></div>`;
                    });
                    modalHtml += `</div>`;
                }

                if (failedList.length > 0) {
                    modalHtml += `
                        <div class="skipped-list" style="border-color:#fca5a5; background:#fef2f2; margin-top:10px;">
                            <div class="skipped-title" style="color:#b91c1c;">❌ 以下任务执行失败：</div>
                    `;
                    failedList.forEach(f => {
                        modalHtml += `<div class="skipped-item" style="color:#991b1b;"><strong>#${f.id}</strong> ${escapeHtml(f.name)}: ${f.reason}</div>`;
                    });
                    modalHtml += `</div>`;
                }

                showModal('批量流转完成执行汇总', modalHtml);
                loadMyActiveTasks(); // 刷新待办列表并重新同步状态
            } else {
                alert('执行异常: ' + resJson.message);
            }
        } catch (e) {
            hideLoading();
            alert('网络请求失败: ' + e);
        }
    };

    // 5. 模块二：动态配置化批量修改字段输入框渲染
    function renderDynamicValueInput(fieldName) {
        let html = '';
        if (fieldName === 'name') {
            html = `
                <select id="nameModeSelect" class="form-control" style="width: 125px;">
                    <option value="direct" selected>统一重命名</option>
                    <option value="prefix">添加前缀</option>
                    <option value="suffix">添加后缀</option>
                    <option value="replace">文本替换</option>
                </select>
                <div id="nameInputsContainer" style="display:inline-flex; align-items:center; gap:6px;">
                    <input type="text" id="fieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="min-width: 220px; max-width: 320px;">
                </div>
                <label class="checkbox-label" style="display:inline-flex; align-items:center; gap:5px; font-size:12px; color:#475569; cursor:pointer; user-select:none; margin-left:6px;" title="勾选后，任务描述将同步更新为与新任务名称一致">
                    <input type="checkbox" id="syncDescCheckbox" checked>
                    <span>同步将任务描述改成与名称一致</span>
                </label>
            `;
        } else if (fieldName === 'assignedTo') {
            html = `
                <select id="fieldValueInput" class="form-control" style="min-width: 170px;">
                    <option value="closed" selected>Closed (已关闭锁定)</option>
                    <option value="${currentAccount}">指派给当前用户 (${userRealname.textContent || currentAccount})</option>
                    <option value="">未指派 (置空)</option>
                    <option value="__custom__">自定义输入其他账号 (搜索/下拉)...</option>
                </select>
                <div class="searchable-select-wrapper" id="customUserWrapper" style="display:none; min-width: 220px; max-width: 320px;">
                    <input type="text" id="customUserInput" class="form-control searchable-select-input" placeholder="输入姓名/账号搜索用户..." autocomplete="off">
                    <input type="hidden" id="customUserHidden" value="">
                    <button type="button" class="searchable-select-clear" id="customUserClear" title="清除" style="display: none;">&times;</button>
                    <span class="searchable-select-arrow">▼</span>
                    <div class="searchable-select-dropdown" id="customUserDropdown" style="display: none;">
                        <!-- 动态渲染用户列表 -->
                    </div>
                </div>
            `;
        } else if (fieldName === 'status') {
            html = `
                <select id="fieldValueInput" class="form-control" style="min-width: 150px;">
                    <option value="wait">未开始 (wait)</option>
                    <option value="doing">进行中 (doing)</option>
                    <option value="done">已完成 (done)</option>
                    <option value="closed" selected>已关闭 (closed)</option>
                    <option value="pause">已暂停 (pause)</option>
                </select>
            `;
        } else if (fieldName === 'project') {
            const firstProj = (cachedProjects && cachedProjects.length > 0) ? cachedProjects[0] : { id: '183', name: '互联网应用V1.1版本迭代' };
            html = `
                <div class="searchable-select-wrapper" id="batchProjectWrapper" style="min-width: 240px; max-width: 340px;">
                    <input type="text" id="batchProjectInput" class="form-control searchable-select-input" placeholder="输入关键字搜索目标项目..." autocomplete="off">
                    <input type="hidden" id="fieldValueInput" value="${firstProj.id}">
                    <button type="button" class="searchable-select-clear" id="batchProjectClear" title="清除" style="display: none;">&times;</button>
                    <span class="searchable-select-arrow">▼</span>
                    <div class="searchable-select-dropdown" id="batchProjectDropdown" style="display: none;">
                        <!-- 动态渲染项目列表 -->
                    </div>
                </div>
            `;
        } else if (fieldName === 'execution') {
            html = `<input type="number" id="fieldValueInput" class="form-control" placeholder="目标执行/迭代 ID (如 203)" style="width:180px;">`;
        } else if (fieldName === 'estimate') {
            html = `<input type="number" step="0.5" id="fieldValueInput" class="form-control" placeholder="工时(小时，如 2.0)" style="width:150px;">`;
        } else if (fieldName === 'pri') {
            html = `
                <select id="fieldValueInput" class="form-control" style="min-width: 120px;">
                    <option value="1">1 (最高)</option>
                    <option value="2">2 (高)</option>
                    <option value="3" selected>3 (中)</option>
                    <option value="4">4 (低)</option>
                </select>
            `;
        } else if (fieldName === 'deadline') {
            html = `<input type="date" id="fieldValueInput" class="form-control" style="width:160px;">`;
        }

        dynamicValueContainer.innerHTML = html;

        // 任务名称模式切换联动
        const nameModeSelect = document.getElementById('nameModeSelect');
        const nameInputsContainer = document.getElementById('nameInputsContainer');
        if (nameModeSelect && nameInputsContainer) {
            nameModeSelect.addEventListener('change', () => {
                const mode = nameModeSelect.value;
                if (mode === 'direct') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="min-width: 220px; max-width: 320px;">`;
                } else if (mode === 'prefix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入前缀 (如 【2026】)" style="min-width: 190px;">`;
                } else if (mode === 'suffix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入后缀 (如 -已评审)" style="min-width: 190px;">`;
                } else if (mode === 'replace') {
                    nameInputsContainer.innerHTML = `
                        <input type="text" id="replaceFromInput" class="form-control" placeholder="要查找的词" style="width: 125px;">
                        <span style="color:#64748b; font-weight:bold;">➔</span>
                        <input type="text" id="fieldValueInput" class="form-control" placeholder="替换为新词" style="width: 125px;">
                    `;
                }
            });
        }

        // 如果是所属项目字段，初始化目标项目可搜索下拉选择组件
        if (fieldName === 'project') {
            const firstProj = (cachedProjects && cachedProjects.length > 0) ? cachedProjects[0] : null;
            setupSearchableProjectSelect({
                wrapper: document.getElementById('batchProjectWrapper'),
                input: document.getElementById('batchProjectInput'),
                hiddenInput: document.getElementById('fieldValueInput'),
                clearBtn: document.getElementById('batchProjectClear'),
                dropdown: document.getElementById('batchProjectDropdown'),
                items: cachedProjects,
                includeAll: false,
                defaultId: firstProj ? firstProj.id : '',
                placeholder: '输入关键字搜索目标项目...'
            });
        }

        // 如果是指派给，支持自定义切换为支持搜索的下拉选择框
        const valSelect = document.getElementById('fieldValueInput');
        const customUserWrapper = document.getElementById('customUserWrapper');
        if (valSelect && customUserWrapper && valSelect.tagName === 'SELECT') {
            valSelect.addEventListener('change', () => {
                if (valSelect.value === '__custom__') {
                    customUserWrapper.style.display = 'inline-block';
                    loadUsers().then(() => {
                        setupSearchableUserSelect({
                            wrapper: customUserWrapper,
                            input: document.getElementById('customUserInput'),
                            hiddenInput: document.getElementById('customUserHidden'),
                            clearBtn: document.getElementById('customUserClear'),
                            dropdown: document.getElementById('customUserDropdown'),
                            placeholder: '输入姓名/账号搜索用户...'
                        });
                        const customUserInput = document.getElementById('customUserInput');
                        if (customUserInput) customUserInput.focus();
                    });
                } else {
                    customUserWrapper.style.display = 'none';
                    const customUserHidden = document.getElementById('customUserHidden');
                    if (customUserHidden) customUserHidden.value = '';
                }
            });
        }
    }

    // 初始化渲染一次字段输入
    renderDynamicValueInput(batchFieldSelect.value);

    batchFieldSelect.addEventListener('change', () => {
        renderDynamicValueInput(batchFieldSelect.value);
    });

    // 6. 模块二：自定义查询
    btnSearch.onclick = async () => {
        const targetAcc = (document.getElementById('filterUserAccount')?.value || '').trim();
        const userInputVal = (document.getElementById('filterUserInput')?.value || '').trim();
        let targetRealname = '';
        if (userInputVal) {
            const m = userInputVal.match(/^([^()]+)/);
            if (m) targetRealname = m[1].replace(/^我\s*[:：(（]?\s*/, '').replace(/[)）]/g, '').trim();
        }

        const params = {
            target_account: targetAcc || currentAccount,
            target_realname: targetRealname,
            view_type: document.getElementById('filterViewType').value,
            year: document.getElementById('filterYear').value.trim(),
            status: document.getElementById('filterStatus').value,
            project_id: document.getElementById('filterProjectId').value.trim(),
            keyword: document.getElementById('filterKeyword').value.trim()
        };

        showLoading('正在全量检索任务，请稍候...');
        queryTableBody.innerHTML = `<tr><td colspan="10" class="empty-cell">检索中...</td></tr>`;

        try {
            const res = await fetch(apiUrl('/api/tasks/query'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await res.json();
            hideLoading();

            if (data.success) {
                currentQueryTasks = data.tasks || [];
                selectedTaskIds.clear();
                updateSelectedCount();
                pendingNameChanges.clear();
                updateInlineEditBar();
                renderQueryTable(currentQueryTasks);
            } else {
                queryTableBody.innerHTML = `<tr><td colspan="10" class="empty-cell" style="color:red;">查询失败: ${data.message}</td></tr>`;
            }
        } catch (e) {
            hideLoading();
            queryTableBody.innerHTML = `<tr><td colspan="10" class="empty-cell" style="color:red;">网络异常: ${e}</td></tr>`;
        }
    };

    function renderQueryTable(tasks) {
        if (!tasks || tasks.length === 0) {
            queryTableBody.innerHTML = `<tr><td colspan="10" class="empty-cell">未找到符合条件的任务</td></tr>`;
            checkAllRows.checked = false;
            return;
        }

        // 前端渲染层按任务 ID 去重兜底
        const uniqueTasks = [];
        const seenIds = new Set();
        for (const t of tasks) {
            const sid = String(t.id);
            if (!seenIds.has(sid)) {
                seenIds.add(sid);
                uniqueTasks.push(t);
            }
        }

        let html = '';
        uniqueTasks.forEach(t => {
            const st = statusMap[t.status] || { label: t.status, class: 'status-wait' };
            const isAssignedEmpty = (t.assignedTo === '' || t.assignedTo === null);
            const assignedDisplay = isAssignedEmpty
                ? `<span style="color:#2563eb; font-weight:600;">未指派</span>`
                : (t.assignedTo === 'closed' ? `<span style="color:#64748b;">Closed</span>` : (t.assignedToRealname || t.assignedTo));

            const finishedByDisplay = t.finishedByRealname || t.finishedBy || '-';

            const taskIdStr = String(t.id);
            const isModified = pendingNameChanges.has(taskIdStr);
            const currentName = isModified ? pendingNameChanges.get(taskIdStr).newName : t.name;

            html += `
                <tr data-row-id="${t.id}">
                    <td style="text-align:center;">
                        <input type="checkbox" class="task-checkbox" data-id="${t.id}" ${selectedTaskIds.has(taskIdStr) ? 'checked' : ''}>
                    </td>
                    <td><strong>#${t.id}</strong></td>
                    <td class="editable-name-cell ${isModified ? 'cell-modified' : ''}" data-id="${t.id}" data-original="${escapeHtml(t.name)}" title="点击可直接编辑修改名称">
                        <div class="name-display-box">
                            <span class="task-name-text">${escapeHtml(currentName)}</span>
                            ${isModified ? '<span class="cell-modified-badge">已改</span>' : '<span class="edit-hint-icon" title="点击编辑">✏️</span>'}
                        </div>
                    </td>
                    <td><span class="status-tag ${st.class}">${st.label}</span></td>
                    <td>${assignedDisplay}</td>
                    <td><span style="color:#0f172a; font-weight:500;">${escapeHtml(finishedByDisplay)}</span></td>
                    <td>${t.project || '-'}</td>
                    <td>${t.estStarted || '-'}</td>
                    <td>${t.deadline || '-'}</td>
                    <td>${t.estimate || 0}h</td>
                </tr>
            `;
        });
        queryTableBody.innerHTML = html;

        // 绑定每行勾选事件
        document.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.getAttribute('data-id');
                if (e.target.checked) {
                    selectedTaskIds.add(id);
                } else {
                    selectedTaskIds.delete(id);
                }
                updateSelectedCount();
            });
        });

        // 绑定任务名称单元格点击编辑事件
        bindInlineNameEditEvents();
    }

    function bindInlineNameEditEvents() {
        document.querySelectorAll('.editable-name-cell').forEach(cell => {
            cell.addEventListener('click', function(e) {
                // 如果正在输入中，避免重复触发
                if (this.querySelector('.inline-name-input')) return;

                const taskId = this.getAttribute('data-id');
                const originalName = this.getAttribute('data-original');
                const textSpan = this.querySelector('.task-name-text');
                const currentVal = textSpan ? textSpan.textContent : originalName;

                // 替换为输入框
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'inline-name-input';
                input.value = currentVal;
                input.title = '按回车或点击空白处保存，Esc 键取消修改';

                this.innerHTML = '';
                this.appendChild(input);
                input.focus();
                input.select();

                let isCanceled = false;

                // 键盘快捷处理
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        input.blur(); // 触发失焦统一保存
                    } else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        isCanceled = true;
                        renderCellDisplay(this, taskId, originalName, currentVal);
                    }
                });

                // 失焦暂存
                input.addEventListener('blur', () => {
                    if (isCanceled) return;

                    const newVal = input.value.trim();
                    if (!newVal) {
                        alert('任务名称不能为空！');
                        renderCellDisplay(this, taskId, originalName, currentVal);
                        return;
                    }

                    if (newVal !== originalName) {
                        // 存入暂存池
                        pendingNameChanges.set(String(taskId), {
                            id: taskId,
                            originalName: originalName,
                            newName: newVal
                        });
                    } else {
                        // 改回原名，移除暂存
                        pendingNameChanges.delete(String(taskId));
                    }

                    renderCellDisplay(this, taskId, originalName, newVal);
                    updateInlineEditBar();
                });
            });
        });
    }

    function renderCellDisplay(cell, taskId, originalName, displayName) {
        const isModified = pendingNameChanges.has(String(taskId));
        const val = isModified ? pendingNameChanges.get(String(taskId)).newName : displayName;

        if (isModified) {
            cell.classList.add('cell-modified');
        } else {
            cell.classList.remove('cell-modified');
        }

        cell.innerHTML = `
            <div class="name-display-box">
                <span class="task-name-text">${escapeHtml(val)}</span>
                ${isModified ? '<span class="cell-modified-badge">已改</span>' : '<span class="edit-hint-icon" title="点击编辑">✏️</span>'}
            </div>
        `;
    }

    // 撤销所有行内修改
    if (btnCancelInlineEdit) {
        btnCancelInlineEdit.onclick = () => {
            if (pendingNameChanges.size === 0) return;
            if (!confirm(`确定撤销所有已修改的 ${pendingNameChanges.size} 个任务名称吗？`)) return;
            pendingNameChanges.clear();
            updateInlineEditBar();
            renderQueryTable(currentQueryTasks);
        };
    }

    // 统一提交所有行内修改
    if (btnSubmitInlineEdit) {
        btnSubmitInlineEdit.onclick = async () => {
            if (pendingNameChanges.size === 0) {
                alert('当前没有待保存的修改！');
                return;
            }

            const changeList = Array.from(pendingNameChanges.values());
            const inlineSyncDescCheckbox = document.getElementById('inlineSyncDescCheckbox');
            const syncDesc = inlineSyncDescCheckbox ? inlineSyncDescCheckbox.checked : false;

            let confirmTip = `即将统一提交 ${changeList.length} 个任务的新名称到禅道`;
            if (syncDesc) confirmTip += `\n（已勾选：同步将任务描述修改为与新名称一致）`;
            confirmTip += `，确认提交保存吗？`;

            if (!confirm(confirmTip)) {
                return;
            }

            showProgressLoading('✏️ 批量提交重命名', 0, changeList.length, `准备提交 ${changeList.length} 个任务的名称修改...`);

            try {
                const res = await fetch(apiUrl('/api/tasks/batch-rename'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tasks: changeList.map(item => ({ id: item.id, name: item.newName })),
                        sync_desc: syncDesc,
                        stream: true
                    })
                });

                let finalDone = null;
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('ndjson')) {
                    finalDone = await readNdJsonStream(res, (evt) => {
                        if (evt.type === 'start') {
                            updateProgress(0, evt.total, `准备重命名 ${evt.total} 条任务...`);
                        } else if (evt.type === 'progress') {
                            const taskDesc = evt.task ? `#${evt.task.id} ${evt.task.name}` : '';
                            updateProgress(evt.current, evt.total, evt.message || `正在提交重命名...`, taskDesc);
                        }
                    });
                } else {
                    finalDone = await res.json();
                }
                hideLoading();
                const resJson = finalDone || {};

                if (resJson.success) {
                    const data = resJson.data;
                    pendingNameChanges.clear();
                    updateInlineEditBar();

                    showBatchResultModal('行内自定义修改提交结果', data, '已成功批量提交保存任务自定义名称！');

                    // 重新执行查询以刷新最新列表
                    btnSearch.click();
                } else {
                    alert('提交保存失败: ' + resJson.message);
                }
            } catch (e) {
                hideLoading();
                alert('网络请求异常: ' + e);
            }
        };
    }

    // 全选当前表格
    checkAllRows.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.checked = checked;
            const id = cb.getAttribute('data-id');
            if (checked) selectedTaskIds.add(id);
            else selectedTaskIds.delete(id);
        });
        updateSelectedCount();
    });

    btnSelectAll.onclick = () => {
        currentQueryTasks.forEach(t => selectedTaskIds.add(String(t.id)));
        document.querySelectorAll('.task-checkbox').forEach(cb => cb.checked = true);
        checkAllRows.checked = true;
        updateSelectedCount();
    };

    btnDeselectAll.onclick = () => {
        selectedTaskIds.clear();
        document.querySelectorAll('.task-checkbox').forEach(cb => cb.checked = false);
        checkAllRows.checked = false;
        updateSelectedCount();
    };

    function updateSelectedCount() {
        selectedCount.textContent = selectedTaskIds.size;
    }

    // 通用渲染批量修改结果弹窗 (展示实际有修改条数 + 未修改任务名称列表)
    function showBatchResultModal(title, data, customDesc) {
        const modifiedCount = data.modified_count !== undefined ? data.modified_count : (data.success ? data.success.length : 0);
        const unmodifiedCount = data.unmodified_count !== undefined ? data.unmodified_count : (data.failed ? data.failed.length : 0);
        const unmodifiedList = data.unmodified || [];

        let unmodifiedSection = '';
        if (unmodifiedCount > 0 && unmodifiedList.length > 0) {
            const listItemsHtml = unmodifiedList.map(item => `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:6px 0; border-bottom:1px dashed #e2e8f0;">
                    <div style="font-weight:500; word-break:break-all;" title="#${item.id} ${escapeHtml(item.name)}">
                        <span style="color:#64748b; font-size:12px; margin-right:4px;">#${item.id}</span>${escapeHtml(item.name)}
                    </div>
                    <span style="color:#b45309; font-size:11px; flex-shrink:0; background:#fef3c7; padding:2px 8px; border-radius:12px; white-space:nowrap;">
                        ${escapeHtml(item.reason || '未做修改')}
                    </span>
                </div>
            `).join('');

            unmodifiedSection = `
                <div style="margin-top:16px; border-top:1px solid #e2e8f0; padding-top:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-weight:600; color:#334155; font-size:13px;">未修改任务名称列表 (${unmodifiedCount} 个)：</span>
                        <button type="button" class="btn btn-secondary btn-sm" id="btnCopyUnmodified" style="padding:2px 8px; font-size:11px;">📋 复制未修改列表</button>
                    </div>
                    <div style="max-height:190px; overflow-y:auto; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:4px 10px; font-size:12px; color:#334155;">
                        ${listItemsHtml}
                    </div>
                </div>
            `;
        }

        let statusNoticeHtml = '';
        if (customDesc) {
            if (modifiedCount > 0 && unmodifiedCount === 0) {
                statusNoticeHtml = `
                    <div style="margin-top:12px; padding:9px 12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; color:#15803d; font-size:13px; display:flex; align-items:center; gap:8px;">
                        <span>✅</span>
                        <div>已成功将所选 <b>${modifiedCount}</b> 个任务的 ${customDesc}。</div>
                    </div>
                `;
            } else if (modifiedCount > 0 && unmodifiedCount > 0) {
                statusNoticeHtml = `
                    <div style="margin-top:12px; padding:9px 12px; background:#fffbeb; border:1px solid #fef3c7; border-radius:6px; color:#b45309; font-size:13px; display:flex; align-items:center; gap:8px;">
                        <span>⚠️</span>
                        <div>已成功修改 <b>${modifiedCount}</b> 个任务，另有 <b>${unmodifiedCount}</b> 个任务未修改（详见下方）。</div>
                    </div>
                `;
            } else {
                statusNoticeHtml = `
                    <div style="margin-top:12px; padding:9px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; color:#b91c1c; font-size:13px; display:flex; align-items:center; gap:8px;">
                        <span>❌</span>
                        <div>所选 <b>${unmodifiedCount}</b> 个任务未能执行修改（操作未生效或被拒绝），具体原因见下方列表。</div>
                    </div>
                `;
            }
        }

        const modalHtml = `
            <div class="summary-stat-grid" style="grid-template-columns: 1fr 1fr;">
                <div class="stat-box success">
                    <span class="stat-num">${modifiedCount}</span>
                    <span class="stat-label">实际有修改 (条)</span>
                </div>
                <div class="stat-box ${unmodifiedCount > 0 ? 'warning' : 'success'}">
                    <span class="stat-num">${unmodifiedCount}</span>
                    <span class="stat-label">未修改任务 (条)</span>
                </div>
            </div>
            ${statusNoticeHtml}
            ${unmodifiedSection}
        `;

        showModal(title, modalHtml);

        const btnCopy = document.getElementById('btnCopyUnmodified');
        if (btnCopy && data.unmodified_names && data.unmodified_names.length > 0) {
            btnCopy.onclick = () => {
                const textToCopy = data.unmodified_names.join('\n');
                navigator.clipboard.writeText(textToCopy).then(() => {
                    btnCopy.textContent = '✅ 已复制任务名称';
                    setTimeout(() => { btnCopy.textContent = '📋 复制未修改列表'; }, 2000);
                }).catch(() => {
                    alert('复制失败，请手动选择复制');
                });
            };
        }
    }

    // 7. 模块二核心操作：一键批量修改
    btnExecuteBatchUpdate.onclick = async () => {
        if (selectedTaskIds.size === 0) {
            alert('请先在下方表格中勾选需要修改的任务！');
            return;
        }

        const field = batchFieldSelect.value;
        const valElem = document.getElementById('fieldValueInput');
        const customInp = document.getElementById('customValueInput');
        const nameModeElem = document.getElementById('nameModeSelect');
        const replaceFromElem = document.getElementById('replaceFromInput');

        let targetValue = valElem ? valElem.value : '';
        let targetRealname = '';
        if (field === 'assignedTo' && targetValue === '__custom__') {
            const customUserHidden = document.getElementById('customUserHidden');
            const customUserInput = document.getElementById('customUserInput');
            targetValue = customUserHidden ? customUserHidden.value.trim() : '';
            if (!targetValue && customUserInput) {
                targetValue = customUserInput.value.trim();
            }
            if (!targetValue) {
                alert('请在下拉列表中搜索并选择要指派的目标用户，或输入账号！');
                return;
            }
            const foundUser = cachedUsers.find(u => u.account.toLowerCase() === targetValue.toLowerCase());
            if (foundUser) {
                targetRealname = foundUser.realname;
            }
        }

        const nameMode = nameModeElem ? nameModeElem.value : 'direct';
        const replaceFrom = replaceFromElem ? replaceFromElem.value.trim() : '';

        if (field === 'name' && !targetValue && nameMode !== 'replace') {
            alert('请输入新的任务名称或前后缀！');
            return;
        }

        const syncDescCheckbox = document.getElementById('syncDescCheckbox');
        const syncDesc = (field === 'name' && syncDescCheckbox) ? syncDescCheckbox.checked : false;

        const batchUpdateComment = document.getElementById('batchUpdateComment');
        const updateCommentText = batchUpdateComment ? batchUpdateComment.value.trim() : '';

        const fieldText = batchFieldSelect.options[batchFieldSelect.selectedIndex].text;
        let displayTarget = targetValue;
        if (field === 'assignedTo' && targetRealname) {
            displayTarget = `${targetRealname} (${targetValue})`;
        }
        let confirmMsg = `确定将已勾选的 ${selectedTaskIds.size} 个任务的「${fieldText}」统一批量修改为「${displayTarget}」吗？\n` +
            `• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
        if (field === 'name') {
            if (nameMode === 'prefix') confirmMsg = `确定为已勾选的 ${selectedTaskIds.size} 个任务名称统一添加前缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            else if (nameMode === 'suffix') confirmMsg = `确定为已勾选的 ${selectedTaskIds.size} 个任务名称统一添加后缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            else if (nameMode === 'replace') confirmMsg = `确定将已勾选的 ${selectedTaskIds.size} 个任务名称中的「${replaceFrom}」批量替换为「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            if (syncDesc) {
                confirmMsg += `\n（已勾选：同步将任务描述修改为与新名称一致）`;
            }
        }

        if (!confirm(confirmMsg)) return;

        showProgressLoading('🛠️ 批量修改任务字段', 0, selectedTaskIds.size, `准备批量更新 ${selectedTaskIds.size} 个任务...`);

        try {
            const res = await fetch(apiUrl('/api/tasks/batch-update'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_ids: Array.from(selectedTaskIds),
                    field: field,
                    value: targetValue,
                    name_mode: nameMode,
                    replace_from: replaceFrom,
                    sync_desc: syncDesc,
                    comment: updateCommentText,
                    stream: true
                })
            });

            let finalDone = null;
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('ndjson')) {
                finalDone = await readNdJsonStream(res, (evt) => {
                    if (evt.type === 'start') {
                        updateProgress(0, evt.total, `准备修改 ${evt.total} 条任务...`);
                    } else if (evt.type === 'progress') {
                        const taskDesc = evt.task ? `#${evt.task.id} ${evt.task.name}` : '';
                        updateProgress(evt.current, evt.total, evt.message || `正在修改任务...`, taskDesc);
                    }
                });
            } else {
                finalDone = await res.json();
            }
            hideLoading();
            const resJson = finalDone || {};

            if (resJson.success) {
                const data = resJson.data;
                const desc = `<b>${fieldText}</b> 更新为 <b>${escapeHtml(displayTarget)}</b>`;
                showBatchResultModal('批量修改执行结果', data, desc);

                // 重新检索以刷新视图
                btnSearch.click();
            } else {
                alert('修改异常: ' + resJson.message);
            }
        } catch (e) {
            hideLoading();
            alert('网络请求异常: ' + e);
        }
    };

    // 辅助转义
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ==================== 模块 3：个人工作周报交互逻辑 ====================
    const btnGenerateWeeklyReport = document.getElementById('btnGenerateWeeklyReport');
    const btnGenerateWeeklyReportEmpty = document.getElementById('btnGenerateWeeklyReportEmpty');
    const btnExportWeeklyReport = document.getElementById('btnExportWeeklyReport');
    const btnExportWeeklyReport2 = document.getElementById('btnExportWeeklyReport2');
    const btnExportWeeklyReportBottom = document.getElementById('btnExportWeeklyReportBottom');
    const btnAddSummaryItem = document.getElementById('btnAddSummaryItem');
    const btnAddPlanItem = document.getElementById('btnAddPlanItem');

    const reportStartDate = document.getElementById('reportStartDate');
    const reportEndDate = document.getElementById('reportEndDate');
    const reportReporterInput = document.getElementById('reportReporterInput');
    const reportDeptInput = document.getElementById('reportDeptInput');
    const reportTitleInput = document.getElementById('reportTitleInput');
    const btnPrevWeek = document.getElementById('btnPrevWeek');
    const btnThisWeek = document.getElementById('btnThisWeek');

    const reportEmptyPlaceholder = document.getElementById('reportEmptyPlaceholder');
    const reportPreviewContainer = document.getElementById('reportPreviewContainer');
    const excelReportTable = document.getElementById('excelReportTable');

    let currentWeeklyReportData = null;

    function formatDateYMD(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function initWeeklyDateRange() {
        const now = new Date();
        const day = now.getDay();
        const diffToMonday = (day === 0 ? -6 : 1) - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diffToMonday);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        if (reportStartDate) reportStartDate.value = formatDateYMD(monday);
        if (reportEndDate) reportEndDate.value = formatDateYMD(sunday);
    }
    initWeeklyDateRange();

    if (btnPrevWeek) {
        btnPrevWeek.onclick = () => {
            const startVal = reportStartDate.value;
            if (!startVal) return;
            const currentMonday = new Date(startVal + 'T00:00:00');
            currentMonday.setDate(currentMonday.getDate() - 7);
            const currentSunday = new Date(currentMonday);
            currentSunday.setDate(currentMonday.getDate() + 6);

            reportStartDate.value = formatDateYMD(currentMonday);
            reportEndDate.value = formatDateYMD(currentSunday);
        };
    }

    if (btnThisWeek) {
        btnThisWeek.onclick = () => {
            initWeeklyDateRange();
        };
    }

    // 自动抓取生成本周周报
    async function doGenerateWeeklyReport() {
        if (!statusDot.className.includes('online')) {
            alert('请先登录禅道账号后再生成周报！');
            openLoginModal(false);
            return;
        }

        const startDate = reportStartDate ? reportStartDate.value : '';
        const endDate = reportEndDate ? reportEndDate.value : '';
        const reporter = reportReporterInput ? reportReporterInput.value.trim() : '';
        const department = reportDeptInput ? reportDeptInput.value.trim() : '应用组';

        showLoading('正在提取您本周在禅道完成的任务，生成周报中...');

        try {
            const res = await fetch(apiUrl('/api/weekly-report/generate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_date: startDate,
                    end_date: endDate,
                    reporter: reporter,
                    department: department
                })
            });
            const resJson = await res.json();
            hideLoading();

            if (resJson.success) {
                currentWeeklyReportData = resJson.data;
                if (reportReporterInput && currentWeeklyReportData.reporter) {
                    reportReporterInput.value = currentWeeklyReportData.reporter;
                }
                renderWeeklyReportTable(currentWeeklyReportData);

                if (reportEmptyPlaceholder) reportEmptyPlaceholder.style.display = 'none';
                if (reportPreviewContainer) reportPreviewContainer.style.display = 'block';
                if (btnExportWeeklyReport) btnExportWeeklyReport.style.display = 'inline-flex';
            } else {
                alert('生成周报失败: ' + resJson.message);
            }
        } catch (e) {
            hideLoading();
            alert('网络请求异常: ' + e);
        }
    }

    if (btnGenerateWeeklyReport) btnGenerateWeeklyReport.onclick = doGenerateWeeklyReport;
    if (btnGenerateWeeklyReportEmpty) btnGenerateWeeklyReportEmpty.onclick = doGenerateWeeklyReport;

    // 渲染 Excel 拟真周报预览表格
    function renderWeeklyReportTable(data) {
        if (!data || !excelReportTable) return;

        const title = reportTitleInput ? reportTitleInput.value.trim() : (data.title || '应用组工作周报');
        const reporter = data.reporter || (reportReporterInput ? reportReporterInput.value.trim() : '');
        const dept = data.department || (reportDeptInput ? reportDeptInput.value.trim() : '应用组');
        const reportDate = data.report_date || formatDateYMD(new Date());

        const summaryItems = data.summary_items || [];
        const planItems = data.plan_items || [];
        const risks = data.risks_and_issues || '';
        const suggestions = data.suggestions || '';

        function formatTaskMultiline(tasks) {
            if (typeof tasks === 'string') {
                tasks = tasks.split('\n').map(t => t.trim()).filter(Boolean);
            }
            if (!Array.isArray(tasks)) return '';
            return tasks.map((t, idx) => {
                const s = String(t).trim();
                const clean = s.replace(/^(\d+[\.、\s]\s*)+/, '').trim();
                return `${idx + 1}. ${clean || s}`;
            }).join('\n');
        }

        let html = '';

        // 严格根据模板定义列宽比例 (Col A:15.18, B:19.73, C:50.73, D:27.73, E:29.46)
        html += `
            <colgroup>
                <col style="width: 10.63%;">
                <col style="width: 13.81%;">
                <col style="width: 35.52%;">
                <col style="width: 19.41%;">
                <col style="width: 20.63%;">
            </colgroup>
        `;

        // Row 1: 大标题 (A1:E1，高度 35，背景 #91ACE0，黑体 14pt 加粗，居中)
        html += `
            <tr>
                <td colspan="5" class="excel-header-title">
                    <input type="text" class="excel-input" id="sheetTitleInput" value="${escapeHtml(title)}" style="text-align: center; font-family: '黑体', SimHei, sans-serif; font-size: 14pt; font-weight: bold; width: 100%;">
                </td>
            </tr>
        `;

        // Row 2: 汇报人与时间 (高度 30，黑体 12pt 加粗)
        html += `
            <tr class="excel-header-sub">
                <td style="text-align: center; font-weight: bold;">汇报人</td>
                <td style="text-align: center;">
                    <input type="text" class="excel-input" id="sheetReporterInput" value="${escapeHtml(reporter)}" style="text-align: center; font-weight: bold; font-size: 12pt;">
                </td>
                <td style="text-align: center;">
                    <input type="text" class="excel-input" id="sheetDeptInput" value="${escapeHtml(dept)}" style="text-align: center; font-weight: bold; font-size: 12pt;">
                </td>
                <td colspan="2" style="text-align: left; padding-left: 14px; font-weight: bold;">
                    <span>汇报时间：</span>
                    <input type="date" class="excel-input" id="sheetDateInput" value="${escapeHtml(reportDate)}" style="width: 140px; display: inline-block; font-weight: bold; font-size: 12pt; text-align: left;">
                </td>
            </tr>
        `;

        // Row 3: 表头行 (背景 #91ACE0，黑体 11pt 加粗，全部居中)
        html += `
            <tr class="excel-th">
                <td>类别</td>
                <td>项目名称</td>
                <td>重点任务</td>
                <td>进度与风险</td>
                <td>技术要点</td>
            </tr>
        `;

        // 本周工作总结行
        const summaryCount = Math.max(summaryItems.length, 1);
        summaryItems.forEach((item, idx) => {
            const taskStr = formatTaskMultiline(item.tasks);
            const progRisk = item.progress_risk || '进度：100%\n风险：\n';
            const techNotes = item.tech_notes || '';

            html += `
                <tr class="summary-item-row" data-type="summary">
                    ${idx === 0 ? `<td rowspan="${summaryCount}" class="excel-category-cell" id="summaryCategoryCell">本周工作总结</td>` : ''}
                    <td class="excel-project-cell">
                        <textarea class="excel-textarea summary-project-name" placeholder="项目名称" style="min-height: 48px; text-align: center;">${escapeHtml(item.project_name || '')}</textarea>
                        ${summaryItems.length > 1 ? `<button type="button" class="item-delete-btn" title="删除该项目" onclick="removeReportItem('summary', ${idx})">&times;</button>` : ''}
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea summary-tasks" placeholder="重点任务清单 (换行带序号)" style="min-height: 70px;">${escapeHtml(taskStr)}</textarea>
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea summary-progress" placeholder="进度与风险" style="min-height: 70px;">${escapeHtml(progRisk)}</textarea>
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea summary-tech" placeholder="技术要点 (可选)" style="min-height: 70px;">${escapeHtml(techNotes)}</textarea>
                    </td>
                </tr>
            `;
        });

        // 下周计划行
        const planCount = Math.max(planItems.length, 1);
        planItems.forEach((item, idx) => {
            const taskStr = formatTaskMultiline(item.tasks);
            const progRisk = item.progress_risk || '进度：进行中';
            const techNotes = item.tech_notes || '';

            html += `
                <tr class="plan-item-row" data-type="plan">
                    ${idx === 0 ? `<td rowspan="${planCount}" class="excel-category-cell" id="planCategoryCell">下周计划</td>` : ''}
                    <td class="excel-project-cell">
                        <textarea class="excel-textarea plan-project-name" placeholder="项目名称" style="min-height: 48px; text-align: center;">${escapeHtml(item.project_name || '')}</textarea>
                        ${planItems.length > 1 ? `<button type="button" class="item-delete-btn" title="删除该项目" onclick="removeReportItem('plan', ${idx})">&times;</button>` : ''}
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea plan-tasks" placeholder="下周计划任务 (换行带序号)" style="min-height: 60px;">${escapeHtml(taskStr)}</textarea>
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea plan-progress" placeholder="计划进度" style="min-height: 60px;">${escapeHtml(progRisk)}</textarea>
                    </td>
                    <td class="excel-content-left">
                        <textarea class="excel-textarea plan-tech" placeholder="技术要点 (可选)" style="min-height: 60px;">${escapeHtml(techNotes)}</textarea>
                    </td>
                </tr>
            `;
        });

        // 风险与问题行 (A列居中加粗，B:E合并靠左靠上)
        html += `
            <tr>
                <td class="excel-category-cell">风险与问题</td>
                <td colspan="4" class="excel-content-top">
                    <textarea class="excel-textarea" id="sheetRisksInput" placeholder="填写风险与阻碍问题..." style="min-height: 60px;">${escapeHtml(risks)}</textarea>
                </td>
            </tr>
        `;

        // 优化与建议行 (A列居中加粗，B:E合并靠左靠上)
        html += `
            <tr>
                <td class="excel-category-cell">优化与建议</td>
                <td colspan="4" class="excel-content-top">
                    <textarea class="excel-textarea" id="sheetSuggestionsInput" placeholder="填写工作优化建议..." style="min-height: 50px;">${escapeHtml(suggestions)}</textarea>
                </td>
            </tr>
        `;

        excelReportTable.innerHTML = html;
    }

    // 收集当前预览表格中编辑后的所有最新数据
    function collectCurrentWeeklyReportData() {
        const title = document.getElementById('sheetTitleInput') ? document.getElementById('sheetTitleInput').value.trim() : '应用组工作周报';
        const reporter = document.getElementById('sheetReporterInput') ? document.getElementById('sheetReporterInput').value.trim() : (reportReporterInput ? reportReporterInput.value.trim() : '');
        const department = document.getElementById('sheetDeptInput') ? document.getElementById('sheetDeptInput').value.trim() : '应用组';
        const reportDate = document.getElementById('sheetDateInput') ? document.getElementById('sheetDateInput').value.trim() : formatDateYMD(new Date());

        const summaryRows = document.querySelectorAll('.summary-item-row');
        const summaryItems = [];
        summaryRows.forEach(row => {
            const pname = row.querySelector('.summary-project-name') ? row.querySelector('.summary-project-name').value.trim() : '';
            const tasksRaw = row.querySelector('.summary-tasks') ? row.querySelector('.summary-tasks').value.trim() : '';
            const progress = row.querySelector('.summary-progress') ? row.querySelector('.summary-progress').value.trim() : '';
            const tech = row.querySelector('.summary-tech') ? row.querySelector('.summary-tech').value.trim() : '';
            if (pname || tasksRaw) {
                const taskList = tasksRaw.split('\n')
                    .map(t => t.trim())
                    .filter(Boolean)
                    .map((t, idx) => {
                        const clean = t.replace(/^(\d+[\.、\s]\s*)+/, '').trim();
                        return `${idx + 1}. ${clean || t}`;
                    });
                summaryItems.push({
                    project_name: pname,
                    tasks: taskList,
                    progress_risk: progress,
                    tech_notes: tech
                });
            }
        });

        const planRows = document.querySelectorAll('.plan-item-row');
        const planItems = [];
        planRows.forEach(row => {
            const pname = row.querySelector('.plan-project-name') ? row.querySelector('.plan-project-name').value.trim() : '';
            const tasksRaw = row.querySelector('.plan-tasks') ? row.querySelector('.plan-tasks').value.trim() : '';
            const progress = row.querySelector('.plan-progress') ? row.querySelector('.plan-progress').value.trim() : '';
            const tech = row.querySelector('.plan-tech') ? row.querySelector('.plan-tech').value.trim() : '';
            if (pname || tasksRaw) {
                const taskList = tasksRaw.split('\n')
                    .map(t => t.trim())
                    .filter(Boolean)
                    .map((t, idx) => {
                        const clean = t.replace(/^(\d+[\.、\s]\s*)+/, '').trim();
                        return `${idx + 1}. ${clean || t}`;
                    });
                planItems.push({
                    project_name: pname,
                    tasks: taskList,
                    progress_risk: progress,
                    tech_notes: tech
                });
            }
        });

        const risks = document.getElementById('sheetRisksInput') ? document.getElementById('sheetRisksInput').value.trim() : '';
        const suggestions = document.getElementById('sheetSuggestionsInput') ? document.getElementById('sheetSuggestionsInput').value.trim() : '';

        return {
            title,
            reporter,
            department,
            report_date: reportDate,
            summary_items: summaryItems,
            plan_items: planItems,
            risks_and_issues: risks,
            suggestions: suggestions
        };
    }

    // 导出周报 Excel 文件并触发浏览器下载
    async function doExportWeeklyReport() {
        const payload = collectCurrentWeeklyReportData();
        if (!payload.summary_items || payload.summary_items.length === 0) {
            alert('周报内容为空，无法导出！');
            return;
        }

        showLoading('正在根据模板格式生成 Excel 周报文件，请稍候...');

        try {
            const res = await fetch(apiUrl('/api/weekly-report/export'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                hideLoading();
                alert('导出周报失败: ' + (errJson.message || res.statusText));
                return;
            }

            const blob = await res.blob();
            hideLoading();

            const reporter = payload.reporter || '周报';
            const dateStr = (payload.report_date || '').replace(/-/g, '');
            const filename = `应用组工作周报_${reporter}_${dateStr}.xlsx`;

            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (e) {
            hideLoading();
            alert('网络异常，导出失败: ' + e);
        }
    }

    if (btnExportWeeklyReport) btnExportWeeklyReport.onclick = doExportWeeklyReport;
    if (btnExportWeeklyReport2) btnExportWeeklyReport2.onclick = doExportWeeklyReport;
    if (btnExportWeeklyReportBottom) btnExportWeeklyReportBottom.onclick = doExportWeeklyReport;

    // 动态添加/删除总结与计划项目
    window.removeReportItem = function(type, index) {
        if (!currentWeeklyReportData) return;
        const current = collectCurrentWeeklyReportData();
        if (type === 'summary') {
            current.summary_items.splice(index, 1);
        } else if (type === 'plan') {
            current.plan_items.splice(index, 1);
        }
        currentWeeklyReportData = current;
        renderWeeklyReportTable(currentWeeklyReportData);
    };

    if (btnAddSummaryItem) {
        btnAddSummaryItem.onclick = () => {
            const current = collectCurrentWeeklyReportData();
            current.summary_items.push({
                project_name: '',
                tasks: ['1.新任务项'],
                progress_risk: '进度：100%\n风险：\n',
                tech_notes: ''
            });
            currentWeeklyReportData = current;
            renderWeeklyReportTable(currentWeeklyReportData);
        };
    }

    if (btnAddPlanItem) {
        btnAddPlanItem.onclick = () => {
            const current = collectCurrentWeeklyReportData();
            current.plan_items.push({
                project_name: '',
                tasks: ['1.下周计划项'],
                progress_risk: '进度：进行中',
                tech_notes: ''
            });
            currentWeeklyReportData = current;
            renderWeeklyReportTable(currentWeeklyReportData);
        };
    }

    // ==================== 模块 4：AI Agent 桌宠与智能对话逻辑 ====================
    const aiPetContainer = document.getElementById('aiPetContainer');
    const petAvatarBtn = document.getElementById('petAvatarBtn');
    const petSpeechBubble = document.getElementById('petSpeechBubble');
    const petBubbleText = document.getElementById('petBubbleText');
    const btnPetBubbleClose = document.getElementById('btnPetBubbleClose');
    const aiChatPanel = document.getElementById('aiChatPanel');
    const btnAiClose = document.getElementById('btnAiClose');
    const btnAiSettings = document.getElementById('btnAiSettings');
    const btnAiClear = document.getElementById('btnAiClear');
    const aiSettingsDrawer = document.getElementById('aiSettingsDrawer');
    const btnDrawerClose = document.getElementById('btnDrawerClose');
    const inputDeepSeekKey = document.getElementById('inputDeepSeekKey');
    const btnToggleAiKey = document.getElementById('btnToggleAiKey');
    const selectDeepSeekModel = document.getElementById('selectDeepSeekModel');
    const btnTestAiKey = document.getElementById('btnTestAiKey');
    const btnSaveAiKey = document.getElementById('btnSaveAiKey');
    const aiKeyTestFeedback = document.getElementById('aiKeyTestFeedback');
    const chatMessagesContainer = document.getElementById('chatMessagesContainer');
    const aiChatInput = document.getElementById('aiChatInput');
    const btnSendAi = document.getElementById('btnSendAi');
    const chatModelBadge = document.getElementById('chatModelBadge');
    const chatAccountBadge = document.getElementById('chatAccountBadge');

    // 多会话与历史管理 DOM 元素
    const btnToggleAiHistory = document.getElementById('btnToggleAiHistory');
    const aiHistoryCountBadge = document.getElementById('aiHistoryCountBadge');
    const chatSessionTitle = document.getElementById('chatSessionTitle');
    const btnRenameSession = document.getElementById('btnRenameSession');
    const btnAiNewChat = document.getElementById('btnAiNewChat');
    const btnCopyEntireChat = document.getElementById('btnCopyEntireChat');
    const aiHistoryDrawer = document.getElementById('aiHistoryDrawer');
    const btnHistoryDrawerClose = document.getElementById('btnHistoryDrawerClose');
    const btnDrawerNewChat = document.getElementById('btnDrawerNewChat');
    const aiSessionList = document.getElementById('aiSessionList');
    const historyTotalCount = document.getElementById('historyTotalCount');
    const btnClearAllHistory = document.getElementById('btnClearAllHistory');

    // 本地存储 key
    const STORAGE_KEY_DEEPSEEK = 'zentao_deepseek_api_key';
    const STORAGE_KEY_MODEL = 'zentao_deepseek_model';

    // 基于当前登录账号动态隔离存储 key
    function getSessionsStorageKey(account = currentAccount) {
        const acc = (account || '').trim().toLowerCase();
        if (!acc) return 'zentao_ai_chat_sessions_guest';
        return `zentao_ai_chat_sessions_user_${acc}`;
    }

    function getActiveSessionStorageKey(account = currentAccount) {
        const acc = (account || '').trim().toLowerCase();
        if (!acc) return 'zentao_ai_active_id_guest';
        return `zentao_ai_active_id_user_${acc}`;
    }

    let isAiGenerating = false;
    let aiSessions = [];
    let activeSessionId = null;

    // 1. 初始化读取配置
    function initAiConfig() {
        const savedKey = localStorage.getItem(STORAGE_KEY_DEEPSEEK) || '';
        const savedModel = localStorage.getItem(STORAGE_KEY_MODEL) || 'deepseek-chat';
        if (inputDeepSeekKey) inputDeepSeekKey.value = savedKey;
        if (selectDeepSeekModel) selectDeepSeekModel.value = savedModel;
        if (chatModelBadge) {
            chatModelBadge.textContent = savedModel === 'deepseek-reasoner' ? 'DeepSeek-R1 推理' : 'DeepSeek-V3 驱动';
        }
    }
    initAiConfig();

    // 明文/密文切换
    if (btnToggleAiKey && inputDeepSeekKey) {
        btnToggleAiKey.onclick = () => {
            if (inputDeepSeekKey.type === 'password') {
                inputDeepSeekKey.type = 'text';
                btnToggleAiKey.textContent = '🔒';
            } else {
                inputDeepSeekKey.type = 'password';
                btnToggleAiKey.textContent = '👁️';
            }
        };
    }

    // 2. 保存配置
    if (btnSaveAiKey) {
        btnSaveAiKey.onclick = () => {
            const key = inputDeepSeekKey.value.trim();
            const model = selectDeepSeekModel.value;
            localStorage.setItem(STORAGE_KEY_DEEPSEEK, key);
            localStorage.setItem(STORAGE_KEY_MODEL, model);
            if (chatModelBadge) {
                chatModelBadge.textContent = model === 'deepseek-reasoner' ? 'DeepSeek-R1 推理' : 'DeepSeek-V3 驱动';
            }
            if (aiKeyTestFeedback) {
                aiKeyTestFeedback.style.display = 'block';
                aiKeyTestFeedback.style.color = '#10b981';
                aiKeyTestFeedback.textContent = '✓ 配置已成功保存至本地浏览器！';
            }
            setTimeout(() => {
                if (aiSettingsDrawer) aiSettingsDrawer.style.display = 'none';
                if (aiKeyTestFeedback) aiKeyTestFeedback.style.display = 'none';
            }, 1200);
        };
    }

    // 3. 测试 API Key 连接
    if (btnTestAiKey) {
        btnTestAiKey.onclick = async () => {
            const key = inputDeepSeekKey.value.trim();
            if (!key) {
                alert('请先输入 DeepSeek API Key 再测试');
                return;
            }
            if (aiKeyTestFeedback) {
                aiKeyTestFeedback.style.display = 'block';
                aiKeyTestFeedback.style.color = '#64748b';
                aiKeyTestFeedback.textContent = '正在连接 DeepSeek 官方服务验证...';
            }
            btnTestAiKey.disabled = true;

            try {
                const res = await fetch(apiUrl('/api/ai/test-key'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: key })
                });
                const resJson = await res.json();
                btnTestAiKey.disabled = false;

                if (resJson.success) {
                    aiKeyTestFeedback.style.color = '#10b981';
                    aiKeyTestFeedback.textContent = '✓ ' + resJson.message;
                    localStorage.setItem(STORAGE_KEY_DEEPSEEK, key);
                } else {
                    aiKeyTestFeedback.style.color = '#ef4444';
                    aiKeyTestFeedback.textContent = '✗ ' + resJson.message;
                }
            } catch (e) {
                btnTestAiKey.disabled = false;
                aiKeyTestFeedback.style.color = '#ef4444';
                aiKeyTestFeedback.textContent = '✗ 网络请求异常: ' + e;
            }
        };
    }

    // 4. 气泡提示语自动轮播
    const petBubbleTips = [
        '嗨！我是小禅 AI 助手，点我可以查任务或写周报哦~',
        '需要一键批量完成名下待办任务吗？告诉我即可！⚡',
        '想查看当前禅道系统里有哪些项目吗？随时问我！📁',
        '本周工作做完了？我可以自动为您汇总生成标准周报！📊',
        '支持自然语言修改任务名称与描述，体验智能运维吧~'
    ];
    let bubbleTipIndex = 0;
    setInterval(() => {
        if (petSpeechBubble && petSpeechBubble.style.display !== 'none' && !aiChatPanel || aiChatPanel.style.display === 'none') {
            bubbleTipIndex = (bubbleTipIndex + 1) % petBubbleTips.length;
            if (petBubbleText) {
                petBubbleText.textContent = petBubbleTips[bubbleTipIndex];
            }
        }
    }, 18000);

    if (btnPetBubbleClose) {
        btnPetBubbleClose.onclick = (e) => {
            e.stopPropagation();
            if (petSpeechBubble) petSpeechBubble.style.display = 'none';
        };
    }

    // 5. 桌宠头像点击与拖拽支持
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialRight = 32;
    let initialBottom = 32;

    if (petAvatarBtn) {
        petAvatarBtn.addEventListener('mousedown', (e) => {
            isDragging = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - dragStartX;
                const dy = moveEvent.clientY - dragStartY;
                if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                    isDragging = true;
                    // 动态更新位置
                    const curBottom = Math.max(10, Math.min(window.innerHeight - 80, initialBottom - dy));
                    const curRight = Math.max(10, Math.min(window.innerWidth - 80, initialRight - dx));
                    if (aiPetContainer) {
                        aiPetContainer.style.bottom = curBottom + 'px';
                        aiPetContainer.style.right = curRight + 'px';
                    }
                    if (aiChatPanel) {
                        aiChatPanel.style.bottom = (curBottom + 76) + 'px';
                        aiChatPanel.style.right = curRight + 'px';
                    }
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                if (aiPetContainer) {
                    initialRight = parseInt(aiPetContainer.style.right || '32', 10);
                    initialBottom = parseInt(aiPetContainer.style.bottom || '32', 10);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        petAvatarBtn.addEventListener('click', () => {
            if (isDragging) return; // 拖动释放时不触发打开
            if (aiChatPanel) {
                const isOpen = aiChatPanel.style.display === 'flex';
                aiChatPanel.style.display = isOpen ? 'none' : 'flex';
                if (!isOpen) {
                    if (petSpeechBubble) petSpeechBubble.style.display = 'none';
                    if (aiSessions.length === 0) {
                        initAiSessions();
                    } else {
                        renderActiveSessionMessages();
                    }
                    if (aiChatInput) setTimeout(() => aiChatInput.focus(), 150);
                }
            }
        });
    }

    if (petSpeechBubble) {
        petSpeechBubble.addEventListener('click', () => {
            if (petAvatarBtn) petAvatarBtn.click();
        });
    }

    if (btnAiClose) {
        btnAiClose.onclick = () => {
            if (aiChatPanel) aiChatPanel.style.display = 'none';
            if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
        };
    }

    if (btnAiSettings) {
        btnAiSettings.onclick = () => {
            if (aiSettingsDrawer) {
                const isShow = aiSettingsDrawer.style.display === 'block';
                aiSettingsDrawer.style.display = isShow ? 'none' : 'block';
                if (!isShow && aiHistoryDrawer) {
                    aiHistoryDrawer.style.display = 'none';
                }
            }
        };
    }

    if (btnDrawerClose) {
        btnDrawerClose.onclick = () => {
            if (aiSettingsDrawer) aiSettingsDrawer.style.display = 'none';
        };
    }

    if (btnToggleAiHistory) {
        btnToggleAiHistory.onclick = () => {
            if (aiHistoryDrawer) {
                const isShow = aiHistoryDrawer.style.display === 'flex';
                aiHistoryDrawer.style.display = isShow ? 'none' : 'flex';
                if (!isShow) {
                    if (aiSettingsDrawer) aiSettingsDrawer.style.display = 'none';
                    renderSessionList();
                }
            }
        };
    }

    if (btnHistoryDrawerClose) {
        btnHistoryDrawerClose.onclick = () => {
            if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
        };
    }

    if (btnAiNewChat) {
        btnAiNewChat.onclick = createNewSession;
    }

    // 一键复制当前会话的全部记录
    if (btnCopyEntireChat) {
        btnCopyEntireChat.onclick = async () => {
            const session = getActiveSession();
            if (!session || !session.messages || session.messages.length === 0) {
                alert('当前暂无对话内容可复制');
                return;
            }
            let fullText = `# 🤖 小禅 AI 智能助手对话记录\n会话主题：${session.title || '新对话'}\n生成时间：${new Date().toLocaleString()}\n\n---\n\n`;
            session.messages.forEach(m => {
                const roleName = m.role === 'user' ? '👤 我' : '🤖 小禅 AI';
                fullText += `### ${roleName} (${m.time || ''})\n\n${m.content}\n\n`;
            });
            try {
                await navigator.clipboard.writeText(fullText);
                alert('✓ 已成功复制当前对话全部内容至剪贴板！可直接粘贴至 Word、Markdown 或微信。');
            } catch (err) {
                const ta = document.createElement('textarea');
                ta.value = fullText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                alert('✓ 已成功复制当前对话全部内容至剪贴板！可直接粘贴至 Word、Markdown 或微信。');
            }
        };
    }

    if (btnDrawerNewChat) {
        btnDrawerNewChat.onclick = createNewSession;
    }

    if (btnRenameSession) {
        btnRenameSession.onclick = () => promptRenameSession(activeSessionId);
    }

    if (chatSessionTitle) {
        chatSessionTitle.onclick = () => promptRenameSession(activeSessionId);
    }

    if (btnAiClear) {
        btnAiClear.onclick = clearCurrentSession;
    }

    if (btnClearAllHistory) {
        btnClearAllHistory.onclick = clearAllHistorySessions;
    }

    // 6. 快捷提问胶囊绑定
    document.querySelectorAll('.chat-quick-chips .chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.getAttribute('data-prompt');
            if (prompt && aiChatInput) {
                aiChatInput.value = prompt;
                handleSendAiMessage();
            }
        });
    });

    // 7. 渲染轻量级 Markdown (加粗、换行、标题、列表、代码、表格及文档下载卡片)
    function renderMarkdownToHtml(markdown) {
        if (!markdown) return '';
        let text = escapeHtml(markdown);

        // 粗体 **bold**
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 行内代码 `code`
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 代码块 ```...```
        text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

        // 表格处理
        const lines = text.split('\n');
        let inTable = false;
        let tableHtml = '';
        let resultLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && line.endsWith('|')) {
                // 表格行
                if (line.includes('---')) {
                    // 表头分隔线，忽略
                    continue;
                }
                const cells = line.slice(1, -1).split('|').map(c => c.trim());
                if (!inTable) {
                    inTable = true;
                    tableHtml = '<table><thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
                } else {
                    tableHtml += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
                }
            } else {
                if (inTable) {
                    inTable = false;
                    tableHtml += '</tbody></table>';
                    resultLines.push(tableHtml);
                    tableHtml = '';
                }
                resultLines.push(line);
            }
        }
        if (inTable) {
            tableHtml += '</tbody></table>';
            resultLines.push(tableHtml);
        }

        // 处理标题、无序/有序列表与普通段落
        let finalHtml = '';
        let inList = false;
        for (let l of resultLines) {
            if (l.startsWith('&lt;table') || l.startsWith('&lt;pre') || l.startsWith('<table') || l.startsWith('<pre')) {
                finalHtml += l;
                continue;
            }
            if (/^###\s+/.test(l)) {
                if (inList) { finalHtml += '</ul>'; inList = false; }
                finalHtml += `<h4 style="margin: 8px 0 4px; font-size: 13px; font-weight: 700; color: #1e293b;">${l.replace(/^###\s+/, '')}</h4>`;
            } else if (/^##\s+/.test(l)) {
                if (inList) { finalHtml += '</ul>'; inList = false; }
                finalHtml += `<h3 style="margin: 10px 0 5px; font-size: 14px; font-weight: 700; color: #1e40af;">${l.replace(/^##\s+/, '')}</h3>`;
            } else if (/^#\s+/.test(l)) {
                if (inList) { finalHtml += '</ul>'; inList = false; }
                finalHtml += `<h2 style="margin: 12px 0 6px; font-size: 15px; font-weight: 700; color: #1e3a8a;">${l.replace(/^#\s+/, '')}</h2>`;
            } else if (/^[-*]\s+/.test(l)) {
                if (!inList) {
                    finalHtml += '<ul>';
                    inList = true;
                }
                finalHtml += `<li>${l.replace(/^[-*]\s+/, '')}</li>`;
            } else if (/^\d+\.\s+/.test(l)) {
                if (!inList) {
                    finalHtml += '<ol>';
                    inList = true;
                }
                finalHtml += `<li>${l.replace(/^\d+\.\s+/, '')}</li>`;
            } else {
                if (inList) {
                    finalHtml += '</ul>';
                    inList = false;
                }
                if (l.trim()) {
                    finalHtml += `<p>${l}</p>`;
                }
            }
        }
        if (inList) finalHtml += '</ul>';

        // 识别 Markdown 链接语法 [label](url)
        finalHtml = finalHtml.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
            // 如果指向文档下载接口 /api/ai/download-doc/，自动升格为精美文档下载卡片
            if (href.includes('/api/ai/download-doc/')) {
                const isDocx = href.toLowerCase().endsWith('.docx');
                const icon = isDocx ? '📄' : '📝';
                const typeTag = isDocx ? 'Word 文档 (.docx)' : 'Markdown 文档 (.md)';
                const cleanLabel = label.replace(/^[📄📝⬇️\s]+/, '').replace(/^点击直接下载文档[：:]\s*/, '').trim() || '小禅AI生成文档';
                return `
                    <div class="ai-doc-card">
                        <div class="ai-doc-card-info">
                            <span class="ai-doc-card-icon">${icon}</span>
                            <div class="ai-doc-card-meta">
                                <div class="ai-doc-card-title">${escapeHtml(cleanLabel)}</div>
                                <div class="ai-doc-card-sub">
                                    <span class="ai-doc-card-tag">${typeTag}</span>
                                    <span>AI智能生成 · 直接下载</span>
                                </div>
                            </div>
                        </div>
                        <a href="${href}" class="ai-doc-download-btn" download target="_blank">⬇️ 立即下载</a>
                    </div>
                `;
            }
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${label}</a>`;
        });

        return finalHtml || text.replace(/\n/g, '<br>');
    }

    // 8. 欢迎语模板与多会话辅助工具
    function getAiWelcomeText() {
        const name = currentUserRealname || currentAccount;
        if (name) {
            return `您好，**${escapeHtml(name)}**！我是您的禅道桌面伴侣 **「小禅」** 🤖。\n\n我可以帮您通过 DeepSeek 模型与禅道系统实时协同：\n- 🔍 **查询名下待办任务与工时**\n- ⚡ **一键批量将待办切为进行中并点击完成**\n- 📝 **批量修改任务名称与描述**\n- 📊 **汇总并生成符合标准格式的工作周报**\n- 📄 **智能生成专业 Word/MD 文档并支持直接浏览器下载**\n- 📁 **检索禅道里的所有项目与详情**\n\n有什么我可以协助您的吗？您可以在下方直接提问，或点击预设胶囊快捷体验~`;
        }
        return `您好！我是您的禅道桌面伴侣 **「小禅」** 🤖。\n\n*（当前处于未登录状态，登录后可为您专属查询名下待办、一键批量报工与定制周报）*\n\n您可以点击右上角 **【🔑 登录禅道】** 完成登录。若已配置 DeepSeek API Key，您也可以在此咨询任何关于禅道操作的问题，或让我为您撰写并导出文档！`;
    }

    function getCurrentTimeStr() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatSessionTime(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (isToday) {
            return `今天 ${timeStr}`;
        }
        const isThisYear = d.getFullYear() === now.getFullYear();
        if (isThisYear) {
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${timeStr}`;
        }
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function createSessionObject(title = '新对话', initialMessages = null) {
        const now = Date.now();
        return {
            id: 'session_' + now + '_' + Math.random().toString(36).substr(2, 5),
            title: title || '新对话',
            createdAt: now,
            updatedAt: now,
            messages: initialMessages || [
                {
                    role: 'ai',
                    content: getAiWelcomeText(),
                    toolHistory: [],
                    time: getCurrentTimeStr()
                }
            ]
        };
    }

    // 初始化多会话与历史记录（严格按当前账号隔离读取）
    function initAiSessions() {
        const storageKeySessions = getSessionsStorageKey();
        const storageKeyActiveId = getActiveSessionStorageKey();
        aiSessions = [];
        activeSessionId = null;

        try {
            let raw = localStorage.getItem(storageKeySessions);

            // 兼容旧版全局迁移：如果当前登录账号且专属 key 尚无数据，但存在旧版全局数据，则迁移至当前账号并清理全局 key
            if (!raw && currentAccount) {
                const oldRaw = localStorage.getItem('zentao_ai_chat_sessions_v2');
                if (oldRaw) {
                    raw = oldRaw;
                    localStorage.setItem(storageKeySessions, oldRaw);
                    localStorage.removeItem('zentao_ai_chat_sessions_v2');
                    const oldActive = localStorage.getItem('zentao_ai_active_session_id');
                    if (oldActive) {
                        localStorage.setItem(storageKeyActiveId, oldActive);
                        localStorage.removeItem('zentao_ai_active_session_id');
                    }
                }
            }

            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    aiSessions = parsed;
                }
            }
        } catch (e) {
            console.error('读取对话历史记录失败:', e);
        }

        if (!aiSessions || aiSessions.length === 0) {
            aiSessions = [createSessionObject('新对话')];
        }

        const savedActiveId = localStorage.getItem(storageKeyActiveId);
        if (savedActiveId && aiSessions.some(s => s.id === savedActiveId)) {
            activeSessionId = savedActiveId;
        } else {
            activeSessionId = aiSessions[0].id;
        }

        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
    }

    function saveAiSessions() {
        const storageKeySessions = getSessionsStorageKey();
        const storageKeyActiveId = getActiveSessionStorageKey();
        try {
            localStorage.setItem(storageKeySessions, JSON.stringify(aiSessions));
            if (activeSessionId) {
                localStorage.setItem(storageKeyActiveId, activeSessionId);
            }
        } catch (e) {
            console.error('保存对话历史失败:', e);
        }
        updateSessionMetaBadges();
    }

    function updateSessionMetaBadges() {
        const count = aiSessions.length;
        if (aiHistoryCountBadge) aiHistoryCountBadge.textContent = count;
        if (historyTotalCount) historyTotalCount.textContent = count;
        const active = getActiveSession();
        if (chatSessionTitle) {
            chatSessionTitle.textContent = active ? active.title : '新对话';
        }
        if (chatAccountBadge) {
            if (currentAccount) {
                chatAccountBadge.textContent = `@${currentAccount} · `;
                chatAccountBadge.title = `当前绑定账号: ${currentUserRealname || currentAccount} (${currentAccount})`;
                chatAccountBadge.style.color = '#93c5fd';
            } else {
                chatAccountBadge.textContent = `(未登录) · `;
                chatAccountBadge.title = `未登录禅道账号，历史记录仅在本地访客空间临时隔离`;
                chatAccountBadge.style.color = '#fbbf24';
            }
        }
    }

    // 切换当前 AI 账号会话空间并无缝刷新
    function switchAiUserAccount(account, realname) {
        currentAccount = (account || '').trim();
        currentUserRealname = (realname || '').trim();
        initAiSessions();
    }

    function getActiveSession() {
        let session = aiSessions.find(s => s.id === activeSessionId);
        if (!session && aiSessions.length > 0) {
            session = aiSessions[0];
            activeSessionId = session.id;
        }
        return session;
    }

    function renderActiveSessionMessages() {
        if (!chatMessagesContainer) return;
        chatMessagesContainer.innerHTML = '';
        const session = getActiveSession();
        if (!session) return;

        if (chatSessionTitle) {
            chatSessionTitle.textContent = session.title || '新对话';
        }

        if (!session.messages || session.messages.length === 0) {
            session.messages = [
                {
                    role: 'ai',
                    content: getAiWelcomeText(),
                    toolHistory: [],
                    time: getCurrentTimeStr()
                }
            ];
            saveAiSessions();
        }

        session.messages.forEach(msg => {
            appendAiMessageToUI({
                role: msg.role === 'assistant' ? 'ai' : msg.role,
                content: msg.content,
                toolHistory: msg.toolHistory || [],
                time: msg.time
            });
        });

        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }

    function renderSessionList() {
        updateSessionMetaBadges();
        if (!aiSessionList) return;

        if (!aiSessions || aiSessions.length === 0) {
            aiSessionList.innerHTML = `<div style="text-align:center; padding:30px; color:#94a3b8; font-size:13px;">暂无历史对话记录</div>`;
            return;
        }

        let html = '';
        aiSessions.forEach(s => {
            const isActive = s.id === activeSessionId;
            const timeStr = formatSessionTime(s.updatedAt || s.createdAt);
            const msgCount = (s.messages || []).length;
            html += `
                <div class="history-session-item ${isActive ? 'is-active' : ''}" data-id="${s.id}">
                    <div class="session-icon">💬</div>
                    <div class="session-main">
                        <div class="session-title-text" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</div>
                        <div class="session-meta">
                            <span class="session-time">${timeStr}</span>
                            <span class="session-count">${msgCount} 条消息</span>
                        </div>
                    </div>
                    <div class="session-actions">
                        <button type="button" class="btn-session-action btn-session-rename" title="重命名对话" data-id="${s.id}">✏️</button>
                        <button type="button" class="btn-session-action btn-session-del" title="删除该对话" data-id="${s.id}">🗑️</button>
                    </div>
                </div>
            `;
        });
        aiSessionList.innerHTML = html;

        aiSessionList.querySelectorAll('.history-session-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.session-actions')) return;
                const sid = item.getAttribute('data-id');
                switchSession(sid);
            });
        });

        aiSessionList.querySelectorAll('.btn-session-rename').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sid = btn.getAttribute('data-id');
                promptRenameSession(sid);
            });
        });

        aiSessionList.querySelectorAll('.btn-session-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sid = btn.getAttribute('data-id');
                deleteSession(sid);
            });
        });
    }

    function switchSession(sid) {
        if (!sid || sid === activeSessionId) {
            if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
            return;
        }
        activeSessionId = sid;
        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
        if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
        if (aiChatInput) aiChatInput.focus();
    }

    function createNewSession() {
        const newSession = createSessionObject('新对话');
        aiSessions.unshift(newSession);
        activeSessionId = newSession.id;
        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
        if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
        if (aiChatInput) {
            aiChatInput.value = '';
            aiChatInput.focus();
        }
    }

    function promptRenameSession(sid) {
        const target = aiSessions.find(s => s.id === sid);
        if (!target) return;
        const newTitle = prompt('请输入该对话的新名称：', target.title);
        if (newTitle !== null) {
            const trimmed = newTitle.trim();
            if (!trimmed) {
                alert('对话名称不能为空！');
                return;
            }
            target.title = trimmed;
            target.updatedAt = Date.now();
            saveAiSessions();
            renderSessionList();
            if (target.id === activeSessionId && chatSessionTitle) {
                chatSessionTitle.textContent = target.title;
            }
        }
    }

    function deleteSession(sid) {
        const target = aiSessions.find(s => s.id === sid);
        if (!target) return;
        if (!confirm(`确定要删除对话「${target.title}」及其所有历史记录吗？`)) return;

        aiSessions = aiSessions.filter(s => s.id !== sid);
        if (aiSessions.length === 0) {
            const fallback = createSessionObject('新对话');
            aiSessions = [fallback];
            activeSessionId = fallback.id;
        } else if (activeSessionId === sid) {
            activeSessionId = aiSessions[0].id;
        }
        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
    }

    function clearCurrentSession() {
        const session = getActiveSession();
        if (!session) return;
        if (!confirm(`确定要清空当前对话「${session.title}」的记录吗？`)) return;

        session.title = '新对话';
        session.updatedAt = Date.now();
        session.messages = [
            {
                role: 'ai',
                content: getAiWelcomeText(),
                toolHistory: [],
                time: getCurrentTimeStr()
            }
        ];
        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
    }

    function clearAllHistorySessions() {
        if (!confirm('确定要清空全部所有历史对话记录吗？此操作无法恢复！')) return;
        const fresh = createSessionObject('新对话');
        aiSessions = [fresh];
        activeSessionId = fresh.id;
        saveAiSessions();
        renderActiveSessionMessages();
        renderSessionList();
        if (aiHistoryDrawer) aiHistoryDrawer.style.display = 'none';
    }

    // 导出单条消息或内容为文档文件并直接调起浏览器原生下载
    async function exportMessageAsDocument(title, content, format = 'docx') {
        if (!content) {
            alert('暂无可导出的内容');
            return;
        }
        showLoading(`正在生成 ${format.toUpperCase()} 文档并准备下载...`);
        try {
            const res = await fetch(apiUrl('/api/ai/export-content'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title || '小禅AI生成文档',
                    content: content,
                    format: format
                })
            });
            hideLoading();
            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                alert('导出失败: ' + (errJson.message || res.statusText));
                return;
            }
            let filename = `小禅AI文档.${format}`;
            const disposition = res.headers.get('Content-Disposition');
            if (disposition && disposition.includes('filename*=')) {
                const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
                if (match && match[1]) filename = decodeURIComponent(match[1]);
            } else if (disposition && disposition.includes('filename=')) {
                const match = disposition.match(/filename="?([^";]+)"?/);
                if (match && match[1]) filename = match[1];
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (e) {
            hideLoading();
            alert('导出请求异常: ' + e);
        }
    }

    // 9. 添加消息气泡到 UI
    function appendAiMessageToUI({ role, content, toolHistory, time, isTemp }) {
        if (!chatMessagesContainer) return null;

        const row = document.createElement('div');
        row.className = `chat-msg-row ${role}`;
        if (isTemp) row.id = 'tempAiLoadingRow';

        const avatar = document.createElement('div');
        avatar.className = 'chat-msg-avatar';
        avatar.textContent = role === 'user' ? '👤' : '🤖';

        const bubble = document.createElement('div');
        bubble.className = 'chat-msg-bubble';

        // 渲染 Agent 工具调用过程微标
        if (toolHistory && toolHistory.length > 0) {
            toolHistory.forEach(th => {
                const toolBadge = document.createElement('div');
                toolBadge.className = 'agent-tool-badge';
                const toolNameMap = {
                    'get_my_active_tasks': '查询指派给我的未完成任务',
                    'get_all_projects': '查询禅道所有项目列表',
                    'query_tasks': '多条件检索任务数据',
                    'batch_finish_my_tasks': '一键批量完成待办任务',
                    'batch_update_task_name': '批量修改任务名称',
                    'generate_weekly_report': '生成个人工作周报数据',
                    'generate_downloadable_document': '生成可下载文档',
                    'get_current_user_status': '获取登录状态与用户信息'
                };
                const displayToolName = toolNameMap[th.tool_name] || th.tool_name;
                toolBadge.innerHTML = `<span class="tool-done-icon">✓</span> <span>已调用工具：<b>${displayToolName}</b></span>`;
                bubble.appendChild(toolBadge);
            });
        }

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = role === 'user' ? escapeHtml(content).replace(/\n/g, '<br>') : renderMarkdownToHtml(content);
        bubble.appendChild(contentDiv);

        if (!isTemp) {
            const footerDiv = document.createElement('div');
            footerDiv.className = 'chat-msg-footer';

            // 一键复制该条内容按钮
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn-msg-copy';
            copyBtn.title = '复制该条消息全部内容';
            copyBtn.innerHTML = '📋 复制';
            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                const copyText = content || '';
                try {
                    await navigator.clipboard.writeText(copyText);
                    copyBtn.innerHTML = '✓ 已复制';
                    copyBtn.classList.add('is-copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = '📋 复制';
                        copyBtn.classList.remove('is-copied');
                    }, 1500);
                } catch (err) {
                    const ta = document.createElement('textarea');
                    ta.value = copyText;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyBtn.innerHTML = '✓ 已复制';
                    copyBtn.classList.add('is-copied');
                    setTimeout(() => {
                        copyBtn.innerHTML = '📋 复制';
                        copyBtn.classList.remove('is-copied');
                    }, 1500);
                }
            };
            footerDiv.appendChild(copyBtn);

            // 仅对 AI 生成的回答提供导出为 Word 和 Markdown 按钮
            if (role === 'ai') {
                const exportWordBtn = document.createElement('button');
                exportWordBtn.type = 'button';
                exportWordBtn.className = 'btn-msg-export';
                exportWordBtn.title = '将本条内容导出为 Word (.docx) 文档并下载';
                exportWordBtn.innerHTML = '📄 导出Word';
                exportWordBtn.onclick = (e) => {
                    e.stopPropagation();
                    const active = getActiveSession();
                    const docTitle = active ? active.title : '小禅AI生成文档';
                    exportMessageAsDocument(docTitle, content, 'docx');
                };
                footerDiv.appendChild(exportWordBtn);

                const exportMdBtn = document.createElement('button');
                exportMdBtn.type = 'button';
                exportMdBtn.className = 'btn-msg-export';
                exportMdBtn.title = '将本条内容导出为 Markdown (.md) 文档并下载';
                exportMdBtn.innerHTML = '📝 导出MD';
                exportMdBtn.onclick = (e) => {
                    e.stopPropagation();
                    const active = getActiveSession();
                    const docTitle = active ? active.title : '小禅AI生成文档';
                    exportMessageAsDocument(docTitle, content, 'md');
                };
                footerDiv.appendChild(exportMdBtn);
            }

            if (time) {
                const timeDiv = document.createElement('div');
                timeDiv.className = 'chat-msg-time';
                timeDiv.textContent = time;
                footerDiv.appendChild(timeDiv);
            }

            bubble.appendChild(footerDiv);
        }

        row.appendChild(avatar);
        row.appendChild(bubble);
        chatMessagesContainer.appendChild(row);

        // 滚动到底部
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        return row;
    }

    // 10. 发送消息交互
    async function handleSendAiMessage() {
        if (!aiChatInput) return;
        const text = aiChatInput.value.trim();
        if (!text || isAiGenerating) return;

        const session = getActiveSession();
        if (!session) return;

        // 未登录账号安全提醒与拦截
        if (!currentAccount) {
            appendAiMessageToUI({
                role: 'user',
                content: text,
                time: getCurrentTimeStr()
            });
            appendAiMessageToUI({
                role: 'ai',
                content: '⚠️ 您当前尚未登录禅道账号。小禅的查询名下待办、批量报工、批量修改以及生成个人周报等功能均需要关联您的禅道账号身份。\n\n请点击右上角 **【🔑 登录禅道】** 完成登录后再试。',
                time: getCurrentTimeStr()
            });
            aiChatInput.value = '';
            openLoginModal(false);
            return;
        }

        // 检查 API Key
        const apiKey = localStorage.getItem(STORAGE_KEY_DEEPSEEK) || (inputDeepSeekKey ? inputDeepSeekKey.value.trim() : '');
        if (!apiKey) {
            appendAiMessageToUI({
                role: 'user',
                content: text,
                time: getCurrentTimeStr()
            });
            appendAiMessageToUI({
                role: 'ai',
                content: '⚠️ 您尚未配置 **DeepSeek API Key**。\n请先点击右上角的 **【⚙️ 设置】** 图标输入并保存您的 API Key 即可畅享 AI 交互！',
                time: getCurrentTimeStr()
            });
            aiChatInput.value = '';
            if (aiSettingsDrawer) aiSettingsDrawer.style.display = 'block';
            return;
        }

        const currentTime = getCurrentTimeStr();

        // 自动重命名会话标题（若仍为“新对话”，则使用首问作为标题）
        if (session.title === '新对话') {
            session.title = text.length > 18 ? text.slice(0, 18) + '...' : text;
            if (chatSessionTitle) chatSessionTitle.textContent = session.title;
        }

        // 添加用户消息并持久化
        session.messages.push({
            role: 'user',
            content: text,
            time: currentTime
        });
        session.updatedAt = Date.now();
        saveAiSessions();

        // 渲染用户输入气泡
        appendAiMessageToUI({
            role: 'user',
            content: text,
            time: currentTime
        });

        aiChatInput.value = '';

        // 渲染 loading 状态
        isAiGenerating = true;
        if (btnSendAi) btnSendAi.disabled = true;

        const loadingRow = appendAiMessageToUI({
            role: 'ai',
            content: '<span style="color: #64748b;">小禅正在思考并准备调用禅道工具中...</span>',
            isTemp: true
        });

        const selectedModel = localStorage.getItem(STORAGE_KEY_MODEL) || 'deepseek-chat';

        // 提取发送给后端的上下文
        const messagesForApi = session.messages
            .filter(m => m.role === 'user' || m.role === 'ai' || m.role === 'assistant')
            .map(m => ({
                role: m.role === 'ai' ? 'assistant' : m.role,
                content: m.content
            }));

        try {
            const res = await fetch(apiUrl('/api/ai/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: messagesForApi,
                    api_key: apiKey,
                    model: selectedModel
                })
            });
            const resJson = await res.json();

            // 移除临时 loading
            if (loadingRow && loadingRow.parentNode) {
                loadingRow.parentNode.removeChild(loadingRow);
            }

            const replyTime = getCurrentTimeStr();

            if (resJson.success) {
                appendAiMessageToUI({
                    role: 'ai',
                    content: resJson.reply,
                    toolHistory: resJson.tool_history || [],
                    time: replyTime
                });

                session.messages.push({
                    role: 'ai',
                    content: resJson.reply,
                    toolHistory: resJson.tool_history || [],
                    time: replyTime
                });
                session.updatedAt = Date.now();
                saveAiSessions();
                renderSessionList();

                // 如果 Agent 刚才执行了批量完成或修改等操作，自动触发界面刷新
                if (resJson.tool_history && resJson.tool_history.some(th => ['batch_finish_my_tasks', 'batch_update_task_name'].includes(th.tool_name))) {
                    loadMyActiveTasks();
                }
            } else {
                appendAiMessageToUI({
                    role: 'ai',
                    content: '⚠️ ' + (resJson.reply || resJson.message || 'AI 服务请求异常'),
                    time: replyTime
                });
                session.messages.push({
                    role: 'ai',
                    content: '⚠️ ' + (resJson.reply || resJson.message || 'AI 服务请求异常'),
                    toolHistory: [],
                    time: replyTime
                });
                session.updatedAt = Date.now();
                saveAiSessions();
                renderSessionList();

                if (resJson.error_type === 'NO_API_KEY') {
                    if (aiSettingsDrawer) aiSettingsDrawer.style.display = 'block';
                }
            }
        } catch (e) {
            if (loadingRow && loadingRow.parentNode) {
                loadingRow.parentNode.removeChild(loadingRow);
            }
            appendAiMessageToUI({
                role: 'ai',
                content: `⚠️ 请求异常: ${e}，请检查网络连接或后端服务状态。`,
                time: getCurrentTimeStr()
            });
        } finally {
            isAiGenerating = false;
            if (btnSendAi) btnSendAi.disabled = false;
            if (aiChatInput) aiChatInput.focus();
        }
    }

    if (btnSendAi) {
        btnSendAi.onclick = handleSendAiMessage;
    }

    if (aiChatInput) {
        aiChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendAiMessage();
            }
        });
    }

    // 初始化加载 AI 对话多会话
    initAiSessions();

    // 首次进入自动加载
    initFilterUserSelect();
    checkStatus();
    loadMyActiveTasks();
});

