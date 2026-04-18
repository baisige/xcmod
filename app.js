    // Use the secure API provided by preload.js
    // All window.api.* calls are async (IPC invoke), must use .then() or async/await

    let currentGame = null;
    let currentPid = null;
    
    let isScanning = false;
    let _scanGeneration = 0;  // 扫描代号，用于忽略停止扫描后的过期回调

    async function loadGames() {
      var list = document.getElementById('gameList');
      if (!list) return;
      list.innerHTML = '';
      try {
        var games = await window.api.getGames();
        
        // 更新插件数量显示
        var pluginCountEl = document.getElementById('pluginCount');
        if (pluginCountEl) {
          pluginCountEl.textContent = games && games.length > 0 ? games.length : 0;
        }
        
        if (!games || games.length === 0) {
          list.innerHTML = '<div style="padding:8px;color:#888;">暂无游戏配置</div>';
          return;
        }
        games.forEach(function(game, idx) {
          var div = document.createElement('div');
          div.className = 'game-item' + (currentGame === game.name ? ' selected' : '');
          // 整个卡片可点击选中，删除按钮阻止冒泡
          div.dataset.idx = idx;
          div.onclick = function(e) {
            // 如果点的是删除/编辑按钮，不触发选中
            if (e.target.classList.contains('game-delete-btn') || e.target.classList.contains('game-edit-btn')) return;
            selectGame(parseInt(this.dataset.idx));
          };
          div.innerHTML = '<span class="game-name-text">' + game.name + '</span>'
            + '<button class="game-edit-btn" onclick="event.stopPropagation();showEditGameDialog(' + idx + ')" title="编辑此插件">&#9998;</button>'
            + '<button class="game-delete-btn" onclick="event.stopPropagation();deleteGamePlugin(\'' + (game.id || '') + '\',\'' + (game.name || '').replace(/'/g, "\\'") + '\')" title="删除此插件">&times;</button>';
          list.appendChild(div);
        });
      } catch(e) {
        console.error(e);
        list.innerHTML = '<div style="padding:8px;color:#a44;">加载失败</div>';
      }
    }

    function deleteGamePlugin(id, name) {
      var confirmMsg = window.currentLanguage === 'en' ? 'Are you sure you want to delete plugin "' + (name || id) + '"?' : '确定要删除插件 "' + (name || id) + '" 吗？';
      if (!confirm(confirmMsg)) return;
      window.api.deletePlugin(id).then(function(result) {
        if (result.success) {
          // 如果删除的是当前选中的游戏，清除选中状态
          if (currentGame) {
            window.api.getGames().then(function(games) {
              var stillExists = games && games.some(function(g) { return g.name === currentGame; });
              if (!stillExists) { currentGame = null; }
              loadGames();
              renderCheatPanel();
            });
          } else {
            loadGames();
          }
        } else {
          alert('删除失败: ' + (result.error || ''));
        }
      });
    }

    // ===== 统一弹窗辅助函数 =====
    function closeXdDialog(dlgId) {
      var dlg = document.getElementById(dlgId);
      if (!dlg) return;
      dlg.classList.add('closing');
      setTimeout(function() { if (dlg.parentNode) dlg.remove(); }, 160);
    }
    // Escape 键关闭弹窗
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var openDlg = document.querySelector('.xd-dialog:not(.closing)');
        if (openDlg) { closeXdDialog(openDlg.id); return; }
        // 也处理日志弹窗
        var logOverlay = document.getElementById('logDialogOverlay');
        if (logOverlay && logOverlay.style.display !== 'none') { hideLogDialog(); return; }
        // 处理插件管理器
        closePluginManager();
      }
    });

    // 编辑游戏信息（名称、描述）
    var _editingGameIdx = -1;

    function showEditGameDialog(idx) {
      _editingGameIdx = idx;
      var isEn = window.currentLanguage === 'en';
      window.api.getGames().then(function(games) {
        if (!games || !games[idx]) return;
        var game = games[idx];

        var oldDlg = document.getElementById('editGameDialog');
        if (oldDlg) oldDlg.remove();

        var dlg = document.createElement('div');
        dlg.id = 'editGameDialog';
        dlg.className = 'xd-dialog';
        dlg.innerHTML = ''
          + '<div class="xd-dialog-backdrop" onclick="closeEditGameDialog()"></div>'
          + '<div class="xd-dialog-box">'
          + '  <div class="xd-dialog-header">'
          + '    <div class="xd-dialog-icon">&#9998;</div>'
          + '    <h3 class="xd-dialog-title">' + (isEn ? 'Edit Game Info' : '编辑游戏信息') + '</h3>'
          + '    <button class="xd-dialog-close" onclick="closeEditGameDialog()">&times;</button>'
          + '  </div>'
          + '  <div class="xd-dialog-body">'
          + '    <label class="xd-form-label">' + (isEn ? 'Game Name' : '游戏名称') + ' <span class="required">*</span></label>'
          + '    <input type="text" id="editGameName" class="xd-input" value="' + escapeHtml(game.name || '') + '" placeholder="' + (isEn ? 'Enter game name' : '输入游戏名称') + '">'
          + '    <label class="xd-form-label">' + (isEn ? 'Game Description' : '游戏描述') + '</label>'
          + '    <textarea id="editGameDesc" class="xd-input" rows="3" placeholder="' + (isEn ? 'Brief description of this game plugin' : '简短描述这个游戏插件') + '">' + escapeHtml(game.description || '') + '</textarea>'
          + '  </div>'
          + '  <div class="xd-dialog-footer">'
          + '    <button type="button" class="xd-btn xd-btn-cancel" onclick="closeEditGameDialog()">' + (isEn ? 'Cancel' : '取消') + '</button>'
          + '    <button type="button" class="xd-btn xd-btn-primary" onclick="confirmEditGame()">' + (isEn ? 'Save' : '保存') + '</button>'
          + '  </div>'
          + '</div>';
        document.body.appendChild(dlg);
        setTimeout(function() {
          var el = document.getElementById('editGameName');
          if (el) { el.focus(); el.select(); }
        }, 80);
      });
    }

    function closeEditGameDialog() {
      closeXdDialog('editGameDialog');
      _editingGameIdx = -1;
    }

    async function confirmEditGame() {
      if (_editingGameIdx < 0) return;
      var nameInput = document.getElementById('editGameName');
      var descInput = document.getElementById('editGameDesc');
      var newName = nameInput ? nameInput.value.trim() : '';
      var newDesc = descInput ? descInput.value.trim() : '';

      if (!newName) {
        alert('游戏名称不能为空！');
        return;
      }

      try {
        var result = await window.api.editGameInfo(_editingGameIdx, newName, newDesc);
        if (result && result.success) {
          // 如果改的是当前选中游戏，同步更新 currentGame
          if (currentGame && result.oldName === currentGame) {
            currentGame = newName;
            updateScanGameHint({ executable: result.executable || '' });
          }
          closeEditGameDialog();
          loadGames();
          renderCheatPanel();
          appendLog('[编辑] 游戏信息已更新: ' + newName, 'success');
        } else {
          alert('保存失败: ' + (result ? result.error : '未知错误'));
        }
      } catch(e) {
        alert('保存失败: ' + e.message);
      }
    }

    async function selectGame(idx) {
      var games = await window.api.getGames();
      if (!games || !games[idx]) return;
      currentGame = games[idx].name;

      // 更新扫描区域的可执行文件名提示
      updateScanGameHint(games[idx]);

      loadGames();
      refreshProcesses();
      renderCheatPanel();
    }

    function updateScanGameHint(game) {
      var hintEl = document.getElementById('scanGameHint');
      if (!hintEl) return;
      var exe = game.executable || game.exe || '';
      if (exe) {
        hintEl.innerHTML = '目标: <span class="hint-exe">' + escapeHtml(exe) + '</span>';
        hintEl.style.display = '';
      } else {
        hintEl.style.display = 'none';
      }
    }

    async function highlightMatchedProcess() {
      if (!currentGame) return;
      var games = await window.api.getGames();
      var game = games.find(function(g) { return g.name === currentGame; });
      if (!game || !game.processName) return;
      var target = game.processName.toLowerCase();

      // 在自定义下拉框列表中找到匹配项并选中
      var items = document.querySelectorAll('.proc-item');
      for (var i = 0; i < items.length; i++) {
        var name = items[i].dataset.name || '';
        if (name.toLowerCase() === target) {
          var pid = parseInt(items[i].dataset.pid);
          selectProcess(pid, name, null);
          // 高亮该项
          items.forEach(function(it) { it.classList.remove('selected'); });
          items[i].classList.add('selected');
          break;
        }
      }
    }

    // 全局存储进程列表，供搜索过滤使用
    window._allProcesses = [];

    async function refreshProcesses() {
      var trigger = document.getElementById('procDropdownTrigger');
      var listEl = document.getElementById('procDropdownList');
      if (!trigger || !listEl) return;

      var textEl = document.getElementById('procSelectedText');
      if (textEl) textEl.textContent = '加载中...';

      // 清空搜索框（仅当搜索框未被聚焦时，避免打断用户输入）
      var searchInput = document.getElementById('procSearchInput');
      if (searchInput && document.activeElement !== searchInput) {
        searchInput.value = '';
      }

      var processes;
      try {
        processes = await window.api.getProcessList();
      } catch(e) {
        console.error(e);
        if (textEl) textEl.textContent = '加载失败';
        return;
      }

      var currentSelPid = currentPid;

      // 只清除进程项，保留搜索框
      var existingItems = listEl.querySelectorAll('.proc-item');
      for (var ei = 0; ei < existingItems.length; ei++) { existingItems[ei].remove(); }
      var noResult = listEl.querySelector('.proc-no-result');
      if (noResult) noResult.remove();

      if (!processes || processes.length === 0) {
        var emptyDiv = document.createElement('div');
        emptyDiv.className = 'proc-no-result';
        emptyDiv.style.cssText = 'padding:12px;color:#888;text-align:center;font-size:12px;';
        emptyDiv.textContent = '未找到进程';
        listEl.appendChild(emptyDiv);
        if (textEl) textEl.textContent = '无进程';
        window._allProcesses = [];
        return;
      }

      // 保存到全局供搜索使用
      window._allProcesses = processes;

      // 按名称分组，方便区分重名
      var nameCount = {};
      processes.forEach(function(p) { nameCount[p.name] = (nameCount[p.name] || 0) + 1; });

      // 第一遍：立即渲染所有项（无图标），保证秒开
      var iconPlaceholder = '<span class="proc-item-icon" style="background:rgba(255,255,255,0.08);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#666;">?</span>';

      processes.forEach(function(p) {
        var item = document.createElement('div');
        item.className = 'proc-item';
        if (p.pid === currentSelPid) item.classList.add('selected');
        item.dataset.pid = p.pid;
        item.dataset.name = p.name;
        item.dataset.path = p.path || '';

        var isDuplicate = nameCount[p.name] > 1;
        var pathDisplay = p.path ? p.path.replace(/\\/g, '\\').split('\\').pop() : '';

        item.innerHTML = ''
          + iconPlaceholder
          + '<div class="proc-item-info">'
          + '  <div class="proc-item-name">' + escapeHtml(p.name) + '</div>'
          + '  <div class="proc-item-pid">PID: ' + p.pid + (isDuplicate ? '  |  ' + escapeHtml(pathDisplay) : '') + '</div>'
          + '</div>';

        item.onclick = function() {
          selectProcess(parseInt(this.dataset.pid), this.dataset.name, null);
          closeProcDropdown();
        };

        listEl.appendChild(item);
      });

      // 更新触发器显示
      if (currentSelPid) {
        highlightMatchedProcess();
      } else {
        if (textEl) textEl.textContent = '选择进程... (' + processes.length + ' 个进程)';
        var iconEl = document.getElementById('procSelectedIcon');
        if (iconEl) iconEl.style.display = 'none';
      }

      // 异步：只给可见项（前20个）加载图标，不阻塞 UI
      loadVisibleProcessIcons(processes);
    }

    // 延迟加载可见进程的图标（最多20个）
    async function loadVisibleProcessIcons(processes) {
      // 收集有路径的进程的 path，限制前20个
      var paths = [];
      for (var i = 0; i < Math.min(processes.length, 20); i++) {
        if (processes[i].path) paths.push(processes[i].path);
      }
      if (paths.length === 0) return;

      try {
        var icons = await window.api.getProcessIcons(paths);
        if (!icons || typeof icons !== 'object') return;

        // 构建 path -> icon 的映射，更新对应 DOM 项
        var listContainer = document.getElementById('procDropdownList');
        var items = listContainer ? listContainer.querySelectorAll('.proc-item') : [];
        items.forEach(function(item) {
          var path = item.dataset.path;
          if (path && icons[path]) {
            var imgContainer = item.querySelector('.proc-item-icon');
            if (imgContainer) {
              imgContainer.outerHTML = '<img class="proc-item-icon" src="' + icons[path] + '" alt="">';
            }
          }
        });

        // 如果当前选中项有图标，也更新触发栏图标
        var curIconEl = document.getElementById('procSelectedIcon');
        if (curIconEl && currentPid) {
          var selectedItem = listContainer.querySelector('.proc-item.selected');
          if (selectedItem) {
            var selPath = selectedItem.dataset.path;
            if (selPath && icons[selPath]) {
              curIconEl.src = icons[selPath];
              curIconEl.style.display = '';
            }
          }
        }
      } catch(e) {
        // 图标加载失败不影响主流程
      }
    }

    function toggleProcDropdown() {
      var dropdown = document.getElementById('procDropdown');
      if (!dropdown) return;
      var isOpening = !dropdown.classList.contains('open');
      dropdown.classList.toggle('open');
      // 打开时聚焦搜索框
      if (isOpening) {
        var searchInput = document.getElementById('procSearchInput');
        if (searchInput) {
          setTimeout(function() { searchInput.focus(); }, 50);
        }
      }
    }

    // 搜索过滤进程列表
    function filterProcessList(keyword) {
      keyword = (keyword || '').toLowerCase().trim();
      var listEl = document.getElementById('procDropdownList');
      if (!listEl) return;

      var items = listEl.querySelectorAll('.proc-item');
      var visibleCount = 0;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var name = (item.dataset.name || '').toLowerCase();
        var pidStr = (item.dataset.pid || '');
        // 匹配进程名或PID
        var match = !keyword || name.indexOf(keyword) >= 0 || pidStr.indexOf(keyword) >= 0;
        item.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      }

      // 显示/隐藏"无结果"提示
      var noResult = listEl.querySelector('.proc-no-result');
      if (visibleCount === 0 && keyword && items.length > 0) {
        if (!noResult) {
          noResult = document.createElement('div');
          noResult.className = 'proc-no-result';
          noResult.style.cssText = 'padding:12px;color:#888;text-align:center;font-size:12px;';
          listEl.appendChild(noResult);
        }
        noResult.textContent = '未找到匹配 "' + escapeHtml(keyword) + '" 的进程';
        noResult.style.display = '';
      } else if (noResult) {
        noResult.style.display = 'none';
      }
    }

    // 绑定搜索框输入事件
    (function() {
      var searchInput = document.getElementById('procSearchInput');
      if (searchInput) {
        // 用 oninput 实时过滤，防抖 100ms
        var timer = null;
        searchInput.addEventListener('input', function() {
          clearTimeout(timer);
          timer = setTimeout(function() {
            filterProcessList(this.value);
          }.bind(this), 80);
        });
        // 回车选中第一个可见项
        searchInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            var listEl = document.getElementById('procDropdownList');
            if (!listEl) return;
            var visibleItems = listEl.querySelectorAll('.proc-item[style=""], .proc-item:not([style])');
            if (visibleItems.length > 0) {
              visibleItems[0].click();
            }
          }
          // 上下键导航
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var listEl2 = document.getElementById('procDropdownList');
            if (!listEl2) return;
            var vis = listEl2.querySelectorAll('.proc-item[style=""], .proc-item:not([style])');
            var curIdx = -1;
            for (var vi = 0; vi < vis.length; vi++) {
              if (vis[vi].classList.contains('selected')) { curIdx = vi; break; }
            }
            var nextIdx = e.key === 'ArrowDown'
              ? Math.min(curIdx + 1, vis.length - 1)
              : Math.max(curIdx - 1, 0);
            for (var hj = 0; hj < vis.length; hj++) vis[hj].classList.remove('selected');
            if (vis[nextIdx]) vis[nextIdx].classList.add('selected');
            vis[nextIdx].scrollIntoView({ block: 'nearest' });
          }
        });
      }
    })();

    function closeProcDropdown() {
      var dropdown = document.getElementById('procDropdown');
      if (dropdown) dropdown.classList.remove('open');
      // 关闭时清空搜索，恢复全部显示
      var searchInput = document.getElementById('procSearchInput');
      if (searchInput) { searchInput.value = ''; }
      filterProcessList('');
    }

    // 点击外部关闭下拉框
    document.addEventListener('click', function(e) {
      var dropdown = document.getElementById('procDropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        closeProcDropdown();
      }
    });

    function selectProcess(pid, name, icon) {
      currentPid = pid;
      var textEl = document.getElementById('procSelectedText');
      if (textEl) textEl.textContent = name + ' (' + pid + ')';
      var iconEl = document.getElementById('procSelectedIcon');
      if (iconEl) {
        if (icon) {
          iconEl.src = icon;
          iconEl.style.display = '';
        } else {
          iconEl.style.display = 'none';
        }
      }
      var curProcEl = document.getElementById('currentProcess');
      if (curProcEl) curProcEl.textContent = name + ' (' + pid + ')';
      highlightMatchedProcess();
    }

    // ========== 日志系统（弹窗模式）==========

    // 日志存储数组（始终收集，关闭弹窗不影响）
    var _logEntries = [];
    var _maxLogEntries = 500;
    var _logDialogVisible = false;

    function appendLog(msg, type) {
      var now = new Date();
      var timeStr = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ':' + ('0' + now.getSeconds()).slice(-2);
      var html = '<span class="log-time">' + timeStr + '</span>' + escapeHtml(msg);

      _logEntries.push({ html: html, type: type || '' });

      // 限制条数
      if (_logEntries.length > _maxLogEntries) {
        _logEntries.shift();
      }

      // 仅在弹窗打开时更新DOM（关闭时日志照常存入数组）
      if (_logDialogVisible) {
        renderLogToPanel();
        updateLogCount();
      }
    }

    function renderLogToPanel() {
      var panel = document.getElementById('logContent');
      if (!panel) return;

      // 批量渲染：用 innerHTML 一次性写入，避免逐条 appendNode 导致高频操作卡顿
      var frag = '';
      for (var i = 0; i < _logEntries.length; i++) {
        frag += '<div class="log-entry' + (_logEntries[i].type ? ' log-' + _logEntries[i].type : '') + '">' + _logEntries[i].html + '</div>';
      }
      panel.innerHTML = frag;
      panel.scrollTop = panel.scrollHeight;
    }

    function updateLogCount() {
      var el = document.getElementById('logCount');
      if (el) el.textContent = _logEntries.length + ' 条';
    }

    function showLogDialog() {
      var overlay = document.getElementById('logDialogOverlay');
      if (!overlay) return;
      overlay.style.display = '';
      _logDialogVisible = true;
      // 打开时从数组重新渲染全部日志
      renderLogToPanel();
      updateLogCount();
    }

    function hideLogDialog() {
      var overlay = document.getElementById('logDialogOverlay');
      if (!overlay) return;
      overlay.style.display = 'none';
      _logDialogVisible = false;
      // 不清空数组！日志继续收集
    }

    function clearLog() {
      _logEntries = [];
      var panel = document.getElementById('logContent');
      if (panel) panel.innerHTML = '';
      updateLogCount();
    }

    function escapeHtml(s) {
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(s));
      return d.innerHTML;
    }

    // 监听主进程日志，显示在日志面板中
    if (window.api.onMainLog) {
      window.api.onMainLog(function(msg) {
        console.log('[主进程]', msg);
        // 根据内容判断日志类型
        var type = 'info';
        if (msg.indexOf('ERROR') >= 0 || msg.indexOf('error') >= 0 || msg.indexOf('failed') >= 0 || msg.indexOf('FAILED') >= 0) {
          type = 'error';
        } else if (msg.indexOf('DONE') >= 0 || msg.indexOf('OK') >= 0 || msg.indexOf('success') >= 0) {
          type = 'success';
        } else if (msg.indexOf('WARN') >= 0 || msg.indexOf('timeout') >= 0) {
          type = 'warning';
        }
        appendLog(msg, type);
      });
    }

    // 监听扫描进度，实时更新UI + 日志
    if (window.api.onScanProgress) {
      window.api.onScanProgress(function(msg) {
        const progressText = document.getElementById('scanProgressText');
        const progressBar = document.getElementById('scanProgressBar');
        const progressPct = document.getElementById('scanProgressPct');
        const regionMatch = msg.match(/regions=(\d+)/);
        const kbMatch = msg.match(/readKB=([\d.]+)/);
        const resultMatch = msg.match(/results=(\d+)/);
        if (progressText) {
          let text = '正在扫描内存...';
          if (regionMatch) text += ' 区域 ' + regionMatch[1];
          if (kbMatch) text += ' 已读取 ' + Math.round(parseFloat(kbMatch[1])) + ' KB';
          if (resultMatch && parseInt(resultMatch[1]) > 0) {
            text += ' | 找到 ' + resultMatch[1] + ' 个匹配!';
          }
          progressText.textContent = text;
        }
        if (progressBar) {
          progressBar.style.display = 'block';
          if (kbMatch) {
            const readMB = parseFloat(kbMatch[1]) / 1024;
            const pct = Math.min(98, Math.round(readMB / 5));
            progressBar.style.width = pct + '%';
            if (progressPct) progressPct.textContent = pct + '%';
          }
        }
        // 同时写入日志面板
        appendLog('[进度] ' + msg, 'debug');
      });
    }

    function startScan() {
      // 立即标记为扫描中，防止重复点击
      if (isScanning) {
        return;
      }
      isScanning = true;
      // 如果已有扫描在进行（极少数竞态条件），递增代号
      _scanGeneration++;
      if (!currentPid) {
        alert('请先选择一个进程！');
        return;
      }
      var valueInput1 = document.getElementById('scanValue1');
      var typeSelect = document.getElementById('dataType');
      var value = valueInput1 ? valueInput1.value.trim() : '';
      var dataType = typeSelect ? typeSelect.value : 'int';

      if (value === '') {
        alert('请输入要搜索的数值！');
        return;
      }

      isScanning = true;
      _scanGeneration++;  // 新扫描，递增代号

      // 捕获当前代号，回调中用于判断是否过期
      var myGen = _scanGeneration;

      // 记录当前扫描参数，供筛选和"添加到插件"使用
      window._lastScanValue = value;
      window._lastScanType = dataType;
      window._firstScanResults = null;   // 首次扫描结果（持久保留）
      window._filteredResults = null;     // 筛选后结果

      // 重置第二次输入和重新扫描按钮
      var value2Group = document.getElementById('scanValue2Group');
      var value2Input = document.getElementById('scanValue2');
      var rescanBtn = document.getElementById('rescanBtn');
      if (value2Group) value2Group.classList.remove('active');
      if (value2Input) { value2Input.disabled = true; value2Input.value = ''; }
      if (rescanBtn) { rescanBtn.disabled = true; rescanBtn.textContent = '重新扫描'; }

      var scanBtn = document.getElementById('startScanBtn');
      var stopBtn = document.getElementById('stopScanBtn');
      var resultsDiv = document.getElementById('scanResults');
      var progressContainer = document.getElementById('scanProgress');

      if (scanBtn) { scanBtn.disabled = true; scanBtn.style.display = 'none'; }
      if (stopBtn) stopBtn.style.display = '';
      if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#aaa;">正在扫描中，请稍候...</div>';
      if (progressContainer) progressContainer.style.display = '';

      window.api.scanMemory(currentPid, value, dataType).then(function(result) {
        // 检查是否已过期（用户已停止或开始了新扫描）
        if (myGen !== _scanGeneration) {
          appendLog('[扫描] 过期回调已忽略 (gen=' + myGen + ' vs current=' + _scanGeneration + ')', 'debug');
          return;
        }
        finishScan();

        if (!result || !result.success) {
          if (result && result.message && result.message.includes('停止')) {
            if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#e0a000;">扫描已由用户停止</div>';
            return;
          }
          var errMsg = result && result.error ? result.error : '未知错误';
          if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#c44;">扫描失败: ' + errMsg + '</div>';
          return;
        }

        var addresses = result.results;
        if (!addresses || addresses.length === 0) {
          if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#e0a000;">未找到匹配的地址。尝试其他数据类型或数值。</div>';
          return;
        }

        // 保存首次扫描结果（持久保留，筛选不会清除）
        window._firstScanResults = addresses;
        window._filteredResults = null;

        // 启用第二次输入框和重新扫描按钮
        var value2Group = document.getElementById('scanValue2Group');
        var value2Input = document.getElementById('scanValue2');
        var rescanBtn = document.getElementById('rescanBtn');
        if (value2Group) value2Group.classList.add('active');
        if (value2Input) { value2Input.disabled = false; }
        if (rescanBtn) { rescanBtn.disabled = false; }

        renderScanResults();
      }).catch(function(err) {
        if (myGen !== _scanGeneration) return;  // 过期回调忽略
        finishScan();
        if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#c44;">扫描异常: ' + (err.message || err) + '</div>';
      });
    }

    function stopScan() {
      _scanGeneration++;  // 停止扫描，使当前扫描的回调失效
      window.api.stopScan().then(function(result) {
        console.log('Stop scan:', result);
      });
      finishScan();
      var resultsDiv = document.getElementById('scanResults');
      if (resultsDiv) {
        var stoppingMsg = document.createElement('div');
        stoppingMsg.style.cssText = 'padding:10px;color:#e0a000;';
        stoppingMsg.textContent = '正在停止扫描...';
        resultsDiv.appendChild(stoppingMsg);
      }
    }

    function finishScan() {
      // 防止重复调用（例如多个扫描回调同时完成）
      if (isScanning === false) return;
      
      isScanning = false;
      var scanBtn = document.getElementById('startScanBtn');
      var stopBtn = document.getElementById('stopScanBtn');
      var progressContainer = document.getElementById('scanProgress');

      if (scanBtn) { scanBtn.disabled = false; scanBtn.style.display = ''; }
      if (stopBtn) stopBtn.style.display = 'none';
      if (progressContainer) progressContainer.style.display = 'none';
    }

    function selectAddress(el) {
      var items = document.querySelectorAll('.result-item.selected');
      for (var i = 0; i < items.length; i++) items[i].classList.remove('selected');
      el.classList.add('selected');
    }

    // 筛选/重新扫描 - CE风格（从首次结果中筛选，保留首次数据）
    async function doRescan() {
      var value2Input = document.getElementById('scanValue2');
      if (!value2Input || value2Input.disabled) {
        alert('请先进行一次初始扫描！');
        return;
      }
      var newValue = value2Input.value.trim();
      if (newValue === '') {
        alert('请在【第二次值】中输入变化后的数值！');
        value2Input.focus();
        return;
      }
      if (!window._firstScanResults || window._firstScanResults.length === 0) {
        alert('没有可筛选的扫描结果，请先进行一次扫描！');
        return;
      }
      if (!currentPid) {
        alert('请先选择进程！');
        return;
      }

      var validFirstResults = window._firstScanResults || [];
      var prevCount = validFirstResults.length;
      var resultsDiv = document.getElementById('scanResults');
      var rescanBtn = document.getElementById('rescanBtn');
      if (rescanBtn) { rescanBtn.disabled = true; rescanBtn.textContent = '筛选中...'; }
      if (resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px;color:#4a9eff;">正在筛选 ' + prevCount + ' 个地址，请稍候...</div>';

      appendLog('[重新扫描] 开始筛选 ' + prevCount + ' 个地址，目标值=' + newValue, 'info');

      try {
        var result = await window.api.filterScan(
          currentPid,
          validFirstResults,
          newValue,
          window._lastScanType
        );

        if (rescanBtn) { rescanBtn.disabled = false; rescanBtn.textContent = '重新扫描'; }

        if (!result || !result.success) {
          var errMsg = result && result.error ? result.error : '未知错误';
          appendLog('[重新扫描] 失败: ' + errMsg, 'error');
          alert('筛选失败: ' + errMsg);
          // 失败时恢复首次结果显示（不清空）
          renderScanResults();
          return;
        }

        var filtered = result.results;
        appendLog('[重新扫描] 完成! ' + prevCount + ' → ' + filtered.length + ' 个地址', filtered.length > 0 ? 'success' : 'warning');

        // 更新筛选结果（首次结果不变）
        window._filteredResults = filtered;
        window._validFirstResults = validFirstResults;
        window._lastScanValue = newValue;

        if (filtered.length === 0) {
          renderScanResults();
          return;
        }

        renderScanResults();

        // 自动聚焦第二次输入框方便继续筛选
        setTimeout(function() {
          if (value2Input) { value2Input.value = ''; value2Input.focus(); }
        }, 200);

      } catch (err) {
        if (rescanBtn) { rescanBtn.disabled = false; rescanBtn.textContent = '重新扫描'; }
        appendLog('[重新扫描] 异常: ' + err, 'error');
        alert('筛选异常: ' + (err.message || err));
        // 异常时恢复首次结果显示
        renderScanResults();
      }
    }

    // 渲染扫描结果区域（首次扫描 + 筛选结果 双区域）
    function renderScanResults() {
      var resultsDiv = document.getElementById('scanResults');
      if (!resultsDiv) return;

      var first = window._firstScanResults;
      var filtered = window._filteredResults;
      var dataType = window._lastScanType || 'int';

      // 无任何结果
      if (!first || first.length === 0) {
        resultsDiv.innerHTML = '';
        return;
      }

      // 构建地址→首次值的映射（供筛选结果查原始值用）
      var firstValueMap = {};
      first.forEach(function(item) {
        var addr = item.Address || item.address || '';
        if (addr) firstValueMap[addr] = item.Value !== undefined ? item.Value : '';
      });

      var html = '';

      // === 首次扫描结果区域（始终显示） ===
      html += '<div class="scan-section" id="firstScanSection">'
        + '  <div class="scan-results-header">'
        + '    <span>首次扫描: <strong>' + first.length + '</strong> 个地址</span>'
        + '    <button class="scan-clear-btn" onclick="clearScanResults()">清空</button>'
        + '  </div>';

      // 过滤首次扫描结果：移除可疑的无效地址
      var validFirstResults = first.filter(function(item) {
        var addr = item.Address || item.address || '';
        // 过滤条件：地址必须以0x开头，且是有效的十六进制格式
        if (!addr || !addr.toLowerCase().startsWith('0x')) return false;
        var hexPart = addr.replace(/^0x/, '');
        if (!/^[0-9a-fA-F]+$/.test(hexPart)) return false;
        // 地址长度检查（常规内存地址不会超过16位十六进制数）
        if (hexPart.length > 16) return false;
        // 过滤掉常见的无效地址范围
        var addrValue = parseInt(hexPart, 16);
        if (addrValue === 0 || addrValue > 0xFFFFFFFFFFFF) return false;
        return true;
      });

      // 如果过滤后结果太少，放宽条件
      if (validFirstResults.length === 0) {
        validFirstResults = first.filter(function(item) {
          var addr = item.Address || item.address || '';
          if (!addr) return false;
          var hexPart = addr.replace(/^0x/, '');
          return /^[0-9a-fA-F]{8,}$/.test(hexPart); // 至少8位十六进制
        });
      }

      var pageFirstResults = validFirstResults.slice(0, 500); // 限制显示数量
      pageFirstResults.forEach(function(item, idx) {
        var addr = item.Address || item.address || item;
        var val = item.Value !== undefined ? item.Value : '';
        html += '<div class="result-item result-first" data-addr="' + addr + '" data-value="' + val + '" data-type="' + dataType + '" data-idx="' + idx + '" onclick="selectAddress(this)">'
          + '<span class="result-row result-row-first">首次: ' + addr + ' = ' + val + '</span>'
          + '<button class="result-add-btn" onclick="event.stopPropagation();showAddCheatDialog(\'' + addr + '\',' + val + ',\'' + dataType + '\')">添加</button>'
          + '</div>';
      });
      html += '</div>';

      // === 筛选结果区域（有筛选数据时才显示） ===
      if (filtered && filtered.length > 0) {
        html += '<div class="scan-section" id="filteredSection">'
          + '  <div class="scan-results-header scan-header-filtered">'
          + '    筛选结果: <strong>' + filtered.length + '</strong> 个地址'
          + '    <span style="color:#e0a000;font-size:11px;">(从 ' + first.length + ' 个中筛选)</span>'
          + '  </div>';

        // 过滤筛选结果：移除可疑的无效地址
        var validFilteredResults = filtered.filter(function(item) {
          var addr = item.Address || item.address || '';
          if (!addr || !addr.toLowerCase().startsWith('0x')) return false;
          var hexPart = addr.replace(/^0x/, '');
          if (!/^[0-9a-fA-F]+$/.test(hexPart)) return false;
          if (hexPart.length > 16) return false;
          var addrValue = parseInt(hexPart, 16);
          if (addrValue === 0 || addrValue > 0xFFFFFFFFFFFF) return false;
          return true;
        });

        var pageFilteredResults = validFilteredResults.slice(0, 500); // 限制显示数量

        pageFilteredResults.forEach(function(item, idx) {
          var addr = item.Address || item.address || item;
          var newVal = item.Value !== undefined ? item.Value : '';
          var oldVal = firstValueMap[addr] !== undefined ? firstValueMap[addr] : '?';
          html += '<div class="result-item result-filtered" data-addr="' + addr + '" data-value="' + newVal + '" data-type="' + dataType + '" data-idx="' + idx + '" onclick="selectAddress(this)">'
            + '<span class="result-row result-row-first">首次: ' + addr + ' = ' + oldVal + '</span>'
            + '<span class="result-row result-row-second">二次: = ' + newVal + '</span>'
            + '<button class="result-add-btn" onclick="event.stopPropagation();showAddCheatDialog(\'' + addr + '\',' + newVal + ',\'' + dataType + '\')">添加</button>'
            + '</div>';
        });
        html += '</div>';
      } else if (filtered && filtered.length === 0 && validFirstResults.length > 0) {
        // 筛选后无匹配（已过滤无效结果）
        html += '<div class="scan-section" id="filteredSection">'
          + '  <div class="scan-results-header scan-header-filtered">'
          + '    筛选结果: <strong style="color:#c44;">0</strong> 个地址（已过滤无效结果）'
          + '  </div>'
          + '  <div style="padding:10px;color:#e0a000;font-size:12px;">筛选无匹配。可能原因：<br>1. 数值类型不正确（尝试 float/double）<br>2. 游戏使用了值加密<br>3. 值已再次改变，请重新输入第二次值筛选</div>'
          + '</div>';
      } else if (filtered && filtered.length === 0 && first.length > 0) {
        // 筛选后无匹配（无有效首次结果）
        html += '<div class="scan-section" id="filteredSection">'
          + '  <div class="scan-results-header scan-header-filtered">'
          + '    筛选结果: <strong style="color:#c44;">0</strong> 个地址'
          + '  </div>'
          + '  <div style="padding:10px;color:#e0a000;font-size:12px;">筛选无匹配。可能原因：<br>1. 数值类型不正确（尝试 float/double）<br>2. 游戏使用了值加密<br>3. 值已再次改变，请重新输入第二次值筛选</div>'
          + '</div>';
      }

      resultsDiv.innerHTML = html;

      // 更新"从扫描结果导入"按钮状态
      updateImportFromScanButton();
    }

    // 清空所有扫描结果
    function clearScanResults() {
      window._firstScanResults = null;
      window._filteredResults = null;

      // 重置UI
      var resultsDiv = document.getElementById('scanResults');
      if (resultsDiv) resultsDiv.innerHTML = '';

      // 重置数据
      window._firstScanResults = null;
      window._filteredResults = null;
      window._validFirstResults = null;

      // 重置第二次输入框
      var value2Group = document.getElementById('scanValue2Group');
      var value2Input = document.getElementById('scanValue2');
      var rescanBtn = document.getElementById('rescanBtn');
      if (value2Group) value2Group.classList.remove('active');
      if (value2Input) { value2Input.disabled = true; value2Input.value = ''; }
      if (rescanBtn) { rescanBtn.disabled = true; rescanBtn.textContent = '重新扫描'; }

      // 更新"从扫描结果导入"按钮状态
      updateImportFromScanButton();

      appendLog('[清空] 已清除所有扫描结果', 'info');
    }

    // 显示"添加到插件"对话框
    function showAddCheatDialog(addr, value, dataType) {
      if (!currentGame) {
        alert('请先在左侧选择一个游戏插件！');
        return;
      }
      var oldDlg = document.getElementById('addCheatDialog');
      if (oldDlg) oldDlg.remove();

      var dlg = document.createElement('div');
      dlg.id = 'addCheatDialog';
      dlg.className = 'xd-dialog';
      dlg.innerHTML = ''
        + '<div class="xd-dialog-backdrop" onclick="closeAddCheatDialog()"></div>'
        + '<div class="xd-dialog-box">'
        + '  <div class="xd-dialog-header">'
        + '    <div class="xd-dialog-icon">&#10133;</div>'
        + '    <h3 class="xd-dialog-title">添加修改项</h3>'
        + '    <button class="xd-dialog-close" onclick="closeAddCheatDialog()">&times;</button>'
        + '  </div>'
        + '  <div class="xd-dialog-body">'
        + '    <label class="xd-form-label">修改项名称 <span style="color:#666;font-weight:400;font-size:11px;margin-left:6px;">（如：金钱、血量）</span></label>'
        + '    <input type="text" id="addCheatName" class="xd-input" placeholder="如：金钱" autocomplete="off">'
        + '    <label class="xd-form-label">内存地址</label>'
        + '    <input type="text" id="addCheatAddr" class="xd-input" value="' + addr + '" readonly style="opacity:0.5;cursor:default;">'
        + '    <label class="xd-form-label">当前值 / 类型</label>'
        + '    <input type="text" class="xd-input" value="' + value + '  (' + dataType + ')" readonly style="opacity:0.5;cursor:default;font-family:Consolas,monospace;">'
        + '  </div>'
        + '  <div class="xd-dialog-footer">'
        + '    <button type="button" class="xd-btn xd-btn-cancel" onclick="closeAddCheatDialog()">取消</button>'
        + '    <button type="button" class="xd-btn xd-btn-primary" onclick="confirmAddCheat(\'' + addr + '\',' + value + ',\'' + dataType + '\')">确认添加</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(dlg);
      setTimeout(function() {
        var el = document.getElementById('addCheatName');
        if (el) el.focus();
      }, 80);
    }

    function closeAddCheatDialog() {
      closeXdDialog('addCheatDialog');
    }

    async function confirmAddCheat(addr, value, dataType) {
      var nameInput = document.getElementById('addCheatName');
      var name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        alert('请输入修改项名称！');
        return;
      }
      try {
        await window.api.addCheatsToGame(currentGame, [{
          id: 'cheat_scan_' + Date.now(),
          name: name,
          address: addr,
          value: parseFloat(value) || 0,
          dataType: dataType
        }]);
        alert('已将 "' + name + '" (' + addr + ') 添加到 "' + currentGame + '"');
        closeAddCheatDialog();
        // 刷新右侧面板
        renderCheatPanel();
      } catch(e) {
        alert('添加失败: ' + e.message);
      }
    }

    // 保存当前插件的修改（收集面板中的值，批量写入）
    async function savePluginChanges() {
      if (!currentGame) {
        alert('请先选择一个游戏！');
        return;
      }
      try {
        var result = await window.api.saveCurrentGame(currentGame);
        if (result && result.success) {
          appendLog('[保存] ' + currentGame + ' 插件修改已保存', 'success');
          alert('插件修改已保存！');
        } else {
          alert('保存失败: ' + (result ? result.error : '未知错误'));
        }
      } catch(e) {
        alert('保存失败: ' + e.message);
      }
    }

    async function renderCheatPanel() {
      var panel = document.getElementById('cheatPanel');
      if (!panel) return;

      // 找到固定的容器区域（不清空它们）
      var cheatListEl = document.getElementById('cheatList');
      if (!cheatListEl) return;

      // 【焦点保护】记录当前聚焦的输入框，渲染完后恢复
      var activeEl = document.activeElement;
      var focusedIdx = null;
      var focusedSelector = null;
      if (activeEl) {
        // 记录 cheat value 输入框的 idx
        if (activeEl.classList && activeEl.classList.contains('cheat-value-input')) {
          focusedIdx = activeEl.dataset.idx;
        } else {
          // 其他输入框（扫描值、搜索框等）用 tag+id 记录
          focusedSelector = activeEl.id || (activeEl.className ? activeEl.className : null);
        }
      }

      // 只清空修改项列表区域，不动其他部分
      cheatListEl.innerHTML = '';

      if (!currentGame) {
        cheatListEl.innerHTML = '<div class="empty-state"><h3>请先选择一个游戏</h3><p>从左侧列表选择一个游戏，或使用内存扫描查找地址</p></div>';
        return;
      }

      var games;
      try {
        games = await window.api.getGames();
      } catch(e) {
        console.error(e);
        cheatListEl.innerHTML = '<div style="padding:20px;color:#c44;text-align:center;">加载失败</div>';
        return;
      }

      var game = games.find(function(g) { return g.name === currentGame; });
      if (!game) {
        cheatListEl.innerHTML = '<div class="empty-state"><h3>未找到游戏配置</h3><p>' + currentGame + '</p></div>';
        return;
      }

      if (!game.cheats || game.cheats.length === 0) {
        cheatListEl.innerHTML = '<div class="empty-state"><h3>该游戏暂无可用修改项</h3>'
          + '<p>提示：使用内存扫描找到地址后，可点击"添加到当前游戏"</p></div>';
        return;
      }

      // 渲染每个修改项为卡片
      game.cheats.forEach(function(cheat, idx) {
        var card = document.createElement('div');
        card.className = 'cheat-card';

        // 删除按钮（悬浮显示）
        var delBtn = document.createElement('button');
        delBtn.className = 'cheat-card-delete';
        delBtn.title = window.currentLanguage === 'en' ? 'Delete this cheat' : '删除此修改项';
        delBtn.textContent = '\u00D7';
        delBtn.onclick = function(e) { e.stopPropagation(); deleteCheatFromGame(idx); };
        card.appendChild(delBtn);

        // 标题行：名称
        var header = document.createElement('div');
        header.className = 'cheat-header';

        var nameEl = document.createElement('span');
        nameEl.className = 'cheat-name';
        nameEl.textContent = cheat.name || ('修改项 #' + (idx + 1));

        header.appendChild(nameEl);

        // 输入行：数值输入框
        var inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;';

        var valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.className = 'cheat-value-input';
        valueInput.value = cheat.value !== undefined ? cheat.value : 0;
        valueInput.placeholder = window.currentLanguage === 'en' ? 'Target Value' : '目标值';
        valueInput.dataset.idx = idx;

        inputRow.appendChild(valueInput);

        // 内存地址显示行
        var addrRow = document.createElement('div');
        addrRow.className = 'cheat-address-row';
        addrRow.style.cssText = 'margin-bottom:8px;';
        var addrLabel = window.currentLanguage === 'en' ? 'Address: ' : '地址: ';
        var notSetText = window.currentLanguage === 'en' ? 'Not set' : '未设置';
        addrRow.textContent = addrLabel + (cheat.address || notSetText);

        // 操作行：单次修改按钮
        var actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;';
        var writeBtn = document.createElement('button');
        writeBtn.className = 'cheat-write-btn';
        writeBtn.textContent = window.currentLanguage === 'en' ? 'One-Time Modify' : '单次修改';
        writeBtn.onclick = (function(cheatIdx, valInput) {
          return function() { showWriteValueDialog(cheatIdx, valInput); };
        })(idx, valueInput);
        actionRow.appendChild(writeBtn);

        card.appendChild(header);
        card.appendChild(inputRow);
        card.appendChild(addrRow);
        card.appendChild(actionRow);
        cheatListEl.appendChild(card);
      });

      // 【焦点恢复】如果之前有输入框被聚焦，重新聚焦到对应位置
      if (focusedIdx !== null) {
        var restoredInput = cheatListEl.querySelector('.cheat-value-input[data-idx="' + focusedIdx + '"]');
        if (restoredInput) {
          // 用 setTimeout 确保 DOM 完全渲染后再 focus
          setTimeout(function() { restoredInput.focus(); restoredInput.select(); }, 0);
        }
      } else if (focusedSelector) {
        var restoredEl = document.getElementById(focusedSelector) || document.querySelector('.' + focusedSelector.split(' ')[0]);
        if (restoredEl && restoredEl !== document.body) {
          setTimeout(function() { restoredEl.focus(); }, 0);
        }
      }
    }

    function createInfoDiv(text) {
      var div = document.createElement('div');
      div.style.cssText = 'padding:20px;color:#555;text-align:center;';
      div.innerHTML = text;
      return div;
    }

    // ========== 插件管理相关函数 ==========

    function showCreatePlugin() {
      showPluginManager();
      showTab('create');
    }

    function showPluginManager() {
      var modal = document.getElementById('pluginModal');
      if (modal) modal.classList.add('show');
    }

    function closePluginManager() {
      var modal = document.getElementById('pluginModal');
      if (modal) modal.classList.remove('show');
    }

    function showTab(tabName) {
      var tabs = document.querySelectorAll('.tab-btn');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        if (tabs[i].getAttribute('onclick').indexOf("'" + tabName + "'") !== -1) {
          tabs[i].classList.add('active');
        }
      }
      var contents = document.querySelectorAll('.tab-content');
      for (var j = 0; j < contents.length; j++) {
        contents[j].style.display = 'none';
      }
      var target = document.getElementById('tab-' + tabName);
      if (target) target.style.display = '';
    }

    function addCheatItem() {
      var container = document.getElementById('cheatItems');
      if (!container) return;
      var div = document.createElement('div');
      div.className = 'cheat-item';
      div.innerHTML = '<input type="text" class="cheat-name" placeholder="修改项名称" maxlength="10">'
        + '<input type="text" class="cheat-address" placeholder="内存地址 (0x...)">'
        + '<input type="number" class="cheat-value" placeholder="目标值">'
        + '<select class="cheat-datatype">'
        + '<option value="int">整数</option>'
        + '<option value="float">浮点数</option>'
        + '<option value="byte">字节</option>'
        + '<option value="short">短整数</option>'
        + '<option value="double">双精度</option>'
        + '</select>'
        + '<input type="text" class="cheat-hotkey" placeholder="快捷键 (如F1)">'
        + '<button type="button" class="remove-cheat" onclick="removeCheatItem(this)">-</button>';
      container.appendChild(div);
    }

    function removeCheatItem(btn) {
      var item = btn.parentNode;
      if (item && item.parentNode) {
        item.parentNode.removeChild(item);
      }
    }

    function saveNewPlugin() {
      var nameInput = document.getElementById('createGameName');
      var exeInput = document.getElementById('createGameExe');
      var descInput = document.getElementById('createGameDesc');

      var name = nameInput ? nameInput.value.trim() : '';
      var exe = exeInput ? exeInput.value.trim() : '';
      var desc = descInput ? descInput.value.trim() : '';

      if (!name || !exe) {
        alert('请填写游戏名称和可执行文件名！');
        return;
      }

      var cheats = [];
      var items = document.querySelectorAll('#createCheatItems .cheat-item');
      items.forEach(function(item) {
        var cName = item.querySelector('.cheat-name');
        var cAddr = item.querySelector('.cheat-address');
        var cVal = item.querySelector('.cheat-value');
        var cType = item.querySelector('.cheat-datatype');
        if (cAddr && cAddr.value.trim()) {
          cheats.push({
            id: 'cheat_' + cheats.length,
            name: cName ? cName.value.trim() : '',
            address: cAddr.value.trim(),
            value: cVal ? parseFloat(cVal.value) || 0 : 0,
            dataType: cType ? cType.value : 'int'
          });
        }
      });

      var plugin = {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: name,
        executable: exe,
        description: desc,
        cheats: cheats
      };

      window.api.savePlugin(plugin).then(function(result) {
        if (result.success) {
          alert('插件保存成功！');
          closePluginManager();
          loadGames();
        } else {
          alert('保存失败: ' + (result.error || '未知错误'));
        }
      });
    }

    // 显示"添加新修改项"对话框（名称必填，其他可选）
    function showAddNewCheatDialog() {
      if (!currentGame) {
        alert(window.currentLanguage === 'en' ? 'Please select a game plugin from the left panel first!' : '请先在左侧选择一个游戏插件！');
        return;
      }
      var oldDlg = document.getElementById('addCheatDialog');
      if (oldDlg) oldDlg.remove();

      var isEn = window.currentLanguage === 'en';
      var dlg = document.createElement('div');
      dlg.id = 'addCheatDialog';
      dlg.className = 'xd-dialog';
      dlg.innerHTML = ''
        + '<div class="xd-dialog-backdrop" onclick="closeAddCheatDialog()"></div>'
        + '<div class="xd-dialog-box">'
        + '  <div class="xd-dialog-header">'
        + '    <div class="xd-dialog-icon">&#10010;</div>'
        + '    <h3 class="xd-dialog-title">' + (isEn ? 'Add New Cheat' : '添加新修改项') + '</h3>'
        + '    <button class="xd-dialog-close" onclick="closeAddCheatDialog()">&times;</button>'
        + '  </div>'
        + '  <div class="xd-dialog-body">'
        + '    <label class="xd-form-label">' + (isEn ? 'Cheat Name' : '修改项名称') + ' <span class="required">*</span> <span style="color:#666;font-weight:400;font-size:11px;margin-left:6px;">' + (isEn ? '(e.g. Money, Health)' : '（如：金钱、血量）') + '</span></label>'
        + '    <input type="text" id="addCheatName" class="xd-input" placeholder="' + (isEn ? 'e.g. Money' : '如：金钱') + '" autocomplete="off">'
        + '    <label class="xd-form-label">' + (isEn ? 'Memory Address' : '内存地址') + ' <span style="color:#666;font-weight:400;font-size:11px;margin-left:6px;">' + (isEn ? '(Optional, leave empty to create placeholder)' : '（选填，留空则仅占位）') + '</span></label>'
        + '    <input type="text" id="addCheatAddr" class="xd-input" placeholder="' + (isEn ? 'e.g. 0x1A7E613BA3C' : '如：0x1A7E613BA3C') + '">'
        + '    <label class="xd-form-label">' + (isEn ? 'Target Value' : '目标值') + ' <span style="color:#666;font-weight:400;font-size:11px;margin-left:6px;">' + (isEn ? '(Optional)' : '（选填）') + '</span></label>'
        + '    <input type="number" id="addCheatValue" class="xd-input" placeholder="' + (isEn ? 'e.g. 69029' : '如：69029') + '">'
        + '    <label class="xd-form-label">' + (isEn ? 'Data Type' : '数据类型') + '</label>'
        + '    <select id="addCheatType" class="xd-input" style="cursor:pointer;padding-right:30px;">'
        + '      <option value="int">' + (isEn ? 'Integer (int)' : '整数 (int)') + '</option>'
        + '      <option value="float">' + (isEn ? 'Float (float)' : '浮点数 (float)') + '</option>'
        + '      <option value="double">' + (isEn ? 'Double (double)' : '双精度 (double)') + '</option>'
        + '      <option value="byte">' + (isEn ? 'Byte (byte)' : '字节 (byte)') + '</option>'
        + '      <option value="short">' + (isEn ? 'Short (short)' : '短整数 (short)') + '</option>'
        + '    </select>'
        + '  </div>'
        + '  <div class="xd-dialog-footer">'
        + '    <button type="button" class="xd-btn xd-btn-cancel" onclick="closeAddCheatDialog()">' + (isEn ? 'Cancel' : '取消') + '</button>'
        + '    <button type="button" class="xd-btn xd-btn-primary" onclick="confirmAddNewCheat()">' + (isEn ? 'Confirm Add' : '确认添加') + '</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(dlg);
      setTimeout(function() {
        var el = document.getElementById('addCheatName');
        if (el) el.focus();
      }, 80);
    }

    async function confirmAddNewCheat() {
      var nameInput = document.getElementById('addCheatName');
      var addrInput = document.getElementById('addCheatAddr');
      var valInput = document.getElementById('addCheatValue');
      var typeSelect = document.getElementById('addCheatType');

      var name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        alert('请输入修改项名称！');
        return;
      }
      var addr = addrInput ? addrInput.value.trim() : '';
      var valStr = valInput ? valInput.value.trim() : '';
      var dataType = typeSelect ? typeSelect.value : 'int';

      try {
        await window.api.addCheatsToGame(currentGame, [{
          id: 'cheat_manual_' + Date.now(),
          name: name,
          address: addr || '',
          value: valStr !== '' ? parseFloat(valStr) : 0,
          dataType: dataType
        }]);
        alert('已将 "' + name + '" 添加到 "' + currentGame + '"');
        closeAddCheatDialog();
        renderCheatPanel();
      } catch(e) {
        alert('添加失败: ' + e.message);
      }
    }

    // 显示"单次修改"弹窗 — 输入新值后写入
    function showWriteValueDialog(idx, valueInputEl) {
      if (!currentPid) {
        alert('请先选择一个进程！');
        return;
      }
      var currentVal = valueInputEl ? valueInputEl.value : '0';

      var oldDlg = document.getElementById('writeValueDialog');
      if (oldDlg) oldDlg.remove();

      var dlg = document.createElement('div');
      dlg.id = 'writeValueDialog';
      dlg.className = 'xd-dialog';
      dlg.innerHTML = ''
        + '<div class="xd-dialog-backdrop" onclick="closeWriteValueDialog()"></div>'
        + '<div class="xd-dialog-box">'
        + '  <div class="xd-dialog-header">'
        + '    <div class="xd-dialog-icon">&#9998;</div>'
        + '    <h3 class="xd-dialog-title">单次修改</h3>'
        + '    <button class="xd-dialog-close" onclick="closeWriteValueDialog()">&times;</button>'
        + '  </div>'
        + '  <div class="xd-dialog-body">'
        + '    <label class="xd-form-label">当前值（参考）</label>'
        + '    <input type="text" id="writeCurrentValue" class="xd-input" value="' + currentVal + '" readonly style="opacity:0.5;cursor:default;font-family:Consolas,monospace;">'
        + '    <label class="xd-form-label">新值 <span class="required">*</span></label>'
        + '    <input type="number" id="writeNewValue" class="xd-input" placeholder="输入要写入的新数值" autocomplete="off">'
        + '  </div>'
        + '  <div class="xd-dialog-footer">'
        + '    <button type="button" class="xd-btn xd-btn-cancel" onclick="closeWriteValueDialog()">取消</button>'
        + '    <button type="button" class="xd-btn xd-btn-primary" onclick="confirmWriteValue(' + idx + ')">确定修改</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(dlg);
      setTimeout(function() {
        var el = document.getElementById('writeNewValue');
        if (el) { el.focus(); el.select(); }
      }, 80);
    }

    function closeWriteValueDialog() {
      closeXdDialog('writeValueDialog');
    }

    async function confirmWriteValue(idx) {
      var newInput = document.getElementById('writeNewValue');
      var newVal = newInput ? newInput.value.trim() : '';
      if (!newVal || isNaN(parseFloat(newVal))) {
        alert('请输入有效的新数值！');
        return;
      }

      if (!currentPid) {
        alert('请先选择进程！');
        closeWriteValueDialog();
        return;
      }

      // 获取当前cheat信息
      var games;
      try { games = await window.api.getGames(); } catch(e) { return; }
      var game = games.find(function(g) { return g.name === currentGame; });
      if (!game || !game.cheats || !game.cheats[idx]) return;
      var cheat = game.cheats[idx];

      closeWriteValueDialog();

      appendLog('[单次修改] ' + cheat.name + ': 地址=' + cheat.address + ', 新值=' + newVal, 'info');

      try {
        var result = await window.api.writeMemory(
          currentPid,
          cheat.address,
          parseFloat(newVal),
          cheat.dataType || cheat.type || 'int'
        );

        if (!result || !result.success) {
          alert('写入失败: ' + (result && result.error ? result.error : '未知错误'));
          appendLog('[单次修改] 失败', 'error');
          return;
        }

        appendLog('[单次修改] 成功! ' + cheat.name + ' 已改为 ' + newVal, 'success');

        // 同步更新插件保存值 + 冻结循环值（防止冻结循环用旧值覆盖）
        try {
          await window.api.updateCheatValue(currentGame, idx, parseFloat(newVal));
        } catch(e) {
          appendLog('[单次修改] 更新保存值失败: ' + e.message, 'warning');
        }

        // 只更新输入框显示新值，不改变锁定状态，不重新渲染整个面板
        var valInput = document.querySelector('.cheat-value-input[data-idx="' + idx + '"]');
        if (valInput) valInput.value = newVal;

      } catch(e) {
        alert('修改异常: ' + e.message);
        appendLog('[单次修改] 异常: ' + e, 'error');
      }
    }

    async function deleteCheatFromGame(idx) {
      if (!currentGame) { alert('未选择游戏'); return; }
      
      var games;
      try { 
        games = await window.api.getGames(); 
      } catch(e) { 
        alert('获取游戏列表失败'); 
        return; 
      }
      
      var game = games.find(function(g) { return g.name === currentGame; });
      if (!game || !game.cheats || !game.cheats[idx]) { 
        alert('未找到修改项'); 
        return; 
      }

      var cheatName = game.cheats[idx].name || ('#' + (idx + 1));
      var confirmMsg = window.currentLanguage === 'en' 
        ? 'Are you sure you want to delete cheat "' + cheatName + '" from "' + currentGame + '"?' 
        : '确定要从 "' + currentGame + '" 中删除修改项「' + cheatName + '」吗？';
      if (!confirm(confirmMsg)) return;

      game.cheats.splice(idx, 1);

      var saveData = {
        id: game.id,
        name: game.name,
        executable: game.executable,
        description: game.description || '',
        cheats: game.cheats,
        override: true,
        skipValidation: true
      };
      
      try {
        var result = await window.api.savePlugin(saveData);
        if (result && result.success) {
          appendLog('已删除修改项: ' + cheatName, 'warning');
          renderCheatPanel();
        } else {
          alert('保存失败: ' + (result ? result.error : '未知错误'));
        }
      } catch(e) {
        alert('删除失败: ' + e.message);
      }
    }

    // ========== 上传/导入 插件功能 ==========

    // 隐藏文件输入框（用于触发文件选择）
    var _importFileInput = null;
    function _getImportFileInput() {
      if (!_importFileInput) {
        _importFileInput = document.createElement('input');
        _importFileInput.type = 'file';
        _importFileInput.accept = '.json,.xcmod';
        _importFileInput.style.display = 'none';
        document.body.appendChild(_importFileInput);
        _importFileInput.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (file) handleImportFile(file);
          this.value = '';
        });
      }
      return _importFileInput;
    }

    // 选择文件导入
    function pickImportFile() {
      _getImportFileInput().click();
    }

    // 下载 JSON-Demo 文件
    function downloadJsonDemo() {
      const demoData = {
        "id": "example-game",
        "name": "示例游戏",
        "executable": "Game.exe",
        "description": "这是一个示例插件配置，用于演示如何创建游戏修改插件",
        "cheats": [
          {
            "id": "unlimited-health",
            "name": "无限生命",
            "description": "锁定生命值为999",
            "address": "0x12345678",
            "value": 999,
            "dataType": "int"
          },
          {
            "id": "infinite-money",
            "name": "无限金钱",
            "description": "锁定金钱为999999",
            "address": "0x1234567C",
            "value": 999999,
            "dataType": "int"
          }
        ]
      };
      
      const blob = new Blob([JSON.stringify(demoData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plugin-demo.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      appendLog('[下载] JSON-Demo 文件已下载', 'success');
    }

    // 拖拽导入：处理拖拽进入
    function setupDropZone() {
      var zone = document.getElementById('importDropZone');
      if (!zone) return;

      ['dragenter', 'dragover'].forEach(function(evt) {
        zone.addEventListener(evt, function(e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach(function(evt) {
        zone.addEventListener(evt, function(e) {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove('drag-over');
        });
      });

      zone.addEventListener('drop', function(e) {
        var files = e.dataTransfer.files;
        if (files && files.length > 0) {
          handleImportFile(files[0]);
        }
      });
    }

    // 处理导入的文件（读取JSON并直接保存）
    async function handleImportFile(file) {
      if (!file) return;
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'json' && ext !== 'xcmod') {
        alert('请选择 .json 或 .xcmod 格式的插件文件');
        return;
      }
      var reader = new FileReader();
      reader.onload = async function(e) {
        try {
          var data = JSON.parse(e.target.result);
          // 直接保存插件
          var result = await window.api.savePlugin(data);
          if (result && result.success) {
            alert(result.exists ? '插件已覆盖！' : '插件上传成功！');
            appendLog('[导入] 文件: ' + file.name + ', 包含 ' + (data.cheats ? data.cheats.length : 0) + ' 个修改项', 'success');
            closePluginManager();
            loadGames();
          } else if (result && result.exists) {
            // ID已存在，询问是否覆盖
            if (confirm('插件 ID "' + data.id + '" 已存在，是否覆盖？')) {
              data.override = true;
              var overrideResult = await window.api.savePlugin(data);
              if (overrideResult && overrideResult.success) {
                alert('插件已覆盖！');
                appendLog('[导入] 文件: ' + file.name + ' (覆盖)', 'success');
                closePluginManager();
                loadGames();
              } else {
                alert('覆盖失败: ' + (overrideResult ? overrideResult.error : '未知错误'));
              }
            }
          } else {
            alert('保存失败: ' + (result ? result.error : '未知错误'));
          }
        } catch(err) {
          alert('文件解析失败: 不是有效的JSON格式\n' + err.message);
        }
      };
      reader.onerror = function() { alert('文件读取失败'); };
      reader.readAsText(file);
    }

    function showPasteDialog() {
      var oldDlg = document.getElementById('pasteImportDialog');
      if (oldDlg) oldDlg.remove();

      var dlg = document.createElement('div');
      dlg.id = 'pasteImportDialog';
      dlg.className = 'xd-dialog';
      dlg.innerHTML = ''
        + '<div class="xd-dialog-backdrop" onclick="closePasteDialog()"></div>'
        + '<div class="xd-dialog-box" style="width:520px;">'
        + '  <div class="xd-dialog-header">'
        + '    <div class="xd-dialog-icon">&#128203;</div>'
        + '    <h3 class="xd-dialog-title">粘贴插件 JSON</h3>'
        + '    <button class="xd-dialog-close" onclick="closePasteDialog()">&times;</button>'
        + '  </div>'
        + '  <div class="xd-dialog-body">'
        + '    <textarea id="pasteJsonText" class="xd-input" rows="9" placeholder="{&quot;name&quot;:&quot;游戏名&quot;,&quot;exe&quot;:&quot;xxx.exe&quot;,&quot;cheats&quot;:[...]}"></textarea>'
        + '  </div>'
        + '  <div class="xd-dialog-footer">'
        + '    <button type="button" class="xd-btn xd-btn-cancel" onclick="closePasteDialog()">取消</button>'
        + '    <button type="button" class="xd-btn xd-btn-primary" onclick="confirmPasteImport()">导入</button>'
        + '  </div>'
        + '</div>';
      document.body.appendChild(dlg);
      setTimeout(function() {
        var ta = document.getElementById('pasteJsonText');
        if (ta) { ta.focus(); ta.select(); }
      }, 80);
    }

    function closePasteDialog() {
      closeXdDialog('pasteImportDialog');
    }

    async function confirmPasteImport() {
      var ta = document.getElementById('pasteJsonText');
      if (!ta || !ta.value.trim()) {
        alert('请粘贴JSON内容！');
        return;
      }
      try {
        var data = JSON.parse(ta.value);
        var result = await window.api.savePlugin(data);
        if (result && result.success) {
          alert(result.exists ? '插件已覆盖！' : '插件上传成功！');
          closePasteDialog();
          appendLog('[粘贴导入] 成功, ' + (data.cheats ? data.cheats.length : 0) + ' 个修改项', 'success');
          closePluginManager();
          loadGames();
        } else if (result && result.exists) {
          if (confirm('插件 ID "' + data.id + '" 已存在，是否覆盖？')) {
            data.override = true;
            var overrideResult = await window.api.savePlugin(data);
            if (overrideResult && overrideResult.success) {
              alert('插件已覆盖！');
              closePasteDialog();
              appendLog('[粘贴导入] 成功 (覆盖)', 'success');
              closePluginManager();
              loadGames();
            } else {
              alert('覆盖失败: ' + (overrideResult ? overrideResult.error : '未知错误'));
            }
          }
        } else {
          alert('保存失败: ' + (result ? result.error : '未知错误'));
        }
      } catch(err) {
        alert('JSON解析失败: ' + err.message);
      }
    }

    // 从扫描结果导入
    async function importFromScanResults() {
      var first = window._firstScanResults;
      var filtered = window._filteredResults;

      // 优先用筛选结果（更精确），否则用首次结果
      var source = (filtered && filtered.length > 0) ? filtered : first;
      if (!source || source.length === 0) {
        alert('没有可导入的扫描结果！请先进行内存扫描。');
        return;
      }

      var dataType = window._lastScanType || 'int';

      var cheats = source.map(function(item, idx) {
        return {
          id: 'scan_' + idx,
          name: '修改项 #' + (idx + 1),
          description: '从扫描结果导入',
          address: item.Address || item.address || '',
          value: item.Value !== undefined ? item.Value : 0,
          dataType: dataType
        };
      }).filter(function(c) { return c.address.length > 0; });

      if (cheats.length === 0) {
        alert('扫描结果中没有有效地址！');
        return;
      }

      var plugin = {
        id: 'scan_import_' + Date.now(),
        name: '扫描导入_' + new Date().toLocaleDateString(),
        executable: '',
        description: '从扫描结果导入 (' + new Date().toLocaleString() + ')',
        cheats: cheats
      };

      var result = await window.api.savePlugin(plugin);
      if (result && result.success) {
        alert('插件上传成功！');
        appendLog('[扫描导入] 导入 ' + cheats.length + ' 个地址 (' + (filtered ? '筛选结果' : '首次扫描') + ')', 'success');
        closePluginManager();
        loadGames();
      } else {
        alert('保存失败: ' + (result ? result.error : '未知错误'));
      }
    }

    // 填充上传表单（核心函数）
    function fillUploadForm(data) {
      if (!data) return;

      // 填写基本信息
      var nameEl = document.getElementById('gameName');
      var exeEl = document.getElementById('gameExe');
      var descEl = document.getElementById('gameDesc');
      if (nameEl && data.name) nameEl.value = data.name;
      if (exeEl && data.executable) exeEl.value = data.executable;
      if (descEl && data.description) descEl.value = data.description;

      // 填写修改项列表
      var container = document.getElementById('cheatItems');
      if (!container) return;

      container.innerHTML = '';

      var cheats = data.cheats || [];
      if (cheats.length === 0) {
        // 至少保留一个空行
        container.innerHTML = createCheatItemHTML();
      } else {
        cheats.forEach(function(cheat) {
          container.innerHTML += createCheatItemHTML(
            cheat.name || '',
            cheat.description || '',
            cheat.address || '',
            cheat.value !== undefined ? cheat.value : '',
            cheat.dataType || 'int',
            cheat.hotkey || ''
          );
        });
      }

      // 自动展开手动区域
      var body = document.getElementById('manualBody');
      var btn = document.getElementById('manualToggleBtn');
      if (body) body.style.display = '';
      if (btn) btn.textContent = '收起 &#9650;';
    }

    // 创建单个修改项行的HTML
    function createCheatItemHTML(name, desc, addr, val, type, hotkey) {
      return '<div class="cheat-item">'
        + '<input type="text" class="cheat-name" placeholder="修改项名称" value="' + escapeHtml(name || '') + '" maxlength="10">'
        + '<input type="text" class="cheat-desc" placeholder="描述" value="' + escapeHtml(desc || '') + '">'
        + '<input type="text" class="cheat-address" placeholder="内存地址 (0x...)" value="' + escapeHtml(addr || '') + '">'
        + '<input type="number" class="cheat-value" placeholder="目标值" value="' + (val || '') + '">'
        + '<select class="cheat-datatype">'
        + '  <option value="int"' + (type === 'int' ? ' selected' : '') + '>整数</option>'
        + '  <option value="float"' + (type === 'float' ? ' selected' : '') + '>浮点数</option>'
        + '  <option value="double"' + (type === 'double' ? ' selected' : '') + '>双精度</option>'
        + '  <option value="byte"' + (type === 'byte' ? ' selected' : '') + '>字节</option>'
        + '  <option value="short"' + (type === 'short' ? ' selected' : '') + '>短整数</option>'
        + '</select>'
        + '<input type="text" class="cheat-hotkey" placeholder="快捷键 (如F1)" value="' + escapeHtml(hotkey || '') + '">'
        + '<button type="button" class="remove-cheat" onclick="removeCheatItem(this)">-</button>'
        + '</div>';
    }

    // 展开/收起手动编辑区域
    function toggleManualSection() {
      var body = document.getElementById('manualBody');
      var btn = document.getElementById('manualToggleBtn');
      if (!body || !btn) return;
      var isHidden = body.style.display === 'none' || body.style.display === '';
      if (isHidden) {
        body.style.display = '';
        btn.textContent = '收起 &#9650;';
      } else {
        body.style.display = 'none';
        btn.textContent = '展开 &#9660;';
      }
    }

    // 更新"从扫描结果导入"按钮状态
    function updateImportFromScanButton() {
      var btn = document.getElementById('importFromScanBtn');
      if (!btn) return;
      var hasResults = window._firstScanResults && window._firstScanResults.length > 0;
      btn.disabled = !hasResults;
      if (hasResults) {
        var count = (window._filteredResults && window._filteredResults.length > 0)
          ? window._filteredResults.length : window._firstScanResults.length;
        btn.textContent = '&#128269; 从扫描结果导入 (' + count + ')';
      } else {
        btn.textContent = '&#128269; 从扫描结果导入';
      }
    }

    // 初始化拖拽区域和扫描结果按钮状态
    setupDropZone();
    updateImportFromScanButton();

    // 上传表单提交处理
    document.addEventListener('DOMContentLoaded', function() {
      var uploadForm = document.getElementById('uploadForm');
      if (uploadForm) {
        uploadForm.addEventListener('submit', function(e) {
          e.preventDefault();
          var nameInput = document.getElementById('gameName');
          var exeInput = document.getElementById('gameExe');
          var descInput = document.getElementById('gameDesc');

          var name = nameInput ? nameInput.value.trim() : '';
          var exe = exeInput ? exeInput.value.trim() : '';
          var desc = descInput ? descInput.value.trim() : '';

          if (!name || !exe) {
            alert('请填写游戏名称和可执行文件名！');
            return;
          }

          var cheats = [];
          var items = document.querySelectorAll('#cheatItems .cheat-item');
          items.forEach(function(item) {
            var cName = item.querySelector('.cheat-name');
            var cAddr = item.querySelector('.cheat-address');
            var cVal = item.querySelector('.cheat-value');
            var cType = item.querySelector('.cheat-datatype');
            var cHotkey = item.querySelector('.cheat-hotkey');
            if (cAddr && cAddr.value.trim()) {
              cheats.push({
                id: 'cheat_' + cheats.length,
                name: cName ? cName.value.trim() : '',
                description: item.querySelector('.cheat-desc') ? item.querySelector('.cheat-desc').value.trim() : '',
                address: cAddr.value.trim(),
                value: cVal ? parseFloat(cVal.value) || 0 : 0,
                dataType: cType ? cType.value : 'int',
                hotkey: cHotkey ? cHotkey.value.trim() : ''
              });
            }
          });

          var plugin = {
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            name: name,
            executable: exe,
            description: desc,
            cheats: cheats
          };

          window.api.savePlugin(plugin).then(function(result) {
            if (result.success) {
              alert('插件上传成功！');
              uploadForm.reset();
              var cheatItemsContainer = document.getElementById('cheatItems');
              if (cheatItemsContainer) {
                cheatItemsContainer.innerHTML = '<div class="cheat-item">'
                  + '<input type="text" class="cheat-name" placeholder="修改项名称" maxlength="10">'
                  + '<input type="text" class="cheat-desc" placeholder="描述">'
                  + '<input type="text" class="cheat-address" placeholder="内存地址 (0x...)">'
                  + '<input type="number" class="cheat-value" placeholder="目标值">'
                  + '<select class="cheat-datatype">'
                  + '<option value="int">整数</option><option value="float">浮点数</option><option value="byte">字节</option><option value="short">短整数</option><option value="double">双精度</option>'
                  + '</select>'
                  + '<input type="text" class="cheat-hotkey" placeholder="快捷键 (如F1)">'
                  + '<button type="button" class="remove-cheat" onclick="removeCheatItem(this)">-</button></div>';
              }
              loadGames();
            } else {
              alert('保存失败: ' + (result.error || '未知错误'));
            }
          });
        });
      }
    });

    // 初始化
    document.addEventListener('DOMContentLoaded', function() {
      window.currentLanguage = 'zh';
      loadGames();

      var refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', refreshProcesses);

      var scanBtn = document.getElementById('startScanBtn');
      if (scanBtn) scanBtn.addEventListener('click', startScan);

      // 上传插件功能初始化
      var hiddenInput = document.getElementById('importFileInput');
      if (!hiddenInput) {
        hiddenInput = document.createElement('input');
        hiddenInput.type = 'file';
        hiddenInput.id = 'importFileInput';
        hiddenInput.accept = '.json,application/json';
        hiddenInput.style.display = 'none';
        hiddenInput.addEventListener('change', function(e) {
          if (e.target.files && e.target.files[0]) {
            handleImportFile(e.target.files[0]);
          }
        });
        document.body.appendChild(hiddenInput);
      }

      // 初始化拖拽区域
      setupDropZone();

      // 初始化"从扫描结果导入"按钮状态
      updateImportFromScanButton();

      // 启动时自动加载进程列表（一次性，非定时刷新）
      refreshProcesses();

      // 初始日志
      appendLog('xcmod 已启动，日志面板就绪', 'success');

      // 【Electron 焦点兜底】mousedown 时确保 input/textarea 获得焦点
      // Electron 存在已知 bug：某些场景下点击输入框不会触发 focus
      document.addEventListener('mousedown', function(e) {
        var tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          // 延迟到当前事件循环结束后执行，避免与原生 focus 行为冲突
          setTimeout(function() { e.target.focus(); }, 0);
        }
      }, true);  // capture 阶段，优先于其他处理器

      // 初始化翻译
      initTranslation();
    });

    // ========== 国际化功能 ==========

    async function initTranslation() {
      var elements = document.querySelectorAll('[data-i18n]');
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var key = el.getAttribute('data-i18n');
        if (key) {
          try {
            var text = await window.api.i18nTranslate(key);
            el.textContent = text;
          } catch (e) {
            console.error('翻译失败:', key, e);
          }
        }
      }

      var placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
      for (var i = 0; i < placeholderElements.length; i++) {
        var el = placeholderElements[i];
        var key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          try {
            var text = await window.api.i18nTranslate(key);
            el.placeholder = text;
          } catch (e) {
            console.error('翻译失败:', key, e);
          }
        }
      }

      var titleElements = document.querySelectorAll('[data-i18n-title]');
      for (var i = 0; i < titleElements.length; i++) {
        var el = titleElements[i];
        var key = el.getAttribute('data-i18n-title');
        if (key) {
          try {
            var text = await window.api.i18nTranslate(key);
            el.title = text;
          } catch (e) {
            console.error('翻译失败:', key, e);
          }
        }
      }
    }

    async function changeLanguage(lng) {
      try {
        window.currentLanguage = lng;
        await window.api.i18nChangeLanguage(lng);
        await initTranslation();
        updateGuideExampleJson();
        appendLog('语言已切换为: ' + (lng === 'zh' ? '中文' : 'English'), 'info');
      } catch (e) {
        alert('切换语言失败: ' + e.message);
      }
    }

    async function t(key, params) {
      try {
        var text = await window.api.i18nTranslate(key);
        if (params && typeof params === 'object') {
          for (var k in params) {
            text = text.replace(new RegExp('{{' + k + '}}', 'g'), params[k]);
          }
        }
        return text;
      } catch (e) {
        console.error('翻译失败:', key, e);
        return key;
      }
    }

    async function updateGuideExampleJson() {
      var isEn = window.currentLanguage === 'en';
      var exampleJson = {
        "id": "example-game",
        "name": isEn ? "Example Game" : "示例游戏",
        "executable": "Game.exe",
        "description": isEn ? "This is an example plugin configuration" : "这是一个示例插件配置",
        "cheats": [
          {
            "id": "unlimited-health",
            "name": isEn ? "Unlimited Health" : "无限生命",
            "description": isEn ? "Set health to 999" : "设置生命值为999",
            "address": "0x12345678",
            "value": 999,
            "dataType": "int"
          },
          {
            "id": "infinite-money",
            "name": isEn ? "Infinite Money" : "无限金钱",
            "description": isEn ? "Set money to 999999" : "设置金钱为999999",
            "address": "0x1234567C",
            "value": 999999,
            "dataType": "int"
          },
          {
            "id": "god-mode",
            "name": isEn ? "God Mode" : "无敌模式",
            "description": isEn ? "Enable invincibility" : "开启无敌状态",
            "address": "0x12345680",
            "value": 1,
            "dataType": "byte"
          }
        ]
      };
      var jsonEl = document.getElementById('guideExampleJson');
      if (jsonEl) {
        jsonEl.textContent = JSON.stringify(exampleJson, null, 2);
      }
    }
