using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace OneDesk.Agent;

public sealed class AgentClient
{
    private readonly AgentConfig _cfg;
    private readonly SystemStats _stats = new();
    private ClientWebSocket? _ws;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly Dictionary<string, ConPty> _terminals = new();
    private CancellationTokenSource? _screenCts;
    private ScreenStreamer? _streamer;
    private volatile int _screenFps = 8;
    private volatile int _screenQuality = 50;
    private volatile int _screenMonitor = -1;
    private WebRtcScreen? _webrtc;

    public Action<bool>? OnConnectionChanged;
    public Action<string>? OnLog;
    public Action<string, string, bool>? OnNotify; // title, message, popup
    public Action? OnLock;
    public Action? OnUnlock;
    public Action<bool>? OnBlockInput;     // travar/destravar mouse+teclado fisico do cliente
    public Action<bool>? OnPrivacyScreen;  // mostrar/ocultar tela de espera

    public Action<string>? OnClipboardSet;   // texto p/ colocar na area de transferencia do cliente
    public Action? OnClipboardGet;           // pedido para ler a area de transferencia
    public Action<string>? OnFileSaved;      // nome do arquivo recebido (p/ aviso na bandeja)
    public Action<string>? OnPasteText;      // colar texto na conexao remota (set clipboard + Ctrl+V)
    public Action<List<string>>? OnPasteFiles; // colar arquivos (set filedrop + Ctrl+V)
    public Action<bool>? OnUpdateRequested;  // true = admin forcou pelo dashboard
    public bool Connected { get; private set; }

    private int _remoteRefs;
    private bool _wantBlockInput;
    private bool _wantPrivacyScreen;

    private readonly FileReceiver _fileRecv = new();
    private readonly List<string> _pasteFiles = new();

    public void ReportLock(bool locked) => _ = Send(new { type = "lock:state", locked });
    public void SendClipboard(string text) => _ = Send(new { type = "clipboard:data", text });
    public void ReportUpdateStatus(string phase) => _ = Send(new { type = "update:status", phase });

    public AgentClient(AgentConfig cfg) => _cfg = cfg;

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectOnce(ct);
            }
            catch (Exception ex)
            {
                OnLog?.Invoke($"erro: {ex.Message}");
            }
            SetConnected(false);
            if (ct.IsCancellationRequested) break;
            await Task.Delay(3000, ct).ContinueWith(_ => { });
        }
    }

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

    /// <summary>Descobre a URL atual do hub via endpoint estavel (Vercel). Cai no HubWs se falhar.</summary>
    private async Task<string> ResolveHubWs(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_cfg.DiscoveryUrl)) return _cfg.HubWs;
        try
        {
            var json = await _http.GetStringAsync(_cfg.DiscoveryUrl, ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String)
            {
                var url = u.GetString();
                if (!string.IsNullOrWhiteSpace(url)) return url!;
            }
        }
        catch { /* offline / fora do ar -> fallback */ }
        return _cfg.HubWs;
    }

    private async Task ConnectOnce(CancellationToken ct)
    {
        var hubWs = await ResolveHubWs(ct);
        _ws = new ClientWebSocket();
        var url = $"{hubWs}/agent?token={Uri.EscapeDataString(_cfg.EnrollToken)}";
        OnLog?.Invoke($"conectando a {hubWs}...");
        await _ws.ConnectAsync(new Uri(url), ct);
        SetConnected(true);
        OnLog?.Invoke("conectado ao hub");

        await SendRegister();
        if (OperatingSystem.IsWindows()) ReportLock(LockStore.IsLocked);

        // loops de stats e thumbnail da frota
        var statsTask = StatsLoop(ct);
        var thumbTask = ThumbLoop(ct);

        // loop de recepcao
        var buffer = new byte[64 * 1024];
        var sb = new StringBuilder();
        while (_ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            WebSocketReceiveResult res;
            sb.Clear();
            do
            {
                res = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (res.MessageType == WebSocketMessageType.Close)
                {
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                    return;
                }
                sb.Append(Encoding.UTF8.GetString(buffer, 0, res.Count));
            } while (!res.EndOfMessage);

            HandleMessage(sb.ToString());
        }
        await statsTask.ContinueWith(_ => { });
        await thumbTask.ContinueWith(_ => { });
    }

    private async Task ThumbLoop(CancellationToken ct)
    {
        // Miniatura periodica para os cards da frota (baixa resolucao/qualidade)
        await Task.Delay(1500, ct).ContinueWith(_ => { });
        while (_ws?.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            try
            {
                if (OperatingSystem.IsWindows())
                {
                    var thumb = ScreenCapture.CaptureBase64(360, 35);
                    if (thumb != null) await Send(new { type = "thumb", data = thumb });
                }
            }
            catch { }
            await Task.Delay(12000, ct).ContinueWith(_ => { });
        }
    }

    private async Task StatsLoop(CancellationToken ct)
    {
        while (_ws?.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            try
            {
                var s = _stats.Capture();
                await Send(new
                {
                    type = "stats",
                    s.cpu, s.memUsed, s.memTotal, s.diskUsed, s.diskTotal,
                    s.netUp, s.netDown, s.procCount, s.uptime, s.username,
                });
            }
            catch { }
            await Task.Delay(2000, ct).ContinueWith(_ => { });
        }
    }

    private async Task SendRegister()
    {
        object? specs = null;
        try { if (OperatingSystem.IsWindows()) specs = SystemInfo.Collect(); } catch { }

        await Send(new
        {
            type = "register",
            agentId = _cfg.AgentId,
            hostname = Environment.MachineName,
            os = "Windows",
            osVersion = RuntimeInformation.OSDescription,
            agentVersion = UpdateManager.CurrentVersion,
            localIp = GetLocalIp(),
            username = Environment.UserName,
            consentAt = AgentConfig.GetOrSetConsent().ToString("o"),
            specs,
        });
    }

    private void HandleMessage(string json)
    {
        JsonElement m;
        try { m = JsonDocument.Parse(json).RootElement; }
        catch { return; }
        if (!m.TryGetProperty("type", out var t)) return;
        var type = t.GetString();

        switch (type)
        {
            case "ping":
                _ = Send(new { type = "pong" });
                break;
            case "registered":
                OnLog?.Invoke("registrado no servidor");
                SendMonitors();
                break;
            case "term:start":
                StartTerminal(GetStr(m, "sessionId"), GetStr(m, "shell"));
                break;
            case "term:input":
                TerminalInput(GetStr(m, "sessionId"), GetStr(m, "data"));
                break;
            case "term:resize":
                TerminalResize(GetStr(m, "sessionId"), GetInt(m, "cols"), GetInt(m, "rows"));
                break;
            case "term:stop":
                StopTerminal(GetStr(m, "sessionId"));
                break;
            case "screen:start":
                StartScreen(GetInt(m, "fps", 8), GetInt(m, "quality", 50), GetInt(m, "monitor", -1));
                break;
            case "screen:config":
                _screenFps = Math.Clamp(GetInt(m, "fps", _screenFps), 1, 20);
                _screenQuality = Math.Clamp(GetInt(m, "quality", _screenQuality), 15, 90);
                if (m.TryGetProperty("monitor", out _))
                    ApplyMonitor(GetInt(m, "monitor", _screenMonitor));
                try { _webrtc?.SetFps(GetInt(m, "fps", 20)); } catch { }
                break;
            case "screen:monitors":
                SendMonitors();
                break;
            case "screen:stop":
                StopScreen();
                break;
            case "input:release":
                if (OperatingSystem.IsWindows()) InputInjector.ReleaseAll();
                break;
            case "remote:block-input":
                SetBlockInput(GetBool(m, "enabled"));
                break;
            case "remote:privacy":
                SetPrivacyScreen(GetBool(m, "enabled"));
                break;
            case "screenshot":
                TakeScreenshot();
                break;
            case "webrtc:offer":
                ApplyMonitor(GetInt(m, "monitor", _screenMonitor));
                StartWebRtc(GetStr(m, "sdp"), GetInt(m, "fps", 20), _screenMonitor);
                break;
            case "webrtc:ice":
                _webrtc?.AddIceCandidate(GetStr(m, "candidate"), GetStr(m, "sdpMid"), GetInt(m, "sdpMLineIndex"));
                break;
            case "webrtc:stop":
                StopWebRtc();
                break;
            case "notify":
                OnNotify?.Invoke(GetStr(m, "title"), GetStr(m, "message"), GetBool(m, "popup"));
                _ = Send(new { type = "notify:ack" });
                break;
            case "location:request":
                _ = ReportLocation();
                break;
            case "agent:update":
                OnUpdateRequested?.Invoke(true);
                _ = Send(new { type = "update:status", phase = "prompt_shown" });
                break;
            case "clipboard:set":
                OnClipboardSet?.Invoke(GetStr(m, "text"));
                break;
            case "clipboard:get":
                OnClipboardGet?.Invoke();
                break;
            case "file:chunk":
                if (OperatingSystem.IsWindows())
                {
                    bool paste = GetBool(m, "paste");
                    var saved = _fileRecv.AddChunk(GetStr(m, "id"), GetStr(m, "name"), GetStr(m, "data"), GetBool(m, "last"), paste);
                    if (saved != null)
                    {
                        if (paste) { lock (_pasteFiles) _pasteFiles.Add(saved); }
                        else
                        {
                            _ = Send(new { type = "file:saved", name = Path.GetFileName(saved), path = saved });
                            OnFileSaved?.Invoke(Path.GetFileName(saved));
                        }
                    }
                }
                break;
            case "clipboard:paste-text":
                OnPasteText?.Invoke(GetStr(m, "text"));
                break;
            case "clipboard:paste-commit":
                List<string> files;
                lock (_pasteFiles) { files = _pasteFiles.ToList(); _pasteFiles.Clear(); }
                if (files.Count > 0) OnPasteFiles?.Invoke(files);
                break;
            case "lock:setpass":
                if (OperatingSystem.IsWindows()) LockStore.SetPassword(GetStr(m, "password"));
                break;
            case "lock:on":
                if (OperatingSystem.IsWindows())
                {
                    LockStore.SetLocked(true);
                    OnLock?.Invoke();
                    ReportLock(true);
                }
                break;
            case "lock:off":
                if (OperatingSystem.IsWindows())
                {
                    LockStore.SetLocked(false);
                    OnUnlock?.Invoke();
                    ReportLock(false);
                }
                break;
            case "input:mouse":
                HandleMouse(m);
                break;
            case "input:key":
                if (OperatingSystem.IsWindows())
                {
                    bool combo = GetBool(m, "ctrl") || GetBool(m, "alt") || GetBool(m, "meta") || GetBool(m, "shift");
                    InputInjector.HandleKey(GetStr(m, "key"), GetBool(m, "down"), combo);
                }
                break;
        }
    }

    // ===================== Terminal =====================
    private void StartTerminal(string sessionId, string shell)
    {
        if (string.IsNullOrEmpty(sessionId)) return;
        try
        {
            var pty = ConPty.Start(shell == "powershell" ? "powershell" : "cmd", 120, 30);
            lock (_terminals) _terminals[sessionId] = pty;
            _ = Send(new { type = "term:started", sessionId, shell });
            OnLog?.Invoke($"terminal aberto ({shell})");

            _ = Task.Run(async () =>
            {
                var buf = new byte[8192];
                try
                {
                    while (true)
                    {
                        int n = await pty.Output.ReadAsync(buf);
                        if (n <= 0) break;
                        var data = Convert.ToBase64String(buf, 0, n);
                        await Send(new { type = "term:data", sessionId, data });
                    }
                }
                catch { }
                StopTerminal(sessionId);
            });
        }
        catch (Exception ex)
        {
            OnLog?.Invoke($"falha no terminal: {ex.Message}");
        }
    }

    private void TerminalInput(string sessionId, string b64)
    {
        ConPty? pty;
        lock (_terminals) _terminals.TryGetValue(sessionId, out pty);
        if (pty == null || string.IsNullOrEmpty(b64)) return;
        try
        {
            var bytes = Convert.FromBase64String(b64);
            pty.Input.Write(bytes);
            pty.Input.Flush();
        }
        catch { }
    }

    private void TerminalResize(string sessionId, int cols, int rows)
    {
        ConPty? pty;
        lock (_terminals) _terminals.TryGetValue(sessionId, out pty);
        pty?.Resize((short)cols, (short)rows);
    }

    private void StopTerminal(string sessionId)
    {
        ConPty? pty;
        lock (_terminals)
        {
            _terminals.TryGetValue(sessionId, out pty);
            _terminals.Remove(sessionId);
        }
        pty?.Dispose();
    }

    // ===================== Tela =====================
    private void ApplyMonitor(int monitor)
    {
        if (monitor < 0) monitor = ScreenCapture.GetPrimaryIndex();
        _screenMonitor = monitor;
        ScreenCapture.ActiveMonitor = monitor;
        try { _streamer?.SetMonitor(monitor); } catch { }
        try { _webrtc?.SetMonitor(monitor); } catch { }
    }

    private void SendMonitors()
    {
        if (!OperatingSystem.IsWindows()) return;
        _ = Send(new { type = "screen:monitors", monitors = ScreenCapture.GetMonitors() });
    }

    private void StartScreen(int fps, int quality, int monitor)
    {
        StopScreen();
        if (!OperatingSystem.IsWindows()) return;
        ApplyMonitor(monitor);
        _screenFps = Math.Clamp(fps, 1, 20);
        _screenQuality = Math.Clamp(quality, 15, 90);
        _screenCts = new CancellationTokenSource();
        var ct = _screenCts.Token;
        RemoteSessionEnter();
        OnLog?.Invoke("tela remota iniciada");
        _streamer = new ScreenStreamer(1366, _screenQuality, _screenMonitor);
        _ = Task.Run(async () =>
        {
            var streamer = _streamer!;
            int lastQuality = _screenQuality;
            var sw = new System.Diagnostics.Stopwatch();
            while (!ct.IsCancellationRequested)
            {
                sw.Restart();
                if (_screenQuality != lastQuality) { streamer.SetQuality(_screenQuality); lastQuality = _screenQuality; }
                try { DesktopMonitor.EnsureInputDesktop(); } catch { }
                var b64 = streamer.Frame();
                if (b64 != null)
                    await Send(new { type = "screen:frame", data = b64 });
                int budget = Math.Max(40, 1000 / Math.Max(1, _screenFps));
                int elapsed = (int)sw.ElapsedMilliseconds;
                int wait = budget - elapsed;
                if (wait > 0) await Task.Delay(wait, ct).ContinueWith(_ => { });
            }
        }, ct);
    }

    private void StopScreen()
    {
        var wasRunning = _screenCts != null;
        try { _screenCts?.Cancel(); } catch { }
        _screenCts = null;
        try { _streamer?.Dispose(); } catch { }
        _streamer = null;
        if (wasRunning)
        {
            if (OperatingSystem.IsWindows()) InputInjector.ReleaseAll();
            RemoteSessionLeave();
        }
    }

    private void StartWebRtc(string offerSdp, int fps, int monitor)
    {
        if (!OperatingSystem.IsWindows() || string.IsNullOrEmpty(offerSdp)) return;
        try
        {
            _webrtc ??= new WebRtcScreen(o => { _ = Send(o); });
            _webrtc.OnSessionActive = active =>
            {
                if (active) RemoteSessionEnter();
                else RemoteSessionLeave();
            };
            _ = _webrtc.HandleOffer(offerSdp, fps, monitor);
            OnLog?.Invoke("tela remota (WebRTC) iniciada");
        }
        catch (Exception ex)
        {
            OnLog?.Invoke($"falha WebRTC: {ex.Message}");
        }
    }

    private void StopWebRtc()
    {
        try { _webrtc?.Stop(); } catch { }
    }

    // ===================== Sessao remota (bloqueio + tela de espera opcionais) =====================
    private void RemoteSessionEnter()
    {
        if (Interlocked.Increment(ref _remoteRefs) == 1)
        {
            if (OperatingSystem.IsWindows())
            {
                InputInjector.ReleaseAll();
                DesktopMonitor.Start(() => OnLog?.Invoke("desktop interativo restaurado"));
            }
            SyncRemoteFeatures();
        }
    }

    private void RemoteSessionLeave()
    {
        if (Interlocked.Decrement(ref _remoteRefs) <= 0)
        {
            Interlocked.Exchange(ref _remoteRefs, 0);
            EndRemoteFeatures();
        }
    }

    private void RemoteSessionForceEnd()
    {
        Interlocked.Exchange(ref _remoteRefs, 0);
        EndRemoteFeatures();
    }

    private void SetBlockInput(bool on)
    {
        _wantBlockInput = on;
        SyncRemoteFeatures();
    }

    private void SetPrivacyScreen(bool on)
    {
        _wantPrivacyScreen = on;
        SyncRemoteFeatures();
    }

    private void SyncRemoteFeatures()
    {
        if (!OperatingSystem.IsWindows()) return;
        bool active = _remoteRefs > 0;
        OnBlockInput?.Invoke(active && _wantBlockInput);
        OnPrivacyScreen?.Invoke(active && _wantPrivacyScreen);
    }

    private void EndRemoteFeatures()
    {
        if (!OperatingSystem.IsWindows()) return;
        DesktopMonitor.Stop();
        InputInjector.ReleaseAll();
        OnBlockInput?.Invoke(false);
        OnPrivacyScreen?.Invoke(false);
    }

    private void OnHubDisconnected()
    {
        StopScreen();
        StopWebRtc();
        RemoteSessionForceEnd();
        if (OperatingSystem.IsWindows()) InputInjector.ReleaseAll();
    }

    private async Task ReportLocation()
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var loc = await Geolocation.ResolveAsync();
            if (loc != null)
            {
                await Send(new
                {
                    type = "location:report",
                    loc.lat,
                    loc.lng,
                    loc.accuracy,
                    loc.source,
                    loc.city,
                });
                OnLog?.Invoke($"localizacao enviada ({loc.source})");
            }
        }
        catch (Exception ex)
        {
            OnLog?.Invoke($"falha na localizacao: {ex.Message}");
        }
    }

    private void TakeScreenshot()
    {
        if (!OperatingSystem.IsWindows()) return;
        _ = Task.Run(async () =>
        {
            var b64 = ScreenCapture.CaptureBase64(1920, 85);
            if (b64 != null) await Send(new { type = "screenshot", data = b64 });
        });
    }

    private void HandleMouse(JsonElement m)
    {
        if (!OperatingSystem.IsWindows()) return;
        double x = GetDouble(m, "x"), y = GetDouble(m, "y");
        string button = GetStr(m, "button");
        string action = GetStr(m, "action");
        switch (action)
        {
            case "move": InputInjector.MouseMoveNormalized(x, y); break;
            case "down": InputInjector.MouseMoveNormalized(x, y); InputInjector.MouseButton(button, true); break;
            case "up": InputInjector.MouseButton(button, false); break;
            case "click": InputInjector.Click(x, y, button); break;
        }
    }

    // ===================== util =====================
    private async Task Send(object o)
    {
        if (_ws is not { State: WebSocketState.Open }) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(o);
        await _sendLock.WaitAsync();
        try
        {
            await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch { }
        finally { _sendLock.Release(); }
    }

    private void SetConnected(bool v)
    {
        if (Connected == v) return;
        Connected = v;
        if (!v) OnHubDisconnected();
        OnConnectionChanged?.Invoke(v);
    }

    private static string GetStr(JsonElement m, string k) =>
        m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    private static int GetInt(JsonElement m, string k, int def = 0) =>
        m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : def;
    private static double GetDouble(JsonElement m, string k) =>
        m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
    private static bool GetBool(JsonElement m, string k) =>
        m.TryGetProperty(k, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) && v.GetBoolean();

    private static string GetLocalIp()
    {
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var ip in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ip.Address.AddressFamily == AddressFamily.InterNetwork)
                        return ip.Address.ToString();
                }
            }
        }
        catch { }
        return "";
    }
}
