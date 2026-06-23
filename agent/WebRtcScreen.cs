using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.Versioning;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;

namespace OneDesk.Agent;

/// <summary>
/// Tela remota via WebRTC: captura a tela, codifica em VP8 e envia por uma
/// conexao peer-to-peer direto para o navegador (video real, baixa latencia).
/// Sinalizacao (offer/answer/ice) trafega pelo hub.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WebRtcScreen : IDisposable
{
    private readonly Action<object> _signal; // envia mensagem de sinalizacao ao hub
    private RTCPeerConnection? _pc;
    private VpxVideoEncoder? _encoder;
    private CancellationTokenSource? _cts;
    private int _fps = 20;

    // buffers de captura reaproveitados
    private Bitmap? _full;
    private Graphics? _gFull;
    private Bitmap? _scaled;
    private Graphics? _gScaled;
    private Rectangle _bounds;
    private int _outW, _outH;
    private int _monitor = -1;

    public Action<bool>? OnSessionActive;

    public WebRtcScreen(Action<object> signal) => _signal = signal;

    public void SetMonitor(int monitor)
    {
        if (monitor < 0) monitor = ScreenCapture.GetPrimaryIndex();
        if (_monitor == monitor) return;
        _monitor = monitor;
        _bounds = default;
    }

    /// <summary>Recebe a offer do navegador, responde com answer e comeca a transmitir.</summary>
    public async Task HandleOffer(string offerSdp, int fps, int monitor = -1)
    {
        _fps = Math.Clamp(fps, 5, 30);
        SetMonitor(monitor);
        Stop();

        var config = new RTCConfiguration
        {
            iceServers = new List<RTCIceServer>
            {
                new RTCIceServer { urls = "stun:stun.l.google.com:19302" },
            },
        };
        _pc = new RTCPeerConnection(config);
        _encoder = new VpxVideoEncoder();

        var format = new SDPAudioVideoMediaFormat(SDPMediaTypesEnum.video, 96, "VP8", 90000);
        var track = new MediaStreamTrack(
            SDPMediaTypesEnum.video, false,
            new List<SDPAudioVideoMediaFormat> { format },
            MediaStreamStatusEnum.SendOnly);
        _pc.addTrack(track);

        _pc.onicecandidate += (cand) =>
        {
            if (cand != null)
                _signal(new
                {
                    type = "webrtc:ice",
                    candidate = cand.candidate,
                    sdpMid = cand.sdpMid,
                    sdpMLineIndex = cand.sdpMLineIndex,
                });
        };

        _pc.onconnectionstatechange += (state) =>
        {
            if (state == RTCPeerConnectionState.connected)
            {
                OnSessionActive?.Invoke(true);
                StartCapture();
            }
            else if (state is RTCPeerConnectionState.failed or RTCPeerConnectionState.closed or RTCPeerConnectionState.disconnected)
            {
                StopCapture();
                InputInjector.ReleaseAll();
                OnSessionActive?.Invoke(false);
            }
        };

        var setRemote = _pc.setRemoteDescription(new RTCSessionDescriptionInit
        {
            type = RTCSdpType.offer,
            sdp = offerSdp,
        });
        if (setRemote != SetDescriptionResultEnum.OK)
            throw new InvalidOperationException($"offer rejeitada: {setRemote}");

        var answer = _pc.createAnswer(null);
        await _pc.setLocalDescription(answer);

        _signal(new { type = "webrtc:answer", sdp = answer.sdp });
    }

    public void AddIceCandidate(string candidate, string? sdpMid, int sdpMLineIndex)
    {
        try
        {
            _pc?.addIceCandidate(new RTCIceCandidateInit
            {
                candidate = candidate,
                sdpMid = sdpMid,
                sdpMLineIndex = (ushort)Math.Max(0, sdpMLineIndex),
            });
        }
        catch { }
    }

    public void SetFps(int fps) => _fps = Math.Clamp(fps, 5, 30);

    private void StartCapture()
    {
        StopCapture();
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;
        _ = Task.Run(async () =>
        {
            var sw = new System.Diagnostics.Stopwatch();
            while (!ct.IsCancellationRequested && _pc?.connectionState == RTCPeerConnectionState.connected)
            {
                sw.Restart();
                try
                {
                    DesktopMonitor.EnsureInputDesktop();
                    var (bgr, w, h) = CaptureBgr(1280);
                    if (bgr != null)
                    {
                        var encoded = _encoder!.EncodeVideo(w, h, bgr, VideoPixelFormatsEnum.Bgr, VideoCodecsEnum.VP8);
                        if (encoded != null && encoded.Length > 0)
                            _pc.SendVideo((uint)(90000 / Math.Max(1, _fps)), encoded);
                    }
                }
                catch { }
                int budget = 1000 / Math.Max(1, _fps);
                int wait = budget - (int)sw.ElapsedMilliseconds;
                if (wait > 0) await Task.Delay(wait, ct).ContinueWith(_ => { });
            }
        }, ct);
    }

    private void StopCapture()
    {
        try { _cts?.Cancel(); } catch { }
        _cts = null;
    }

    private (byte[]? bgr, int w, int h) CaptureBgr(int maxWidth)
    {
        if (_monitor < 0) _monitor = ScreenCapture.GetPrimaryIndex();
        var b = ScreenCapture.GetBounds(_monitor);
        if (_full == null || b != _bounds)
        {
            _bounds = b;
            _gFull?.Dispose(); _full?.Dispose();
            _gScaled?.Dispose(); _scaled?.Dispose();

            _full = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb);
            _gFull = Graphics.FromImage(_full);

            double scale = b.Width > maxWidth ? (double)maxWidth / b.Width : 1.0;
            _outW = (int)(b.Width * scale) & ~1;   // par
            _outH = (int)(b.Height * scale) & ~1;
            if (_outW < 2) _outW = 2;
            if (_outH < 2) _outH = 2;
            _scaled = new Bitmap(_outW, _outH, PixelFormat.Format24bppRgb);
            _gScaled = Graphics.FromImage(_scaled);
            _gScaled.InterpolationMode = InterpolationMode.Bilinear;
            _gScaled.CompositingQuality = CompositingQuality.HighSpeed;
            _gScaled.PixelOffsetMode = PixelOffsetMode.Half;
        }

        _gFull!.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
        CursorOverlay.Draw(_gFull, b.Left, b.Top);
        _gScaled!.DrawImage(_full!, 0, 0, _outW, _outH);

        var data = _scaled!.LockBits(new Rectangle(0, 0, _outW, _outH), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            int rowBytes = _outW * 3;
            var outBuf = new byte[rowBytes * _outH];
            for (int y = 0; y < _outH; y++)
            {
                var rowPtr = IntPtr.Add(data.Scan0, y * data.Stride);
                System.Runtime.InteropServices.Marshal.Copy(rowPtr, outBuf, y * rowBytes, rowBytes);
            }
            return (outBuf, _outW, _outH);
        }
        finally { _scaled.UnlockBits(data); }
    }

    private void StopPc()
    {
        try { _pc?.close(); } catch { }
        _pc = null;
    }

    public void Stop()
    {
        StopCapture();
        StopPc();
        InputInjector.ReleaseAll();
    }

    public void Dispose()
    {
        Stop();
        try { _gFull?.Dispose(); _full?.Dispose(); } catch { }
        try { _gScaled?.Dispose(); _scaled?.Dispose(); } catch { }
        try { _encoder?.Dispose(); } catch { }
    }
}
