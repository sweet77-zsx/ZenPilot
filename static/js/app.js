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

                // 实时加载所有项目、分组与用户列表，并刷新目标用户下拉选择器
                loadProjects();
                loadGroups();
                loadUsers().then(() => {
                    initFilterUserSelect();
                    initPTabFinishedBySelect();
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
        let isComposing = false;
        let searchTimer = null;

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

            const displayList = matched.slice(0, 100);

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
                displayList.forEach(p => {
                    const isSelected = String(hiddenInput.value) === String(p.id);
                    html += `
                        <div class="searchable-select-item ${isSelected ? 'is-selected' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                            <span class="item-id-badge">[${p.id}]</span>
                            <span class="item-name">${highlightMatch(p.name, keyword)}</span>
                        </div>
                    `;
                });
                if (matched.length > 100) {
                    html += `<div class="searchable-select-empty" style="font-size:11px; color:#94a3b8;">还有 ${matched.length - 100} 个项目，请输入更精确的关键字</div>`;
                }
            }

            dropdown.innerHTML = html;
        }

        // 使用事件委托统一处理下拉项点击，避免频繁绑定
        dropdown.addEventListener('mousedown', (e) => {
            const el = e.target.closest('.searchable-select-item');
            if (el) {
                e.preventDefault();
                const id = el.getAttribute('data-id');
                const name = el.getAttribute('data-name');
                chooseItem(id, name);
            }
        });

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
            if (!wrapper.classList.contains('is-open')) return;
            wrapper.classList.remove('is-open');
            dropdown.style.display = 'none';
            activeIndex = -1;
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

        function toggleDropdown() {
            if (wrapper.classList.contains('is-open')) {
                closeDropdown();
            } else {
                openDropdown();
                input.focus();
            }
        }

        const arrow = wrapper.querySelector('.searchable-select-arrow');
        if (arrow) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        input.addEventListener('focus', () => {
            openDropdown();
            input.select();
        });

        input.addEventListener('click', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            }
        });

        input.addEventListener('compositionstart', () => { isComposing = true; });
        input.addEventListener('compositionend', () => {
            isComposing = false;
            scheduleSearch();
        });

        function scheduleSearch() {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                const kw = input.value.trim().replace(/^\[\d+\]\s*/, '');
                if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';
                renderList(kw);
            }, 80);
        }

        input.addEventListener('input', () => {
            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            if (isComposing) return;
            scheduleSearch();
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

    // 通用多选项目组件 Multi-Select Project Component
    function setupMultiSelectProject({
        wrapper,
        box,
        tagsContainer,
        input,
        hiddenInput,
        clearBtn,
        dropdown,
        items = [],
        placeholder = '输入名称/ID搜索项目 (全部)',
        onChange = null
    }) {
        if (!wrapper || !input || !dropdown) return null;

        const selectedMap = new Map();
        let isComposing = false;
        let searchTimer = null;

        // 增量更新标签 (Diffing)，避免无脑 innerHTML 重绘导致整个页面大回流及动画重播
        function renderTags() {
            if (!tagsContainer) return;

            // 1. 收集现有 tag 节点映射
            const existingTags = new Map();
            tagsContainer.querySelectorAll('.multi-select-tag').forEach(tag => {
                const id = tag.getAttribute('data-id');
                if (id) existingTags.set(id, tag);
            });

            // 2. 移除已被取消选中的 tag
            existingTags.forEach((tagEl, id) => {
                if (!selectedMap.has(id)) {
                    tagEl.remove();
                }
            });

            // 3. 追加新选中的 tag (保持原有 tag 节点不动)
            selectedMap.forEach((name, id) => {
                if (!existingTags.has(id)) {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'multi-select-tag';
                    tagEl.setAttribute('data-id', id);
                    tagEl.setAttribute('title', `[${id}] ${name}`);
                    tagEl.innerHTML = `
                        <span class="tag-text">[${id}] ${escapeHtml(name)}</span>
                        <span class="tag-remove" data-id="${id}" title="移除该项目">&times;</span>
                    `;
                    tagsContainer.appendChild(tagEl);
                }
            });

            if (selectedMap.size > 0) {
                input.placeholder = '继续搜索添加项目...';
                if (clearBtn) clearBtn.style.display = 'block';
            } else {
                input.placeholder = placeholder;
                if (clearBtn) clearBtn.style.display = 'none';
            }

            if (hiddenInput) {
                hiddenInput.value = Array.from(selectedMap.keys()).join(',');
            }
        }

        // 使用委托监听标签移除
        if (tagsContainer) {
            tagsContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.tag-remove');
                if (!btn) return;
                e.stopPropagation();
                const removeId = btn.getAttribute('data-id');
                if (removeId && selectedMap.has(removeId)) {
                    selectedMap.delete(removeId);
                    renderTags();
                    syncDropdownItem(removeId, false);
                    if (onChange) onChange(Array.from(selectedMap.keys()));
                }
            });
        }

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

        function syncDropdownItem(id, isSelected) {
            const el = dropdown.querySelector(`.searchable-select-item[data-id="${id}"]`);
            if (el) {
                if (isSelected) {
                    el.classList.add('is-selected');
                    const cb = el.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '✓';
                } else {
                    el.classList.remove('is-selected');
                    const cb = el.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '';
                }
            }
            const headerCount = dropdown.querySelector('.searchable-select-dropdown-header b');
            if (headerCount) headerCount.textContent = selectedMap.size;
        }

        function renderDropdownList(keyword = '') {
            const kw = keyword.trim().toLowerCase();
            let matched = items.filter(p => {
                if (!kw) return true;
                return String(p.id).toLowerCase().includes(kw) || String(p.name).toLowerCase().includes(kw);
            });

            // 限制最多渲染 200 项，防止 DOM 暴增卡顿
            const displayList = matched.slice(0, 200);

            let html = '';
            html += `
                <div class="searchable-select-dropdown-header">
                    <span>已选 <b>${selectedMap.size}</b> 个项目</span>
                    ${selectedMap.size > 0 ? `<button type="button" id="btnMultiSelectClearAll">清空已选 (全部)</button>` : `<span>点击下方项目多选</span>`}
                </div>
            `;

            if (matched.length === 0) {
                html += `<div class="searchable-select-empty">未找到包含「${escapeHtml(keyword)}」的项目</div>`;
            } else {
                displayList.forEach(p => {
                    const isChecked = selectedMap.has(String(p.id));
                    html += `
                        <div class="searchable-select-item ${isChecked ? 'is-selected' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
                            <span class="item-checkbox">${isChecked ? '✓' : ''}</span>
                            <span class="item-id-badge">[${p.id}]</span>
                            <span class="item-name">${highlightMatch(p.name, keyword)}</span>
                        </div>
                    `;
                });
                if (matched.length > 200) {
                    html += `<div class="searchable-select-empty" style="font-size:11px; color:#94a3b8;">还有 ${matched.length - 200} 个项目，请输入更精确的关键字过滤</div>`;
                }
            }

            dropdown.innerHTML = html;
        }

        // 使用事件委托统一处理下拉框点击
        dropdown.addEventListener('mousedown', (e) => {
            const btnClearAll = e.target.closest('#btnMultiSelectClearAll');
            if (btnClearAll) {
                e.preventDefault();
                selectedMap.clear();
                input.value = '';
                renderTags();
                renderDropdownList('');
                if (onChange) onChange([]);
                return;
            }

            const itemEl = e.target.closest('.searchable-select-item');
            if (itemEl) {
                e.preventDefault();
                const id = String(itemEl.getAttribute('data-id'));
                const name = itemEl.getAttribute('data-name');
                if (selectedMap.has(id)) {
                    selectedMap.delete(id);
                    itemEl.classList.remove('is-selected');
                    const cb = itemEl.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '';
                } else {
                    selectedMap.set(id, name);
                    itemEl.classList.add('is-selected');
                    const cb = itemEl.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '✓';
                }
                const headerCount = dropdown.querySelector('.searchable-select-dropdown-header b');
                if (headerCount) headerCount.textContent = selectedMap.size;
                renderTags();

                // 选中/取消后立即清空搜索关键字，重置下拉列表并保持光标聚焦
                if (input.value) {
                    input.value = '';
                    renderDropdownList('');
                }
                input.focus();

                if (onChange) onChange(Array.from(selectedMap.keys()));
            }
        });

        function openDropdown() {
            if (wrapper.classList.contains('is-open')) return;
            document.querySelectorAll('.searchable-select-wrapper.is-open').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('is-open');
                    const dd = w.querySelector('.searchable-select-dropdown');
                    if (dd) dd.style.display = 'none';
                }
            });
            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            renderDropdownList(input.value.trim());
        }

        function closeDropdown() {
            if (!wrapper.classList.contains('is-open')) return;
            wrapper.classList.remove('is-open');
            dropdown.style.display = 'none';
            if (input.value) {
                input.value = '';
            }
        }

        function toggleDropdown() {
            if (wrapper.classList.contains('is-open')) {
                closeDropdown();
            } else {
                openDropdown();
                input.focus();
            }
        }

        // 下拉箭头支持 Toggle
        const arrow = wrapper.querySelector('.searchable-select-arrow');
        if (arrow) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        if (box) {
            box.addEventListener('click', (e) => {
                if (!e.target.closest('.tag-remove')) {
                    if (!wrapper.classList.contains('is-open')) {
                        openDropdown();
                    }
                    input.focus();
                }
            });
        }

        input.addEventListener('focus', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            }
        });

        // 中文输入法 Composition 状态守卫及防抖优化
        input.addEventListener('compositionstart', () => {
            isComposing = true;
        });

        input.addEventListener('compositionend', () => {
            isComposing = false;
            scheduleSearch();
        });

        function scheduleSearch() {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                renderDropdownList(input.value.trim());
            }, 80);
        }

        input.addEventListener('input', () => {
            if (!wrapper.classList.contains('is-open')) {
                wrapper.classList.add('is-open');
                dropdown.style.display = 'block';
            }
            if (isComposing) return;
            scheduleSearch();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && selectedMap.size > 0) {
                const keys = Array.from(selectedMap.keys());
                const lastKey = keys[keys.length - 1];
                selectedMap.delete(lastKey);
                renderTags();
                syncDropdownItem(lastKey, false);
                if (onChange) onChange(Array.from(selectedMap.keys()));
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedMap.clear();
                input.value = '';
                renderTags();
                renderDropdownList('');
                if (onChange) onChange([]);
            });
        }

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown();
            }
        });

        return {
            getSelectedIds: () => Array.from(selectedMap.keys()),
            setSelectedIds: (ids = []) => {
                selectedMap.clear();
                ids.forEach(id => {
                    const found = items.find(p => String(p.id) === String(id));
                    if (found) selectedMap.set(String(id), found.name);
                });
                renderTags();
            },
            updateItems: (newItems) => {
                items = newItems || [];
                renderTags();
                if (wrapper.classList.contains('is-open')) {
                    renderDropdownList(input.value.trim());
                }
            },
            clear: () => {
                selectedMap.clear();
                input.value = '';
                renderTags();
            }
        };
    }
    window.setupMultiSelectProject = setupMultiSelectProject;

    // 通用构建可搜索用户下拉选择组件
    function setupSearchableUserSelect({
        wrapper,
        input,
        hiddenInput,
        clearBtn,
        dropdown,
        placeholder = '输入姓名/账号搜索用户...',
        includeMe = false,
        includeAll = false,
        onSelect = null
    }) {
        if (!wrapper || !input || !hiddenInput || !dropdown) return null;

        let activeIndex = -1;
        let currentFiltered = [];
        let isComposing = false;
        let searchTimer = null;

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

            const displayList = matched.slice(0, 100);

            let html = '';

            // 如果支持选择当前登录人“我”
            if (includeMe) {
                const isMatchMe = !kw || '我'.includes(kw) || 'me'.includes(kw) ||
                    (currentUserRealname && currentUserRealname.toLowerCase().includes(kw)) ||
                    (currentAccount && currentAccount.toLowerCase().includes(kw));
                if (isMatchMe) {
                    const isMeSelected = (currentAccount && hiddenInput.value.toLowerCase() === currentAccount.toLowerCase());
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
                displayList.forEach(u => {
                    const isSelected = hiddenInput.value && String(hiddenInput.value).toLowerCase() === String(u.account).toLowerCase();
                    const isCurrentUser = currentAccount && String(u.account).toLowerCase() === currentAccount.toLowerCase();
                    html += `
                        <div class="searchable-select-item ${isSelected ? 'is-selected' : ''}" data-account="${escapeHtml(u.account)}" data-realname="${escapeHtml(u.realname)}" ${isCurrentUser ? 'data-is-me="true"' : ''}>
                            <span class="item-id-badge" style="background:#eff6ff; color:#2563eb; font-weight:600;">@${escapeHtml(u.account)}</span>
                            <span class="item-name">${highlightMatch(u.realname, keyword)} ${isCurrentUser ? '<small style="color:#f59e0b; font-weight:600;">(我)</small>' : ''}</span>
                        </div>
                    `;
                });
                if (matched.length > 100) {
                    html += `<div class="searchable-select-empty" style="font-size:11px; color:#94a3b8;">还有 ${matched.length - 100} 位用户，请输入更精确的关键字</div>`;
                }
            }

            dropdown.innerHTML = html;
        }

        // 事件委托统一处理用户项点击
        dropdown.addEventListener('mousedown', (e) => {
            const el = e.target.closest('.searchable-select-item');
            if (el) {
                e.preventDefault();
                const account = el.getAttribute('data-account');
                const realname = el.getAttribute('data-realname');
                const isMe = el.getAttribute('data-is-me') === 'true';
                chooseItem(account, realname, isMe);
            }
        });

        function chooseItem(account, realname, isMe = false) {
            if (isMe) {
                hiddenInput.value = currentAccount || '';
                input.value = `我 (${currentUserRealname || currentAccount || '当前登录用户'})`;
                if (clearBtn) clearBtn.style.display = 'block';
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
            if (!wrapper.classList.contains('is-open')) return;
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

        function toggleDropdown() {
            if (wrapper.classList.contains('is-open')) {
                closeDropdown();
            } else {
                openDropdown();
                input.focus();
            }
        }

        const arrow = wrapper.querySelector('.searchable-select-arrow');
        if (arrow) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        input.addEventListener('focus', openDropdown);
        input.addEventListener('click', openDropdown);

        input.addEventListener('compositionstart', () => { isComposing = true; });
        input.addEventListener('compositionend', () => {
            isComposing = false;
            scheduleSearch();
        });

        function scheduleSearch() {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                const kw = input.value.trim();
                if (clearBtn) clearBtn.style.display = kw ? 'block' : 'none';
                renderList(kw);
            }, 80);
        }

        input.addEventListener('input', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            }
            if (isComposing) return;
            scheduleSearch();
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

    // 初始化多选目标用户组件
    function setupMultiSelectUser({
        wrapper,
        box,
        tagsContainer,
        input,
        hiddenInput,
        clearBtn,
        dropdown,
        placeholder = '输入姓名/账号搜索用户 (默认我)',
        defaultSelectCurrentUser = true,
        onChange = null
    }) {
        if (!wrapper || !input || !dropdown) return null;

        // Map<account, { account, realname, isMe }>
        const selectedMap = new Map();
        let isComposing = false;
        let searchTimer = null;

        // 默认若允许选中当前登录用户且有账号，默认填入“我”
        if (defaultSelectCurrentUser && currentAccount) {
            selectedMap.set(currentAccount, {
                account: currentAccount,
                realname: currentUserRealname || currentAccount,
                isMe: true
            });
        }

        // 增量更新标签 (Diffing)，避免无脑 innerHTML 重绘导致整个页面大回流及动画重播
        function renderTags() {
            if (!tagsContainer) return;

            // 1. 收集现有 tag 节点映射
            const existingTags = new Map();
            tagsContainer.querySelectorAll('.multi-select-tag').forEach(tag => {
                const acc = tag.getAttribute('data-account');
                if (acc) existingTags.set(acc, tag);
            });

            // 2. 移除已被取消选中的 tag
            existingTags.forEach((tagEl, acc) => {
                if (!selectedMap.has(acc)) {
                    tagEl.remove();
                }
            });

            // 3. 追加新选中的 tag (保持原有 tag 节点不动)
            selectedMap.forEach((u, acc) => {
                if (!existingTags.has(acc)) {
                    const isMe = u.isMe || (currentAccount && acc.toLowerCase() === currentAccount.toLowerCase());
                    const badgeStyle = isMe ? 'background:#fef3c7; color:#92400e; border:1px solid #fde68a;' : '';
                    const titleText = isMe ? `🌟 我 (${u.realname || acc})` : `${u.realname || acc} (@${acc})`;

                    const tagEl = document.createElement('span');
                    tagEl.className = 'multi-select-tag';
                    if (badgeStyle) tagEl.style.cssText = badgeStyle;
                    tagEl.setAttribute('data-account', acc);
                    tagEl.setAttribute('title', titleText);
                    tagEl.innerHTML = `
                        <span class="tag-text">${escapeHtml(titleText)}</span>
                        <span class="tag-remove" data-account="${escapeHtml(acc)}" title="移除该用户">&times;</span>
                    `;
                    tagsContainer.appendChild(tagEl);
                }
            });

            if (selectedMap.size > 0) {
                input.placeholder = '';
                if (clearBtn) clearBtn.style.display = 'block';
            } else {
                input.placeholder = placeholder;
                if (clearBtn) clearBtn.style.display = 'none';
            }

            if (hiddenInput) {
                hiddenInput.value = Array.from(selectedMap.keys()).join(',');
            }
        }

        // 使用委托监听标签移除
        if (tagsContainer) {
            tagsContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.tag-remove');
                if (!btn) return;
                e.stopPropagation();
                const removeAcc = btn.getAttribute('data-account');
                if (removeAcc && selectedMap.has(removeAcc)) {
                    selectedMap.delete(removeAcc);
                    renderTags();
                    syncDropdownItem(removeAcc, false);
                    if (onChange) onChange(Array.from(selectedMap.values()));
                }
            });
        }

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

        function syncDropdownItem(acc, isSelected) {
            const el = dropdown.querySelector(`.searchable-select-item[data-account="${acc}"]`);
            if (el) {
                if (isSelected) {
                    el.classList.add('is-selected');
                    const cb = el.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '✓';
                } else {
                    el.classList.remove('is-selected');
                    const cb = el.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '';
                }
            }
            const headerCount = dropdown.querySelector('.searchable-select-dropdown-header b');
            if (headerCount) headerCount.textContent = selectedMap.size;
        }

        function renderDropdownList(keyword = '') {
            const kw = keyword.trim().toLowerCase();
            let matched = cachedUsers.filter(u => {
                if (!kw) return true;
                return String(u.account).toLowerCase().includes(kw) || String(u.realname).toLowerCase().includes(kw);
            });

            // 限制最多渲染 200 项，防止 DOM 暴增卡顿
            const displayList = matched.slice(0, 200);

            let html = '';
            html += `
                <div class="searchable-select-dropdown-header">
                    <span>已选 <b>${selectedMap.size}</b> 位用户</span>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn-user-reset-me" id="btnUserResetMe">仅选我</button>
                        ${selectedMap.size > 0 ? `<button type="button" class="btn-user-clear-all" id="btnUserClearAll">清空已选</button>` : ''}
                    </div>
                </div>
            `;

            // 当前登录人首项置顶 (未搜关键字或关键字与我匹配)
            if (currentAccount) {
                const isMatchMe = !kw || '我'.includes(kw) || 'me'.includes(kw) ||
                    (currentUserRealname && currentUserRealname.toLowerCase().includes(kw)) ||
                    (currentAccount.toLowerCase().includes(kw));
                if (isMatchMe) {
                    const isChecked = selectedMap.has(currentAccount);
                    html += `
                        <div class="searchable-select-item ${isChecked ? 'is-selected' : ''}" data-account="${escapeHtml(currentAccount)}" data-realname="${escapeHtml(currentUserRealname || currentAccount)}" data-is-me="true">
                            <span class="item-checkbox">${isChecked ? '✓' : ''}</span>
                            <span class="item-id-badge" style="background:#fef3c7; color:#d97706; font-weight:700;">🌟 我</span>
                            <span class="item-name">当前登录用户 (${escapeHtml(currentUserRealname || currentAccount || '我')})</span>
                        </div>
                    `;
                }
            }

            if (cachedUsers.length === 0 && !currentAccount) {
                html += `<div class="searchable-select-empty" style="color:#2563eb;">⏳ 正在查询禅道所有用户...</div>`;
            } else if (matched.length === 0 && (!currentAccount || !(!kw || '我'.includes(kw)))) {
                html += `<div class="searchable-select-empty">未找到匹配「${escapeHtml(keyword)}」的用户</div>`;
            } else {
                displayList.forEach(u => {
                    const isMe = currentAccount && String(u.account).toLowerCase() === currentAccount.toLowerCase();
                    if (isMe) return;
                    const isChecked = selectedMap.has(String(u.account));
                    html += `
                        <div class="searchable-select-item ${isChecked ? 'is-selected' : ''}" data-account="${escapeHtml(u.account)}" data-realname="${escapeHtml(u.realname)}">
                            <span class="item-checkbox">${isChecked ? '✓' : ''}</span>
                            <span class="item-id-badge" style="background:#eff6ff; color:#2563eb; font-weight:600;">@${escapeHtml(u.account)}</span>
                            <span class="item-name">${highlightMatch(u.realname, keyword)}</span>
                        </div>
                    `;
                });
                if (matched.length > 200) {
                    html += `<div class="searchable-select-empty" style="font-size:11px; color:#94a3b8;">还有 ${matched.length - 200} 位用户，请输入更精确的关键字过滤</div>`;
                }
            }

            dropdown.innerHTML = html;
        }

        // 使用事件委托统一处理下拉框内用户点击
        dropdown.addEventListener('mousedown', (e) => {
            const btnResetMe = e.target.closest('#btnUserResetMe, .btn-user-reset-me');
            if (btnResetMe) {
                e.preventDefault();
                selectedMap.clear();
                if (currentAccount) {
                    selectedMap.set(currentAccount, {
                        account: currentAccount,
                        realname: currentUserRealname || currentAccount,
                        isMe: true
                    });
                }
                input.value = '';
                renderTags();
                renderDropdownList('');
                if (onChange) onChange(Array.from(selectedMap.values()));
                return;
            }

            const btnClearAll = e.target.closest('#btnUserClearAll, .btn-user-clear-all');
            if (btnClearAll) {
                e.preventDefault();
                selectedMap.clear();
                input.value = '';
                renderTags();
                renderDropdownList('');
                if (onChange) onChange([]);
                return;
            }

            const itemEl = e.target.closest('.searchable-select-item');
            if (itemEl) {
                e.preventDefault();
                const acc = itemEl.getAttribute('data-account');
                const realname = itemEl.getAttribute('data-realname');
                const isMe = itemEl.getAttribute('data-is-me') === 'true';
                if (selectedMap.has(acc)) {
                    selectedMap.delete(acc);
                    itemEl.classList.remove('is-selected');
                    const cb = itemEl.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '';
                } else {
                    selectedMap.set(acc, { account: acc, realname, isMe });
                    itemEl.classList.add('is-selected');
                    const cb = itemEl.querySelector('.item-checkbox');
                    if (cb) cb.textContent = '✓';
                }
                const headerCount = dropdown.querySelector('.searchable-select-dropdown-header b');
                if (headerCount) headerCount.textContent = selectedMap.size;
                renderTags();

                // 选中/取消后立即清空搜索关键字，重置下拉列表并保持光标聚焦
                if (input.value) {
                    input.value = '';
                    renderDropdownList('');
                }
                input.focus();

                if (onChange) onChange(Array.from(selectedMap.values()));
            }
        });

        function openDropdown() {
            if (wrapper.classList.contains('is-open')) return;
            document.querySelectorAll('.searchable-select-wrapper.is-open').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('is-open');
                    const dd = w.querySelector('.searchable-select-dropdown');
                    if (dd) dd.style.display = 'none';
                }
            });
            wrapper.classList.add('is-open');
            dropdown.style.display = 'block';
            renderDropdownList(input.value.trim());
        }

        function closeDropdown() {
            if (!wrapper.classList.contains('is-open')) return;
            wrapper.classList.remove('is-open');
            dropdown.style.display = 'none';
            if (input.value) {
                input.value = '';
            }
        }

        function toggleDropdown() {
            if (wrapper.classList.contains('is-open')) {
                closeDropdown();
            } else {
                openDropdown();
                input.focus();
            }
        }

        // 下拉箭头支持 Toggle
        const arrow = wrapper.querySelector('.searchable-select-arrow');
        if (arrow) {
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        if (box) {
            box.addEventListener('click', (e) => {
                if (!e.target.closest('.tag-remove')) {
                    if (!wrapper.classList.contains('is-open')) {
                        openDropdown();
                    }
                    input.focus();
                }
            });
        }

        input.addEventListener('focus', () => {
            if (!wrapper.classList.contains('is-open')) {
                openDropdown();
            }
        });

        // 中文输入法 Composition 状态守卫及防抖优化
        input.addEventListener('compositionstart', () => {
            isComposing = true;
        });

        input.addEventListener('compositionend', () => {
            isComposing = false;
            scheduleSearch();
        });

        function scheduleSearch() {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                renderDropdownList(input.value.trim());
            }, 80);
        }

        input.addEventListener('input', () => {
            if (!wrapper.classList.contains('is-open')) {
                wrapper.classList.add('is-open');
                dropdown.style.display = 'block';
            }
            if (isComposing) return;
            scheduleSearch();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value.trim()) {
                const keys = Array.from(selectedMap.keys());
                if (keys.length > 0) {
                    const lastKey = keys[keys.length - 1];
                    selectedMap.delete(lastKey);
                    renderTags();
                    syncDropdownItem(lastKey, false);
                    if (onChange) onChange(Array.from(selectedMap.values()));
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedMap.clear();
                input.value = '';
                renderTags();
                renderDropdownList('');
                if (onChange) onChange([]);
            });
        }

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown();
            }
        });

        renderTags();

        return {
            getSelectedUsers: () => Array.from(selectedMap.values()),
            getSelectedAccounts: () => Array.from(selectedMap.keys()),
            setSelectedUsers: (users = []) => {
                selectedMap.clear();
                users.forEach(u => {
                    const acc = String(u.account || '').trim();
                    if (acc) {
                        const isMe = currentAccount && acc.toLowerCase() === currentAccount.toLowerCase();
                        selectedMap.set(acc, {
                            account: acc,
                            realname: u.realname || acc,
                            isMe: isMe
                        });
                    }
                });
                renderTags();
                if (wrapper.classList.contains('is-open')) {
                    renderDropdownList(input.value.trim());
                }
                if (onChange) onChange(Array.from(selectedMap.values()));
            },
            setSelectedAccounts: (accounts = []) => {
                selectedMap.clear();
                accounts.forEach(acc => {
                    const cleanAcc = String(acc || '').trim();
                    if (!cleanAcc) return;
                    const found = cachedUsers.find(u => String(u.account).toLowerCase() === cleanAcc.toLowerCase());
                    const isMe = currentAccount && cleanAcc.toLowerCase() === currentAccount.toLowerCase();
                    selectedMap.set(cleanAcc, {
                        account: cleanAcc,
                        realname: found ? found.realname : (isMe ? currentUserRealname : cleanAcc),
                        isMe: isMe
                    });
                });
                renderTags();
                if (wrapper.classList.contains('is-open')) {
                    renderDropdownList(input.value.trim());
                }
                if (onChange) onChange(Array.from(selectedMap.values()));
            },
            clear: () => {
                selectedMap.clear();
                input.value = '';
                renderTags();
                if (onChange) onChange([]);
            },
            refreshMe: () => {
                if (defaultSelectCurrentUser && selectedMap.size === 0 && currentAccount) {
                    selectedMap.set(currentAccount, {
                        account: currentAccount,
                        realname: currentUserRealname || currentAccount,
                        isMe: true
                    });
                }
                renderTags();
                if (onChange) onChange(Array.from(selectedMap.values()));
            },
            resetToMe: () => {
                selectedMap.clear();
                if (currentAccount) {
                    selectedMap.set(currentAccount, {
                        account: currentAccount,
                        realname: currentUserRealname || currentAccount,
                        isMe: true
                    });
                }
                renderTags();
                if (onChange) onChange(Array.from(selectedMap.values()));
            }
        };
    }
    window.setupMultiSelectUser = setupMultiSelectUser;

    // 动态刷新任务范围类型下拉框的选项文案，支持单人或多人联动
    function updateViewTypeOptions(selectedUsers = []) {
        const sel = document.getElementById('filterViewType');
        if (!sel) return;
        const currentVal = sel.value;

        let nameText = '我';
        let allText = '我的全部任务';

        if (!selectedUsers || selectedUsers.length === 0) {
            nameText = '我 (未选默认我)';
            allText = '我的全部任务';
        } else if (selectedUsers.length === 1) {
            const u = selectedUsers[0];
            const isMe = u.isMe || (currentAccount && u.account.toLowerCase() === currentAccount.toLowerCase());
            nameText = isMe ? '我' : (u.realname || u.account);
            allText = isMe ? '我的全部任务' : `${nameText}的全部任务`;
        } else {
            // 多人模式
            if (selectedUsers.length <= 3) {
                const names = selectedUsers.map(u => {
                    const isMe = u.isMe || (currentAccount && u.account.toLowerCase() === currentAccount.toLowerCase());
                    return isMe ? '我' : (u.realname || u.account);
                });
                nameText = names.join('、');
            } else {
                const firstTwo = selectedUsers.slice(0, 2).map(u => {
                    const isMe = u.isMe || (currentAccount && u.account.toLowerCase() === currentAccount.toLowerCase());
                    return isMe ? '我' : (u.realname || u.account);
                }).join('、');
                nameText = `${firstTwo} 等${selectedUsers.length}人`;
            }
            allText = `${nameText}的全部任务`;
        }

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
    let pTabProjectSelectInstance = null;
    let pTabFinishedBySelectInstance = null;

    // 初始化多维查询的目标用户下拉选择器
    function initFilterUserSelect() {
        const wrapper = document.getElementById('filterUserWrapper');
        const box = document.getElementById('filterUserBox');
        const tagsContainer = document.getElementById('filterUserTags');
        const input = document.getElementById('filterUserInput');
        const hidden = document.getElementById('filterUserAccount');
        const clearBtn = document.getElementById('filterUserClear');
        const dropdown = document.getElementById('filterUserDropdown');

        if (!wrapper || !input || !hidden || !dropdown) return;

        if (filterUserSelectInstance) {
            filterUserSelectInstance.refreshMe();
            return;
        }

        filterUserSelectInstance = setupMultiSelectUser({
            wrapper,
            box,
            tagsContainer,
            input,
            hiddenInput: hidden,
            clearBtn,
            dropdown,
            placeholder: '输入姓名/账号搜索用户 (默认我)',
            onChange: (selectedUsers) => {
                updateViewTypeOptions(selectedUsers);
            }
        });

        // 默认初始化文案联动
        if (filterUserSelectInstance) {
            updateViewTypeOptions(filterUserSelectInstance.getSelectedUsers());
        }
    }

    // 初始化项目全量任务模块下的任务完成人多选选择器
    function initPTabFinishedBySelect() {
        const wrapper = document.getElementById('pTabFinishedByWrapper');
        const box = document.getElementById('pTabFinishedByBox');
        const tagsContainer = document.getElementById('pTabFinishedByTags');
        const input = document.getElementById('pTabFinishedByInput');
        const hidden = document.getElementById('pTabFinishedByAccount');
        const clearBtn = document.getElementById('pTabFinishedByClear');
        const dropdown = document.getElementById('pTabFinishedByDropdown');

        if (!wrapper || !input || !hidden || !dropdown) return;

        if (pTabFinishedBySelectInstance) {
            return;
        }

        pTabFinishedBySelectInstance = setupMultiSelectUser({
            wrapper,
            box,
            tagsContainer,
            input,
            hiddenInput: hidden,
            clearBtn,
            dropdown,
            placeholder: '输入姓名/账号搜索 (留空不限)',
            defaultSelectCurrentUser: false,
            onChange: null
        });
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

                const filterBox = document.getElementById('filterProjectBox');
                const filterTags = document.getElementById('filterProjectTags');

                if (filterProjectSelectInstance) {
                    filterProjectSelectInstance.updateItems(cachedProjects);
                } else if (filterWrapper && filterInput && filterHidden && filterDropdown) {
                    filterProjectSelectInstance = setupMultiSelectProject({
                        wrapper: filterWrapper,
                        box: filterBox,
                        tagsContainer: filterTags,
                        input: filterInput,
                        hiddenInput: filterHidden,
                        clearBtn: filterClear,
                        dropdown: filterDropdown,
                        items: cachedProjects,
                        placeholder: '输入名称/ID搜索项目 (全部)'
                    });
                }

                // 2. 如果当前批量修改选的是项目，也刷新动态输入框为可搜索选择器
                if (batchFieldSelect && batchFieldSelect.value === 'project') {
                    renderDynamicValueInput('project');
                }

                // 3. 初始化项目全量任务独立 Tab 的多选项目下拉组件
                const pTabWrapper = document.getElementById('pTabProjectWrapper');
                const pTabBox = document.getElementById('pTabProjectBox');
                const pTabTags = document.getElementById('pTabProjectTags');
                const pTabInput = document.getElementById('pTabProjectInput');
                const pTabHidden = document.getElementById('pTabProjectId');
                const pTabClear = document.getElementById('pTabProjectClear');
                const pTabDropdown = document.getElementById('pTabProjectDropdown');

                if (pTabProjectSelectInstance) {
                    pTabProjectSelectInstance.updateItems(cachedProjects);
                } else if (pTabWrapper && pTabInput && pTabHidden && pTabDropdown) {
                    pTabProjectSelectInstance = setupMultiSelectProject({
                        wrapper: pTabWrapper,
                        box: pTabBox,
                        tagsContainer: pTabTags,
                        input: pTabInput,
                        hiddenInput: pTabHidden,
                        clearBtn: pTabClear,
                        dropdown: pTabDropdown,
                        items: cachedProjects,
                        placeholder: '输入名称/ID搜索项目 (可多选)'
                    });
                }

                // 4. 如果项目全量任务Tab当前批量修改选的是项目，也刷新动态输入框为可搜索选择器
                if (typeof pTabBatchFieldSelect !== 'undefined' && pTabBatchFieldSelect && pTabBatchFieldSelect.value === 'project') {
                    renderPTabDynamicValueInput('project');
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

    // ==========================================
    // 团队分组与成员管理 (Group & Members Logic)
    // ==========================================
    let cachedGroups = [];
    let activeGroupId = null;
    let editingGroupMembers = [];

    // 候选待添加成员映射表 (account -> { account, realname })
    let pendingAddCandidateMap = new Map();
    let gmUserSearchTimer = null;
    let isGmUserComposing = false;

    const userGroupSelect = document.getElementById('userGroupSelect');
    const pTabGroupSelect = document.getElementById('pTabGroupSelect');
    const groupManageModal = document.getElementById('groupManageModal');
    const groupManageModalCloseBtn = document.getElementById('groupManageModalCloseBtn');
    const groupManageModalDoneBtn = document.getElementById('groupManageModalDoneBtn');
    const btnTopManageGroups = document.getElementById('btnTopManageGroups');
    const btnManageGroups = document.getElementById('btnManageGroups');
    const btnPTabManageGroups = document.getElementById('btnPTabManageGroups');

    const groupListContainer = document.getElementById('groupListContainer');
    const btnAddNewGroup = document.getElementById('btnAddNewGroup');
    const groupEmptyNotice = document.getElementById('groupEmptyNotice');
    const groupEditorPanel = document.getElementById('groupEditorPanel');

    const gmGroupName = document.getElementById('gmGroupName');
    const gmMemberCount = document.getElementById('gmMemberCount');
    const gmMemberTagsContainer = document.getElementById('gmMemberTagsContainer');

    // 可搜索多选添加成员组件
    const gmAddUserWrapper = document.getElementById('gmAddUserWrapper');
    const gmAddUserInput = document.getElementById('gmAddUserInput');
    const gmAddUserClear = document.getElementById('gmAddUserClear');
    const gmAddUserArrow = document.getElementById('gmAddUserArrow');
    const gmAddUserDropdown = document.getElementById('gmAddUserDropdown');
    const gmCandidateHeaderCount = document.getElementById('gmCandidateHeaderCount');
    const btnGmCandidateSelectAll = document.getElementById('btnGmCandidateSelectAll');
    const btnGmCandidateDeselectAll = document.getElementById('btnGmCandidateDeselectAll');
    const gmCandidateList = document.getElementById('gmCandidateList');
    const btnGmAddMember = document.getElementById('btnGmAddMember');
    const btnGmAddCount = document.getElementById('btnGmAddCount');
    const gmPendingBar = document.getElementById('gmPendingBar');
    const gmPendingTags = document.getElementById('gmPendingTags');
    const btnGmPendingClear = document.getElementById('btnGmPendingClear');

    const btnDeleteCurrentGroup = document.getElementById('btnDeleteCurrentGroup');
    const btnSaveCurrentGroup = document.getElementById('btnSaveCurrentGroup');

    async function loadGroups() {
        try {
            const res = await fetch(apiUrl('/api/groups'));
            const data = await res.json();
            if (data.success && Array.isArray(data.groups)) {
                cachedGroups = data.groups;
                renderGroupSelects();
            }
        } catch (e) {
            console.error('加载团队分组失败:', e);
        }
    }

    function renderGroupSelects() {
        const optionsHtml = '<option value="">👥 选择团队分组...</option>' +
            cachedGroups.map(g => `<option value="${g.id}">👥 ${escapeHtml(g.name)} (${(g.members || []).length}人)</option>`).join('');

        if (userGroupSelect) userGroupSelect.innerHTML = optionsHtml;
        if (pTabGroupSelect) pTabGroupSelect.innerHTML = optionsHtml;
    }

    if (userGroupSelect) {
        userGroupSelect.addEventListener('change', (e) => {
            const gid = e.target.value;
            if (!gid) return;
            const grp = cachedGroups.find(g => g.id === gid);
            if (grp && filterUserSelectInstance) {
                filterUserSelectInstance.setSelectedUsers(grp.members || []);
            }
        });
    }

    if (pTabGroupSelect) {
        pTabGroupSelect.addEventListener('change', (e) => {
            const gid = e.target.value;
            if (!gid) return;
            const grp = cachedGroups.find(g => g.id === gid);
            if (grp && pTabFinishedBySelectInstance) {
                pTabFinishedBySelectInstance.setSelectedUsers(grp.members || []);
            }
        });
    }

    function renderGroupModalList() {
        if (!groupListContainer) return;
        if (!cachedGroups || cachedGroups.length === 0) {
            groupListContainer.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 24px 8px; font-size: 12px;">暂无分组<br>点击上方“➕ 新增”</div>';
            return;
        }
        let html = '';
        cachedGroups.forEach(g => {
            const count = (g.members || []).length;
            const isActive = g.id === activeGroupId;
            html += `
                <div class="group-list-item ${isActive ? 'active' : ''}" data-id="${g.id}">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;" title="${escapeHtml(g.name)}">👥 ${escapeHtml(g.name)}</span>
                    <span class="group-item-badge">${count}人</span>
                </div>
            `;
        });
        groupListContainer.innerHTML = html;
    }

    function showEmptyGroupEditor() {
        activeGroupId = null;
        editingGroupMembers = [];
        if (groupEmptyNotice) groupEmptyNotice.style.display = 'block';
        if (groupEditorPanel) groupEditorPanel.style.display = 'none';
    }

    function renderMemberTags() {
        if (!gmMemberTagsContainer) return;
        if (gmMemberCount) gmMemberCount.textContent = editingGroupMembers.length;

        if (editingGroupMembers.length === 0) {
            gmMemberTagsContainer.innerHTML = '<span style="color: #94a3b8; font-size: 12px; margin: auto;">该分组暂无成员，请在下方选择用户添加</span>';
            return;
        }

        let html = '';
        editingGroupMembers.forEach(m => {
            html += `
                <span class="group-member-tag">
                    <span>${escapeHtml(m.realname || m.account)} (${escapeHtml(m.account)})</span>
                    <span class="group-member-remove" data-account="${escapeHtml(m.account)}" title="移除此成员">&times;</span>
                </span>
            `;
        });
        gmMemberTagsContainer.innerHTML = html;
    }

    function highlightGmMatch(text, keyword) {
        if (!keyword || !text) return escapeHtml(text || '');
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

    function renderGmPendingBar() {
        const count = pendingAddCandidateMap.size;
        if (btnGmAddCount) btnGmAddCount.textContent = count;
        if (gmCandidateHeaderCount) gmCandidateHeaderCount.textContent = count;

        if (!gmPendingBar || !gmPendingTags) return;
        if (count === 0) {
            gmPendingBar.style.display = 'none';
            gmPendingTags.innerHTML = '';
            return;
        }
        gmPendingBar.style.display = 'flex';
        let html = '';
        pendingAddCandidateMap.forEach((u, acc) => {
            html += `
                <span class="gm-pending-tag" data-account="${escapeHtml(acc)}">
                    <span>${escapeHtml(u.realname || acc)}</span>
                    <span class="gm-pending-tag-remove" data-account="${escapeHtml(acc)}" title="取消勾选">&times;</span>
                </span>
            `;
        });
        gmPendingTags.innerHTML = html;
    }

    function renderGmCandidateList(keyword = '') {
        if (!gmCandidateList) return;
        const kw = keyword.trim().toLowerCase();

        const existingAccounts = new Set(
            editingGroupMembers.map(m => String(m.account).toLowerCase())
        );

        let matched = cachedUsers.filter(u => {
            if (!kw) return true;
            const acc = String(u.account || '').toLowerCase();
            const name = String(u.realname || '').toLowerCase();
            return acc.includes(kw) || name.includes(kw);
        });

        if (cachedUsers.length === 0) {
            gmCandidateList.innerHTML = `<div class="searchable-select-empty" style="color: #2563eb;">⏳ 正在加载用户库...</div>`;
            return;
        }

        if (matched.length === 0) {
            gmCandidateList.innerHTML = `<div class="searchable-select-empty">未找到匹配「${escapeHtml(keyword)}」的用户</div>`;
            return;
        }

        matched.sort((a, b) => {
            const aIn = existingAccounts.has(String(a.account).toLowerCase());
            const bIn = existingAccounts.has(String(b.account).toLowerCase());
            if (aIn !== bIn) return aIn ? 1 : -1;

            const aChecked = pendingAddCandidateMap.has(String(a.account));
            const bChecked = pendingAddCandidateMap.has(String(b.account));
            if (aChecked !== bChecked) return aChecked ? -1 : 1;

            return (a.realname || a.account).localeCompare(b.realname || b.account, 'zh');
        });

        const displayList = matched.slice(0, 150);

        let html = '';
        displayList.forEach(u => {
            const acc = String(u.account);
            const name = u.realname || acc;
            const isInGroup = existingAccounts.has(acc.toLowerCase());
            const isChecked = pendingAddCandidateMap.has(acc);

            if (isInGroup) {
                html += `
                    <div class="searchable-select-item is-in-group" data-account="${escapeHtml(acc)}" title="该用户已是当前组成员">
                        <span class="item-checkbox" style="opacity: 0.3;">-</span>
                        <span class="item-id-badge">@${escapeHtml(acc)}</span>
                        <span class="item-name">${escapeHtml(name)}</span>
                        <span class="in-group-badge">✓ 已在组内</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="searchable-select-item ${isChecked ? 'is-selected' : ''}" data-account="${escapeHtml(acc)}" data-realname="${escapeHtml(name)}">
                        <span class="item-checkbox">${isChecked ? '✓' : ''}</span>
                        <span class="item-id-badge" style="background: #eff6ff; color: #2563eb; font-weight: 600;">@${highlightGmMatch(acc, keyword)}</span>
                        <span class="item-name">${highlightGmMatch(name, keyword)}</span>
                    </div>
                `;
            }
        });

        if (matched.length > 150) {
            html += `<div class="searchable-select-empty" style="font-size: 11px; color: #94a3b8;">还有 ${matched.length - 150} 位候选人，请输入更精确的关键字</div>`;
        }

        gmCandidateList.innerHTML = html;
    }

    function openGmDropdown() {
        if (!gmAddUserWrapper || !gmAddUserDropdown) return;
        gmAddUserWrapper.classList.add('is-open');
        gmAddUserDropdown.style.display = 'flex';
        renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
    }

    function closeGmDropdown() {
        if (!gmAddUserWrapper || !gmAddUserDropdown) return;
        gmAddUserWrapper.classList.remove('is-open');
        gmAddUserDropdown.style.display = 'none';
    }

    function toggleGmDropdown() {
        if (gmAddUserWrapper && gmAddUserWrapper.classList.contains('is-open')) {
            closeGmDropdown();
        } else {
            openGmDropdown();
            if (gmAddUserInput) gmAddUserInput.focus();
        }
    }

    function selectGroupForEdit(groupId) {
        const grp = cachedGroups.find(g => g.id === groupId);
        if (!grp) {
            showEmptyGroupEditor();
            return;
        }
        activeGroupId = grp.id;
        editingGroupMembers = (grp.members || []).map(m => ({ account: m.account, realname: m.realname || m.account }));

        pendingAddCandidateMap.clear();
        if (gmAddUserInput) gmAddUserInput.value = '';
        if (gmAddUserClear) gmAddUserClear.style.display = 'none';
        renderGmPendingBar();
        closeGmDropdown();

        if (groupEmptyNotice) groupEmptyNotice.style.display = 'none';
        if (groupEditorPanel) groupEditorPanel.style.display = 'block';

        if (gmGroupName) gmGroupName.value = grp.name || '';
        renderMemberTags();
        renderGroupModalList();
    }

    async function openGroupManageModal(selectGroupId = null) {
        if (!groupManageModal) return;
        groupManageModal.style.display = 'flex';

        pendingAddCandidateMap.clear();
        if (gmAddUserInput) gmAddUserInput.value = '';
        if (gmAddUserClear) gmAddUserClear.style.display = 'none';
        renderGmPendingBar();
        closeGmDropdown();

        // 确保用户列表已加载
        if (cachedUsers.length === 0) {
            await loadUsers();
        }

        renderGroupModalList();

        if (selectGroupId && cachedGroups.some(g => g.id === selectGroupId)) {
            selectGroupForEdit(selectGroupId);
        } else if (cachedGroups.length > 0) {
            selectGroupForEdit(cachedGroups[0].id);
        } else {
            showEmptyGroupEditor();
        }
    }

    function closeGroupManageModal() {
        if (groupManageModal) groupManageModal.style.display = 'none';
        pendingAddCandidateMap.clear();
        if (gmAddUserInput) gmAddUserInput.value = '';
        if (gmAddUserClear) gmAddUserClear.style.display = 'none';
        renderGmPendingBar();
        closeGmDropdown();
        // 清理未保存的临时草稿分组
        cachedGroups = cachedGroups.filter(g => !String(g.id).startsWith('temp_'));
        renderGroupSelects();
    }

    function addNewGroup() {
        const tempId = 'temp_' + Date.now();
        const newGrp = {
            id: tempId,
            name: '新建分组',
            members: []
        };
        cachedGroups.unshift(newGrp);
        activeGroupId = tempId;
        editingGroupMembers = [];

        pendingAddCandidateMap.clear();
        if (gmAddUserInput) gmAddUserInput.value = '';
        if (gmAddUserClear) gmAddUserClear.style.display = 'none';
        renderGmPendingBar();
        closeGmDropdown();

        if (groupEmptyNotice) groupEmptyNotice.style.display = 'none';
        if (groupEditorPanel) groupEditorPanel.style.display = 'block';
        if (gmGroupName) {
            gmGroupName.value = newGrp.name;
            gmGroupName.focus();
            gmGroupName.select();
        }
        renderMemberTags();
        renderGroupModalList();
    }

    function addMemberToGroup() {
        if (pendingAddCandidateMap.size === 0) {
            const kw = gmAddUserInput ? gmAddUserInput.value.trim().toLowerCase() : '';
            if (kw) {
                const existingAccounts = new Set(editingGroupMembers.map(m => String(m.account).toLowerCase()));
                const candidateMatches = cachedUsers.filter(u => {
                    const acc = String(u.account || '').toLowerCase();
                    const name = String(u.realname || '').toLowerCase();
                    return (acc.includes(kw) || name.includes(kw)) && !existingAccounts.has(acc);
                });
                if (candidateMatches.length === 1) {
                    const single = candidateMatches[0];
                    pendingAddCandidateMap.set(String(single.account), {
                        account: String(single.account),
                        realname: single.realname || single.account
                    });
                } else if (candidateMatches.length > 1) {
                    alert(`搜索结果共有 ${candidateMatches.length} 位候选成员，请在列表中勾选要加入的人员！`);
                    if (gmAddUserInput) {
                        gmAddUserInput.focus();
                        openGmDropdown();
                    }
                    return;
                } else {
                    alert('未找到可加入当前分组的匹配成员！');
                    if (gmAddUserInput) {
                        gmAddUserInput.focus();
                        openGmDropdown();
                    }
                    return;
                }
            } else {
                alert('请在候选列表中勾选要加入分组的成员！');
                if (gmAddUserInput) {
                    gmAddUserInput.focus();
                    openGmDropdown();
                }
                return;
            }
        }

        const existingAccounts = new Set(editingGroupMembers.map(m => String(m.account).toLowerCase()));
        let addedCount = 0;
        pendingAddCandidateMap.forEach((u, acc) => {
            if (!existingAccounts.has(acc.toLowerCase())) {
                editingGroupMembers.push({ account: acc, realname: u.realname || acc });
                addedCount++;
            }
        });

        pendingAddCandidateMap.clear();
        if (gmAddUserInput) gmAddUserInput.value = '';
        if (gmAddUserClear) gmAddUserClear.style.display = 'none';
        renderGmPendingBar();
        renderMemberTags();
        renderGroupModalList();

        if (gmAddUserWrapper && gmAddUserWrapper.classList.contains('is-open')) {
            renderGmCandidateList('');
        }
    }

    async function saveCurrentGroup() {
        const name = gmGroupName ? gmGroupName.value.trim() : '';
        if (!name) {
            alert('分组名称不能为空！');
            if (gmGroupName) gmGroupName.focus();
            return;
        }

        showLoading('正在保存分组配置...');
        try {
            const isTemp = !activeGroupId || String(activeGroupId).startsWith('temp_');
            const res = await fetch(apiUrl('/api/groups'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: isTemp ? '' : activeGroupId,
                    name: name,
                    members: editingGroupMembers
                })
            });
            const data = await res.json();
            hideLoading();
            if (data.success) {
                cachedGroups = data.groups || [];
                activeGroupId = data.group_id;
                renderGroupSelects();
                renderGroupModalList();
                selectGroupForEdit(activeGroupId);
                alert('分组保存成功！');
            } else {
                alert('保存失败: ' + (data.message || '未知错误'));
            }
        } catch (e) {
            hideLoading();
            alert('保存分组网络请求异常: ' + e);
        }
    }

    async function deleteCurrentGroup() {
        if (!activeGroupId) return;
        if (String(activeGroupId).startsWith('temp_')) {
            cachedGroups = cachedGroups.filter(g => g.id !== activeGroupId);
            if (cachedGroups.length > 0) {
                selectGroupForEdit(cachedGroups[0].id);
            } else {
                showEmptyGroupEditor();
            }
            renderGroupModalList();
            return;
        }

        const name = gmGroupName ? gmGroupName.value : '此分组';
        if (!confirm(`确定要删除分组「${name}」吗？`)) return;

        showLoading('正在删除分组...');
        try {
            const res = await fetch(apiUrl(`/api/groups/${activeGroupId}`), {
                method: 'DELETE'
            });
            const data = await res.json();
            hideLoading();
            if (data.success) {
                cachedGroups = data.groups || [];
                renderGroupSelects();
                if (cachedGroups.length > 0) {
                    selectGroupForEdit(cachedGroups[0].id);
                } else {
                    showEmptyGroupEditor();
                }
                renderGroupModalList();
                alert('分组已删除！');
            } else {
                alert('删除失败: ' + (data.message || '未知错误'));
            }
        } catch (e) {
            hideLoading();
            alert('删除分组网络请求异常: ' + e);
        }
    }

    // 绑定分组弹窗内部事件
    if (btnTopManageGroups) btnTopManageGroups.onclick = () => openGroupManageModal();
    if (btnManageGroups) btnManageGroups.onclick = () => openGroupManageModal(userGroupSelect ? userGroupSelect.value : null);
    if (btnPTabManageGroups) btnPTabManageGroups.onclick = () => openGroupManageModal(pTabGroupSelect ? pTabGroupSelect.value : null);
    if (groupManageModalCloseBtn) groupManageModalCloseBtn.onclick = closeGroupManageModal;
    if (groupManageModalDoneBtn) groupManageModalDoneBtn.onclick = closeGroupManageModal;
    if (btnAddNewGroup) btnAddNewGroup.onclick = addNewGroup;
    if (btnGmAddMember) btnGmAddMember.onclick = addMemberToGroup;
    if (btnSaveCurrentGroup) btnSaveCurrentGroup.onclick = saveCurrentGroup;
    if (btnDeleteCurrentGroup) btnDeleteCurrentGroup.onclick = deleteCurrentGroup;

    // 可搜索多选添加成员事件绑定
    if (gmAddUserInput) {
        gmAddUserInput.addEventListener('focus', () => {
            openGmDropdown();
        });

        gmAddUserInput.addEventListener('compositionstart', () => {
            isGmUserComposing = true;
        });

        gmAddUserInput.addEventListener('compositionend', () => {
            isGmUserComposing = false;
            if (gmAddUserClear) {
                gmAddUserClear.style.display = gmAddUserInput.value ? 'block' : 'none';
            }
            if (gmUserSearchTimer) clearTimeout(gmUserSearchTimer);
            gmUserSearchTimer = setTimeout(() => {
                renderGmCandidateList(gmAddUserInput.value);
            }, 80);
        });

        gmAddUserInput.addEventListener('input', () => {
            if (!gmAddUserWrapper.classList.contains('is-open')) {
                openGmDropdown();
            }
            if (gmAddUserClear) {
                gmAddUserClear.style.display = gmAddUserInput.value ? 'block' : 'none';
            }
            if (isGmUserComposing) return;
            if (gmUserSearchTimer) clearTimeout(gmUserSearchTimer);
            gmUserSearchTimer = setTimeout(() => {
                renderGmCandidateList(gmAddUserInput.value);
            }, 80);
        });

        gmAddUserInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeGmDropdown();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                addMemberToGroup();
            }
        });
    }

    if (gmAddUserClear) {
        gmAddUserClear.addEventListener('click', (e) => {
            e.stopPropagation();
            if (gmAddUserInput) {
                gmAddUserInput.value = '';
                gmAddUserInput.focus();
            }
            gmAddUserClear.style.display = 'none';
            renderGmCandidateList('');
        });
    }

    if (gmAddUserArrow) {
        gmAddUserArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGmDropdown();
        });
    }

    if (gmCandidateList) {
        gmCandidateList.addEventListener('mousedown', (e) => {
            const itemEl = e.target.closest('.searchable-select-item');
            if (!itemEl || itemEl.classList.contains('is-in-group')) return;
            e.preventDefault();

            const acc = itemEl.getAttribute('data-account');
            const realname = itemEl.getAttribute('data-realname') || acc;
            if (!acc) return;

            if (pendingAddCandidateMap.has(acc)) {
                pendingAddCandidateMap.delete(acc);
                itemEl.classList.remove('is-selected');
                const cb = itemEl.querySelector('.item-checkbox');
                if (cb) cb.textContent = '';
            } else {
                pendingAddCandidateMap.set(acc, { account: acc, realname: realname });
                itemEl.classList.add('is-selected');
                const cb = itemEl.querySelector('.item-checkbox');
                if (cb) cb.textContent = '✓';
            }

            renderGmPendingBar();
            if (gmAddUserInput) gmAddUserInput.focus();
        });
    }

    if (btnGmCandidateSelectAll) {
        btnGmCandidateSelectAll.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const kw = gmAddUserInput ? gmAddUserInput.value.trim().toLowerCase() : '';
            const existingAccounts = new Set(
                editingGroupMembers.map(m => String(m.account).toLowerCase())
            );

            cachedUsers.forEach(u => {
                const acc = String(u.account || '');
                const name = String(u.realname || '');
                if (!acc || existingAccounts.has(acc.toLowerCase())) return;
                if (kw && !acc.toLowerCase().includes(kw) && !name.toLowerCase().includes(kw)) return;

                pendingAddCandidateMap.set(acc, { account: acc, realname: name || acc });
            });

            renderGmPendingBar();
            renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
        });
    }

    if (btnGmCandidateDeselectAll) {
        btnGmCandidateDeselectAll.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            pendingAddCandidateMap.clear();
            renderGmPendingBar();
            renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
        });
    }

    if (gmPendingTags) {
        gmPendingTags.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.gm-pending-tag-remove');
            if (removeBtn) {
                const acc = removeBtn.getAttribute('data-account');
                if (acc && pendingAddCandidateMap.has(acc)) {
                    pendingAddCandidateMap.delete(acc);
                    renderGmPendingBar();
                    if (gmAddUserWrapper && gmAddUserWrapper.classList.contains('is-open')) {
                        renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
                    }
                }
            }
        });
    }

    if (btnGmPendingClear) {
        btnGmPendingClear.addEventListener('click', () => {
            pendingAddCandidateMap.clear();
            renderGmPendingBar();
            if (gmAddUserWrapper && gmAddUserWrapper.classList.contains('is-open')) {
                renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (gmAddUserWrapper && !gmAddUserWrapper.contains(e.target) && !e.target.closest('#btnGmAddMember')) {
            closeGmDropdown();
        }
    });

    if (groupListContainer) {
        groupListContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.group-list-item');
            if (item) {
                const gid = item.getAttribute('data-id');
                if (gid) selectGroupForEdit(gid);
            }
        });
    }

    if (gmMemberTagsContainer) {
        gmMemberTagsContainer.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.group-member-remove');
            if (removeBtn) {
                const acc = removeBtn.getAttribute('data-account');
                editingGroupMembers = editingGroupMembers.filter(m => String(m.account).toLowerCase() !== String(acc).toLowerCase());
                renderMemberTags();
                renderGroupModalList();
                if (gmAddUserWrapper && gmAddUserWrapper.classList.contains('is-open')) {
                    renderGmCandidateList(gmAddUserInput ? gmAddUserInput.value : '');
                }
            }
        });
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
            } else if (targetId === 'tab-gitee-commits') {
                initGiteeModule();
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
                <select id="nameModeSelect" class="form-control" style="width: 115px;">
                    <option value="direct" selected>统一重命名</option>
                    <option value="prefix">添加前缀</option>
                    <option value="suffix">添加后缀</option>
                    <option value="replace">文本替换</option>
                </select>
                <div id="nameInputsContainer" style="display:inline-flex; align-items:center; gap:6px;">
                    <input type="text" id="fieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="width: 210px; max-width: 260px;">
                </div>
                <label class="checkbox-label" style="display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#475569; cursor:pointer; user-select:none; margin-left:4px; white-space:nowrap;" title="勾选后，任务描述将同步更新为与新任务名称一致">
                    <input type="checkbox" id="syncDescCheckbox" checked>
                    <span>同步修改描述</span>
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
        } else if (fieldName === 'finishedBy') {
            html = `
                <select id="fieldValueInput" class="form-control" style="min-width: 170px;">
                    <option value="${currentAccount}" selected>改为当前用户 (${userRealname.textContent || currentAccount})</option>
                    <option value="__custom__">选择其他用户 (搜索/下拉)...</option>
                    <option value="">置空 (无完成人)</option>
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
            nameModeSelect.addEventListener('change', (e) => {
                e.stopPropagation();
                const mode = nameModeSelect.value;
                if (mode === 'direct') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="width: 210px; max-width: 260px;">`;
                } else if (mode === 'prefix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入前缀 (如 【2026】)" style="width: 180px;">`;
                } else if (mode === 'suffix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="fieldValueInput" class="form-control" placeholder="输入后缀 (如 -已评审)" style="width: 180px;">`;
                } else if (mode === 'replace') {
                    nameInputsContainer.innerHTML = `
                        <input type="text" id="replaceFromInput" class="form-control" placeholder="原词" style="width: 100px;">
                        <span style="color:#64748b; font-weight:bold;">➔</span>
                        <input type="text" id="fieldValueInput" class="form-control" placeholder="替换为新词 (留空则删除)" style="width: 140px;">
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

    batchFieldSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        renderDynamicValueInput(batchFieldSelect.value);
    });

    // 6. 模块二：自定义查询
    btnSearch.onclick = async () => {
        const selectedUsers = filterUserSelectInstance
            ? filterUserSelectInstance.getSelectedUsers()
            : [];
        const selectedAccounts = selectedUsers.map(u => u.account).filter(Boolean);
        const selectedRealnames = selectedUsers.map(u => u.realname || u.account).filter(Boolean);

        const selectedProjectIds = filterProjectSelectInstance
            ? filterProjectSelectInstance.getSelectedIds()
            : (document.getElementById('filterProjectId')?.value || '').split(',').filter(Boolean);

        const params = {
            target_accounts: selectedAccounts,
            target_account: selectedAccounts[0] || currentAccount,
            target_realnames: selectedRealnames,
            target_realname: selectedRealnames[0] || currentUserRealname || currentAccount,
            view_type: document.getElementById('filterViewType').value,
            year: document.getElementById('filterYear').value.trim(),
            status: document.getElementById('filterStatus').value,
            project_ids: selectedProjectIds,
            project_id: selectedProjectIds[0] || '',
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

    // -------------------------------------------------------------
    // 模块：项目全量任务检索 (独立功能 Tab)
    // -------------------------------------------------------------
    let currentProjectTasks = [];
    let pTabSelectedTaskIds = new Set();

    const btnSearchProjectTasks = document.getElementById('btnSearchProjectTasks');
    const projectTasksTableBody = document.getElementById('projectTasksTableBody');
    const checkAllProjectRows = document.getElementById('checkAllProjectRows');
    const projectTasksBadge = document.getElementById('projectTasksBadge');
    const projectTasksTotalBadge = document.getElementById('projectTasksTotalBadge');
    const pTabSummaryBar = document.getElementById('pTabSummaryBar');

    function updatePTabSelectedCount() {
        const count = pTabSelectedTaskIds.size;
        const selCountEl = document.getElementById('pTabSelectedCount');
        if (selCountEl) {
            selCountEl.textContent = count;
        }
        const summaryCountEl = document.getElementById('pTabSummarySelectedCount');
        if (summaryCountEl) {
            summaryCountEl.textContent = count;
        }
        if (checkAllProjectRows) {
            const total = currentProjectTasks.length;
            if (total === 0 || count === 0) {
                checkAllProjectRows.checked = false;
                checkAllProjectRows.indeterminate = false;
            } else if (count === total) {
                checkAllProjectRows.checked = true;
                checkAllProjectRows.indeterminate = false;
            } else {
                checkAllProjectRows.checked = false;
                checkAllProjectRows.indeterminate = true;
            }
        }
    }

    if (checkAllProjectRows) {
        checkAllProjectRows.addEventListener('change', () => {
            const isChecked = checkAllProjectRows.checked;
            pTabSelectedTaskIds.clear();
            if (isChecked) {
                currentProjectTasks.forEach(t => pTabSelectedTaskIds.add(String(t.id)));
            }
            document.querySelectorAll('.ptab-task-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
            updatePTabSelectedCount();
        });
    }

    const btnPTabSelectAll = document.getElementById('btnPTabSelectAll');
    const btnPTabDeselectAll = document.getElementById('btnPTabDeselectAll');
    const pTabBatchFieldSelect = document.getElementById('pTabBatchFieldSelect');
    const btnPTabExecuteBatchUpdate = document.getElementById('btnPTabExecuteBatchUpdate');

    if (btnPTabSelectAll) {
        btnPTabSelectAll.onclick = () => {
            pTabSelectedTaskIds.clear();
            currentProjectTasks.forEach(t => pTabSelectedTaskIds.add(String(t.id)));
            document.querySelectorAll('.ptab-task-checkbox').forEach(cb => {
                cb.checked = true;
            });
            updatePTabSelectedCount();
        };
    }

    if (btnPTabDeselectAll) {
        btnPTabDeselectAll.onclick = () => {
            pTabSelectedTaskIds.clear();
            document.querySelectorAll('.ptab-task-checkbox').forEach(cb => {
                cb.checked = false;
            });
            updatePTabSelectedCount();
        };
    }

    function renderPTabDynamicValueInput(fieldName) {
        const container = document.getElementById('pTabDynamicValueContainer');
        if (!container) return;
        let html = '';
        if (fieldName === 'name') {
            html = `
                <select id="pTabNameModeSelect" class="form-control" style="width: 115px;">
                    <option value="direct" selected>统一重命名</option>
                    <option value="prefix">添加前缀</option>
                    <option value="suffix">添加后缀</option>
                    <option value="replace">文本替换</option>
                </select>
                <div id="pTabNameInputsContainer" style="display:inline-flex; align-items:center; gap:6px;">
                    <input type="text" id="pTabFieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="width: 210px; max-width: 260px;">
                </div>
                <label class="checkbox-label" style="display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#475569; cursor:pointer; user-select:none; margin-left:4px; white-space:nowrap;" title="勾选后，任务描述将同步更新为与新任务名称一致">
                    <input type="checkbox" id="pTabSyncDescCheckbox" checked>
                    <span>同步修改描述</span>
                </label>
            `;
        } else if (fieldName === 'assignedTo') {
            html = `
                <select id="pTabFieldValueInput" class="form-control" style="min-width: 170px;">
                    <option value="closed" selected>Closed (已关闭锁定)</option>
                    <option value="${currentAccount}">指派给当前用户 (${currentUserRealname || currentAccount})</option>
                    <option value="">未指派 (置空)</option>
                    <option value="__custom__">自定义输入其他账号 (搜索/下拉)...</option>
                </select>
                <div class="searchable-select-wrapper" id="pTabCustomUserWrapper" style="display:none; min-width: 220px; max-width: 320px;">
                    <input type="text" id="pTabCustomUserInput" class="form-control searchable-select-input" placeholder="输入姓名/账号搜索用户..." autocomplete="off">
                    <input type="hidden" id="pTabCustomUserHidden" value="">
                    <button type="button" class="searchable-select-clear" id="pTabCustomUserClear" title="清除" style="display: none;">&times;</button>
                    <span class="searchable-select-arrow">▼</span>
                    <div class="searchable-select-dropdown" id="pTabCustomUserDropdown" style="display: none;">
                        <!-- 动态渲染用户列表 -->
                    </div>
                </div>
            `;
        } else if (fieldName === 'finishedBy') {
            html = `
                <select id="pTabFieldValueInput" class="form-control" style="min-width: 170px;">
                    <option value="${currentAccount}" selected>改为当前用户 (${currentUserRealname || currentAccount})</option>
                    <option value="__custom__">选择其他用户 (搜索/下拉)...</option>
                    <option value="">置空 (无完成人)</option>
                </select>
                <div class="searchable-select-wrapper" id="pTabCustomUserWrapper" style="display:none; min-width: 220px; max-width: 320px;">
                    <input type="text" id="pTabCustomUserInput" class="form-control searchable-select-input" placeholder="输入姓名/账号搜索用户..." autocomplete="off">
                    <input type="hidden" id="pTabCustomUserHidden" value="">
                    <button type="button" class="searchable-select-clear" id="pTabCustomUserClear" title="清除" style="display: none;">&times;</button>
                    <span class="searchable-select-arrow">▼</span>
                    <div class="searchable-select-dropdown" id="pTabCustomUserDropdown" style="display: none;">
                        <!-- 动态渲染用户列表 -->
                    </div>
                </div>
            `;
        } else if (fieldName === 'status') {
            html = `
                <select id="pTabFieldValueInput" class="form-control" style="min-width: 150px;">
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
                <div class="searchable-select-wrapper" id="pTabBatchProjectWrapper" style="min-width: 240px; max-width: 340px;">
                    <input type="text" id="pTabBatchProjectInput" class="form-control searchable-select-input" placeholder="输入关键字搜索目标项目..." autocomplete="off">
                    <input type="hidden" id="pTabFieldValueInput" value="${firstProj.id}">
                    <button type="button" class="searchable-select-clear" id="pTabBatchProjectClear" title="清除" style="display: none;">&times;</button>
                    <span class="searchable-select-arrow">▼</span>
                    <div class="searchable-select-dropdown" id="pTabBatchProjectDropdown" style="display: none;">
                        <!-- 动态渲染项目列表 -->
                    </div>
                </div>
            `;
        } else if (fieldName === 'execution') {
            html = `<input type="number" id="pTabFieldValueInput" class="form-control" placeholder="目标执行/迭代 ID (如 203)" style="width:180px;">`;
        } else if (fieldName === 'estimate') {
            html = `<input type="number" step="0.5" id="pTabFieldValueInput" class="form-control" placeholder="工时(小时，如 2.0)" style="width:150px;">`;
        } else if (fieldName === 'pri') {
            html = `
                <select id="pTabFieldValueInput" class="form-control" style="min-width: 120px;">
                    <option value="1">1 (最高)</option>
                    <option value="2">2 (高)</option>
                    <option value="3" selected>3 (中)</option>
                    <option value="4">4 (低)</option>
                </select>
            `;
        } else if (fieldName === 'deadline') {
            html = `<input type="date" id="pTabFieldValueInput" class="form-control" style="width:160px;">`;
        }

        container.innerHTML = html;

        // 任务名称模式切换联动
        const nameModeSelect = document.getElementById('pTabNameModeSelect');
        const nameInputsContainer = document.getElementById('pTabNameInputsContainer');
        if (nameModeSelect && nameInputsContainer) {
            nameModeSelect.addEventListener('change', (e) => {
                e.stopPropagation();
                const mode = nameModeSelect.value;
                if (mode === 'direct') {
                    nameInputsContainer.innerHTML = `<input type="text" id="pTabFieldValueInput" class="form-control" placeholder="输入统一的新任务名称" style="width: 210px; max-width: 260px;">`;
                } else if (mode === 'prefix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="pTabFieldValueInput" class="form-control" placeholder="输入前缀 (如 【2026】)" style="width: 180px;">`;
                } else if (mode === 'suffix') {
                    nameInputsContainer.innerHTML = `<input type="text" id="pTabFieldValueInput" class="form-control" placeholder="输入后缀 (如 -已评审)" style="width: 180px;">`;
                } else if (mode === 'replace') {
                    nameInputsContainer.innerHTML = `
                        <input type="text" id="pTabReplaceFromInput" class="form-control" placeholder="原词" style="width: 100px;">
                        <span style="color:#64748b; font-weight:bold;">➔</span>
                        <input type="text" id="pTabFieldValueInput" class="form-control" placeholder="替换为新词 (留空则删除)" style="width: 140px;">
                    `;
                }
            });
        }

        // 如果是所属项目字段，初始化目标项目可搜索下拉选择组件
        if (fieldName === 'project') {
            const firstProj = (cachedProjects && cachedProjects.length > 0) ? cachedProjects[0] : null;
            setupSearchableProjectSelect({
                wrapper: document.getElementById('pTabBatchProjectWrapper'),
                input: document.getElementById('pTabBatchProjectInput'),
                hiddenInput: document.getElementById('pTabFieldValueInput'),
                clearBtn: document.getElementById('pTabBatchProjectClear'),
                dropdown: document.getElementById('pTabBatchProjectDropdown'),
                items: cachedProjects,
                includeAll: false,
                defaultId: firstProj ? firstProj.id : '',
                placeholder: '输入关键字搜索目标项目...'
            });
        }

        // 如果是指派给，支持自定义切换为支持搜索的下拉选择框
        const valSelect = document.getElementById('pTabFieldValueInput');
        const customUserWrapper = document.getElementById('pTabCustomUserWrapper');
        if (valSelect && customUserWrapper && valSelect.tagName === 'SELECT') {
            valSelect.addEventListener('change', () => {
                if (valSelect.value === '__custom__') {
                    customUserWrapper.style.display = 'inline-block';
                    loadUsers().then(() => {
                        setupSearchableUserSelect({
                            wrapper: customUserWrapper,
                            input: document.getElementById('pTabCustomUserInput'),
                            hiddenInput: document.getElementById('pTabCustomUserHidden'),
                            clearBtn: document.getElementById('pTabCustomUserClear'),
                            dropdown: document.getElementById('pTabCustomUserDropdown'),
                            placeholder: '输入姓名/账号搜索用户...'
                        });
                        const customUserInput = document.getElementById('pTabCustomUserInput');
                        if (customUserInput) customUserInput.focus();
                    });
                } else {
                    customUserWrapper.style.display = 'none';
                    const customUserHidden = document.getElementById('pTabCustomUserHidden');
                    if (customUserHidden) customUserHidden.value = '';
                }
            });
        }
    }

    if (pTabBatchFieldSelect) {
        renderPTabDynamicValueInput(pTabBatchFieldSelect.value);
        pTabBatchFieldSelect.addEventListener('change', (e) => {
            e.stopPropagation();
            renderPTabDynamicValueInput(pTabBatchFieldSelect.value);
        });
    }

    if (btnPTabExecuteBatchUpdate) {
        btnPTabExecuteBatchUpdate.onclick = async () => {
            if (pTabSelectedTaskIds.size === 0) {
                alert('请先在下方表格中勾选需要修改的项目任务！');
                return;
            }

            const field = pTabBatchFieldSelect ? pTabBatchFieldSelect.value : 'project';
            const valElem = document.getElementById('pTabFieldValueInput');
            const nameModeElem = document.getElementById('pTabNameModeSelect');
            const replaceFromElem = document.getElementById('pTabReplaceFromInput');

            let targetValue = valElem ? valElem.value : '';
            let targetRealname = '';
            if ((field === 'assignedTo' || field === 'finishedBy') && targetValue === '__custom__') {
                const customUserHidden = document.getElementById('pTabCustomUserHidden');
                const customUserInput = document.getElementById('pTabCustomUserInput');
                targetValue = customUserHidden ? customUserHidden.value.trim() : '';
                if (!targetValue && customUserInput) {
                    targetValue = customUserInput.value.trim();
                }
                if (!targetValue) {
                    alert('请在下拉列表中搜索并选择目标用户，或输入账号！');
                    return;
                }
                let foundUser = cachedUsers.find(u => u.account && u.account.toLowerCase() === targetValue.toLowerCase());
                if (!foundUser) {
                    foundUser = cachedUsers.find(u => u.realname === targetValue);
                    if (foundUser) {
                        targetValue = foundUser.account;
                        targetRealname = foundUser.realname;
                    }
                } else {
                    targetRealname = foundUser.realname;
                }
            }

            const nameMode = nameModeElem ? nameModeElem.value : 'direct';
            const replaceFrom = replaceFromElem ? replaceFromElem.value.trim() : '';

            if (field === 'name') {
                if (nameMode === 'replace') {
                    if (!replaceFrom) {
                        alert('请输入要查找并替换的原词！');
                        return;
                    }
                } else if (!targetValue) {
                    alert('请输入新的任务名称或前后缀！');
                    return;
                }
            }

            const syncDescCheckbox = document.getElementById('pTabSyncDescCheckbox');
            const syncDesc = (field === 'name' && syncDescCheckbox) ? syncDescCheckbox.checked : false;

            const batchUpdateComment = document.getElementById('pTabBatchUpdateComment');
            const updateCommentText = batchUpdateComment ? batchUpdateComment.value.trim() : '';

            const fieldText = pTabBatchFieldSelect.options[pTabBatchFieldSelect.selectedIndex].text;
            let displayTarget = targetValue;
            if ((field === 'assignedTo' || field === 'finishedBy') && targetRealname) {
                displayTarget = `${targetRealname} (${targetValue})`;
            } else if ((field === 'assignedTo' || field === 'finishedBy') && !targetValue) {
                displayTarget = '置空 (无)';
            } else if (field === 'finishedBy' && targetValue === currentAccount) {
                displayTarget = `${currentUserRealname || currentAccount} (${currentAccount})`;
            }
            let confirmMsg = `确定将已勾选的 ${pTabSelectedTaskIds.size} 个项目任务的「${fieldText}」统一批量修改为「${displayTarget}」吗？\n` +
                `• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            if (field === 'name') {
                if (nameMode === 'prefix') confirmMsg = `确定为已勾选的 ${pTabSelectedTaskIds.size} 个项目任务名称统一添加前缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
                else if (nameMode === 'suffix') confirmMsg = `确定为已勾选的 ${pTabSelectedTaskIds.size} 个项目任务名称统一添加后缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
                else if (nameMode === 'replace') {
                    const replaceTargetStr = targetValue ? `「${targetValue}」` : '「空 (删除该词)」';
                    confirmMsg = `确定将已勾选的 ${pTabSelectedTaskIds.size} 个项目任务名称中的「${replaceFrom}」批量替换为 ${replaceTargetStr} 吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
                }
                if (syncDesc) {
                    confirmMsg += `\n（已勾选：同步将任务描述修改为与新名称一致）`;
                }
            }

            if (!confirm(confirmMsg)) return;

            showProgressLoading('🛠️ 批量修改项目任务字段', 0, pTabSelectedTaskIds.size, `准备批量更新 ${pTabSelectedTaskIds.size} 个任务...`);

            try {
                const res = await fetch(apiUrl('/api/tasks/batch-update'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task_ids: Array.from(pTabSelectedTaskIds),
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
                    let desc = `<b>${fieldText}</b> 更新为 <b>${escapeHtml(displayTarget)}</b>`;
                    if (field === 'name' && nameMode === 'replace') {
                        const toText = targetValue ? `「${escapeHtml(targetValue)}」` : '「空 (删除该词)」';
                        desc = `任务名称中的「${escapeHtml(replaceFrom)}」批量替换为 ${toText}`;
                    }
                    showBatchResultModal('批量修改执行结果', data, desc);

                    // 重新检索以刷新视图
                    if (btnSearchProjectTasks) btnSearchProjectTasks.click();
                } else {
                    alert('批量修改失败: ' + resJson.message);
                }
            } catch (e) {
                hideLoading();
                alert('网络请求异常: ' + e);
            }
        };
    }

    function renderProjectTasksTable(tasks) {
        if (!projectTasksTableBody) return;
        if (!tasks || tasks.length === 0) {
            projectTasksTableBody.innerHTML = `<tr><td colspan="11" class="empty-cell">未找到该项目下符合条件的任务</td></tr>`;
            if (pTabSummaryBar) pTabSummaryBar.style.display = 'none';
            const pTabBatchCard = document.getElementById('pTabBatchEditCard');
            if (pTabBatchCard) pTabBatchCard.style.display = 'none';
            if (projectTasksTotalBadge) projectTasksTotalBadge.innerHTML = `共 <strong>0</strong> 条任务`;
            if (projectTasksBadge) projectTasksBadge.style.display = 'none';
            return;
        }

        // 统计状态分布与工时
        let waitCount = 0;
        let doingCount = 0;
        let doneCount = 0;
        let closedCount = 0;
        let totalConsumed = 0;

        tasks.forEach(t => {
            const st = String(t.status || '').toLowerCase();
            if (st === 'wait') waitCount++;
            else if (st === 'doing') doingCount++;
            else if (st === 'done') doneCount++;
            else if (st === 'closed') closedCount++;

            const consumed = parseFloat(t.consumed) || 0;
            totalConsumed += consumed;
        });

        if (pTabSummaryBar) {
            pTabSummaryBar.style.display = 'flex';
            const statTotal = document.getElementById('pTabStatTotal');
            const statWait = document.getElementById('pTabStatWait');
            const statDoing = document.getElementById('pTabStatDoing');
            const statDone = document.getElementById('pTabStatDone');
            const statClosed = document.getElementById('pTabStatClosed');
            const statConsumed = document.getElementById('pTabStatConsumed');

            if (statTotal) statTotal.textContent = tasks.length;
            if (statWait) statWait.textContent = waitCount;
            if (statDoing) statDoing.textContent = doingCount;
            if (statDone) statDone.textContent = doneCount;
            if (statClosed) statClosed.textContent = closedCount;
            if (statConsumed) statConsumed.textContent = totalConsumed.toFixed(1);
        }

        const pTabBatchCard = document.getElementById('pTabBatchEditCard');
        if (pTabBatchCard) pTabBatchCard.style.display = 'block';

        if (projectTasksTotalBadge) {
            projectTasksTotalBadge.innerHTML = `共 <strong>${tasks.length}</strong> 条任务`;
        }
        if (projectTasksBadge) {
            projectTasksBadge.textContent = tasks.length;
            projectTasksBadge.style.display = 'inline-block';
        }

        let html = '';
        tasks.forEach(t => {
            const st = statusMap[t.status] || { label: t.status, class: 'status-wait' };
            const isAssignedEmpty = (t.assignedTo === '' || t.assignedTo === null);
            const assignedDisplay = isAssignedEmpty
                ? `<span style="color:#2563eb; font-weight:600;">未指派</span>`
                : (t.assignedTo === 'closed' ? `<span style="color:#64748b;">Closed</span>` : escapeHtml(t.assignedToRealname || t.assignedTo));

            const finishedByDisplay = escapeHtml(t.finishedByRealname || t.finishedBy || '-');
            const openedByDisplay = escapeHtml(t.openedByRealname || t.openedBy || '-');
            const projNameDisplay = escapeHtml(t.projectName || `[${t.project}]` || '-');
            const estStarted = escapeHtml(t.estStarted || '-');
            const deadlineOrFinish = escapeHtml(t.finishedDate || t.deadline || '-');
            const taskIdStr = String(t.id);

            html += `
                <tr data-row-id="${t.id}">
                    <td style="text-align:center;">
                        <input type="checkbox" class="ptab-task-checkbox" data-id="${t.id}" ${pTabSelectedTaskIds.has(taskIdStr) ? 'checked' : ''}>
                    </td>
                    <td><strong>#${t.id}</strong></td>
                    <td title="项目ID: ${t.project}"><small class="proj-badge">${projNameDisplay}</small></td>
                    <td>
                        <span class="task-name-text" style="font-weight:500; color:#1e293b;" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    </td>
                    <td><span class="status-tag ${st.class}">${st.label}</span></td>
                    <td>${assignedDisplay}</td>
                    <td><span style="color:#0f172a; font-weight:500;">${finishedByDisplay}</span></td>
                    <td><small style="color:#64748b;">${openedByDisplay}</small></td>
                    <td><small>${t.consumed || 0}/${t.estimate || 0}h</small></td>
                    <td><small>${estStarted}</small></td>
                    <td><small>${deadlineOrFinish}</small></td>
                </tr>
            `;
        });

        projectTasksTableBody.innerHTML = html;
        updatePTabSelectedCount();
    }

    if (projectTasksTableBody) {
        projectTasksTableBody.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('ptab-task-checkbox')) {
                const id = e.target.getAttribute('data-id');
                if (e.target.checked) {
                    pTabSelectedTaskIds.add(id);
                } else {
                    pTabSelectedTaskIds.delete(id);
                }
                updatePTabSelectedCount();
            }
        });
    }

    initPTabFinishedBySelect();

    if (btnSearchProjectTasks) {
        btnSearchProjectTasks.onclick = async () => {
            const selectedProjectIds = pTabProjectSelectInstance
                ? pTabProjectSelectInstance.getSelectedIds()
                : (document.getElementById('pTabProjectId')?.value || '').split(',').filter(Boolean);

            if (!selectedProjectIds || selectedProjectIds.length === 0) {
                alert('请在【所属项目】下拉框中至少选择一个项目！');
                return;
            }

            const finishedByAccounts = pTabFinishedBySelectInstance
                ? pTabFinishedBySelectInstance.getSelectedAccounts()
                : (document.getElementById('pTabFinishedByAccount')?.value || '').split(',').filter(Boolean);

            const status = document.getElementById('pTabStatus')?.value || 'all';
            const year = (document.getElementById('pTabYear')?.value || '').trim();
            const keyword = (document.getElementById('pTabKeyword')?.value || '').trim();

            showLoading(`正在检索所选项目的全量任务，请稍候...`);
            if (projectTasksTableBody) {
                projectTasksTableBody.innerHTML = `<tr><td colspan="11" class="empty-cell">正在穿透加载项目全量任务...</td></tr>`;
            }

            try {
                const res = await fetch(apiUrl('/api/project-tasks/query'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_ids: selectedProjectIds,
                        finished_by: finishedByAccounts,
                        status,
                        year,
                        keyword
                    })
                });
                const data = await res.json();
                hideLoading();

                if (data.success) {
                    currentProjectTasks = data.tasks || [];
                    pTabSelectedTaskIds.clear();
                    renderProjectTasksTable(currentProjectTasks);
                } else {
                    if (projectTasksTableBody) {
                        projectTasksTableBody.innerHTML = `<tr><td colspan="11" class="empty-cell" style="color:red;">查询失败: ${data.message}</td></tr>`;
                    }
                }
            } catch (e) {
                hideLoading();
                if (projectTasksTableBody) {
                    projectTasksTableBody.innerHTML = `<tr><td colspan="11" class="empty-cell" style="color:red;">请求出错: ${e}</td></tr>`;
                }
            }
        };
    }

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

        // 绑定任务名称单元格点击编辑事件
        bindInlineNameEditEvents();
    }

    function handleInlineNameEdit(cell) {
        if (!cell || cell.querySelector('.inline-name-input')) return;

        const taskId = cell.getAttribute('data-id');
        const originalName = cell.getAttribute('data-original');
        const textSpan = cell.querySelector('.task-name-text');
        const currentVal = textSpan ? textSpan.textContent : originalName;

        // 替换为输入框
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-name-input';
        input.value = currentVal;
        input.title = '按回车或点击空白处保存，Esc 键取消修改';

        cell.innerHTML = '';
        cell.appendChild(input);
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
                renderCellDisplay(cell, taskId, originalName, currentVal);
            }
        });

        // 失焦暂存
        input.addEventListener('blur', () => {
            if (isCanceled) return;

            const newVal = input.value.trim();
            if (!newVal) {
                alert('任务名称不能为空！');
                renderCellDisplay(cell, taskId, originalName, currentVal);
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

            renderCellDisplay(cell, taskId, originalName, newVal);
            updateInlineEditBar();
        });
    }

    function bindInlineNameEditEvents() {
        // 已通过 queryTableBody 事件委托统一代理，无需遍历全量 DOM 绑定
    }

    if (queryTableBody) {
        queryTableBody.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('task-checkbox')) {
                const id = e.target.getAttribute('data-id');
                if (e.target.checked) {
                    selectedTaskIds.add(id);
                } else {
                    selectedTaskIds.delete(id);
                }
                updateSelectedCount();
            }
        });

        queryTableBody.addEventListener('click', (e) => {
            const cell = e.target.closest('.editable-name-cell');
            if (cell) {
                handleInlineNameEdit(cell);
            }
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
        if ((field === 'assignedTo' || field === 'finishedBy') && targetValue === '__custom__') {
            const customUserHidden = document.getElementById('customUserHidden');
            const customUserInput = document.getElementById('customUserInput');
            targetValue = customUserHidden ? customUserHidden.value.trim() : '';
            if (!targetValue && customUserInput) {
                targetValue = customUserInput.value.trim();
            }
            if (!targetValue) {
                alert('请在下拉列表中搜索并选择目标用户，或输入账号！');
                return;
            }
            let foundUser = cachedUsers.find(u => u.account && u.account.toLowerCase() === targetValue.toLowerCase());
            if (!foundUser) {
                foundUser = cachedUsers.find(u => u.realname === targetValue);
                if (foundUser) {
                    targetValue = foundUser.account;
                    targetRealname = foundUser.realname;
                }
            } else {
                targetRealname = foundUser.realname;
            }
        }

        const nameMode = nameModeElem ? nameModeElem.value : 'direct';
        const replaceFrom = replaceFromElem ? replaceFromElem.value.trim() : '';

        if (field === 'name') {
            if (nameMode === 'replace') {
                if (!replaceFrom) {
                    alert('请输入要查找并替换的原词！');
                    return;
                }
            } else if (!targetValue) {
                alert('请输入新的任务名称或前后缀！');
                return;
            }
        }

        const syncDescCheckbox = document.getElementById('syncDescCheckbox');
        const syncDesc = (field === 'name' && syncDescCheckbox) ? syncDescCheckbox.checked : false;

        const batchUpdateComment = document.getElementById('batchUpdateComment');
        const updateCommentText = batchUpdateComment ? batchUpdateComment.value.trim() : '';

        const fieldText = batchFieldSelect.options[batchFieldSelect.selectedIndex].text;
        let displayTarget = targetValue;
        if ((field === 'assignedTo' || field === 'finishedBy') && targetRealname) {
            displayTarget = `${targetRealname} (${targetValue})`;
        } else if ((field === 'assignedTo' || field === 'finishedBy') && !targetValue) {
            displayTarget = '置空 (无)';
        } else if (field === 'finishedBy' && targetValue === currentAccount) {
            displayTarget = `${userRealname.textContent || currentAccount} (${currentAccount})`;
        }
        let confirmMsg = `确定将已勾选的 ${selectedTaskIds.size} 个任务的「${fieldText}」统一批量修改为「${displayTarget}」吗？\n` +
            `• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
        if (field === 'name') {
            if (nameMode === 'prefix') confirmMsg = `确定为已勾选的 ${selectedTaskIds.size} 个任务名称统一添加前缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            else if (nameMode === 'suffix') confirmMsg = `确定为已勾选的 ${selectedTaskIds.size} 个任务名称统一添加后缀「${targetValue}」吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            else if (nameMode === 'replace') {
                const replaceTargetStr = targetValue ? `「${targetValue}」` : '「空 (删除该词)」';
                confirmMsg = `确定将已勾选的 ${selectedTaskIds.size} 个任务名称中的「${replaceFrom}」批量替换为 ${replaceTargetStr} 吗？\n• 修改备注：${updateCommentText ? updateCommentText : '无备注 (留空未填)'}`;
            }
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
                let desc = `<b>${fieldText}</b> 更新为 <b>${escapeHtml(displayTarget)}</b>`;
                if (field === 'name' && nameMode === 'replace') {
                    const toText = targetValue ? `「${escapeHtml(targetValue)}」` : '「空 (删除该词)」';
                    desc = `任务名称中的「${escapeHtml(replaceFrom)}」批量替换为 ${toText}`;
                }
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

    // =========================================================================
    // 模块：Gitee 开放 API 代码提交看板
    // =========================================================================
    const giteeState = {
        authenticated: false,
        user: null,
        enterprise: null,
        enterpriseMemberId: null,
        stats: null,
        repos: [],
        branches: [],
        commits: [],
        filteredCommits: [],
        isDemo: false,
        hasLoaded: false,
        isLoading: false,
        selectedRepo: 'all',
        searchKeyword: '',
        selectedType: 'all',
        selectedBranch: 'all',
        currentPage: 1,
        pageSize: 20,
        expandedCommitIds: new Set(),
        rawPayloads: null,
        currentPayloadTab: 'all'
    };

    // DOM 元素引用
    const giteeCommitBadge = document.getElementById('giteeCommitBadge');
    const giteeModeBadge = document.getElementById('giteeModeBadge');
    const giteeModeText = document.getElementById('giteeModeText');
    const btnGiteeRefreshCommits = document.getElementById('btnGiteeRefreshCommits');
    const btnGiteeOpenAuthModal = document.getElementById('btnGiteeOpenAuthModal');

    // 用户与企业画像
    const giteeUserAvatarImg = document.getElementById('giteeUserAvatarImg');
    const giteeUserAvatarFallback = document.getElementById('giteeUserAvatarFallback');
    const giteeUserRealname = document.getElementById('giteeUserRealname');
    const giteeUserLogin = document.getElementById('giteeUserLogin');
    const giteeEnterpriseName = document.getElementById('giteeEnterpriseName');
    const giteeMetaDateRange = document.getElementById('giteeMetaDateRange');
    const giteeMetaEnterpriseId = document.getElementById('giteeMetaEnterpriseId');
    const giteeMetaMemberId = document.getElementById('giteeMetaMemberId');

    // 统计指标
    const giteeStatActiveRepos = document.getElementById('giteeStatActiveRepos');
    const giteeStatThisWeekCommits = document.getElementById('giteeStatThisWeekCommits');
    const giteeStatPushEvents = document.getElementById('giteeStatPushEvents');
    const giteeStatActiveBranches = document.getElementById('giteeStatActiveBranches');

    // 过滤与检索
    const giteeRepoTagsList = document.getElementById('giteeRepoTagsList');
    const giteeTagAllRepos = document.getElementById('giteeTagAllRepos');
    const giteeTagAllCount = document.getElementById('giteeTagAllCount');
    const giteeSearchInput = document.getElementById('giteeSearchInput');
    const giteeSearchClear = document.getElementById('giteeSearchClear');
    const giteeCommitTypeFilter = document.getElementById('giteeCommitTypeFilter');
    const giteeBranchFilter = document.getElementById('giteeBranchFilter');
    const giteeFilteredCount = document.getElementById('giteeFilteredCount');

    // 流水列表与分页
    const giteeLoadingNotice = document.getElementById('giteeLoadingNotice');
    const giteeEmptyNotice = document.getElementById('giteeEmptyNotice');
    const giteeEmptySubtext = document.getElementById('giteeEmptySubtext');
    const giteeCommitStreamList = document.getElementById('giteeCommitStreamList');
    const giteePaginationBar = document.getElementById('giteePaginationBar');
    const giteePageStartIdx = document.getElementById('giteePageStartIdx');
    const giteePageEndIdx = document.getElementById('giteePageEndIdx');
    const giteePageTotalCount = document.getElementById('giteePageTotalCount');
    const giteePageSizeSelect = document.getElementById('giteePageSizeSelect');
    const giteePageButtons = document.getElementById('giteePageButtons');

    // 授权弹窗
    const giteeAuthModal = document.getElementById('giteeAuthModal');
    const giteeAuthModalCloseBtn = document.getElementById('giteeAuthModalCloseBtn');
    const giteeAuthCancelBtn = document.getElementById('giteeAuthCancelBtn');
    const giteeAuthSubmitBtn = document.getElementById('giteeAuthSubmitBtn');
    const btnGiteeDemoLogin = document.getElementById('btnGiteeDemoLogin');
    const btnGiteeDisconnect = document.getElementById('btnGiteeDisconnect');
    const giteeTokenInput = document.getElementById('giteeTokenInput');
    const btnToggleGiteeToken = document.getElementById('btnToggleGiteeToken');
    const giteeEnterpriseInput = document.getElementById('giteeEnterpriseInput');
    const giteeDetectedEnterprises = document.getElementById('giteeDetectedEnterprises');
    const giteeEnterpriseChips = document.getElementById('giteeEnterpriseChips');


    function escapeGiteeHtml(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function copyGiteeTextToClipboard(text, onSuccess) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (onSuccess) onSuccess();
            }).catch(() => {
                fallbackGiteeCopy(text, onSuccess);
            });
        } else {
            fallbackGiteeCopy(text, onSuccess);
        }
    }

    function fallbackGiteeCopy(text, onSuccess) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            if (onSuccess) onSuccess();
        } catch (e) {}
        document.body.removeChild(ta);
    }

    // 初始化 Gitee 模块主入口 (切换到 Tab 时触发)
    async function initGiteeModule() {
        updateGiteeAuthButtonState();
        if (!giteeState.hasLoaded) {
            await loadGiteeData(false);
        }
    }

    // 静默检测 Gitee 登录状态 (首次页面加载)
    async function checkGiteeStatusQuietly() {
        try {
            const res = await fetch(apiUrl('/api/gitee/status'));
            if (!res.ok) return;
            const data = await res.json();
            if (data.authenticated) {
                giteeState.authenticated = true;
                giteeState.user = data.user;
                giteeState.isDemo = !!data.is_demo;
                if (giteeCommitBadge) {
                    giteeCommitBadge.style.display = 'inline-block';
                    giteeCommitBadge.textContent = data.is_demo ? '演示' : '在线';
                }
            } else {
                giteeState.authenticated = false;
            }
            updateGiteeAuthButtonState();
        } catch (e) {
            // 静默失败，不打扰核心禅道流程
        }
    }

    // 加载 Gitee 提交数据
    async function loadGiteeData(forceRefresh = false, useDemo = false) {
        if (giteeState.isLoading) return;
        giteeState.isLoading = true;

        if (giteeLoadingNotice) giteeLoadingNotice.style.display = 'block';
        if (giteeEmptyNotice) giteeEmptyNotice.style.display = 'none';
        if (giteeCommitStreamList) giteeCommitStreamList.style.display = 'none';
        if (btnGiteeRefreshCommits) {
            btnGiteeRefreshCommits.disabled = true;
            btnGiteeRefreshCommits.textContent = '🔄 正在获取提交...';
        }

        try {
            const url = apiUrl(`/api/gitee/commits?refresh=${forceRefresh ? 1 : 0}&use_demo=${useDemo ? 1 : 0}`);
            const res = await fetch(url);
            const data = await res.json();

            if (res.status === 401 || !data.authenticated) {
                giteeState.authenticated = false;
                giteeState.hasLoaded = true;
                if (giteeLoadingNotice) giteeLoadingNotice.style.display = 'none';
                if (giteeCommitBadge) giteeCommitBadge.style.display = 'none';
                updateGiteeAuthButtonState();
                // 打开配置弹窗引导授权
                openGiteeAuthModal();
                return;
            }

            if (data.code !== 200) {
                throw new Error(data.message || '获取 Gitee 提交记录失败');
            }

            // 更新状态
            giteeState.authenticated = true;
            giteeState.hasLoaded = true;
            updateGiteeAuthButtonState();
            giteeState.user = data.user || {};
            giteeState.enterprise = data.enterprise || {};
            giteeState.enterpriseMemberId = data.enterprise_member_id || (data.stats && data.stats.member_id) || (data.user && data.user.id);
            giteeState.stats = data.stats || {};
            if (!giteeState.stats.push_events_count && giteeState.stats.total_push_events) {
                giteeState.stats.push_events_count = giteeState.stats.total_push_events;
            }
            giteeState.repos = (data.repos || []).map(r => ({
                path: r.path || r.name || r.full_name || '',
                name: r.name || r.path || '',
                count: r.count || 0
            }));
            giteeState.commits = (data.commits || []).map(c => {
                const fullSha = c.full_sha || c.commit_id || c.sha || '';
                const shortSha = c.short_sha || (fullSha ? fullSha.slice(0, 7) : '');
                return {
                    id: c.id || c.commit_id || c.sha || shortSha || Math.random().toString(),
                    full_sha: fullSha,
                    short_sha: shortSha,
                    commit_title: c.commit_title || c.title || '代码提交',
                    commit_desc: c.commit_desc || c.body || '',
                    commit_type: c.commit_type || c.type || 'OTHER',
                    repo_name: c.repo_name || c.repo || c.repo_path || '',
                    repo_path: c.repo_path || c.repo_full_name || c.repo_name || '',
                    branch: c.branch || 'main',
                    html_url: c.html_url || c.url || '#',
                    author_name: c.author_name || (data.user && data.user.name) || '',
                    author_login: c.author_login || c.author_username || (data.user && data.user.login) || '',
                    event_id: c.event_id || c.push_event_id || 'N/A',
                    created_at: c.created_at || c.timestamp || '',
                    relative_time: c.relative_time || '刚刚'
                };
            });

            // 提取所有涉及的分支列表
            const branchSet = new Set(data.branches || []);
            giteeState.commits.forEach(c => {
                if (c.branch) branchSet.add(c.branch);
            });
            giteeState.branches = Array.from(branchSet);
            giteeState.isDemo = !!data.is_demo;

            // 渲染各个看板区块
            renderGiteeProfile();
            renderGiteeStats();
            renderGiteeRepoTags();
            renderGiteeBranchFilterOptions();

            // 更新选项卡徽章
            if (giteeCommitBadge) {
                giteeCommitBadge.style.display = 'inline-block';
                giteeCommitBadge.textContent = giteeState.isDemo ? '演示' : giteeState.commits.length;
            }

            // 应用筛选并渲染列表
            applyGiteeFilters(true);

        } catch (e) {
            showModal('Gitee 数据拉取提示', `<div style="color: #ef4444; line-height: 1.6;">拉取 Gitee 数据异常: ${escapeGiteeHtml(e.message || e)}<br><br><span style="color:#64748b;">您可以检查网络连通性或点击右上角【授权与企业配置】切换为演示数据体验。</span></div>`);
            if (giteeEmptyNotice) giteeEmptyNotice.style.display = 'block';
        } finally {
            giteeState.isLoading = false;
            if (giteeLoadingNotice) giteeLoadingNotice.style.display = 'none';
            if (btnGiteeRefreshCommits) {
                btnGiteeRefreshCommits.disabled = false;
                btnGiteeRefreshCommits.textContent = '🔄 刷新最新提交';
            }
        }
    }

    // 渲染用户画像与元数据卡片
    function renderGiteeProfile() {
        const user = giteeState.user || {};
        const ent = giteeState.enterprise || {};
        const stats = giteeState.stats || {};

        const realname = user.name || user.login || (giteeState.authenticated ? 'Gitee 用户' : '未授权用户');
        const login = user.login || '';

        if (giteeUserRealname) giteeUserRealname.textContent = realname;
        if (giteeUserLogin) giteeUserLogin.textContent = login ? `@${login}` : '';

        // 头像处理
        if (user.avatar_url && giteeUserAvatarImg) {
            giteeUserAvatarImg.src = user.avatar_url;
            giteeUserAvatarImg.style.display = 'block';
            if (giteeUserAvatarFallback) giteeUserAvatarFallback.style.display = 'none';
        } else if (giteeUserAvatarFallback) {
            giteeUserAvatarFallback.textContent = (realname || 'G')[0];
            giteeUserAvatarFallback.style.display = 'flex';
            if (giteeUserAvatarImg) giteeUserAvatarImg.style.display = 'none';
        }

        // 所属企业名称
        if (giteeEnterpriseName) {
            giteeEnterpriseName.textContent = ent.name || ent.path || (giteeState.authenticated ? '未指定所属企业' : '尚未连接企业');
        }

        // 元数据三项指标
        if (giteeMetaDateRange) {
            giteeMetaDateRange.textContent = stats.date_range || '近 7 天';
        }
        if (giteeMetaEnterpriseId) {
            giteeMetaEnterpriseId.textContent = ent.id || 'N/A';
        }
        if (giteeMetaMemberId) {
            giteeMetaMemberId.textContent = giteeState.enterpriseMemberId || user.id || 'N/A';
        }

        // 运行模式徽章
        if (giteeModeText) {
            giteeModeText.textContent = !giteeState.authenticated
                ? '未连接'
                : (giteeState.isDemo ? '演示模式 (Mock)' : '实时在线 (OpenAPI)');
        }
        if (giteeModeBadge) {
            if (!giteeState.authenticated) {
                giteeModeBadge.style.background = '#f1f5f9';
                giteeModeBadge.style.color = '#64748b';
                giteeModeBadge.style.borderColor = '#cbd5e1';
            } else {
                giteeModeBadge.style.background = giteeState.isDemo ? '#fef3c7' : '#f0fdf4';
                giteeModeBadge.style.color = giteeState.isDemo ? '#b45309' : '#15803d';
                giteeModeBadge.style.borderColor = giteeState.isDemo ? '#fde68a' : '#bbf7d0';
            }
        }
    }

    // 渲染四项核心统计指标卡片
    function renderGiteeStats() {
        const stats = giteeState.stats || {};
        if (giteeStatActiveRepos) {
            giteeStatActiveRepos.textContent = stats.active_repos_count || 0;
        }
        if (giteeStatThisWeekCommits) {
            giteeStatThisWeekCommits.textContent = stats.this_week_commits_count || 0;
        }
        if (giteeStatPushEvents) {
            giteeStatPushEvents.textContent = stats.push_events_count || 0;
        }
        if (giteeStatActiveBranches) {
            giteeStatActiveBranches.textContent = stats.active_branches_count || 0;
        }
    }

    // 渲染仓库标签筛选胶囊
    function renderGiteeRepoTags() {
        if (!giteeRepoTagsList) return;
        const totalCount = (giteeState.commits || []).length;
        if (giteeTagAllCount) giteeTagAllCount.textContent = totalCount;

        // 高亮“全部仓库”胶囊
        if (giteeTagAllRepos) {
            if (giteeState.selectedRepo === 'all') {
                giteeTagAllRepos.classList.add('active');
            } else {
                giteeTagAllRepos.classList.remove('active');
            }
        }

        const repos = giteeState.repos || [];
        giteeRepoTagsList.innerHTML = repos.map(r => {
            const isActive = giteeState.selectedRepo === r.path || giteeState.selectedRepo === r.name;
            const displayName = r.name || r.path;
            const tagKey = r.path || r.name;
            return `
                <button type="button" class="gitee-repo-tag-pill ${isActive ? 'active' : ''}" data-repo="${escapeGiteeHtml(tagKey)}" title="${escapeGiteeHtml(displayName)} (${r.path})">
                    <span>${escapeGiteeHtml(displayName)}</span>
                    <span class="tag-count">${r.count}</span>
                </button>
            `;
        }).join('');

        // 绑定每个仓库胶囊点击事件
        giteeRepoTagsList.querySelectorAll('.gitee-repo-tag-pill').forEach(btn => {
            btn.onclick = () => {
                const repoPath = btn.getAttribute('data-repo');
                giteeState.selectedRepo = repoPath;
                renderGiteeRepoTags();
                renderGiteeBranchFilterOptions(); // 联动更新该仓库下的分支选项
                applyGiteeFilters(true);
            };
        });
    }

    if (giteeTagAllRepos) {
        giteeTagAllRepos.onclick = () => {
            giteeState.selectedRepo = 'all';
            renderGiteeRepoTags();
            renderGiteeBranchFilterOptions(); // 联动恢复全部分支选项
            applyGiteeFilters(true);
        };
    }

    // 渲染分支下拉选项 (与选中的项目仓库动态联动)
    function renderGiteeBranchFilterOptions() {
        if (!giteeBranchFilter) return;

        const selectedRepo = giteeState.selectedRepo;
        // 筛选出属于当前选定仓库的提交
        const targetCommits = selectedRepo === 'all'
            ? (giteeState.commits || [])
            : (giteeState.commits || []).filter(c => c.repo_path === selectedRepo || c.repo_name === selectedRepo);

        // 提取该仓库下的所有唯一开发分支
        const branchSet = new Set();
        targetCommits.forEach(c => {
            if (c.branch) branchSet.add(c.branch);
        });
        const repoBranches = Array.from(branchSet).sort();

        // 若当前选中的分支不在新分支集合中，重置为 'all'
        if (giteeState.selectedBranch !== 'all' && !branchSet.has(giteeState.selectedBranch)) {
            giteeState.selectedBranch = 'all';
        }

        let html = '<option value="all">🌿 全部分支</option>';
        repoBranches.forEach(b => {
            const isSelected = b === giteeState.selectedBranch ? 'selected' : '';
            html += `<option value="${escapeGiteeHtml(b)}" ${isSelected}>🌿 ${escapeGiteeHtml(b)}</option>`;
        });

        giteeBranchFilter.innerHTML = html;
        giteeBranchFilter.value = giteeState.selectedBranch;
    }

    // 执行多维筛选与关键字检索
    function applyGiteeFilters(resetPage = false) {
        if (resetPage) {
            giteeState.currentPage = 1;
        }

        const kw = (giteeState.searchKeyword || '').trim().toLowerCase();
        const selectedRepo = giteeState.selectedRepo;
        const selectedType = giteeState.selectedType;
        const selectedBranch = giteeState.selectedBranch;

        giteeState.filteredCommits = (giteeState.commits || []).filter(c => {
            // 仓库过滤 (同时支持匹配完整路径与仓库短名)
            if (selectedRepo !== 'all' && c.repo_path !== selectedRepo && c.repo_name !== selectedRepo) {
                return false;
            }
            // 提交类型过滤 (FEAT, FIX, STYLE 等)
            if (selectedType !== 'all' && c.commit_type !== selectedType) {
                return false;
            }
            // 分支过滤
            if (selectedBranch !== 'all' && c.branch !== selectedBranch) {
                return false;
            }
            // 关键字搜索 (支持提交标题、描述、作者名/登录名、Commit 短哈希/完整哈希)
            if (kw) {
                const titleMatch = (c.commit_title || '').toLowerCase().includes(kw);
                const descMatch = (c.commit_desc || '').toLowerCase().includes(kw);
                const authorMatch = (c.author_name || '').toLowerCase().includes(kw) ||
                                    (c.author_login || '').toLowerCase().includes(kw);
                const shaMatch = (c.short_sha || '').toLowerCase().includes(kw) ||
                                 (c.full_sha || '').toLowerCase().includes(kw);
                if (!titleMatch && !descMatch && !authorMatch && !shaMatch) {
                    return false;
                }
            }
            return true;
        });

        if (giteeFilteredCount) {
            giteeFilteredCount.textContent = giteeState.filteredCommits.length;
        }

        renderGiteeCommitStream();
    }

    // 渲染 Commit 流水列表与分页条
    function renderGiteeCommitStream() {
        if (!giteeCommitStreamList) return;

        const total = giteeState.filteredCommits.length;
        const pageSize = giteeState.pageSize;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        if (giteeState.currentPage > totalPages) {
            giteeState.currentPage = totalPages;
        }
        if (giteeState.currentPage < 1) {
            giteeState.currentPage = 1;
        }

        const startIdx = (giteeState.currentPage - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, total);
        const currentSlice = giteeState.filteredCommits.slice(startIdx, endIdx);

        if (total === 0) {
            giteeCommitStreamList.innerHTML = '';
            giteeCommitStreamList.style.display = 'none';
            if (giteeEmptyNotice) {
                giteeEmptyNotice.style.display = 'block';
                if (giteeEmptySubtext) {
                    if (giteeState.searchKeyword || giteeState.selectedRepo !== 'all' || giteeState.selectedType !== 'all' || giteeState.selectedBranch !== 'all') {
                        giteeEmptySubtext.textContent = '当前检索条件暂无结果，请尝试清空关键字或切换全部分支/仓库';
                    } else {
                        giteeEmptySubtext.textContent = '暂无已记录的代码提交，可在 Gitee 企业代码库推送后点击【刷新最新提交】';
                    }
                }
            }
            if (giteePaginationBar) giteePaginationBar.style.display = 'none';
            return;
        }

        if (giteeEmptyNotice) giteeEmptyNotice.style.display = 'none';
        giteeCommitStreamList.style.display = 'flex';
        if (giteePaginationBar) giteePaginationBar.style.display = 'flex';

        // 更新分页统计文案
        if (giteePageStartIdx) giteePageStartIdx.textContent = total > 0 ? (startIdx + 1) : 0;
        if (giteePageEndIdx) giteePageEndIdx.textContent = endIdx;
        if (giteePageTotalCount) giteePageTotalCount.textContent = total;

        const entName = (giteeState.enterprise && (giteeState.enterprise.name || giteeState.enterprise.path)) || '所属企业';

        // 渲染单条 Commit 条目
        giteeCommitStreamList.innerHTML = currentSlice.map(commit => {
            const isExpanded = giteeState.expandedCommitIds.has(commit.id);
            const typeLower = (commit.commit_type || 'other').toLowerCase();
            const repoDisplayName = commit.repo_name || commit.repo_path;

            let expandDetailHtml = '';
            if (isExpanded) {
                expandDetailHtml = `
                    <div class="commit-expand-detail">
                        <div class="detail-row">
                            <span class="detail-label">项目全称:</span>
                            <span class="detail-value"><b>${escapeGiteeHtml(entName)}</b> / ${escapeGiteeHtml(repoDisplayName)} <span style="color:#64748b; font-size:11px;">(${escapeGiteeHtml(commit.repo_path)})</span></span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">完整哈希:</span>
                            <span class="detail-value" style="display: flex; align-items: center; gap: 8px;">
                                <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:11px; border:1px solid #e2e8f0;">${escapeGiteeHtml(commit.full_sha)}</code>
                                <button type="button" class="btn btn-secondary btn-xs btn-copy-full-sha" data-sha="${escapeGiteeHtml(commit.full_sha)}" title="复制完整哈希到剪贴板">📋 复制</button>
                            </span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">提交作者:</span>
                            <span class="detail-value">${escapeGiteeHtml(commit.author_name || commit.author_login)} <span style="color:#64748b;">(@${escapeGiteeHtml(commit.author_login || '')})</span></span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Push事件ID:</span>
                            <span class="detail-value"><code style="color:#0284c7; background:#eff6ff; padding:2px 6px; border-radius:4px;">#${escapeGiteeHtml(commit.event_id || 'N/A')}</code></span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">原始链接:</span>
                            <span class="detail-value">
                                <a href="${escapeGiteeHtml(commit.html_url)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:none; word-break:break-all;">${escapeGiteeHtml(commit.html_url)} ↗</a>
                            </span>
                        </div>
                        <div class="detail-row" style="align-items: flex-start;">
                            <span class="detail-label" style="margin-top: 4px;">详细描述:</span>
                            <div class="detail-value" style="flex: 1;">
                                <pre class="detail-body-pre">${escapeGiteeHtml(commit.commit_desc || commit.commit_title || '无补充提交描述')}</pre>
                            </div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="gitee-commit-item ${isExpanded ? 'expanded' : ''}" data-commit-id="${escapeGiteeHtml(commit.id)}">
                    <div class="commit-item-main">
                        <div class="commit-header-meta">
                            <span class="commit-repo-badge" title="代码仓库: ${escapeGiteeHtml(commit.repo_path)}">
                                📁 ${escapeGiteeHtml(repoDisplayName)}
                            </span>
                            <span class="commit-branch-pill" title="所在开发分支">
                                🌿 ${escapeGiteeHtml(commit.branch)}
                            </span>
                            <span class="commit-type-tag ${typeLower}" title="提交类型">
                                ${escapeGiteeHtml(commit.commit_type)}
                            </span>
                            <span class="commit-sha-pill" data-sha="${escapeGiteeHtml(commit.full_sha)}" title="点击快捷复制哈希">
                                #${escapeGiteeHtml(commit.short_sha)}
                            </span>
                            <span class="commit-time" title="提交时间: ${escapeGiteeHtml(commit.created_at)}">
                                🕒 ${escapeGiteeHtml(commit.relative_time)}
                            </span>
                            <a href="${escapeGiteeHtml(commit.html_url)}" target="_blank" rel="noopener noreferrer" class="commit-ext-link" title="在 Gitee 网页查看此次提交">
                                Gitee 查看 ↗
                            </a>
                            <button type="button" class="commit-toggle-btn" data-toggle-commit="${escapeGiteeHtml(commit.id)}">
                                ${isExpanded ? '收起 ▴' : '详情 ▾'}
                            </button>
                        </div>
                        <div class="commit-title-row">
                            <div class="commit-title" title="${escapeGiteeHtml(commit.commit_title)}">
                                ${escapeGiteeHtml(commit.commit_title)}
                            </div>
                        </div>
                        ${expandDetailHtml}
                    </div>
                </div>
            `;
        }).join('');

        renderGiteePaginationButtons(totalPages);
    }

    // 渲染分页按钮
    function renderGiteePaginationButtons(totalPages) {
        if (!giteePageButtons) return;
        const current = giteeState.currentPage;
        let html = '';

        // 上一页
        html += `<button type="button" class="page-btn" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''} title="上一页">&lt;</button>`;

        // 页码序列计算
        const pages = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (current > 3) pages.push('...');
            const start = Math.max(2, current - 1);
            const end = Math.min(totalPages - 1, current + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (current < totalPages - 2) pages.push('...');
            pages.push(totalPages);
        }

        pages.forEach(p => {
            if (p === '...') {
                html += `<span class="page-btn" style="border:none; cursor:default; background:transparent;">...</span>`;
            } else {
                html += `<button type="button" class="page-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
            }
        });

        // 下一页
        html += `<button type="button" class="page-btn" data-page="${current + 1}" ${current >= totalPages ? 'disabled' : ''} title="下一页">&gt;</button>`;

        giteePageButtons.innerHTML = html;

        // 绑定分页按钮事件
        giteePageButtons.querySelectorAll('.page-btn[data-page]').forEach(btn => {
            btn.onclick = () => {
                const targetPage = parseInt(btn.getAttribute('data-page'), 10);
                if (targetPage && targetPage !== current && targetPage >= 1 && targetPage <= totalPages) {
                    giteeState.currentPage = targetPage;
                    renderGiteeCommitStream();
                }
            };
        });
    }

    // 事件委托：Commit 列表内展开/折叠与哈希一键复制
    if (giteeCommitStreamList) {
        giteeCommitStreamList.addEventListener('click', (e) => {
            // 展开/收起详情
            const toggleBtn = e.target.closest('[data-toggle-commit]');
            if (toggleBtn) {
                const commitId = toggleBtn.getAttribute('data-toggle-commit');
                if (giteeState.expandedCommitIds.has(commitId)) {
                    giteeState.expandedCommitIds.delete(commitId);
                } else {
                    giteeState.expandedCommitIds.add(commitId);
                }
                renderGiteeCommitStream();
                return;
            }

            // 复制哈希 (短哈希或复制按钮)
            const copyShaBtn = e.target.closest('[data-sha]');
            if (copyShaBtn) {
                const sha = copyShaBtn.getAttribute('data-sha');
                if (sha) {
                    const originalText = copyShaBtn.textContent;
                    copyGiteeTextToClipboard(sha, () => {
                        copyShaBtn.textContent = '已复制!';
                        setTimeout(() => {
                            copyShaBtn.textContent = originalText;
                        }, 1200);
                    });
                }
            }
        });
    }

    // 搜索框事件与清空
    if (giteeSearchInput) {
        giteeSearchInput.addEventListener('input', (e) => {
            giteeState.searchKeyword = e.target.value;
            if (giteeSearchClear) {
                giteeSearchClear.style.display = e.target.value ? 'block' : 'none';
            }
            applyGiteeFilters(true);
        });
    }

    if (giteeSearchClear) {
        giteeSearchClear.onclick = () => {
            if (giteeSearchInput) {
                giteeSearchInput.value = '';
                giteeState.searchKeyword = '';
            }
            giteeSearchClear.style.display = 'none';
            applyGiteeFilters(true);
            if (giteeSearchInput) giteeSearchInput.focus();
        };
    }

    // 提交类型与分支下拉筛选
    if (giteeCommitTypeFilter) {
        giteeCommitTypeFilter.addEventListener('change', (e) => {
            giteeState.selectedType = e.target.value;
            applyGiteeFilters(true);
        });
    }

    if (giteeBranchFilter) {
        giteeBranchFilter.addEventListener('change', (e) => {
            giteeState.selectedBranch = e.target.value;
            applyGiteeFilters(true);
        });
    }

    // 每页条数切换
    if (giteePageSizeSelect) {
        giteePageSizeSelect.addEventListener('change', (e) => {
            giteeState.pageSize = parseInt(e.target.value, 10) || 20;
            applyGiteeFilters(true);
        });
    }

    // 刷新按钮
    if (btnGiteeRefreshCommits) {
        btnGiteeRefreshCommits.onclick = () => {
            loadGiteeData(true, giteeState.isDemo);
        };
    }

    // 更新授权/取消授权按钮状态
    function updateGiteeAuthButtonState() {
        if (!btnGiteeOpenAuthModal) return;
        if (giteeState.authenticated) {
            btnGiteeOpenAuthModal.innerHTML = '🚫 取消授权';
            btnGiteeOpenAuthModal.title = '点击取消当前 Gitee 授权并清空已保存的凭据';
            btnGiteeOpenAuthModal.classList.remove('btn-secondary');
            btnGiteeOpenAuthModal.classList.add('btn-danger-ghost');
        } else {
            btnGiteeOpenAuthModal.innerHTML = '🔑 授权与企业配置';
            btnGiteeOpenAuthModal.title = '配置或更换 Gitee Access Token 与所属企业';
            btnGiteeOpenAuthModal.classList.remove('btn-danger-ghost');
            btnGiteeOpenAuthModal.classList.add('btn-secondary');
        }
    }

    // 取消 Gitee 授权连接
    async function handleGiteeDisconnect() {
        if (!confirm('确定要取消当前 Gitee 授权连接吗？取消后需重新配置令牌。')) return;
        try {
            await fetch(apiUrl('/api/gitee/logout'), { method: 'POST' });
            giteeState.authenticated = false;
            giteeState.hasLoaded = false;
            giteeState.user = null;
            giteeState.enterprise = null;
            giteeState.enterpriseMemberId = null;
            giteeState.stats = null;
            giteeState.repos = [];
            giteeState.branches = [];
            giteeState.commits = [];
            giteeState.filteredCommits = [];
            giteeState.selectedRepo = 'all';
            giteeState.selectedBranch = 'all';
            giteeState.searchKeyword = '';
            if (giteeSearchInput) giteeSearchInput.value = '';
            if (giteeSearchClear) giteeSearchClear.style.display = 'none';
            if (giteeCommitBadge) giteeCommitBadge.style.display = 'none';
            closeGiteeAuthModal();
            updateGiteeAuthButtonState();
            renderGiteeProfile();
            renderGiteeStats();
            renderGiteeRepoTags();
            renderGiteeBranchFilterOptions();
            applyGiteeFilters(true);
            alert('已成功取消 Gitee 授权');
        } catch (e) {
            alert('取消授权异常: ' + e);
        }
    }

    // =========================================================================
    // 授权配置与模式切换弹窗
    // =========================================================================
    function openGiteeAuthModal() {
        if (!giteeAuthModal) return;
        giteeAuthModal.style.display = 'flex';
        if (giteeState.authenticated && btnGiteeDisconnect) {
            btnGiteeDisconnect.style.display = 'inline-block';
        } else if (btnGiteeDisconnect) {
            btnGiteeDisconnect.style.display = 'none';
        }
    }

    function closeGiteeAuthModal() {
        if (giteeAuthModal) giteeAuthModal.style.display = 'none';
    }

    if (btnGiteeOpenAuthModal) {
        btnGiteeOpenAuthModal.onclick = () => {
            if (giteeState.authenticated) {
                handleGiteeDisconnect();
            } else {
                openGiteeAuthModal();
            }
        };
    }
    if (giteeAuthModalCloseBtn) {
        giteeAuthModalCloseBtn.onclick = closeGiteeAuthModal;
    }
    if (giteeAuthCancelBtn) {
        giteeAuthCancelBtn.onclick = closeGiteeAuthModal;
    }

    // 切换 Token 明文显示/隐藏
    if (btnToggleGiteeToken && giteeTokenInput) {
        btnToggleGiteeToken.onclick = () => {
            if (giteeTokenInput.type === 'password') {
                giteeTokenInput.type = 'text';
                btnToggleGiteeToken.textContent = '🔒';
            } else {
                giteeTokenInput.type = 'password';
                btnToggleGiteeToken.textContent = '👁️';
            }
        };
    }

    // 演示模式体验
    if (btnGiteeDemoLogin) {
        btnGiteeDemoLogin.onclick = async () => {
            try {
                btnGiteeDemoLogin.disabled = true;
                btnGiteeDemoLogin.textContent = '正在进入演示模式...';
                const res = await fetch(apiUrl('/api/gitee/auth'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ use_demo: true })
                });
                const data = await res.json();
                if (data.code === 200) {
                    closeGiteeAuthModal();
                    await loadGiteeData(true, true);
                    updateGiteeAuthButtonState();
                } else {
                    alert('切换演示模式失败: ' + data.message);
                }
            } catch (e) {
                alert('切换演示模式异常: ' + e);
            } finally {
                btnGiteeDemoLogin.disabled = false;
                btnGiteeDemoLogin.textContent = '✨ 使用演示数据体验';
            }
        };
    }

    // 提交 Token 授权连接
    if (giteeAuthSubmitBtn) {
        giteeAuthSubmitBtn.onclick = async () => {
            const token = (giteeTokenInput ? giteeTokenInput.value : '').trim();
            const enterprise = (giteeEnterpriseInput ? giteeEnterpriseInput.value : '').trim();

            if (!token) {
                alert('请输入您的 Gitee Access Token 私人令牌');
                if (giteeTokenInput) giteeTokenInput.focus();
                return;
            }

            try {
                giteeAuthSubmitBtn.disabled = true;
                giteeAuthSubmitBtn.textContent = '正在校验令牌与权限...';

                const res = await fetch(apiUrl('/api/gitee/auth'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, enterprise })
                });
                const data = await res.json();

                if (data.code === 200) {
                    closeGiteeAuthModal();
                    if (giteeTokenInput) giteeTokenInput.value = '';
                    await loadGiteeData(true, false);
                    updateGiteeAuthButtonState();
                } else {
                    alert('授权验证失败: ' + (data.message || 'Token 无效或权限不足'));
                }
            } catch (e) {
                alert('授权网络请求异常: ' + e);
            } finally {
                giteeAuthSubmitBtn.disabled = false;
                giteeAuthSubmitBtn.textContent = '🔑 验证并授权连接';
            }
        };
    }

    // 断开 Gitee 连接
    if (btnGiteeDisconnect) {
        btnGiteeDisconnect.onclick = handleGiteeDisconnect;
    }

    // =========================================================================
    // 模块：Gitee Commit 记录 AI 汇总与任务工单生成 (套用任务模板.xlsx)
    // =========================================================================
    const btnOpenGiteeAiTaskModal = document.getElementById('btnOpenGiteeAiTaskModal');
    const giteeAiTaskModal = document.getElementById('giteeAiTaskModal');
    const giteeAiTaskModalCloseBtn = document.getElementById('giteeAiTaskModalCloseBtn');
    const giteeAiTaskModalCancelBtn = document.getElementById('giteeAiTaskModalCancelBtn');
    const giteeTaskStartDate = document.getElementById('giteeTaskStartDate');
    const giteeTaskEndDate = document.getElementById('giteeTaskEndDate');
    const giteeTaskQuickPresets = document.getElementById('giteeTaskQuickPresets');
    const giteeTaskRepoSelect = document.getElementById('giteeTaskRepoSelect');
    const giteeTaskProjectInput = document.getElementById('giteeTaskProjectInput');
    const giteeTaskAssigneeInput = document.getElementById('giteeTaskAssigneeInput');
    const giteeTaskMatchedCount = document.getElementById('giteeTaskMatchedCount');
    const btnStartGiteeAiTaskGen = document.getElementById('btnStartGiteeAiTaskGen');
    const giteeAiTaskLoadingBox = document.getElementById('giteeAiTaskLoadingBox');
    const giteeAiTaskResultArea = document.getElementById('giteeAiTaskResultArea');
    const giteeTaskResDateRange = document.getElementById('giteeTaskResDateRange');
    const giteeTaskResCommitCount = document.getElementById('giteeTaskResCommitCount');
    const giteeTaskResTaskCount = document.getElementById('giteeTaskResTaskCount');
    const giteeTaskResTotalHours = document.getElementById('giteeTaskResTotalHours');
    const giteeTaskResSourceTag = document.getElementById('giteeTaskResSourceTag');
    const btnAiTaskAddRow = document.getElementById('btnAiTaskAddRow');
    const btnAiTaskQuickDownload = document.getElementById('btnAiTaskQuickDownload');
    const btnAiTaskConfirmDownload = document.getElementById('btnAiTaskConfirmDownload');
    const btnAiTaskImportToZentao = document.getElementById('btnAiTaskImportToZentao');
    const btnAiTaskFooterImportToZentao = document.getElementById('btnAiTaskFooterImportToZentao');
    const giteeAiTaskTableBody = document.getElementById('giteeAiTaskTableBody');

    const giteeAiTaskState = {
        startDate: '',
        endDate: '',
        selectedRepo: 'all',
        matchedCommits: [],
        generatedTasks: [],
        downloadUrl: null,
        downloadFilename: null,
        isGenerating: false,
        hasModified: false
    };

    function formatAiTaskYMD(d) {
        if (!d) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function applyAiTaskDatePreset(presetKey) {
        const today = new Date();
        let sDate = '';
        let eDate = formatAiTaskYMD(today);

        if (presetKey === '7d') {
            const past7 = new Date();
            past7.setDate(today.getDate() - 6);
            sDate = formatAiTaskYMD(past7);
        } else if (presetKey === 'week') {
            const dayOfWeek = today.getDay() || 7; // 1=Mon, 7=Sun
            const monday = new Date(today);
            monday.setDate(today.getDate() - (dayOfWeek - 1));
            sDate = formatAiTaskYMD(monday);
        } else if (presetKey === '14d') {
            const past14 = new Date();
            past14.setDate(today.getDate() - 13);
            sDate = formatAiTaskYMD(past14);
        } else if (presetKey === '30d') {
            const past30 = new Date();
            past30.setDate(today.getDate() - 29);
            sDate = formatAiTaskYMD(past30);
        } else if (presetKey === 'all') {
            sDate = '';
            eDate = '';
        }

        if (giteeTaskStartDate) giteeTaskStartDate.value = sDate;
        if (giteeTaskEndDate) giteeTaskEndDate.value = eDate;
        giteeAiTaskState.startDate = sDate;
        giteeAiTaskState.endDate = eDate;

        // 更新快速标签高亮
        if (giteeTaskQuickPresets) {
            giteeTaskQuickPresets.querySelectorAll('.preset-chip').forEach(btn => {
                if (btn.getAttribute('data-preset') === presetKey) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        updateAiTaskMatchedCount();
    }

    function updateAiTaskMatchedCount() {
        const s = (giteeTaskStartDate ? giteeTaskStartDate.value : '').trim();
        const e = (giteeTaskEndDate ? giteeTaskEndDate.value : '').trim();
        const repo = giteeTaskRepoSelect ? giteeTaskRepoSelect.value : 'all';

        giteeAiTaskState.startDate = s;
        giteeAiTaskState.endDate = e;
        giteeAiTaskState.selectedRepo = repo;

        const allCommits = giteeState.commits || [];
        const matched = allCommits.filter(c => {
            const rawDate = c.created_at || c.timestamp || '';
            const cDate = rawDate.slice(0, 10);
            if (s && cDate && cDate < s) return false;
            if (e && cDate && cDate > e) return false;
            if (repo !== 'all' && c.repo_path !== repo && c.repo_name !== repo) return false;
            return true;
        });

        giteeAiTaskState.matchedCommits = matched;
        if (giteeTaskMatchedCount) {
            giteeTaskMatchedCount.textContent = matched.length;
        }
    }

    function openGiteeAiTaskModal() {
        if (!giteeAiTaskModal) return;
        giteeAiTaskModal.style.display = 'flex';

        // 填充仓库下拉选项
        if (giteeTaskRepoSelect) {
            let optionsHtml = '<option value="all">全部仓库 (聚合分析)</option>';
            (giteeState.repos || []).forEach(r => {
                const val = r.path || r.name;
                const name = r.name || r.path;
                const isSelected = (giteeState.selectedRepo !== 'all' && (giteeState.selectedRepo === val || giteeState.selectedRepo === name)) ? 'selected' : '';
                optionsHtml += `<option value="${escapeGiteeHtml(val)}" ${isSelected}>${escapeGiteeHtml(name)} (${r.count}次提交)</option>`;
            });
            giteeTaskRepoSelect.innerHTML = optionsHtml;
        }

        // 默认按本周设置时间
        applyAiTaskDatePreset('week');
    }

    function closeGiteeAiTaskModal() {
        if (giteeAiTaskModal) giteeAiTaskModal.style.display = 'none';
    }

    // 绑定模态框开关
    if (btnOpenGiteeAiTaskModal) {
        btnOpenGiteeAiTaskModal.onclick = openGiteeAiTaskModal;
    }
    if (giteeAiTaskModalCloseBtn) {
        giteeAiTaskModalCloseBtn.onclick = closeGiteeAiTaskModal;
    }
    if (giteeAiTaskModalCancelBtn) {
        giteeAiTaskModalCancelBtn.onclick = closeGiteeAiTaskModal;
    }

    // 日期预设按钮点击
    if (giteeTaskQuickPresets) {
        giteeTaskQuickPresets.querySelectorAll('.preset-chip').forEach(btn => {
            btn.onclick = () => {
                const preset = btn.getAttribute('data-preset');
                applyAiTaskDatePreset(preset);
            };
        });
    }

    // 日期输入与仓库切换联动
    if (giteeTaskStartDate) {
        giteeTaskStartDate.addEventListener('change', () => {
            if (giteeTaskQuickPresets) {
                giteeTaskQuickPresets.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
            }
            updateAiTaskMatchedCount();
        });
    }
    if (giteeTaskEndDate) {
        giteeTaskEndDate.addEventListener('change', () => {
            if (giteeTaskQuickPresets) {
                giteeTaskQuickPresets.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
            }
            updateAiTaskMatchedCount();
        });
    }
    if (giteeTaskRepoSelect) {
        giteeTaskRepoSelect.addEventListener('change', updateAiTaskMatchedCount);
    }

    // 开始触发 AI 智能汇总
    if (btnStartGiteeAiTaskGen) {
        btnStartGiteeAiTaskGen.onclick = async () => {
            updateAiTaskMatchedCount();
            if (giteeAiTaskState.matchedCommits.length === 0) {
                if (!confirm('所选时间段内未匹配到当前本地已加载的代码提交记录。是否仍要尝试从后端拉取并生成任务工单？')) {
                    return;
                }
            }

            const projectName = (giteeTaskProjectInput ? giteeTaskProjectInput.value : '').trim() || '智慧医疗便民服务平台项目';
            const assignee = (giteeTaskAssigneeInput ? giteeTaskAssigneeInput.value : '').trim() || '张开发(#dev_user)';
            const apiKey = localStorage.getItem('zentao_deepseek_api_key') || (document.getElementById('inputDeepSeekKey') ? document.getElementById('inputDeepSeekKey').value.trim() : '');

            // 切换为 Loading 状态
            if (giteeAiTaskLoadingBox) giteeAiTaskLoadingBox.style.display = 'block';
            if (giteeAiTaskResultArea) giteeAiTaskResultArea.style.display = 'none';
            if (btnAiTaskConfirmDownload) btnAiTaskConfirmDownload.style.display = 'none';
            if (btnAiTaskFooterImportToZentao) btnAiTaskFooterImportToZentao.style.display = 'none';
            btnStartGiteeAiTaskGen.disabled = true;

            try {
                const res = await fetch(apiUrl('/api/gitee/ai_tasks/generate'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start_date: giteeAiTaskState.startDate,
                        end_date: giteeAiTaskState.endDate,
                        repo: giteeAiTaskState.selectedRepo,
                        project_name: projectName,
                        assigned_to: assignee,
                        api_key: apiKey,
                        commits: giteeAiTaskState.matchedCommits
                    })
                });
                const data = await res.json();

                if (data.code !== 200 || !data.success) {
                    throw new Error(data.message || '生成任务失败');
                }

                giteeAiTaskState.generatedTasks = data.tasks || [];
                giteeAiTaskState.downloadUrl = data.download_url;
                giteeAiTaskState.downloadFilename = data.download_filename;
                giteeAiTaskState.hasModified = false;

                // 填充统计指标
                if (giteeTaskResDateRange) giteeTaskResDateRange.textContent = data.date_range || '全周期';
                if (giteeTaskResCommitCount) giteeTaskResCommitCount.textContent = data.commits_count || 0;
                if (giteeTaskResTaskCount) giteeTaskResTaskCount.textContent = (data.tasks || []).length;
                if (giteeTaskResTotalHours) giteeTaskResTotalHours.textContent = data.total_estimate || 0;

                // 模式标签
                if (giteeTaskResSourceTag) {
                    if (data.source === 'deepseek-agent') {
                        giteeTaskResSourceTag.textContent = '🤖 DeepSeek AI Agent 深度提炼';
                        giteeTaskResSourceTag.style.background = '#f5f3ff';
                        giteeTaskResSourceTag.style.color = '#6d28d9';
                    } else {
                        giteeTaskResSourceTag.textContent = '⚡ 智能启发式聚类提炼';
                        giteeTaskResSourceTag.style.background = '#ecfdf5';
                        giteeTaskResSourceTag.style.color = '#047857';
                    }
                }

                // 渲染预览表格
                renderAiTaskPreviewTable();

                if (giteeAiTaskResultArea) giteeAiTaskResultArea.style.display = 'block';
                if (btnAiTaskConfirmDownload) btnAiTaskConfirmDownload.style.display = 'inline-block';
                if (btnAiTaskFooterImportToZentao) btnAiTaskFooterImportToZentao.style.display = 'inline-block';

            } catch (e) {
                alert('AI 任务生成异常: ' + (e.message || e));
            } finally {
                if (giteeAiTaskLoadingBox) giteeAiTaskLoadingBox.style.display = 'none';
                btnStartGiteeAiTaskGen.disabled = false;
            }
        };
    }

    // 渲染预览任务表格
    function renderAiTaskPreviewTable() {
        if (!giteeAiTaskTableBody) return;
        const tasks = giteeAiTaskState.generatedTasks || [];

        if (tasks.length === 0) {
            giteeAiTaskTableBody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: #94a3b8; padding: 24px;">未提炼出任务工单</td></tr>`;
            return;
        }

        giteeAiTaskTableBody.innerHTML = tasks.map((t, idx) => {
            const types = ['开发', '测试', '运维', '设计', '其他'];
            const typeOpts = types.map(tp => `<option value="${tp}" ${tp === t.type ? 'selected' : ''}>${tp}</option>`).join('');
            const pris = [1, 2, 3, 4];
            const priOpts = pris.map(p => `<option value="${p}" ${p === Number(t.pri) ? 'selected' : ''}>${p}</option>`).join('');

            return `
                <tr data-row-idx="${idx}">
                    <td style="text-align: center; font-weight: 600; color: #64748b;">${idx + 1}</td>
                    <td><input type="text" class="task-cell-input" data-field="project" value="${escapeGiteeHtml(t.project || '')}"></td>
                    <td><input type="text" class="task-cell-input" data-field="module" value="${escapeGiteeHtml(t.module || '')}" placeholder="所属模块"></td>
                    <td><input type="text" class="task-cell-input" data-field="assigned_to" value="${escapeGiteeHtml(t.assigned_to || '')}"></td>
                    <td><input type="text" class="task-cell-input" data-field="name" value="${escapeGiteeHtml(t.name || '')}" style="font-weight: 500;"></td>
                    <td><textarea class="task-cell-textarea" data-field="desc" rows="2">${escapeGiteeHtml(t.desc || '')}</textarea></td>
                    <td><select class="task-cell-select" data-field="type">${typeOpts}</select></td>
                    <td><select class="task-cell-select" data-field="pri">${priOpts}</select></td>
                    <td><input type="number" class="task-cell-input" data-field="estimate" value="${t.estimate || 2}" min="0.5" step="0.5" style="width: 60px;"></td>
                    <td><input type="date" class="task-cell-input" data-field="est_started" value="${escapeGiteeHtml(t.est_started || '')}"></td>
                    <td><input type="date" class="task-cell-input" data-field="deadline" value="${escapeGiteeHtml(t.deadline || '')}"></td>
                    <td style="text-align: center;">
                        <button type="button" class="btn-task-row-del" data-del-row="${idx}" title="删除该条任务">&times;</button>
                    </td>
                </tr>
            `;
        }).join('');

        // 重新计算总工时
        calcAiTaskTotalHours();

        // 绑定单元格编辑事件
        giteeAiTaskTableBody.querySelectorAll('[data-field]').forEach(el => {
            el.addEventListener('input', (e) => {
                const tr = e.target.closest('tr');
                if (!tr) return;
                const idx = parseInt(tr.getAttribute('data-row-idx'), 10);
                const field = e.target.getAttribute('data-field');
                let val = e.target.value;
                if (field === 'estimate') val = parseFloat(val) || 0;
                if (field === 'pri') val = parseInt(val, 10) || 3;
                if (giteeAiTaskState.generatedTasks[idx]) {
                    giteeAiTaskState.generatedTasks[idx][field] = val;
                    giteeAiTaskState.hasModified = true;
                }
                if (field === 'estimate') {
                    calcAiTaskTotalHours();
                }
            });
        });

        // 绑定行删除事件
        giteeAiTaskTableBody.querySelectorAll('[data-del-row]').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.getAttribute('data-del-row'), 10);
                giteeAiTaskState.generatedTasks.splice(idx, 1);
                giteeAiTaskState.hasModified = true;
                renderAiTaskPreviewTable();
                if (giteeTaskResTaskCount) {
                    giteeTaskResTaskCount.textContent = giteeAiTaskState.generatedTasks.length;
                }
            };
        });
    }

    function calcAiTaskTotalHours() {
        const total = (giteeAiTaskState.generatedTasks || []).reduce((acc, t) => acc + (parseFloat(t.estimate) || 0), 0);
        if (giteeTaskResTotalHours) {
            giteeTaskResTotalHours.textContent = Math.round(total * 10) / 10;
        }
    }

    // 添加任务项
    if (btnAiTaskAddRow) {
        btnAiTaskAddRow.onclick = () => {
            const defaultProj = (giteeTaskProjectInput ? giteeTaskProjectInput.value : '').trim() || '智慧医疗便民服务平台项目';
            const defaultAssignee = (giteeTaskAssigneeInput ? giteeTaskAssigneeInput.value : '').trim() || '张开发(#dev_user)';
            const todayStr = formatAiTaskYMD(new Date());

            giteeAiTaskState.generatedTasks.push({
                project: defaultProj,
                module: '业务开发',
                story: '',
                assigned_to: defaultAssignee,
                name: '新任务名称',
                desc: '任务描述与工作内容',
                type: '开发',
                pri: 3,
                estimate: 4,
                est_started: giteeAiTaskState.startDate || todayStr,
                deadline: giteeAiTaskState.endDate || todayStr
            });
            giteeAiTaskState.hasModified = true;
            renderAiTaskPreviewTable();
            if (giteeTaskResTaskCount) {
                giteeTaskResTaskCount.textContent = giteeAiTaskState.generatedTasks.length;
            }
        };
    }

    // 下载 Excel 工单文件
    async function triggerAiTaskExcelDownload() {
        const tasks = giteeAiTaskState.generatedTasks || [];
        if (tasks.length === 0) {
            alert('当前没有可导出的任务工单');
            return;
        }

        // 若用户在表格中微调过任务或尚未生成下载链接，则重新触发后端 Excel 导出
        if (giteeAiTaskState.hasModified || !giteeAiTaskState.downloadUrl) {
            try {
                const res = await fetch(apiUrl('/api/gitee/ai_tasks/export'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tasks: tasks,
                        filename: giteeAiTaskState.downloadFilename
                    })
                });
                const data = await res.json();
                if (data.code === 200 && data.download_url) {
                    giteeAiTaskState.downloadUrl = data.download_url;
                    giteeAiTaskState.downloadFilename = data.download_filename;
                    giteeAiTaskState.hasModified = false;
                } else {
                    throw new Error(data.message || '导出 Excel 失败');
                }
            } catch (e) {
                alert('导出 Excel 异常: ' + e);
                return;
            }
        }

        // 触发浏览器直接下载
        if (giteeAiTaskState.downloadUrl) {
            const a = document.createElement('a');
            a.href = apiUrl(giteeAiTaskState.downloadUrl);
            a.download = giteeAiTaskState.downloadFilename || '任务工单.xlsx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    if (btnAiTaskQuickDownload) {
        btnAiTaskQuickDownload.onclick = triggerAiTaskExcelDownload;
    }
    if (btnAiTaskConfirmDownload) {
        btnAiTaskConfirmDownload.onclick = triggerAiTaskExcelDownload;
    }

    // 直接一键导入到禅道任务
    async function handleDirectImportToZentao() {
        const tasks = giteeAiTaskState.generatedTasks || [];
        if (tasks.length === 0) {
            alert('当前没有可导入的任务工单');
            return;
        }

        const projectName = (giteeTaskProjectInput ? giteeTaskProjectInput.value : '').trim() || '智慧医疗便民服务平台项目';
        if (!confirm(`确定要将当前表格中的 ${tasks.length} 项任务，直接创建并导入到禅道项目【${projectName}】中吗？`)) {
            return;
        }

        const setButtonsLoading = (isLoading) => {
            if (btnAiTaskImportToZentao) {
                btnAiTaskImportToZentao.disabled = isLoading;
                btnAiTaskImportToZentao.textContent = isLoading ? '⏳ 正在直接导入...' : '🚀 直接导入到禅道任务';
            }
            if (btnAiTaskFooterImportToZentao) {
                btnAiTaskFooterImportToZentao.disabled = isLoading;
                btnAiTaskFooterImportToZentao.textContent = isLoading ? '⏳ 正在直接导入...' : '🚀 直接导入到禅道任务';
            }
        };

        setButtonsLoading(true);

        try {
            const res = await fetch(apiUrl('/api/gitee/ai_tasks/import_to_zentao'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tasks: tasks,
                    project_name: projectName
                })
            });
            const data = await res.json();

            if (res.status === 401 || (!data.success && data.code === 401)) {
                alert('提示：' + (data.message || '请先在系统顶部登录禅道账号，再执行直接导入。'));
                const loginBtn = document.getElementById('btnLogin');
                if (loginBtn) loginBtn.click();
                return;
            }

            if (data.code !== 200 || !data.success) {
                throw new Error(data.message || '导入任务失败');
            }

            const succCount = data.success_count || 0;
            const failCount = data.failed_count || 0;
            const zentaoBase = (data.zentao_base_url || '').replace(/\/+$/, '');

            const detailList = (data.results || []).map(r => {
                const icon = r.success ? '✅' : '❌';
                const idTag = r.id ? `<span style="display:inline-block; padding: 1px 6px; background: #e0f2fe; color: #0284c7; border-radius: 4px; font-weight: 600; font-family: monospace; font-size: 11px; margin-right: 6px;">#${r.id}</span>` : '';
                const link = (r.id && zentaoBase) ? `<a href="${zentaoBase}/task-view-${r.id}.html" target="_blank" style="margin-left: 8px; color: #2563eb; text-decoration: underline; font-size: 12px; white-space: nowrap;">查看任务 &rarr;</a>` : '';
                return `<li style="margin-bottom: 6px; padding: 6px 10px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                        ${icon} ${idTag}<strong>${escapeGiteeHtml(r.name)}</strong>
                        <span style="color: ${r.success ? '#16a34a' : '#dc2626'}; font-size: 11px; margin-left: 6px;">${escapeGiteeHtml(r.message)}</span>
                    </div>
                    <div>${link}</div>
                </li>`;
            }).join('');

            showModal('禅道任务直接导入完成', `
                <div style="line-height: 1.6;">
                    <div style="font-size: 15px; font-weight: 600; color: #15803d; margin-bottom: 8px;">
                        🎉 ${escapeGiteeHtml(data.message)}
                    </div>
                    <div style="font-size: 13px; color: #475569; margin-bottom: 10px;">
                        目标项目：<strong>${escapeGiteeHtml(data.project_name || projectName)}</strong> (ID: ${data.project_id || '178'})
                    </div>
                    <ul style="max-height: 280px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 12px; list-style: none; margin: 0 0 10px 0;">
                        ${detailList}
                    </ul>
                    <div style="font-size: 12px; color: #64748b;">
                        提示：任务已在禅道中正式创建，初始状态为待办。左侧“我的待办任务”列表已同步刷新。
                    </div>
                </div>
            `);

            // 标记按钮为已导入
            if (btnAiTaskImportToZentao) {
                btnAiTaskImportToZentao.innerHTML = '✅ 已成功导入禅道';
                btnAiTaskImportToZentao.classList.remove('btn-success');
                btnAiTaskImportToZentao.classList.add('btn-secondary');
            }
            if (btnAiTaskFooterImportToZentao) {
                btnAiTaskFooterImportToZentao.innerHTML = '✅ 已成功导入禅道';
                btnAiTaskFooterImportToZentao.classList.remove('btn-success');
                btnAiTaskFooterImportToZentao.classList.add('btn-secondary');
            }

            // 自动刷新左侧任务列表
            loadMyActiveTasks();

        } catch (e) {
            alert('直接导入禅道异常: ' + (e.message || e));
        } finally {
            setButtonsLoading(false);
        }
    }

    if (btnAiTaskImportToZentao) {
        btnAiTaskImportToZentao.onclick = handleDirectImportToZentao;
    }
    if (btnAiTaskFooterImportToZentao) {
        btnAiTaskFooterImportToZentao.onclick = handleDirectImportToZentao;
    }

    // 初始化加载 AI 对话多会话
    initAiSessions();

    // 首次进入自动加载
    initFilterUserSelect();
    initPTabFinishedBySelect();
    checkStatus();
    checkGiteeStatusQuietly();
    updateGiteeAuthButtonState();
    loadGroups();
    loadMyActiveTasks();
});

