/**
 * 蒋故事记账工具 - 主应用逻辑
 *
 * 功能模块：
 *   1. 登录验证与主题初始化
 *   2. 连接状态管理与健康检查
 *   3. 工具函数（esc、防抖、toast等）
 *   4. 撤销删除（持久化）
 *   5. 分页
 *   6. 排序
 *   7. 云端数据同步（Supabase）
 *   8. 数据初始化
 *   9. CRUD 操作（增删改查）
 *  10. 筛选与快捷日期
 *  11. 表格渲染
 *  12. 统计与金额显示
 *  13. 联想下拉
 *  14. 行内编辑
 *  15. 批量操作
 *  16. 账单生成
 *  17. 数据导出与备份
 *  18. 统计图表
 *  19. 键盘快捷键
 *  20. 移动端手势与悬浮按钮
 */

        // ===== 1. 登录验证 =====
        // 密码配置已移至 config.js
        async function sha256(str) {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // 登录尝试次数限制
        let loginAttempts = 0;
        let loginLockoutUntil = 0;

        async function doLogin() {
            const input = document.getElementById('loginPassword');
            const errEl = document.getElementById('loginError');

            // 检查是否被锁定
            if (Date.now() < loginLockoutUntil) {
                const remaining = Math.ceil((loginLockoutUntil - Date.now()) / 1000);
                errEl.textContent = '登录尝试次数过多，请等待 ' + remaining + ' 秒';
                return;
            }

            const hash = await sha256(input.value);
            if (hash === PASSWORD_HASH) {
                loginAttempts = 0;
                sessionStorage.setItem('loggedIn', '1');
                document.getElementById('loginOverlay').style.display = 'none';
                initApp();
            } else {
                loginAttempts++;
                if (loginAttempts >= APP_CONSTANTS.LOGIN_ATTEMPTS_MAX) {
                    loginLockoutUntil = Date.now() + APP_CONSTANTS.LOGIN_LOCKOUT_DURATION;
                    errEl.textContent = '登录尝试次数过多，请等待 30 秒';
                    showToast('登录尝试次数过多，已锁定30秒', 'error');
                } else {
                    errEl.textContent = '密码错误，请重试 (' + loginAttempts + '/' + APP_CONSTANTS.LOGIN_ATTEMPTS_MAX + ')';
                }
                input.classList.add('error');
                setTimeout(() => input.classList.remove('error'), 500);
                input.value = '';
                input.focus();
            }
        }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && document.getElementById('loginOverlay').style.display !== 'none') doLogin();
        });
        if (sessionStorage.getItem('loggedIn') === '1') {
            document.getElementById('loginOverlay').style.display = 'none';
        }

        // 尽早初始化主题，避免闪烁
        initTheme();

        // 连接状态管理
        let isOnline = false;
        let _cloudFailCount = 0;
        let _lastCloudSync = 0;

        function goOffline(reason) {
            if (!isOnline) return;
            isOnline = false;
            _cloudFailCount = 0;
            setSyncStatus('offline', reason || '离线模式');
            console.warn('切换为离线模式:', reason);
        }

        function goOnline() {
            if (isOnline) return;
            isOnline = true;
            _cloudFailCount = 0;
            setSyncStatus('online', '已连接云端');
            scheduleSave();
        }

        // 定时健康检查，断线自动重连
        let _healthTimer = null;
        function startHealthCheck() {
            clearInterval(_healthTimer);
            _healthTimer = setInterval(async function() {
                if (isOnline) return;
                try {
                    const ctrl = new AbortController();
                    setTimeout(function() { ctrl.abort(); }, 5000);
                    const resp = await fetch(sbUrl('records', '?select=id&limit=1'), { headers: SB_HEADERS, signal: ctrl.signal });
                    if (resp.ok) goOnline();
                } catch(e) { /* 仍未连接 */ }
            }, 30000);
        }

        // ===== 工具函数 =====
        function esc(s) {
            const d = document.createElement('div');
            d.textContent = s || '';
            return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        let _saveTimer = null;
        let _cloudSaveTimer = null;
        function scheduleSave() {
            clearTimeout(_saveTimer);
            _saveTimer = setTimeout(saveData, 300);
            // 云端同步独立防抖，避免频繁调用
            clearTimeout(_cloudSaveTimer);
            _cloudSaveTimer = setTimeout(function() { saveToCloud(records); }, APP_CONSTANTS.CLOUD_SYNC_INTERVAL);
        }
        let _renderPending = false;
        function batchRender() {
            if (_renderPending) return;
            _renderPending = true;
            requestAnimationFrame(function() {
                _renderPending = false;
                renderTable();
                updateStats();
                updateSelectedStats();
            });
        }

        // ===== 防抖工具 =====
        function debounce(fn, ms) {
            let timer;
            return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
        }

        // ===== 暗色模式 =====
        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            updateThemeButton(next);
            updateThemeColor(next);
        }

        function updateThemeButton(theme) {
            const moon = document.getElementById('themeIconMoon');
            const sun = document.getElementById('themeIconSun');
            if (moon) moon.style.display = theme === 'dark' ? 'none' : 'block';
            if (sun) sun.style.display = theme === 'dark' ? 'block' : 'none';
        }

        function updateThemeColor(theme) {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#1e40af');
        }

        function initTheme() {
            let theme = localStorage.getItem('theme');
            if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            document.documentElement.setAttribute('data-theme', theme);
            updateThemeButton(theme);
            updateThemeColor(theme);
        }

        // ===== 金额隐藏/显示 =====
        // FIX: 始终维护真实值，切换只影响显示
        let statsMasked = true;
        const statsRealValues = { totalRecords: '0', totalQty: '0', totalAmount: '¥0' };

        function toggleStatsMask() {
            statsMasked = !statsMasked;
            ['totalRecords', 'totalQty', 'totalAmount'].forEach(function(id) {
                const el = document.getElementById(id);
                if (statsMasked) {
                    el.textContent = '***';
                    el.classList.add('masked');
                } else {
                    el.textContent = statsRealValues[id] || '0';
                    el.classList.remove('masked');
                }
            });
            document.getElementById('eyeIconShow').style.display = statsMasked ? 'none' : 'block';
            document.getElementById('eyeIconHide').style.display = statsMasked ? 'block' : 'none';
        }

        // ===== Toast 通知 =====
        function showToast(message, type, duration) {
            type = type || 'info';
            duration = duration || 3000;
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(function() {
                toast.classList.add('removing');
                setTimeout(function() { toast.remove(); }, 300);
            }, duration);
            return toast;
        }

        // ===== 排序状态 =====
        let sortState = { field: 'date', direction: 'asc' };
        function toggleSort(field) {
            if (sortState.field === field) {
                if (sortState.direction === 'asc') sortState.direction = 'desc';
                else if (sortState.direction === 'desc') { sortState.field = null; sortState.direction = null; }
            } else {
                sortState.field = field;
                sortState.direction = 'asc';
            }
            updateSortHeaders();
            currentPage = 1;
            batchRender();
        }
        function updateSortHeaders() {
            document.querySelectorAll('th.sortable').forEach(function(th) {
                th.classList.remove('sorted');
                const arrow = th.querySelector('.sort-arrow');
                if (arrow) arrow.textContent = '';
            });
            if (!sortState.field) return;
            const cols = ['date','name','project','price','qty','total','paid','method'];
            const idx = cols.indexOf(sortState.field);
            if (idx >= 0) {
                const ths = document.querySelectorAll('th.sortable');
                if (ths[idx]) {
                    ths[idx].classList.add('sorted');
                    const arrow = ths[idx].querySelector('.sort-arrow');
                    if (arrow) arrow.textContent = sortState.direction === 'asc' ? '▲' : '▼';
                }
            }
        }
        function sortRecords(arr) {
            if (!sortState.field) return arr;
            const field = sortState.field;
            const dir = sortState.direction === 'asc' ? 1 : -1;
            return arr.slice().sort(function(a, b) {
                let va = a[field], vb = b[field];
                if (field === 'price' || field === 'qty' || field === 'total') return (va - vb) * dir;
                va = (va || '').toString(); vb = (vb || '').toString();
                return va.localeCompare(vb, 'zh-CN') * dir;
            });
        }

        // ===== 撤销删除 - 持久化 =====
        let deletedStack = [];
        function loadUndoStack() {
            try {
                const saved = localStorage.getItem('deletedStack');
                if (saved) deletedStack = JSON.parse(saved).slice(-APP_CONSTANTS.UNDO_MAX);
            } catch(e) {}
        }
        function saveUndoStack() {
            try { localStorage.setItem('deletedStack', JSON.stringify(deletedStack.slice(-APP_CONSTANTS.UNDO_MAX))); } catch(e) {}
        }
        function undoDelete() {
            if (deletedStack.length === 0) { showToast('没有可撤销的删除', 'info'); return; }
            const item = deletedStack.pop();
            saveUndoStack();
            records.splice(item.index, 0, item.record);
            invalidateFilterCache();
            recalcSeq();
            scheduleSave();
            updateCustomerFilter();
            updateInputLists();
            batchRender();
            showToast('已撤销删除：' + item.record.name + ' - ' + item.record.project, 'success');
        }
        function showUndoToast(record) {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast warning';
            toast.innerHTML = '已删除：' + esc(record.name) + ' - ' + esc(record.project) + ' <button class="undo-btn" onclick="undoDelete();this.parentElement.remove();">撤销</button>';
            container.appendChild(toast);
            setTimeout(function() {
                toast.classList.add('removing');
                setTimeout(function() { toast.remove(); }, 300);
            }, 5000);
        }

        // ===== 分页 =====
        let currentPage = 1;

        function renderPagination(totalFiltered) {
            const totalPages = Math.max(1, Math.ceil(totalFiltered / APP_CONSTANTS.PAGE_SIZE));
            if (currentPage > totalPages) currentPage = totalPages;
            const el = document.getElementById('pagination');
            if (totalPages <= 1) { el.innerHTML = ''; return; }

            let html = '';
            html += `<button onclick="goPage(1)" ${currentPage===1?'disabled':''}>⏮</button>`;
            html += `<button onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>◀</button>`;

            // 显示页码（最多7个）
            let start = Math.max(1, currentPage - 3);
            let end = Math.min(totalPages, start + 6);
            if (end - start < 6) start = Math.max(1, end - 6);
            for (let i = start; i <= end; i++) {
                html += `<button class="${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
            }

            html += `<button onclick="goPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}>▶</button>`;
            html += `<button onclick="goPage(${totalPages})" ${currentPage===totalPages?'disabled':''}>⏭</button>`;
            html += `<span class="page-info">${totalFiltered}条 / ${totalPages}页</span>`;
            el.innerHTML = html;
        }
        function goPage(p) { currentPage = p; renderTable(); document.querySelector('.table-wrap').scrollTop = 0; }

        // ===== 全局状态 =====
        let records = [];
        let currentFilter = { customers: [], paid: '', dateFrom: '', dateTo: '', keyword: '' };
        const dirtyRows = new Set();

        // ===== 同步状态指示 =====
        function setSyncStatus(status, text) {
            const el = document.getElementById('syncStatus');
            const txt = document.getElementById('syncText');
            el.className = 'sync-status ' + status;
            txt.textContent = text;
        }

        // ===== Supabase 数据操作 =====
        async function loadFromCloud() {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(function() { controller.abort(); }, 8000);
                const resp = await fetch(sbUrl('records', '?order=date.desc,seq.asc'), { headers: SB_HEADERS, signal: controller.signal });
                clearTimeout(timeoutId);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                records = data.map(function(r) {
                    return { id: r.id, seq: r.seq, date: r.date, name: r.name || '', project: r.project || '',
                             price: Number(r.price) || 0, qty: r.qty || 1, total: Number(r.total) || 0,
                             paid: r.paid || '', method: r.method || '', remark: r.remark || '' };
                });
                isOnline = true;
                setSyncStatus('online', '已连接云端');
                localStorage.setItem('accountRecords', JSON.stringify(records));
                return true;
            } catch (e) {
                console.warn('云端加载失败，使用本地数据', e);
                isOnline = false;
                setSyncStatus('offline', '离线模式');
                return false;
            }
        }

        // FIX: 改用 UPSERT 替代 DELETE+INSERT，防止数据丢失
        async function saveToCloud(recordsToSave) {
            if (!isOnline) return;
            // 防抖：距上次同步不到间隔时间则跳过
            if (Date.now() - _lastCloudSync < APP_CONSTANTS.CLOUD_SYNC_INTERVAL) return;
            _lastCloudSync = Date.now();

            setSyncStatus('syncing', '同步中...');
            try {
                const resp = await fetch(sbUrl('records', '?select=id'), { headers: SB_HEADERS, signal: abortSignal(8000) });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const existingIds = (await resp.json()).map(r => r.id);
                const localIds = new Set(recordsToSave.map(r => r.id));

                // 增量删除
                const toDelete = existingIds.filter(id => !localIds.has(id));
                for (let i = 0; i < toDelete.length; i += 100) {
                    const batch = toDelete.slice(i, i + 100);
                    await fetch(sbUrl('records', '?id=in.(' + batch.join(',') + ')'), { method: 'DELETE', headers: SB_HEADERS, signal: abortSignal(8000) });
                }

                // 增量 UPSERT（分批50条）
                for (let i = 0; i < recordsToSave.length; i += 50) {
                    const batch = recordsToSave.slice(i, i + 50).map(function(r) {
                        return { id: r.id, seq: r.seq, date: r.date, name: r.name, project: r.project,
                                 price: r.price, qty: r.qty, total: r.total, paid: r.paid || null,
                                 method: r.method || null, remark: r.remark || null };
                    });
                    const r = await fetch(sbUrl('records'), { method: 'POST', headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify(batch), signal: abortSignal(10000) });
                    if (!r.ok) throw new Error('POST failed: ' + r.status);
                }

                _cloudFailCount = 0;
                setSyncStatus('online', '已同步');
            } catch (e) {
                console.warn('云端保存失败', e.message);
                _cloudFailCount++;
                if (_cloudFailCount >= APP_CONSTANTS.CLOUD_FAIL_MAX) goOffline('连续同步失败，已切换离线');
                else setSyncStatus('offline', '同步失败(' + _cloudFailCount + '/' + APP_CONSTANTS.CLOUD_FAIL_MAX + ')，本地已保存');
            }
        }

        function abortSignal(ms) {
            const ctrl = new AbortController();
            setTimeout(function() { ctrl.abort(); }, ms);
            return ctrl.signal;
        }

        // ===== 初始化 =====
        function initApp() {
            (async function() {
                loadUndoStack();
                const cloudOk = await loadFromCloud();
                if (!cloudOk) {
                    try {
                        const saved = localStorage.getItem('accountRecords');
                        records = saved ? JSON.parse(saved) : defaultRecords;
                    } catch (e) {
                        console.warn('读取本地数据失败，使用默认数据', e);
                        records = defaultRecords;
                    }
                } else if (records.length === 0 && defaultRecords.length > 0) {
                    records = defaultRecords.slice();
                    saveToCloud(records);
                    localStorage.setItem('accountRecords', JSON.stringify(records));
                    showToast('默认数据已导入云端', 'success');
                }
                document.getElementById('inputDate').value = new Date().toISOString().split('T')[0];
                updateCustomerFilter();
                updateInputLists();
                setupSuggest('inputName', 'customerSuggest', function() { return [...new Set(records.map(r => r.name))].sort(); });
                setupSuggest('inputProject', 'projectSuggest', function() { return [...new Set(records.map(r => r.project))].sort(); });
                initMonthOptions();
                renderTable();
                updateStats();
                document.getElementById('loadingOverlay').style.display = 'none';
                startHealthCheck();

                // 搜索防抖
                const searchInput = document.getElementById('searchKeyword');
                const debouncedFilter = debounce(applyFilter, 300);
                searchInput.addEventListener('input', debouncedFilter);
            })();
        }
        if (sessionStorage.getItem('loggedIn') === '1') initApp();

        // ===== 数据操作 =====

        // 输入验证
        function validateInput(name, project, price, qty) {
            const errors = [];
            if (!name) errors.push('客户名称');
            if (!project) errors.push('项目');
            if (isNaN(price)) errors.push('单价');
            if (isNaN(qty) || qty < 1) errors.push('数量');
            return errors;
        }

        function clearValidation() {
            document.querySelectorAll('.input-group input.invalid').forEach(el => el.classList.remove('invalid'));
        }

        function markInvalid(ids) {
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('invalid');
            });
            setTimeout(clearValidation, 2000);
        }

        function addRecord() {
            const date = document.getElementById('inputDate').value;
            const name = document.getElementById('inputName').value.trim();
            const project = document.getElementById('inputProject').value.trim();
            const price = parseFloat(document.getElementById('inputPrice').value);
            const qty = parseInt(document.getElementById('inputQty').value);
            let paid = document.getElementById('inputPaid').value;
            const method = document.getElementById('inputMethod').value;
            const remark = document.getElementById('inputRemark').value.trim();

            // 选了付款方式就自动标记为已付
            if (method) paid = '已付';

            const errors = validateInput(name, project, price, qty);
            if (errors.length > 0) {
                showToast('请填写：' + errors.join('、'), 'warning');
                const invalidIds = [];
                if (!name) invalidIds.push('inputName');
                if (!project) invalidIds.push('inputProject');
                if (isNaN(price)) invalidIds.push('inputPrice');
                if (isNaN(qty) || qty < 1) invalidIds.push('inputQty');
                markInvalid(invalidIds);
                return;
            }

            const dayRecords = records.filter(r => r.date === date);
            records.push({
                id: Date.now(),
                seq: dayRecords.length + 1,
                date, name, project, price, qty,
                total: price * qty,
                paid, method, remark
            });

            invalidateFilterCache();
            scheduleSave();
            updateCustomerFilter();
            updateInputLists();
            batchRender();

            document.getElementById('inputName').value = '';
            document.getElementById('inputProject').value = '';
            document.getElementById('inputPrice').value = '';
            document.getElementById('inputQty').value = '1';
            document.getElementById('inputPaid').value = '';
            document.getElementById('inputMethod').value = '';
            document.getElementById('inputRemark').value = '';

            if (window.innerWidth <= 768) toggleInput();
            showToast('记录已添加', 'success');
        }

        function updatePrice(id, value) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            r.price = Math.max(0, parseFloat(value) || 0);
            r.total = r.price * r.qty;
            invalidateFilterCache(); scheduleSave(); batchRender();
        }

        function updateName(id, value) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            r.name = value.trim();
            scheduleSave(); updateCustomerFilter(); updateInputLists();
        }

        function updateProject(id, value) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            r.project = value.trim();
            scheduleSave(); updateInputLists();
        }

        function updateRemark(id, value) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            r.remark = value.trim();
            scheduleSave();
        }

        function updateQty(id, value) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            r.qty = Math.max(1, parseInt(value) || 1);
            r.total = r.price * r.qty;
            invalidateFilterCache(); scheduleSave(); batchRender();
        }

        // FIX: 删除 updateTotal，总价只能由 price*qty 自动计算

        function markRowDirty(id) { dirtyRows.add(id); }

        function saveIfDirty(id) {
            if (!dirtyRows.has(id)) return;
            dirtyRows.delete(id);
            const r = records.find(r => r.id === id);
            if (!r) return;
            const row = document.querySelector('tr[data-row-id="' + id + '"]');
            if (!row) return;

            const paySelect = row.querySelector('.pay-edit');
            const methodSelect = row.querySelector('.method-edit');
            if (paySelect) r.paid = paySelect.value ? '已付' : '';
            if (methodSelect) r.method = methodSelect.value;
            if (r.paid && !r.method) r.method = '微信';
            if (!r.paid) r.method = '';

            scheduleSave();
            updateRowDisplay(id);
            updateStats();
            updateCustomerFilter();
        }

        function updateRowDisplay(id) {
            const r = records.find(r => r.id === id);
            if (!r) return;
            const row = document.querySelector('tr[data-row-id="' + id + '"]');
            if (!row) return;
            const payDisplay = row.querySelector('.pay-display');
            if (payDisplay) {
                payDisplay.textContent = r.paid || '未付';
                payDisplay.className = 'pay-display ' + (r.paid ? 'paid' : 'unpaid');
            }
            const methodDisplay = row.querySelector('.method-display');
            if (methodDisplay) methodDisplay.textContent = r.method || '';
        }

        function deleteRecord(id) {
            if (!confirm('确定删除这条记录？')) return;
            const idx = records.findIndex(function(r) { return r.id === id; });
            if (idx < 0) return;
            const removed = records.splice(idx, 1)[0];
            deletedStack.push({ record: removed, index: idx });
            if (deletedStack.length > APP_CONSTANTS.UNDO_MAX) deletedStack.shift();
            saveUndoStack();
            invalidateFilterCache();
            recalcSeq();
            scheduleSave();
            updateCustomerFilter();
            updateInputLists();
            batchRender();
            showUndoToast(removed);
        }

        function recalcSeq() {
            const dateMap = {};
            records.forEach(r => {
                if (!dateMap[r.date]) dateMap[r.date] = 0;
                r.seq = ++dateMap[r.date];
            });
        }

        // ===== 筛选 =====

        function setPaidFilter(value, btn) {
            document.querySelectorAll('.paid-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilter();
        }

        function applyFilter() {
            const c1 = document.getElementById('filterCustomer1').value;
            const c2 = document.getElementById('filterCustomer2').value;
            currentFilter.customers = [c1, c2].filter(v => v);
            const activePaidBtn = document.querySelector('.paid-filter-btn.active');
            currentFilter.paid = activePaidBtn ? activePaidBtn.dataset.paid : '';
            currentFilter.dateFrom = document.getElementById('filterDateFrom').value;
            currentFilter.dateTo = document.getElementById('filterDateTo').value;
            currentFilter.keyword = (document.getElementById('searchKeyword').value || '').trim().toLowerCase();
            document.querySelectorAll('.quick-date .btn-filter').forEach(b => b.classList.remove('active'));
            currentPage = 1;
            invalidateFilterCache();
            updateCustomerFilter();
            batchRender();
        }

        function resetFilter() {
            document.getElementById('filterCustomer1').value = '';
            document.getElementById('filterCustomer2').value = '';
            document.querySelectorAll('.paid-filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.paid-filter-btn[data-paid=""]').classList.add('active');
            document.getElementById('filterDateFrom').value = '';
            document.getElementById('filterDateTo').value = '';
            document.getElementById('searchKeyword').value = '';
            document.getElementById('quickMonth').value = '';
            currentFilter = { customers: [], paid: '', dateFrom: '', dateTo: '', keyword: '' };
            currentPage = 1;
            invalidateFilterCache();
            updateCustomerFilter();
            batchRender();
        }

        // ===== 手机端筛选/输入切换 =====
        function toggleFilter() {
            document.getElementById('filterArea').classList.toggle('open');
        }
        // ===== 可拖动悬浮按钮 =====
        (function() {
            const fab = document.getElementById('fabBtn');
            if (!fab) return;
            let isDragging = false, hasMoved = false;
            let startX, startY, startLeft, startBottom;

            function getPos() {
                const rect = fab.getBoundingClientRect();
                return { left: rect.left, bottom: window.innerHeight - rect.bottom };
            }

            fab.addEventListener('touchstart', function(e) {
                const touch = e.touches[0];
                startX = touch.clientX;
                startY = touch.clientY;
                const pos = getPos();
                startLeft = pos.left;
                startBottom = pos.bottom;
                isDragging = true;
                hasMoved = false;
                fab.style.transition = 'none';
            }, { passive: true });

            fab.addEventListener('touchmove', function(e) {
                if (!isDragging) return;
                const touch = e.touches[0];
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
                if (!hasMoved) return;
                e.preventDefault();
                let newLeft = startLeft + dx;
                let newBottom = startBottom - dy;
                newLeft = Math.max(8, Math.min(window.innerWidth - 60, newLeft));
                newBottom = Math.max(8, Math.min(window.innerHeight - 60, newBottom));
                fab.style.setProperty('left', newLeft + 'px', 'important');
                fab.style.setProperty('bottom', newBottom + 'px', 'important');
                fab.style.setProperty('right', 'auto', 'important');
            }, { passive: false });

            fab.addEventListener('touchend', function() {
                isDragging = false;
                fab.style.transition = 'transform .2s';
                if (!hasMoved) { toggleInput(); _fabTapped = Date.now(); }
            });
            // 兼容 PC 端模拟手机点击
            let _fabTapped = 0;
            fab.addEventListener('click', function() {
                if (Date.now() - _fabTapped < 400) return;
                toggleInput();
            });
        })();

        function toggleInput() {
            const area = document.querySelector('.input-area');
            const overlay = document.getElementById('fabOverlay');
            if (area.classList.contains('show')) {
                area.classList.remove('show');
                overlay.classList.remove('show');
            } else {
                area.classList.add('show');
                overlay.classList.add('show');
                document.getElementById('inputDate').value = new Date().toISOString().split('T')[0];
            }
        }

        function setQuickMonth(val) {
            if (!val) return;
            const [y, m] = val.split('-').map(Number);
            const from = y + '-' + String(m).padStart(2,'0') + '-01';
            const lastDay = new Date(y, m, 0).getDate();
            const to = y + '-' + String(m).padStart(2,'0') + '-' + String(lastDay).padStart(2,'0');
            document.getElementById('filterDateFrom').value = from;
            document.getElementById('filterDateTo').value = to;
            applyFilter();
        }

        // 快捷日期：上月、前一天支持连续点击
        function setQuickDate(type, btn) {
            const today = new Date();
            const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            let from, to;
            const curFrom = document.getElementById('filterDateFrom').value;
            const baseDate = curFrom ? new Date(curFrom + 'T00:00:00') : today;

            switch (type) {
                case 'today':
                    from = to = fmt(today);
                    break;
                case 'yesterday': {
                    // 连续点击：基于当前起始日期往前推一天
                    const d = new Date(baseDate);
                    d.setDate(d.getDate() - 1);
                    from = to = fmt(d);
                    break;
                }
                case 'week': {
                    const day = today.getDay() || 7;
                    const mon = new Date(today);
                    mon.setDate(today.getDate() - day + 1);
                    from = fmt(mon); to = fmt(today);
                    break;
                }
                case 'month':
                    from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
                    to = fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0));
                    break;
                case 'lastMonth': {
                    // 连续点击：基于当前起始日期往前推一个月
                    const y = baseDate.getFullYear();
                    const m = baseDate.getMonth();
                    from = fmt(new Date(y, m - 1, 1));
                    to = fmt(new Date(y, m, 0));
                    break;
                }
            }
            document.getElementById('filterDateFrom').value = from;
            document.getElementById('filterDateTo').value = to;
            document.getElementById('quickMonth').value = '';
            document.querySelectorAll('.quick-date .btn-filter').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            applyFilter();
        }

        function initMonthOptions() {
            const sel = document.getElementById('quickMonth');
            if (!sel) return;
            let minDate = new Date();
            if (records.length) {
                const dates = records.map(r => r.date).sort();
                minDate = new Date(dates[0]);
            }
            const now = new Date();
            let y = minDate.getFullYear(), m = minDate.getMonth() + 1;
            while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
                const opt = document.createElement('option');
                opt.value = y + '-' + String(m).padStart(2,'0');
                opt.textContent = y + '年' + m + '月';
                sel.appendChild(opt);
                m++;
                if (m > 12) { m = 1; y++; }
            }
        }

        let _filterCache = null, _filterValid = false;
        function invalidateFilterCache() { _filterValid = false; }
        function getFilteredRecords() {
            if (_filterValid && _filterCache) return _filterCache;
            _filterCache = records.filter(r => {
                if (currentFilter.customers.length && !currentFilter.customers.includes(r.name)) return false;
                if (currentFilter.paid === 'paid' && !r.paid) return false;
                if (currentFilter.paid === 'unpaid' && r.paid) return false;
                if (currentFilter.dateFrom && r.date < currentFilter.dateFrom) return false;
                if (currentFilter.dateTo && r.date > currentFilter.dateTo) return false;
                if (currentFilter.keyword) {
                    const kw = currentFilter.keyword;
                    if (!r.name.toLowerCase().includes(kw) && !r.project.toLowerCase().includes(kw) && !(r.remark || '').toLowerCase().includes(kw)) return false;
                }
                return true;
            });
            _filterValid = true;
            return _filterCache;
        }

        // ===== 渲染（XSS 安全 + 分页 + 移动端点击编辑） =====

        function renderTable() {
            const tbody = document.getElementById('recordTable');
            const allFiltered = sortRecords(getFilteredRecords());
            const totalFiltered = allFiltered.length;
            const totalPages = Math.max(1, Math.ceil(totalFiltered / APP_CONSTANTS.PAGE_SIZE));

            // 分页切片
            const startIdx = (currentPage - 1) * APP_CONSTANTS.PAGE_SIZE;
            const filtered = allFiltered.slice(startIdx, startIdx + APP_CONSTANTS.PAGE_SIZE);

            let runningQty = 0, runningTotal = 0;

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#94a3b8;padding:30px;">暂无记录</td></tr>';
                renderPagination(totalFiltered);
                return;
            }

            // 使用 DocumentFragment 优化 DOM 操作
            const fragment = document.createDocumentFragment();

            filtered.forEach(r => {
                runningQty += r.qty;
                runningTotal += r.total;
                const tr = document.createElement('tr');
                tr.setAttribute('data-row-id', r.id);
                tr.setAttribute('onmouseleave', 'saveIfDirty(' + r.id + ')');
                tr.innerHTML = '<td><input type="checkbox" class="row-checkbox" data-id="' + r.id + '" onchange="updateSelectedStats()"></td>' +
                    '<td>' + r.seq + '</td>' +
                    '<td>' + esc(r.date) + '</td>' +
                    '<td class="edit-cell" onclick="mobileEditCell(this)">' +
                        '<span class="text-display">' + esc(r.name) + '</span>' +
                        '<input type="text" class="inline-select select-edit" value="' + esc(r.name) + '" onchange="updateName(' + r.id + ', this.value)">' +
                    '</td>' +
                    '<td class="edit-cell" onclick="mobileEditCell(this)">' +
                        '<span class="text-display">' + esc(r.project) + '</span>' +
                        '<input type="text" class="inline-select select-edit" value="' + esc(r.project) + '" onchange="updateProject(' + r.id + ', this.value)">' +
                    '</td>' +
                    '<td class="edit-cell" onclick="mobileEditCell(this)">' +
                        '<span class="text-display">¥' + r.price + '</span>' +
                        '<input type="number" class="inline-select select-edit" value="' + r.price + '" onchange="updatePrice(' + r.id + ', this.value)">' +
                    '</td>' +
                    '<td class="edit-cell" onclick="mobileEditCell(this)">' +
                        '<span class="text-display">' + r.qty + '</span>' +
                        '<input type="number" class="inline-select select-edit" value="' + r.qty + '" min="1" onchange="updateQty(' + r.id + ', this.value)">' +
                    '</td>' +
                    '<td>¥' + r.total + '</td>' +
                    '<td style="position:relative;" onmouseenter="showEdit(this)" onmouseleave="hideEdit(this)" onclick="mobileEditCell(this)">' +
                        '<span class="pay-display ' + (r.paid ? 'paid' : 'unpaid') + '">' + (r.paid || '未付') + '</span>' +
                        '<select class="inline-select pay-edit" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;width:90%;" onchange="markRowDirty(' + r.id + ');saveIfDirty(' + r.id + ')" onclick="event.stopPropagation()">' +
                            '<option value="" ' + (r.paid ? '' : 'selected') + '>未付</option>' +
                            '<option value="已付" ' + (r.paid ? 'selected' : '') + '>已付</option>' +
                        '</select>' +
                    '</td>' +
                    '<td style="position:relative;" onmouseenter="showEdit(this)" onmouseleave="hideEdit(this)" onclick="mobileEditCell(this)">' +
                        '<span class="method-display">' + esc(r.method) + '</span>' +
                        '<select class="inline-select method-edit" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;width:90%;" onchange="var payRow=this.closest(\'tr\').querySelector(\'.pay-edit\');if(payRow)payRow.value=this.value?\'已付\':\'\';markRowDirty(' + r.id + ');saveIfDirty(' + r.id + ')" onclick="event.stopPropagation()">' +
                            '<option value="" ' + (r.method ? '' : 'selected') + '></option>' +
                            '<option value="微信" ' + (r.method == '微信' ? 'selected' : '') + '>微信</option>' +
                            '<option value="支付宝" ' + (r.method == '支付宝' ? 'selected' : '') + '>支付宝</option>' +
                            '<option value="现金" ' + (r.method == '现金' ? 'selected' : '') + '>现金</option>' +
                            '<option value="建行码" ' + (r.method == '建行码' ? 'selected' : '') + '>建行码</option>' +
                            '<option value="备注" ' + (r.method == '备注' ? 'selected' : '') + '>备注</option>' +
                        '</select>' +
                    '</td>' +
                    '<td class="edit-cell" style="min-width:120px;" onclick="mobileEditCell(this)">' +
                        '<span class="text-display">' + esc(r.remark || '') + '</span>' +
                        '<input type="text" class="inline-select select-edit" value="' + esc(r.remark || '') + '" onchange="updateRemark(' + r.id + ', this.value)">' +
                    '</td>' +
                    '<td><button class="delete-btn" onclick="deleteRecord(' + r.id + ')">删除</button></td>';
                fragment.appendChild(tr);
            });

            // 清空并批量插入
            tbody.innerHTML = '';
            tbody.appendChild(fragment);

            renderPagination(totalFiltered);
        }

        // FIX: 统计金额显示bug - 始终维护真实值
        function updateStats() {
            const filtered = getFilteredRecords();
            statsRealValues.totalRecords = String(filtered.length);
            statsRealValues.totalQty = String(filtered.reduce((s, r) => s + r.qty, 0));
            statsRealValues.totalAmount = '¥' + filtered.reduce((s, r) => s + r.total, 0);

            ['totalRecords', 'totalQty', 'totalAmount'].forEach(function(id) {
                const el = document.getElementById(id);
                if (statsMasked) {
                    el.textContent = '***';
                    el.classList.add('masked');
                } else {
                    el.textContent = statsRealValues[id];
                    el.classList.remove('masked');
                }
            });
        }

        function updateCustomerFilter() {
            const activeBtn = document.querySelector('.paid-filter-btn.active');
            const paidFilter = activeBtn ? activeBtn.dataset.paid : '';
            let customers;
            if (paidFilter === 'unpaid') customers = [...new Set(records.filter(r => !r.paid).map(r => r.name))].sort();
            else if (paidFilter === 'paid') customers = [...new Set(records.filter(r => r.paid).map(r => r.name))].sort();
            else customers = [...new Set(records.map(r => r.name))].sort();

            ['filterCustomer1', 'filterCustomer2'].forEach(id => {
                const sel = document.getElementById(id);
                const val = sel.value;
                sel.innerHTML = '<option value="">全部</option>' + customers.map(n => '<option value="' + esc(n) + '" ' + (n === val ? 'selected' : '') + '>' + esc(n) + '</option>').join('');
            });
        }

        // ===== 自定义联想下拉 =====
        let _suggestIdx = -1;
        function setupSuggest(inputId, listId, dataFn) {
            const input = document.getElementById(inputId);
            const list = document.getElementById(listId);
            if (!input || !list) return;

            input.addEventListener('input', function() {
                const val = this.value.trim().toLowerCase();
                if (!val) { list.classList.remove('show'); return; }
                const items = dataFn().filter(d => d.toLowerCase().includes(val));
                if (!items.length) { list.classList.remove('show'); return; }
                list.innerHTML = items.map(d => '<div class="suggest-item" data-val="' + esc(d) + '">' + esc(d) + '</div>').join('');
                list.classList.add('show');
                _suggestIdx = -1;
            });

            input.addEventListener('focus', function() {
                if (!this.value.trim()) {
                    const items = dataFn();
                    if (items.length) {
                        list.innerHTML = items.slice(0, 20).map(d => '<div class="suggest-item" data-val="' + esc(d) + '">' + esc(d) + '</div>').join('');
                        list.classList.add('show');
                    }
                }
            });

            list.addEventListener('click', function(e) {
                const item = e.target.closest('.suggest-item');
                if (!item) return;
                input.value = item.dataset.val;
                list.classList.remove('show');
                input.dispatchEvent(new Event('change'));
            });

            input.addEventListener('keydown', function(e) {
                const items = list.querySelectorAll('.suggest-item');
                if (!items.length || !list.classList.contains('show')) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); _suggestIdx = Math.min(_suggestIdx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === _suggestIdx)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); _suggestIdx = Math.max(_suggestIdx - 1, 0); items.forEach((it, i) => it.classList.toggle('active', i === _suggestIdx)); }
                else if (e.key === 'Enter' && _suggestIdx >= 0) { e.preventDefault(); input.value = items[_suggestIdx].dataset.val; list.classList.remove('show'); input.dispatchEvent(new Event('change')); }
                else if (e.key === 'Escape') { list.classList.remove('show'); }
            });

            document.addEventListener('click', function(e) {
                if (!input.contains(e.target) && !list.contains(e.target)) list.classList.remove('show');
            });
        }

        function updateInputLists() {
            // 数据源已更新，联想在输入时实时过滤
        }

        function autoFillPrice() {
            const project = document.getElementById('inputProject').value.trim();
            if (!project) return;
            const matched = records.filter(r => r.project === project);
            if (matched.length > 0) {
                const latest = matched.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                document.getElementById('inputPrice').value = latest.price;
            }
        }

        // ===== 行内编辑（支持移动端点击） =====

        // FIX: 移动端用 click 触发编辑
        function mobileEditCell(cell) {
            if (window.innerWidth > 768) return; // 桌面端用 hover
            // 关闭其他已打开的编辑
            document.querySelectorAll('.mobile-active').forEach(c => {
                if (c !== cell) c.classList.remove('mobile-active');
            });
            cell.classList.toggle('mobile-active');
            // 自动聚焦输入框或选择框
            const input = cell.querySelector('.select-edit, .pay-edit, .method-edit');
            if (input && cell.classList.contains('mobile-active')) {
                input.style.display = 'inline-block';
                const span = cell.querySelector('span');
                if (span) span.style.display = 'none';
                setTimeout(() => input.focus(), 50);
            } else if (input) {
                input.style.display = 'none';
                const span = cell.querySelector('span');
                if (span) span.style.display = '';
            }
        }

        function showEdit(cell) {
            if (window.innerWidth <= 768) return; // 移动端用 click
            const display = cell.querySelector('span');
            const select = cell.querySelector('select');
            if (display) display.style.display = 'none';
            if (select) select.style.display = 'inline-block';
        }

        function hideEdit(cell) {
            if (window.innerWidth <= 768) return;
            const display = cell.querySelector('span');
            const select = cell.querySelector('select');
            if (display) display.style.display = 'inline-block';
            if (select) select.style.display = 'none';
        }

        // ===== 全选/批量 =====

        function toggleSelectAll() {
            const checked = document.getElementById('selectAll').checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
            updateSelectedStats();
        }

        function updateSelectedStats() {
            const checked = document.querySelectorAll('.row-checkbox:checked');
            let selQty = 0, selAmount = 0;
            checked.forEach(cb => {
                const r = records.find(r => r.id === parseInt(cb.getAttribute('data-id')));
                if (r) { selQty += r.qty; selAmount += r.total; }
            });
            document.getElementById('selectedRecords').textContent = checked.length;
            document.getElementById('selectedQty').textContent = selQty;
            document.getElementById('selectedAmount').textContent = '¥' + selAmount;
        }

        function batchPay() {
            const checked = document.querySelectorAll('.row-checkbox:checked');
            if (!checked.length) { showToast('请先勾选要修改的记录！', 'warning'); return; }
            const payStatus = document.getElementById('batchPayStatus').value;
            const payMethod = document.getElementById('batchPayMethod').value;
            const statusText = payStatus ? '已付' : '未付';
            if (!confirm('确定将选中的 ' + checked.length + ' 条记录改为「' + statusText + ' - ' + payMethod + '」？')) return;

            checked.forEach(cb => {
                const r = records.find(r => r.id === parseInt(cb.getAttribute('data-id')));
                if (r) {
                    if (payStatus) { r.paid = '已付'; r.method = payMethod; }
                    else { r.paid = ''; r.method = ''; }
                }
            });
            scheduleSave(); batchRender();
            showToast('批量修改完成！', 'success');
        }

        // ===== 账单 =====

        function generateBill() {
            const c1 = document.getElementById('filterCustomer1').value;
            const c2 = document.getElementById('filterCustomer2').value;
            const customers = [c1, c2].filter(v => v);
            if (!customers.length) { showToast('请先选择一个客户！', 'warning'); return; }

            // 根据当前筛选状态决定账单类型
            const activePaidBtn = document.querySelector('.paid-filter-btn.active');
            const paidFilter = activePaidBtn ? activePaidBtn.dataset.paid : '';

            // 跟随筛选状态：未结账→未付 / 已结账→已付 / 全部→所有记录
            let billRecords;
            let billTypeLabel;
            if (paidFilter === 'paid') {
                billRecords = records.filter(r => customers.includes(r.name) && r.paid);
                billTypeLabel = '已结账对账单';
            } else if (paidFilter === 'unpaid') {
                billRecords = records.filter(r => customers.includes(r.name) && !r.paid);
                billTypeLabel = '未结账结算单';
            } else {
                billRecords = records.filter(r => customers.includes(r.name));
                billTypeLabel = '客户对账单';
            }

            billRecords = billRecords.sort((a, b) => a.date.localeCompare(b.date));
            if (!billRecords.length) { showToast('该客户没有符合条件的记录！', 'info'); return; }

            const today = new Date().toLocaleDateString('zh-CN');
            let html = '<div class="bill-card" style="position:relative;overflow:hidden;">';
            // 斜向水印：-28°排列，大间距，隐约可见
            const logoSize = 70, gapX = logoSize * 4, gapY = logoSize * 3.5;
            for (let row = -1; row <= 4; row++) {
                for (let col = -1; col <= 7; col++) {
                    const left = col * gapX + (row % 2 === 0 ? 0 : gapX / 2);
                    const top = row * gapY;
                    html += '<img src="LOGO.png" alt="" style="position:absolute;left:'+left+'px;top:'+top+'px;width:'+logoSize+'px;opacity:0.06;transform:rotate(-28deg);pointer-events:none;">';
                }
            }
            html += '<div style="position:relative;z-index:1;">';
            html += '<div class="bill-title">📋 ' + esc(billTypeLabel) + '</div>';
            html += '<div class="bill-info">' +
                '<div><span class="bill-info-label">客户：</span><span class="bill-info-value">' + esc(customers.join('、')) + '</span></div>' +
                '<div><span class="bill-info-label">账单发送日期：</span><span class="bill-info-value">' + esc(today) + '</span></div>' +
            '</div>';

            // 带表头的表格布局
            html += '<div class="bill-header">' +
                '<span class="h-no">序号</span>' +
                '<span class="h-date">日期</span>' +
                '<span class="h-project">维修项目</span>' +
                '<span class="h-price">单价</span>' +
                '<span class="h-qty">数量</span>' +
                '<span class="h-total">总价</span>' +
            '</div>';

            let total = 0;
            billRecords.forEach((r, i) => {
                total += r.total;
                html += '<div class="bill-item">' +
                    '<span class="bill-item-no">' + (i + 1) + '</span>' +
                    '<span class="bill-item-date">' + esc(r.date) + '</span>' +
                    '<span class="bill-item-project">' + esc(r.project) + '</span>' +
                    '<span class="bill-item-price">¥' + r.price + '</span>' +
                    '<span class="bill-item-qty">' + r.qty + '</span>' +
                    '<span class="bill-item-total">¥' + r.total + '</span>' +
                '</div>';
            });

            html += '<div class="bill-amount">合计：¥' + total + '</div>';
            html += '<div class="bill-footer">' +
                '<div class="bill-footer-text">📍 安徽省芜湖市镜湖区融汇中江广场西区3楼328号</div>' +
                '<div class="bill-footer-text" style="margin-top:5px;">📞 15655305888（微信同号）</div>' +
            '</div></div></div>';

            document.getElementById('billContent').innerHTML = html;
            document.getElementById('billModal').style.display = 'block';
        }

        // FIX: 关闭弹窗时重置拖拽位置
        function closeModal() {
            document.getElementById('billModal').style.display = 'none';
            const mc = document.getElementById('modalContent');
            mc.style.transform = '';
            xOffset = 0; yOffset = 0;
        }

        function copyBill() {
            navigator.clipboard.writeText(document.getElementById('billContent').innerText)
                .then(function() { showToast('账单已复制到剪贴板！', 'success'); })
                .catch(function() { showToast('复制失败，请手动复制', 'error'); });
        }

        function exportBillAsImage() {
            const billEl = document.getElementById('billContent').querySelector('.bill-card');
            if (!billEl) { showToast('没有可导出的账单！', 'warning'); return; }
            const btn = event.target;
            btn.textContent = '⏳ 生成中...';
            btn.disabled = true;

            html2canvas(billEl, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                onclone: function(clonedDoc) {
                    const clonedCard = clonedDoc.querySelector('.bill-card');
                    if (clonedCard) {
                        clonedCard.style.padding = '20px';
                        clonedCard.style.background = '#fff';
                    }
                }
            }).then(function(canvas) {
                const link = document.createElement('a');
                const customer = [document.getElementById('filterCustomer1').value, document.getElementById('filterCustomer2').value].filter(v=>v).join('_') || '账单';
                link.download = customer + '_账单_' + new Date().toISOString().slice(0,10) + '.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
                btn.textContent = '📸 导出图片'; btn.disabled = false;
            }).catch(function(err) {
                showToast('导出失败：' + err.message, 'error');
                btn.textContent = '📸 导出图片'; btn.disabled = false;
            });
        }

        window.onclick = e => {
            if (e.target === document.getElementById('billModal')) closeModal();
            if (e.target === document.getElementById('chartModal')) closeChartModal();
        };

        // 拖动弹窗（支持多个弹窗）
        let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0, activeContent = null;

        function setupModalDrag(modalId) {
            const mc = document.getElementById(modalId);
            if (!mc) return;
            const content = mc.querySelector('.modal-content');
            if (!content) return;
            content.addEventListener('mousedown', e => {
                if (['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
                isDragging = true;
                activeContent = content;
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
            });
        }

        setupModalDrag('billModal');
        setupModalDrag('chartModal');

        document.addEventListener('mouseup', () => { initialX = currentX; initialY = currentY; isDragging = false; activeContent = null; });
        document.addEventListener('mousemove', e => {
            if (!isDragging || !activeContent) return;
            e.preventDefault();
            currentX = e.clientX - initialX; currentY = e.clientY - initialY;
            xOffset = currentX; yOffset = currentY;
            activeContent.style.transform = 'translate(calc(-50% + ' + currentX + 'px), ' + currentY + 'px)';
        });

        // ===== 离开页面提醒 =====
        window.addEventListener('beforeunload', e => {
            if (_saveTimer || dirtyRows.size > 0) {
                e.preventDefault();
                e.returnValue = '有未保存的更改，确定离开吗？';
            }
        });

        // ===== 数据持久化 =====

        function saveData() {
            try {
                localStorage.setItem('accountRecords', JSON.stringify(records));
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    showToast('⚠️ 本地存储空间已满！云端已同步', 'warning', 5000);
                } else {
                    showToast('本地保存失败：' + e.message, 'error');
                }
            }
        }

        function manualBackup() {
            let csv = '序号,日期,客户名称,项目,单价,数量,总价,付款情况,付款方式,备注\n';
            records.forEach(r => {
                const row = [r.seq, r.date, r.name, r.project, r.price, r.qty, r.total, r.paid || '未付', r.method || '', r.remark || '']
                    .map(v => String(v).includes(',') ? '"' + v + '"' : v).join(',');
                csv += row + '\n';
            });
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = '记账备份_' + new Date().toISOString().slice(0,19).replace(/:/g, '-') + '.csv';
            link.click();
            showToast('备份已下载！', 'success');
        }

        function restoreBackup() { document.getElementById('restoreFile').click(); }

        // FIX: 恢复时强制 total = price * qty，支持合并模式
        function handleRestore(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = e => {
                const lines = e.target.result.split('\n').filter(l => l.trim());
                const newRecords = [];
                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    if (cols.length >= 8) {
                        const price = parseFloat(cols[4]) || 0;
                        const qty = parseInt(cols[5]) || 1;
                        newRecords.push({
                            id: Date.now() + i, seq: cols[0] || '', date: cols[1] || '', name: cols[2] || '',
                            project: cols[3] || '', price, qty,
                            total: price * qty, // FIX: 强制重新计算
                            paid: cols[7] === '未付' ? '' : cols[7], method: cols[8] || '', remark: cols[9] || ''
                        });
                    }
                }
                if (newRecords.length > 0) {
                    const choice = confirm('找到 ' + newRecords.length + ' 条记录。\n\n确定 = 覆盖现有数据\n取消 = 合并（追加到现有数据）');
                    if (choice) {
                        records = newRecords;
                    } else {
                        records = records.concat(newRecords);
                    }
                    recalcSeq();
                    saveData(); updateCustomerFilter(); updateInputLists(); batchRender();
                    showToast('恢复成功！共 ' + newRecords.length + ' 条记录', 'success');
                } else { showToast('没有找到有效的记录！', 'error'); }
            };
            reader.readAsText(file);
            event.target.value = '';
        }

        function parseCSVLine(line) {
            const result = [];
            let current = '', inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i+1] === '"') { current += '"'; i++; }
                    else if (ch === '"') { inQuotes = false; }
                    else { current += ch; }
                } else {
                    if (ch === '"') { inQuotes = true; }
                    else if (ch === ',') { result.push(current); current = ''; }
                    else { current += ch; }
                }
            }
            result.push(current);
            return result;
        }

        function clearAll() {
            if (confirm('确定清空所有记录？此操作不可恢复！')) {
                records = [];
                deletedStack = [];
                saveUndoStack();
                saveData(); updateCustomerFilter(); updateInputLists(); batchRender();
                showToast('已清空所有记录', 'info');
            }
        }

        function exportToExcel() {
            if (typeof XLSX !== 'undefined') {
                const filtered = sortRecords(getFilteredRecords());
                let runningQty = 0, runningTotal = 0;
                const data = filtered.map(r => {
                    runningQty += r.qty;
                    runningTotal += r.total;
                    return {
                        '序号': r.seq, '日期': r.date,
                        '客户名称': r.name, '项目': r.project,
                        '单价': r.price, '数量': r.qty, '总价': r.total,
                        '付款情况': r.paid || '未付',
                        '付款方式': r.method || '',
                        '备注': r.remark || '',
                        '累计数量': runningQty, '累计金额': runningTotal
                    };
                });
                const ws = XLSX.utils.json_to_sheet(data);
                ws['!cols'] = [{ wch: 6 },{ wch: 12 },{ wch: 12 },{ wch: 25 },{ wch: 8 },{ wch: 6 },{ wch: 10 },{ wch: 8 },{ wch: 8 },{ wch: 15 },{ wch: 10 },{ wch: 12 }];
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, '记账数据');
                XLSX.writeFile(wb, '记账本_' + new Date().toISOString().split('T')[0] + '.xlsx');
                showToast('导出成功！', 'success');
            } else {
                const filtered = sortRecords(getFilteredRecords());
                let csv = '序号,日期,客户名称,项目,单价,数量,总价,付款情况,付款方式,备注,总数量,总计\n';
                let runningQty = 0, runningTotal = 0;
                filtered.forEach(r => {
                    runningQty += r.qty; runningTotal += r.total;
                    const row = [r.seq, r.date, r.name, r.project, r.price, r.qty, r.total, r.paid || '', r.method || '', r.remark || '', runningQty, runningTotal]
                        .map(v => String(v).includes(',') ? '"' + v + '"' : v).join(',');
                    csv += row + '\n';
                });
                const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = '记账本_' + new Date().toISOString().split('T')[0] + '.csv';
                link.click();
                showToast('CSV 导出成功！', 'success');
            }
        }

        // ===== 统计图表 =====
        let monthlyChartInstance = null;
        let paidChartInstance = null;
        let customerChartInstance = null;

        function showChart() {
            if (typeof Chart === 'undefined') {
                showToast('图表功能加载失败，请刷新页面重试', 'error');
                return;
            }
            document.getElementById('chartModal').style.display = 'block';
            renderCharts();
        }

        function closeChartModal() {
            document.getElementById('chartModal').style.display = 'none';
        }

        function renderCharts() {
            const filtered = getFilteredRecords();

            // 1. 月度收支趋势图
            const monthMap = {};
            filtered.forEach(r => {
                const month = r.date.substring(0, 7);
                if (!monthMap[month]) monthMap[month] = { paid: 0, unpaid: 0 };
                if (r.paid) monthMap[month].paid += r.total;
                else monthMap[month].unpaid += r.total;
            });
            const months = Object.keys(monthMap).sort();
            const paidData = months.map(m => monthMap[m].paid);
            const unpaidData = months.map(m => monthMap[m].unpaid);

            if (monthlyChartInstance) monthlyChartInstance.destroy();
            monthlyChartInstance = new Chart(document.getElementById('monthlyChart'), {
                type: 'bar',
                data: {
                    labels: months.map(m => m.substring(5) + '月'),
                    datasets: [
                        { label: '已结账', data: paidData, backgroundColor: 'rgba(5,150,105,0.7)' },
                        { label: '未结账', data: unpaidData, backgroundColor: 'rgba(220,38,38,0.7)' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { title: { display: true, text: '月度收支趋势' } },
                    scales: { x: { stacked: true }, y: { stacked: true } }
                }
            });

            // 2. 付款状态饼图
            const paidTotal = filtered.filter(r => r.paid).reduce((s, r) => s + r.total, 0);
            const unpaidTotal = filtered.filter(r => !r.paid).reduce((s, r) => s + r.total, 0);

            if (paidChartInstance) paidChartInstance.destroy();
            paidChartInstance = new Chart(document.getElementById('paidChart'), {
                type: 'doughnut',
                data: {
                    labels: ['已结账', '未结账'],
                    datasets: [{ data: [paidTotal, unpaidTotal], backgroundColor: ['rgba(5,150,105,0.8)', 'rgba(220,38,38,0.8)'] }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { title: { display: true, text: '付款状态' } }
                }
            });

            // 3. 客户排名柱状图
            const customerMap = {};
            filtered.forEach(r => {
                if (!customerMap[r.name]) customerMap[r.name] = 0;
                customerMap[r.name] += r.total;
            });
            const sorted = Object.entries(customerMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

            if (customerChartInstance) customerChartInstance.destroy();
            customerChartInstance = new Chart(document.getElementById('customerChart'), {
                type: 'bar',
                data: {
                    labels: sorted.map(s => s[0]),
                    datasets: [{ label: '消费金额', data: sorted.map(s => s[1]), backgroundColor: 'rgba(37,99,235,0.7)' }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: { title: { display: true, text: '客户消费排名（Top 10）' } }
                }
            });
        }

        // Enter键添加记录
        document.querySelectorAll('.input-group input').forEach(input => {
            input.addEventListener('keypress', e => { if (e.key === 'Enter') addRecord(); });
        });

        // FIX: 全局快捷键 - 输入框内不拦截 Ctrl+Z
        document.addEventListener('keydown', function(e) {
            const tag = (e.target.tagName || '').toLowerCase();
            const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

            // Ctrl+Z - 撤销删除（输入框外）
            if (e.ctrlKey && e.key === 'z' && !isInput) { e.preventDefault(); undoDelete(); }

            // Ctrl+S - 快速备份
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); manualBackup(); showToast('正在下载备份...', 'info'); }

            // Esc - 关闭弹窗
            if (e.key === 'Escape') { closeModal(); closeChartModal(); }

            // Ctrl+N - 新增记录（聚焦到输入区）
            if (e.ctrlKey && e.key === 'n' && !isInput) {
                e.preventDefault();
                if (window.innerWidth <= 768) {
                    toggleInput();
                }
                document.getElementById('inputName').focus();
                showToast('已聚焦到输入区', 'info');
            }

            // Ctrl+F - 聚焦搜索框
            if (e.ctrlKey && e.key === 'f' && !isInput) {
                e.preventDefault();
                document.getElementById('searchKeyword').focus();
            }

            // Ctrl+Shift+E - 导出数据
            if (e.ctrlKey && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                exportToExcel();
                showToast('正在导出数据...', 'info');
            }

            // Ctrl+Shift+B - 备份数据
            if (e.ctrlKey && e.shiftKey && e.key === 'B') {
                e.preventDefault();
                manualBackup();
                showToast('正在下载备份...', 'info');
            }
        });

        // 点击页面其他区域关闭移动端编辑
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.edit-cell')) {
                document.querySelectorAll('.edit-cell.mobile-active').forEach(c => c.classList.remove('mobile-active'));
            }
        });

        // ===== 全局错误捕获 =====
        window.addEventListener('error', function(e) {
            console.error('全局错误:', e.error);
            showToast('发生了一个错误，请刷新页面重试', 'error');
        });

        window.addEventListener('unhandledrejection', function(e) {
            console.error('未处理的 Promise 错误:', e.reason);
            showToast('网络请求失败，请检查网络连接', 'error');
        });

        // ===== 网络状态监听 =====
        window.addEventListener('online', function() {
            showToast('网络已恢复', 'success');
            if (!isOnline) goOnline();
        });

        window.addEventListener('offline', function() {
            showToast('网络已断开，切换到离线模式', 'warning');
            goOffline('网络断开');
        });

        // ===== 触摸手势支持 =====

        // 下拉刷新 - 仅在页面顶部时触发
        (function() {
            let pullStartY = 0;
            let isPulling = false;
            let pullIndicator = null;
            let isRefreshing = false;

            // 创建下拉指示器
            function createPullIndicator() {
                if (pullIndicator) return;
                pullIndicator = document.createElement('div');
                pullIndicator.className = 'pull-refresh-indicator';
                pullIndicator.innerHTML = '<div class="pull-refresh-spinner"></div><span>下拉刷新</span>';
                pullIndicator.style.cssText = 'position:fixed;top:-60px;left:50%;transform:translateX(-50%);background:#fff;padding:12px 24px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);display:flex;align-items:center;gap:8px;transition:top 0.3s ease;z-index:1000;';
                document.body.appendChild(pullIndicator);
            }

            // 只在表格区域顶部监听下拉
            const tableWrap = document.querySelector('.table-wrap');
            if (!tableWrap) return;

            tableWrap.addEventListener('touchstart', function(e) {
                // 只在滚动位置为0时触发
                if (tableWrap.scrollTop === 0) {
                    pullStartY = e.touches[0].clientY;
                    isPulling = true;
                    createPullIndicator();
                }
            }, { passive: true });

            tableWrap.addEventListener('touchmove', function(e) {
                if (!isPulling || !pullIndicator || isRefreshing) return;
                const pullY = e.touches[0].clientY;
                const pullDistance = pullY - pullStartY;

                if (pullDistance > 0 && pullDistance < 150) {
                    pullIndicator.style.top = (pullDistance - 60) + 'px';
                    if (pullDistance > 80) {
                        pullIndicator.querySelector('span').textContent = '释放刷新';
                    } else {
                        pullIndicator.querySelector('span').textContent = '下拉刷新';
                    }
                }
            }, { passive: true });

            tableWrap.addEventListener('touchend', function(e) {
                if (!isPulling || !pullIndicator || isRefreshing) return;
                const pullEndY = e.changedTouches[0].clientY;
                const pullDistance = pullEndY - pullStartY;

                if (pullDistance > 80) {
                    // 触发刷新
                    isRefreshing = true;
                    pullIndicator.querySelector('span').textContent = '刷新中...';
                    pullIndicator.style.top = '10px';

                    // 执行刷新
                    loadFromCloud().then(function(success) {
                        if (success) {
                            batchRender();
                            showToast('数据已刷新', 'success');
                        } else {
                            showToast('刷新失败，请检查网络', 'warning');
                        }
                        pullIndicator.style.top = '-60px';
                        isRefreshing = false;
                    }).catch(function() {
                        pullIndicator.style.top = '-60px';
                        showToast('刷新失败，请检查网络', 'warning');
                        isRefreshing = false;
                    });
                } else {
                    pullIndicator.style.top = '-60px';
                }

                isPulling = false;
                setTimeout(function() {
                    if (pullIndicator) {
                        pullIndicator.remove();
                        pullIndicator = null;
                    }
                }, 300);
            }, { passive: true });
        })();