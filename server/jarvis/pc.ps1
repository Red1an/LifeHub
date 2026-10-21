# Управление компьютером для Джарвиса (server/jarvis/pc.ts).
#
# Хаб держит один процесс PowerShell: запрос — строка JSON { id, fn, args } на stdin,
# ответ — строка JSON { id, ok, result | error } в stdout. Выполняются только функции
# из таблицы $fns ниже — произвольный код сюда не попадает.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace LifeHubPc {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
  }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

  public static class Audio {
    static IAudioEndpointVolume Vol() {
      var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
      IMMDevice dev = null;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
      IAudioEndpointVolume epv = null;
      var id = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out epv));
      return epv;
    }
    public static float Volume {
      get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
      set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
    }
    public static bool Mute {
      get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
      set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
    }
  }

  public static class Win {
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool LockWorkStation();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("powrprof.dll")] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);

    const uint KEYUP = 2;

    public static void Keys(byte[] vks) {
      foreach (var k in vks) keybd_event(k, 0, 0, UIntPtr.Zero);
      for (int i = vks.Length - 1; i >= 0; i--) keybd_event(vks[i], 0, KEYUP, UIntPtr.Zero);
    }

    /* Windows не отдаёт фокус чужому окну просто так: короткое нажатие Alt снимает запрет. */
    public static void Focus(IntPtr h) {
      if (IsIconic(h)) ShowWindow(h, 9);
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
      SetForegroundWindow(h);
    }

    public static string ActiveTitle() {
      var sb = new StringBuilder(512);
      GetWindowText(GetForegroundWindow(), sb, 512);
      return sb.ToString();
    }

    public static uint ActivePid() {
      uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid;
    }
  }
}
'@

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Out-Line($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Get-Vol { @{ level = [int][math]::Round([LifeHubPc.Audio]::Volume * 100); muted = [LifeHubPc.Audio]::Mute } }

$fns = @{
  'ping' = { param($a) 'pong' }

  'volume.get' = { param($a) Get-Vol }
  'volume.set' = { param($a)
    $l = [math]::Max(0, [math]::Min(100, [int]$a.level))
    [LifeHubPc.Audio]::Volume = $l / 100
    if ($l -gt 0) { [LifeHubPc.Audio]::Mute = $false }
    Get-Vol
  }
  'volume.mute' = { param($a) [LifeHubPc.Audio]::Mute = [bool]$a.on; Get-Vol }

  # Медиаклавиши: работают с любым плеером — Spotify, Яндекс Музыка, YouTube в браузере.
  'media' = { param($a)
    $vk = @{ play = 0xB3; next = 0xB0; prev = 0xB1; stop = 0xB2 }[[string]$a.key]
    if (-not $vk) { throw "Неизвестная клавиша: $($a.key)" }
    [LifeHubPc.Win]::Keys([byte[]]@($vk)); $true
  }

  # Сочетания клавиш — только из этого списка.
  'hotkey' = { param($a)
    $combos = @{
      'close'    = @(0x12, 0x73)        # Alt+F4
      'minimize' = @(0x5B, 0x28)        # Win+Down
      'maximize' = @(0x5B, 0x26)        # Win+Up
      'desktop'  = @(0x5B, 0x44)        # Win+D
      'switch'   = @(0x12, 0x09)        # Alt+Tab
      'snip'     = @(0x5B, 0x10, 0x53)  # Win+Shift+S
      'taskview' = @(0x5B, 0x09)        # Win+Tab
      'emoji'    = @(0x5B, 0xBE)        # Win+.
      'copy'     = @(0x11, 0x43)
      'paste'    = @(0x11, 0x56)
      'undo'     = @(0x11, 0x5A)
      'enter'    = @(0x0D)
      'newtab'   = @(0x11, 0x54)
      'closetab' = @(0x11, 0x57)
      'reopentab' = @(0x11, 0x10, 0x54)
      'fullscreen' = @(0x7A)            # F11
      'space'    = @(0x20)
    }
    $k = $combos[[string]$a.name]
    if (-not $k) { throw "Неизвестное сочетание: $($a.name)" }
    [LifeHubPc.Win]::Keys([byte[]]$k); $true
  }

  # Все приложения меню «Пуск» (и обычные, и из Store): имя и AppID для shell:AppsFolder.
  'apps.list' = { param($a)
    $list = @()
    try { $list = @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } }) } catch {}
    if (-not $list.Count) {
      $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
      $list = @(Get-ChildItem $dirs -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { @{ name = $_.BaseName; id = $_.FullName; path = $true } })
    }
    @{ items = $list }
  }
  'apps.launch' = { param($a)
    $id = [string]$a.id
    if ($a.path) { Start-Process -FilePath $id } else { Start-Process -FilePath "shell:AppsFolder\$id" }
    $true
  }

  # Ссылка, папка или файл — то же, что двойной щелчок.
  'open' = { param($a) Start-Process -FilePath ([string]$a.target); $true }

  'windows.list' = { param($a)
    $items = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
      $desc = ''; try { $desc = $_.MainModule.FileVersionInfo.FileDescription } catch {}
      @{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle; desc = $desc }
    })
    @{ items = $items; active = [LifeHubPc.Win]::ActivePid() }
  }
  'window.focus' = { param($a)
    $p = Get-Process -Id ([int]$a.pid)
    [LifeHubPc.Win]::Focus($p.MainWindowHandle); $true
  }
  'window.close' = { param($a)
    $ok = $false
    foreach ($p in @(Get-Process -Name ([string]$a.name) -ErrorAction SilentlyContinue)) {
      if ($p.MainWindowHandle -ne 0) { if ($p.CloseMainWindow()) { $ok = $true } }
    }
    $ok
  }
  'window.kill' = { param($a) Stop-Process -Name ([string]$a.name) -Force; $true }
  'window.active' = { param($a) @{ title = [LifeHubPc.Win]::ActiveTitle(); pid = [LifeHubPc.Win]::ActivePid() } }

  'lock' = { param($a) [LifeHubPc.Win]::LockWorkStation() | Out-Null; $true }
  'sleep' = { param($a) [LifeHubPc.Win]::SetSuspendState($false, $false, $false) | Out-Null; $true }
  'shutdown' = { param($a)
    $t = [math]::Max(0, [int]$a.seconds)
    if ($a.restart) { & shutdown.exe /r /t $t | Out-Null } else { & shutdown.exe /s /t $t | Out-Null }
    $true
  }
  'shutdown.abort' = { param($a) & shutdown.exe /a 2>$null | Out-Null; $LASTEXITCODE -eq 0 }

  'brightness.get' = { param($a)
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
    if (-not $b) { throw 'Яркость этого экрана не настраивается программно' }
    [int]$b.CurrentBrightness
  }
  'brightness.set' = { param($a)
    $l = [math]::Max(0, [math]::Min(100, [int]$a.level))
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
    if (-not $m) { throw 'Яркость этого экрана не настраивается программно' }
    Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$l } | Out-Null
    $l
  }

  # Ввод текста в активное окно через буфер обмена: так работают любые языки и символы.
  'type' = { param($a)
    $old = $null; try { $old = Get-Clipboard -Raw } catch {}
    Set-Clipboard -Value ([string]$a.text)
    Start-Sleep -Milliseconds 60
    [LifeHubPc.Win]::Keys([byte[]]@(0x11, 0x56))
    Start-Sleep -Milliseconds 250
    if ($a.enter) { [LifeHubPc.Win]::Keys([byte[]]@(0x0D)) }
    if ($null -ne $old) { try { Set-Clipboard -Value $old } catch {} }
    $true
  }
  'clipboard.get' = { param($a) try { [string](Get-Clipboard -Raw) } catch { '' } }

  'screenshot' = { param($a)
    $dir = [string]$a.dir
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $file = Join-Path $dir ("Джарвис " + (Get-Date -Format 'yyyy-MM-dd HH-mm-ss') + '.png')
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $file
  }

  'battery' = { param($a)
    $b = Get-CimInstance Win32_Battery | Select-Object -First 1
    if (-not $b) { return $null }
    @{ percent = [int]$b.EstimatedChargeRemaining; charging = ($b.BatteryStatus -eq 2 -or $b.BatteryStatus -ge 6) }
  }

  'system' = { param($a)
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    @{
      cpu = [int]$cpu
      ramUsed = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
      ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
      uptimeMin = [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes
    }
  }

  'notify' = { param($a)
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(8000, [string]$a.title, [string]$a.text, 'Info')
    Start-Sleep -Milliseconds 200
    $true
  }
}

Out-Line @{ id = 0; ok = $true; result = 'ready' }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $fn = $fns[[string]$req.fn]
    if (-not $fn) { throw "Неизвестная функция: $($req.fn)" }
    $result = & $fn $req.args
    Out-Line @{ id = $id; ok = $true; result = $result }
  } catch {
    Out-Line @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
