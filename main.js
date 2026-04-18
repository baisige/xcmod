const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { initI18n, changeLanguage, t } = require('./i18n');

let mainWindow;
let gameConfigs = [];

let currentScanProcess = null;  // 当前扫描子进程引用，用于停止扫描
let i18n = null;

// 将主进程日志转发到渲染进程，方便用户在界面中看到调试信息
function logToRenderer(message) {
  console.log('[xcmod] ' + message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main-log', message);
  }
}

async function createWindow() {
  if (!i18n) {
    i18n = await initI18n();
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    },
    title: 'xcmod'
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function loadGameConfigs() {
  const configPath = path.join(__dirname, 'games');
  
  if (fs.existsSync(configPath)) {
    const files = fs.readdirSync(configPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    gameConfigs = jsonFiles.map(f => {
      try {
        const content = fs.readFileSync(path.join(configPath, f), 'utf8');
        return JSON.parse(content);
      } catch (e) {
        console.error('加载配置失败:', f, e.message);
        return null;
      }
    }).filter(Boolean);
  }
}

// Convert IPC handlers to asynchronous handles to support async renderer
// Data validation helper exposed below

// Data contract validation for plugin config
const ALLOWED_DATA_TYPES = ['int','float','double','byte','short'];
function isValidHotkey(hotkey) {
  if (!hotkey) return true;
  const s = hotkey.toUpperCase();
  return /^F([1-9]|1[0-2])$/.test(s);
}
function validatePluginConfig(plugin) {
  const errors = [];
  if (!plugin || typeof plugin !== 'object') {
    errors.push('插件对象错误');
    return { valid: false, errors };
  }
  if (typeof plugin.id !== 'string' || plugin.id.trim() === '') errors.push('id 必须为非空字符串');
  if (typeof plugin.name !== 'string' || plugin.name.trim() === '') errors.push('name 必须为非空字符串');
  if (typeof plugin.executable !== 'string' || plugin.executable.trim() === '') errors.push('executable 必须为非空字符串');
  if (!Array.isArray(plugin.cheats)) {
    errors.push('cheats 必须是数组');
  } else {
    plugin.cheats.forEach((cheat, idx) => {
      if (!cheat || typeof cheat !== 'object') {
        errors.push(`cheats[${idx}] 必须是对象`);
        return;
      }
      if (typeof cheat.name !== 'string' || cheat.name.trim() === '') errors.push(`cheats[${idx}].name 必填`);
      
      if (typeof cheat.address !== 'string' || cheat.address.trim() === '') {
        errors.push(`cheats[${idx}].address 必填`);
      } else if (!cheat.address.startsWith('0x')) {
        cheat.address = '0x' + cheat.address.trim();
      }
      
      if (typeof cheat.value !== 'number' || Number.isNaN(cheat.value)) errors.push(`cheats[${idx}].value 必须是数字`);
      if (typeof cheat.dataType !== 'string' || !ALLOWED_DATA_TYPES.includes(cheat.dataType)) errors.push(`cheats[${idx}].dataType 不合法`);
      if (cheat.hotkey && !isValidHotkey(cheat.hotkey)) errors.push(`cheats[${idx}].hotkey 格式不正确`);
    });
  }
  return { valid: errors.length === 0, errors };
}

async function writeMemory(pid, address, value, dataType) {
  try {
    logToRenderer('[writeMemory] 入参 pid=' + pid + ' addr=' + address + ' value=' + value + ' type=' + dataType);
    let buffer;
    if (dataType === 'float') {
      buffer = Buffer.alloc(4);
      buffer.writeFloatLE(value, 0);
    } else if (dataType === 'double') {
      buffer = Buffer.alloc(8);
      buffer.writeDoubleLE(value, 0);
    } else if (dataType === 'byte') {
      buffer = Buffer.alloc(1);
      buffer.writeUInt8(value, 0);
    } else if (dataType === 'short') {
      buffer = Buffer.alloc(2);
      buffer.writeUInt16LE(value, 0);
    } else {
      buffer = Buffer.alloc(4);
      buffer.writeUInt32LE(value, 0);
    }
    return await writeMemoryRaw(pid, address, buffer);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function scanMemory(pid, value, dataType) {
  return new Promise((resolve, reject) => {
    let psScriptPath = null;
    const cleanup = () => {
      if (psScriptPath) { try { fs.unlinkSync(psScriptPath); } catch (_) {} }
      currentScanProcess = null;
    };

    try {
      logToRenderer('=== Start memory scan ===');
      logToRenderer('PID: ' + pid + ', Value: ' + value + ', Type: ' + dataType);

      // All scanning logic lives inside a C# class (XcmodScanner).
      // PowerShell only calls one method and prints the result.
      // This eliminates ALL PowerShell<->C# interop issues with ref/out structs.
      const csharpCode = [
        'using System;',
        'using System.Text;',
        'using System.Runtime.InteropServices;',
        'using System.Collections.Generic;',
        '',
        'public class XcmodScanner {',
        '  const uint PROCESS_ALL_ACCESS = 0x1F0FFF;',
        '  const uint MEM_COMMIT = 0x1000;',
        '  const uint PAGE_NOACCESS = 0x01;',
        '  const int CHUNK_SIZE = 65536;',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int sz, out int read);',
        '',
        '  [DllImport("kernel32.dll")]',
        '  static extern bool CloseHandle(IntPtr h);',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr lpAddress, out MEMORY_BASIC_INFORMATION lpBuffer, uint dwLength);',
        '',
        '  [StructLayout(LayoutKind.Sequential)]',
        '  struct MEMORY_BASIC_INFORMATION {',
        '    public IntPtr BaseAddress;',
        '    public IntPtr AllocationBase;',
        '    public uint AllocationProtect;',
        '    public IntPtr RegionSize;',
        '    public uint State;',
        '    public uint Protect;',
        '    public uint Type;',
        '  }',
        '',
        '  public static string Scan(int pid, double targetValue, string dt) {',
        '    var results = new List<string>();',
        '    int dataSize;',
        '    switch (dt) {',
        '      case "float": dataSize = 4; break;',
        '      case "double": dataSize = 8; break;',
        '      case "byte": dataSize = 1; break;',
        '      case "short": dataSize = 2; break;',
        '      default: dataSize = 4; break;',
        '    }',
        '',
        '    IntPtr hProc = OpenProcess(PROCESS_ALL_ACCESS, false, pid);',
        '    if (hProc == IntPtr.Zero) return "ERROR:OPEN_PROCESS_FAILED";',
        '',
        '    Console.WriteLine("SCAN_HANDLE_OK");',
        '    long totalRead = 0;',
        '    int regionsScanned = 0;',
        '    int chunks = 0;',
        '    var sb = new StringBuilder();',
        '    sb.Append("[");',
        '    bool first = true;',
        '    var mbi = new MEMORY_BASIC_INFORMATION();',
        '    IntPtr scanAddr = IntPtr.Zero;',
        '',
        '    while (true) {',
        '      IntPtr ret = VirtualQueryEx(hProc, scanAddr, out mbi, (uint)Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION)));',
        '      if (ret == IntPtr.Zero) break;',
        '',
        '      long regionSize = mbi.RegionSize.ToInt64();',
        '      IntPtr regionBase = mbi.BaseAddress;',
        '',
        '      if (mbi.State == MEM_COMMIT && (mbi.Protect & PAGE_NOACCESS) == 0) {',
        '        regionsScanned++;',
        '        long offset = 0;',
        '        while (offset < regionSize) {',
        '          int toRead = (int)Math.Min(CHUNK_SIZE, regionSize - offset);',
        '          byte[] buf = new byte[toRead];',
        '          int bytesRead = 0;',
        '          IntPtr curAddr = new IntPtr(regionBase.ToInt64() + offset);',
        '          try {',
        '            if (ReadProcessMemory(hProc, curAddr, buf, toRead, out bytesRead) && bytesRead > 0) {',
        '              totalRead += bytesRead;',
        '              int limit = bytesRead - dataSize;',
        '              for (int i = 0; i < limit; i += dataSize) {',
        '                bool match = false;',
        '                string valStr = "";',
        '                if (dt == "float") {',
        '                  float v = BitConverter.ToSingle(buf, i);',
        '                  match = Math.Abs((double)v - targetValue) <= 0.01;',
        '                  if (match) valStr = Math.Round(v, 2).ToString(System.Globalization.CultureInfo.InvariantCulture);',
        '                } else if (dt == "double") {',
        '                  double v = BitConverter.ToDouble(buf, i);',
        '                  match = Math.Abs(v - targetValue) <= 0.0001;',
        '                  if (match) valStr = Math.Round(v, 4).ToString(System.Globalization.CultureInfo.InvariantCulture);',
        '                } else if (dt == "byte") {',
        '                  byte v = buf[i];',
        '                  match = v == (byte)targetValue;',
        '                  if (match) valStr = v.ToString();',
        '                } else if (dt == "short") {',
        '                  ushort v = BitConverter.ToUInt16(buf, i);',
        '                  match = v == (ushort)targetValue;',
        '                  if (match) valStr = v.ToString();',
        '                } else {',
        '                  uint v = BitConverter.ToUInt32(buf, i);',
        '                  match = v == (uint)targetValue;',
        '                  if (match) valStr = v.ToString();',
        '                }',
        '                if (match) {',
        '                  if (!first) sb.Append(",");',
        '                  first = false;',
        '                  IntPtr hitAddr = new IntPtr(curAddr.ToInt64() + i);',
        '                  sb.Append("{\\\"Address\\\":\\\"0x" + hitAddr.ToInt64().ToString("X") + "\\\",\\\"Value\\\":" + valStr + "}");',
        '                }',
        '              }',
        '            }',
        '          } catch { }',
        '          offset += toRead;',
        '          chunks++;',
        '          if (chunks % 50 == 0) {',
        '            double kb = Math.Round(totalRead / 1024.0);',
        '            Console.WriteLine("SCAN_PROGRESS: regions=" + regionsScanned + " chunks=" + chunks + " readKB=" + kb + " results=" + results.Count);',
        '          }',
        '        }',
        '      }',
        '',
        '      // Advance to next region',
        '      long nextAddr = scanAddr.ToInt64() + regionSize;',
        '      if (nextAddr <= scanAddr.ToInt64()) break;',
        '      scanAddr = new IntPtr(nextAddr);',
        '    }',
        '',
        '    CloseHandle(hProc);',
        '    double kbTotal = Math.Round(totalRead / 1024.0);',
        '    Console.WriteLine("SCAN_DONE: regions=" + regionsScanned + " chunks=" + chunks + " readKB=" + kbTotal + " results=" + (first ? 0 : 1));',
        '    sb.Append("]");',
        '    return sb.ToString();',
        '  }',
        '}'
      ].join('\n');

      // PowerShell script: compile C# class, call Scan(), output result
      const psCode = [
        "$cs = @'\n" + csharpCode + "\n'@",
        "Add-Type -TypeDefinition $cs -Language CSharp",
        "$result = [XcmodScanner]::Scan(" + pid + ", " + value + ", '" + dataType + "')",
        "if ($result.StartsWith('ERROR:')) { Write-Error $result; exit 1 }",
        "Write-Host $result"
      ].join('\n') + '\n';

      psScriptPath = path.join(require('os').tmpdir(), `xcmod_scan_${Date.now()}.ps1`);
      fs.writeFileSync(psScriptPath, '\uFEFF' + psCode, 'utf8');

      logToRenderer('Launching scan (pure C# scanner)...');

      // Use spawn for non-blocking execution with real-time progress streaming
      const ps = spawn('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', psScriptPath
      ], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windows: 'hide'
      });

      // Store reference so stopScan can kill it
      currentScanProcess = ps;

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        stdout += text;

        // Stream progress lines to renderer in real-time
        const lines = text.split('\n').filter(l => l.trim());
        lines.forEach(line => {
          if (line.startsWith('SCAN_')) {
            logToRenderer(line);
          }
          // Also send dedicated progress event for UI updates
          if (line.startsWith('SCAN_PROGRESS:')) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scan-progress', line);
            }
          }
        });
      });

      ps.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      const timer = setTimeout(() => {
        logToRenderer('Scan timeout (>120s), killing process...');
        try { ps.kill(); } catch(_) {}
        cleanup();
        resolve({ success: false, error: 'Scan timed out (>120s). Try narrowing search range.' });
      }, 120000);

      ps.on('close', (code) => {
        clearTimeout(timer);
        cleanup();

        if (code !== 0 && code !== null) {
          // code == null means process was killed (by stopScan or timeout)
          const errMsg = stderr || stdout || 'Process exited with code ' + code;
          logToRenderer('Scan failed: ' + errMsg.substring(0, 200));

          if (errMsg.includes('OPEN_PROCESS_FAILED') || errMsg.includes('OpenProcess')) {
            return resolve({ success: false, error: 'Cannot open target process. Ensure: 1) Run as admin; 2) Correct PID; 3) Process not protected' });
          }
          return resolve({ success: false, error: errMsg.substring(0, 300) || 'Scan failed. Run as admin.' });
        }

        logToRenderer('PS output length: ' + stdout.length);

        if (!stdout || stdout.trim() === '') {
          logToRenderer('ERROR: empty result');
          return resolve({ success: false, error: 'Scan returned empty. Check process and admin rights.' });
        }

        // Extract JSON from output - handle both {objects} and [array] formats
        const trimmed = stdout.trim();
        let jsonStr = '';
        // Try to find JSON array [...] or object {...}
        const arrayMatch = trimmed.match(/\[[\s\S]*\]$/);
        const objectMatch = trimmed.match(/\{[\s\S]*\}$/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        } else if (objectMatch) {
          jsonStr = objectMatch[0];
        }

        if (!jsonStr) {
          logToRenderer('ERROR: no JSON in output. Raw: ' + stdout.substring(0, 300));
          return resolve({ success: false, error: 'Scan data format error: ' + stdout.substring(0, 300) });
        }

        let results;
        try {
          results = JSON.parse(jsonStr);
        } catch (e) {
          logToRenderer('JSON parse error: ' + e.message);
          return resolve({ success: false, error: 'Failed to parse scan results.' });
        }

        logToRenderer('Parsed: ' + (Array.isArray(results) ? results.length : (results ? 1 : 0)) + ' results');
        resolve({ success: true, results: Array.isArray(results) ? results : (results ? [results] : []) });
      });

      ps.on('error', (err) => {
        clearTimeout(timer);
        cleanup();
        logToRenderer('Spawn error: ' + err.message);
        resolve({ success: false, error: 'Failed to launch PowerShell: ' + err.message });
      });

    } catch (error) {
      cleanup();
      logToRenderer('Scan exception: ' + (error.message || ''));
      resolve({ success: false, error: error.message || 'Scan failed. Run as admin.' });
    }
  });
}

function stopScan() {
  if (currentScanProcess) {
    logToRenderer('User requested scan stop...');
    try {
      currentScanProcess.kill();
    } catch (_) {}
    currentScanProcess = null;
    return { success: true, message: '扫描已停止' };
  }
  return { success: false, message: '没有正在运行的扫描' };
}

function writeMemoryRaw(pid, address, buffer) {
  return new Promise((resolve, reject) => {
    let psScriptPath = null;
    const tmpFiles = [];
    const cleanup = () => {
      if (psScriptPath) { try { fs.unlinkSync(psScriptPath); } catch (_) {} }
      tmpFiles.forEach(function(f) { try { fs.unlinkSync(f); } catch (_) {} });
    };

    try {
      const bytesArray = Array.from(buffer);
      const tmpDir = require('os').tmpdir();

      // 写入C#源码文件（避免PS heredoc转义问题）
      const csContent = [
        'using System;',
        'using System.Runtime.InteropServices;',
        '',
        'public class MemWriter {',
        '  [DllImport("kernel32.dll")]',
        '  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  public static extern bool WriteProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int sz, out int written);',
        '',
        '  [DllImport("kernel32.dll")]',
        '  public static extern bool CloseHandle(IntPtr h);',
        '',
        '  public static string Write(int pid, string addrStr, byte[] bytes) {',
        '    var h = OpenProcess(0x1F0FFF, false, pid);',
        '    if (h == IntPtr.Zero) return "ERROR:OPEN";',
        '    long addrLong = Convert.ToInt64(addrStr.Replace("0x","").Replace("0X",""), 16);',
        '    var addr = new IntPtr(addrLong);',
        '    int written = 0;',
        '    bool ok = WriteProcessMemory(h, addr, bytes, bytes.Length, out written);',
        '    CloseHandle(h);',
        '    if (!ok) return "ERROR:WRITE";',
        '    return "OK:" + written;',
        '  }',
        '}'
      ].join('\r\n');

      const csFilePath = path.join(tmpDir, 'xcmod_w_' + Date.now() + '.cs');
      fs.writeFileSync(csFilePath, csContent, 'utf8');
      tmpFiles.push(csFilePath);

      // PS脚本：读.cs文件编译并调用
      const safeCsPath = csFilePath.replace(/\\/g, '/');
      const psCode = [
        '$src = [IO.File]::ReadAllText("' + safeCsPath + '", [System.Text.Encoding]::UTF8)',
        'Add-Type -TypeDefinition $src -Language CSharp | Out-Null',
        '[Byte[]]$bytes = @(' + bytesArray.join(',') + ')',
        '$r = [MemWriter]::Write(' + pid + ', "' + address + '", $bytes)',
        'if ($r.StartsWith("ERROR:")) { Write-Error $r; exit 1 }',
        'Write-Host $r'
      ].join('\r\n');

      psScriptPath = path.join(tmpDir, 'xcmod_wp_' + Date.now() + '.ps1');
      fs.writeFileSync(psScriptPath, '\uFEFF' + psCode, 'utf8');

      logToRenderer('[写入] PID=' + pid + ' Addr=' + address + ' Bytes=' + bytesArray.length + ' Value=' + buffer.readUInt32LE(0));

      const ps = spawn('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', psScriptPath
      ], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windows: 'hide'
      });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

      const timer = setTimeout(() => {
        try { ps.kill(); } catch (_) {}
        cleanup();
        logToRenderer('[写入] 超时 (>10s)');
        resolve({ success: false, error: 'Write timeout (>10s)' });
      }, 10000);

      ps.on('close', (code) => {
        clearTimeout(timer);
        cleanup();

        logToRenderer('[写入] PS exit=' + code + ' stdout="' + stdout.trim() + '" stderr="' + (stderr||'').substring(0,200) + '"');

        if (code !== 0 && code !== null) {
          const errMsg = stderr || stdout || '';
          if (errMsg.includes('OPEN') || errMsg.includes('OpenProcess')) {
            return resolve({ success: false, error: 'Cannot open target process for writing' });
          }
          return resolve({ success: false, error: 'Write failed: ' + errMsg.substring(0, 300) });
        }

        if (stdout.indexOf('OK:') >= 0) {
          resolve({ success: true, written: stdout.trim() });
        } else {
          resolve({ success: false, error: 'Unexpected output: ' + stdout.substring(0, 200) });
        }
      });

      ps.on('error', (err) => {
        clearTimeout(timer);
        cleanup();
        resolve({ success: false, error: 'Failed to launch: ' + err.message });
      });

    } catch (error) {
      cleanup();
      resolve({ success: false, error: error.message || 'Memory write failed' });
    }
  });
}

function getProcessList() {
  // Fast: just name/pid/path, NO icon extraction
  return new Promise((resolve, reject) => {
    try {
      const ps = spawn('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        'Get-Process | Where-Object { $_.Path -ne $null } | Select-Object Name,Id,Path | Sort-Object Name | ConvertTo-Json -Compress'
      ], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windows: 'hide' });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

      const timer = setTimeout(() => {
        try { ps.kill(); } catch (_) {}
        resolve([]);
      }, 5000);

      ps.on('close', () => {
        clearTimeout(timer);
        const processes = [];
        try {
          const data = JSON.parse(stdout);
          if (Array.isArray(data)) {
            data.forEach(p => {
              if (p.Name && p.Id) {
                processes.push({
                  name: p.Name,
                  pid: p.Id,
                  path: p.Path || ''
                });
              }
            });
          }
        } catch (_) {}
        resolve(processes);
      });

      ps.on('error', () => {
        clearTimeout(timer);
        resolve([]);
      });

    } catch (e) {
      resolve([]);
    }
  });
}

// Extract icons for a limited set of process paths (lazy, on-demand for visible items only)
function getProcessIcons(pathList) {
  return new Promise((resolve) => {
    if (!pathList || pathList.length === 0) return resolve({});
    try {
      // Limit to max 20 icons per call to avoid slowdown
      const limitedPaths = pathList.slice(0, 20);
      const escapedPaths = limitedPaths.map(p =>
        p.replace(/'/g, '\\/').replace(/'/g, "''").replace(/`/g, '``')
      ).join("','");

      const ps = spawn('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        [
          '$paths = @(\'' + escapedPaths + '\')',
          '$result = @{}',
          'foreach ($p in $paths) {',
          '  try {',
          '    if ($p -and (Test-Path $p)) {',
          '      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p);',
          '      if ($icon -ne $null) {',
          '        $bmp = $icon.ToBitmap();',
          '        $ms = New-Object System.IO.MemoryStream;',
          '        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);',
          '        $buf = $ms.ToArray();',
          '        $ms.Close();',
          '        $icon.Dispose();',
          '        $result[$p] = "data:image/png;base64," + [Convert]::ToBase64String($buf);',
          '      }',
          '    }',
          '  } catch {}',
          '}',
          '$result | ConvertTo-Json -Compress'
        ].join(';')
      ], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windows: 'hide' });

      let stdout = '';
      ps.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      ps.stderr.on('data', () => {});

      const timer = setTimeout(() => { try { ps.kill(); } catch(_) {} resolve({}); }, 8000);
      ps.on('close', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout)); } catch(_) { resolve({}); }
      });
      ps.on('error', () => { clearTimeout(timer); resolve({}); });
    } catch(e) { resolve({}); }
  });
}

ipcMain.handle('getProcessIcons', async (event, pathList) => {
  return getProcessIcons(pathList);
});

ipcMain.handle('i18nChangeLanguage', async (event, lng) => {
  try {
    await changeLanguage(lng);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('i18nTranslate', async (event, key, options) => {
  return t(key, options);
});

ipcMain.handle('getGames', async () => {
  return gameConfigs;
});

ipcMain.handle('savePlugin', async (event, args) => {
  try {
    if (!args.skipValidation) {
      const validation = validatePluginConfig(args);
      if (!validation.valid) {
        const errorMsg = '插件配置验证失败: ' + validation.errors.join('; ');
        return { success: false, error: errorMsg };
      }
    }
    
    const configPath = path.join(__dirname, 'games');
    if (!fs.existsSync(configPath)) fs.mkdirSync(configPath, { recursive: true });
    
    const filePath = path.join(configPath, `${args.id}.json`);
    const exists = fs.existsSync(filePath);
    
    if (exists && !args.override) {
      return { success: false, error: 'ID已存在', exists: true };
    }
    
    const saveArgs = { ...args };
    delete saveArgs.skipValidation;
    delete saveArgs.override;
    
    fs.writeFileSync(filePath, JSON.stringify(saveArgs, null, 2));
    loadGameConfigs();
    
    return { success: true, exists: exists };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deletePlugin', async (event, args) => {
  try {
    const configPath = path.join(__dirname, 'games');
    if (!fs.existsSync(configPath)) return { success: false, error: '游戏目录不存在' };

    // 先尝试用 id 精确匹配文件名
    let targetFile = path.join(configPath, `${args.id}.json`);

    // 如果 id 匹配不到，尝试用 name 匹配文件内容
    if (!fs.existsSync(targetFile) && args.name) {
      const files = fs.readdirSync(configPath).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(configPath, f), 'utf8'));
          if (content.name === args.name) {
            targetFile = path.join(configPath, f);
            break;
          }
        } catch (_) {}
      }
    }

    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
      loadGameConfigs();
      return { success: true };
    } else {
      return { success: false, error: '插件不存在（id: ' + (args.id || '') + ', name: ' + (args.name || '') + '）' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getProcessList', async (event) => {
  return getProcessList();
});

ipcMain.handle('writeMemory', async (event, pid, address, value, dataType) => {
  return writeMemory(pid, address, value, dataType);
});

ipcMain.handle('scanMemory', async (event, pid, value, dataType) => {
  return scanMemory(pid, value, dataType);
});

ipcMain.handle('stopScan', async () => {
  return stopScan();
});

ipcMain.handle('addCheatsToGame', async (event, gameName, cheats) => {
  try {
    const configPath = path.join(__dirname, 'games');
    if (!fs.existsSync(configPath)) return { success: false, error: '游戏目录不存在' };
    const files = fs.readdirSync(configPath).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const fp = path.join(configPath, f);
      const content = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (content.name === gameName) {
        if (!content.cheats) content.cheats = [];
        cheats.forEach(c => {
          content.cheats.push({
            id: 'cheat_' + content.cheats.length,
            name: c.name,
            address: c.address,
            value: c.value || 0,
            dataType: c.dataType || 'int'
          });
        });
        fs.writeFileSync(fp, JSON.stringify(content, null, 2), 'utf8');
        loadGameConfigs();
        return { success: true };
      }
    }
    return { success: false, error: '未找到游戏: ' + gameName };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// 编辑游戏信息（名称、描述）
ipcMain.handle('editGameInfo', async (event, idx, newName, newDesc) => {
  try {
    if (!gameConfigs[idx]) {
      return { success: false, error: '索引超出范围' };
    }
    const game = gameConfigs[idx];
    const oldName = game.name;
    game.name = newName;
    if (newDesc !== undefined && newDesc !== null) {
      game.description = newDesc;
    }

    // 写回 games/ 目录下的原始文件
    if (game.id) {
      const filePath = path.join(__dirname, 'games', game.id + '.json');
      fs.writeFileSync(filePath, JSON.stringify(game, null, 2), 'utf8');
    }

    logToRenderer('[编辑] 游戏已更新: ' + oldName + ' → ' + newName);
    return { success: true, oldName: oldName, executable: game.executable || '' };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// 单次修改后更新cheat保存值
ipcMain.handle('updateCheatValue', async (event, gameName, idx, newValue) => {
  try {
    const game = gameConfigs.find(function(g) { return g.name === gameName; });
    if (game && game.cheats && game.cheats[idx]) {
      game.cheats[idx].value = newValue;
      if (game.id) {
        const filePath = path.join(__dirname, 'games', game.id + '.json');
        fs.writeFileSync(filePath, JSON.stringify(game, null, 2), 'utf8');
      }
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// 保存当前游戏的完整配置（将内存中的修改同步到文件）
ipcMain.handle('saveCurrentGame', async (event, gameName) => {
  try {
    const game = gameConfigs.find(function(g) { return g.name === gameName; });
    if (!game || !game.id) {
      return { success: false, error: '未找到游戏: ' + gameName };
    }

    const configDir = path.join(__dirname, 'games');
    const filePath = path.join(configDir, game.id + '.json');
    fs.writeFileSync(filePath, JSON.stringify(game, null, 2), 'utf8');

    logToRenderer('[保存] ' + gameName + ' 配置已保存 (' + (game.cheats ? game.cheats.length : 0) + ' 个修改项)');
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

app.whenReady().then(() => {
  loadGameConfigs();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

// Filter scan: re-read previously found addresses, return only those where value changed to newValue
function filterScan(pid, previousResults, newValue, dataType) {
  return new Promise((resolve, reject) => {
    let psScriptPath = null;
    const tmpFiles = [];
    const cleanup = () => {
      if (psScriptPath) { try { fs.unlinkSync(psScriptPath); } catch (_) {} }
      tmpFiles.forEach(function(f) { try { fs.unlinkSync(f); } catch (_) {} });
    };

    try {
      logToRenderer('=== Start filter scan ===');
      logToRenderer('PID: ' + pid + ', NewValue: ' + newValue + ', Type: ' + dataType + ', PreviousResults: ' + previousResults.length);

      const dataSizes = { 'int': 4, 'float': 4, 'double': 8, 'byte': 1, 'short': 2 };
      const dataSize = dataSizes[dataType] || 4;
      const tmpDir = require('os').tmpdir();

      // === 1. 写入地址列表文件（每行一个地址）===
      const addrLines = previousResults.map(function(r) {
        return r.Address || r.address || '';
      }).filter(function(a) { return a.length > 0; }).join('\r\n');
      const addrFilePath = path.join(tmpDir, 'xcmod_fa_' + Date.now() + '.txt');
      fs.writeFileSync(addrFilePath, addrLines, 'utf8');
      tmpFiles.push(addrFilePath);

      // === 2. 直接写入C#源码文件（不经过PS字符串转义）===
      const csContent = [
        'using System;',
        'using System.Text;',
        'using System.IO;',
        'using System.Globalization;',
        'using System.Runtime.InteropServices;',
        '',
        'public class FilterScanner {',
        '  const uint PROCESS_ALL_ACCESS = 0x1F0FFF;',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
        '',
        '  [DllImport("kernel32.dll", SetLastError = true)]',
        '  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int sz, out int read);',
        '',
        '  [DllImport("kernel32.dll")]',
        '  static extern bool CloseHandle(IntPtr h);',
        '',
        '  public static string Filter(int pid, string fpath, double targetVal, string dt) {',
        '    var hProc = OpenProcess(PROCESS_ALL_ACCESS, false, pid);',
        '    if (hProc == IntPtr.Zero) return "ERROR:OPEN_PROCESS_FAILED";',
        '',
        '    var lines = File.ReadAllLines(fpath);',
        '    var sb = new StringBuilder();',
        '    sb.Append("[");',
        '    bool first = true;',
        '    int checkedCount = 0;',
        '    int ds = ' + dataSize + ';',
        '',
        '    foreach (var rawLine in lines) {',
        '      var line = rawLine.Trim();',
        '      if (line.Length == 0) continue;',
        '      checkedCount++;',
        '      long addrLong = 0;',
        '      try {',
        '        var hex = line.Replace("0x","").Replace("0X","");',
        '        addrLong = Convert.ToInt64(hex, 16);',
        '      } catch { continue; }',
        '      var addr = new IntPtr(addrLong);',
        '      byte[] buf = new byte[ds];',
        '      int read = 0;',
        '      try {',
        '        if (ReadProcessMemory(hProc, addr, buf, ds, out read) && read == ds) {',
        '          double v = 0;',
        '          if (dt == "float") v = BitConverter.ToSingle(buf, 0);',
        '          else if (dt == "double") v = BitConverter.ToDouble(buf, 0);',
        '          else if (dt == "byte") v = buf[0];',
        '          else if (dt == "short") v = BitConverter.ToInt16(buf, 0);',
        '          else v = (double)BitConverter.ToUInt32(buf, 0);',
        '          bool match = false;',
        '          if (dt == "float") match = Math.Abs(v - targetVal) <= 0.01;',
        '          else if (dt == "double") match = Math.Abs(v - targetVal) <= 0.0001;',
        '          else match = ((long)v) == ((long)targetVal);',
        '          if (match) {',
        '            if (!first) sb.Append(",");',
        '            first = false;',
        '            sb.Append("{\\\"Address\\\":\\\"" + line + "\\\",\\\"Value\\\":");',
        '            if (dt == "float") sb.Append(Math.Round(v,2).ToString(CultureInfo.InvariantCulture));',
        '            else if (dt == "double") sb.Append(Math.Round(v,4).ToString(CultureInfo.InvariantCulture));',
        '            else sb.Append(((long)v).ToString());',
        '            sb.Append("}");',
        '          }',
        '        }',
        '      } catch { }',
        '    }',
    '    CloseHandle(hProc);',
    '    sb.Append("]");',
    '    return sb.ToString();',
        '  }',
        '}'
      ].join('\r\n');

      const csFilePath = path.join(tmpDir, 'xcmod_fc_' + Date.now() + '.cs');
      fs.writeFileSync(csFilePath, csContent, 'utf8');
      tmpFiles.push(csFilePath);

      // === 3. PS脚本极简：读.cs文件编译并调用（无任何内嵌C#代码）===
      const safeCsPath = csFilePath.replace(/\\/g, '/');
      const safeAddrPath = addrFilePath.replace(/\\/g, '/');
      const psCode = [
        '$src = [IO.File]::ReadAllText("' + safeCsPath + '", [System.Text.Encoding]::UTF8)',
        'Add-Type -TypeDefinition $src -Language CSharp | Out-Null',
        '$r = [FilterScanner]::Filter(' + pid + ', "' + safeAddrPath + '", ' + newValue + ', "' + dataType + '")',
        'if ($r.StartsWith("ERROR:")) { Write-Error $r; exit 1 }',
        'Write-Host $r'
      ].join('\r\n');

      psScriptPath = path.join(tmpDir, 'xcmod_fp_' + Date.now() + '.ps1');
      fs.writeFileSync(psScriptPath, '\uFEFF' + psCode, 'utf8');

      logToRenderer('Launching filter scan...');

      const ps = spawn('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', psScriptPath
      ], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windows: 'hide' });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
        const lines = data.toString('utf8').split('\n').filter(l => l.trim());
        lines.forEach(line => {
          if (line.startsWith('FILTER_')) logToRenderer(line);
        });
      });

      ps.stderr.on('data', (data) => { stderr += data.toString('utf8'); });

      const timer = setTimeout(() => {
        try { ps.kill(); } catch(_) {}
        cleanup();
        resolve({ success: false, error: 'Filter timeout (>30s)' });
      }, 30000);

      ps.on('close', (code) => {
        clearTimeout(timer);
        cleanup();
        if (code !== 0 && code !== null) {
          const errMsg = stderr || stdout || '';
          if (errMsg.includes('OPEN_PROCESS_FAILED')) {
            return resolve({ success: false, error: 'Cannot open target process' });
          }
          return resolve({ success: false, error: errMsg.substring(0, 300) });
        }

        logToRenderer('Filter PS output length: ' + stdout.length + ', stderr: ' + (stderr || '').substring(0, 200));
        let results;
        try {
          results = JSON.parse(stdout);
          resolve({ success: true, results: Array.isArray(results) ? results : [] });
        } catch(e) {
          logToRenderer('Filter parse error: ' + e.message + ', stdout=' + (stdout || '').substring(0, 200));
          resolve({ success: false, error: 'Failed to parse filter results' });
        }
      });

      ps.on('error', (err) => {
        clearTimeout(timer);
        cleanup();
        resolve({ success: false, error: 'Failed to launch filter: ' + err.message });
      });
    } catch(error) {
      cleanup();
      resolve({ success: false, error: error.message });
    }
  });
}

ipcMain.handle('filterScan', async (event, pid, previousResults, newValue, dataType) => {
  return filterScan(pid, previousResults, newValue, dataType);
});
