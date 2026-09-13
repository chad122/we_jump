using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

namespace WeJump.Api.Services;

/// <summary>
/// 单个 WebSocket 连接会话：内部维护一条发送队列（Channel），
/// 后台 writer 依次写出文本帧，保证并发 SendAsync 不交错。
/// </summary>
public sealed class WsSession : IAsyncDisposable
{
    private readonly WebSocket _ws;
    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>(
        new UnboundedChannelOptions { SingleReader = true });
    private readonly CancellationTokenSource _cts = new();
    private Task? _writer;

    public long UserId { get; set; }
    public string? Nickname { get; set; }
    public string? AvatarUrl { get; set; }
    /// <summary>头像文字（一个字），透传到房间成员/对局快照。</summary>
    public string? AvatarChar { get; set; }

    public WsSession(WebSocket ws)
    {
        _ws = ws;
        _writer = Task.Run(WriterLoopAsync);
    }

    public bool IsClosed
    {
        get { lock (_cts) return _cts.IsCancellationRequested || _ws.State != WebSocketState.Open; }
    }

    public void StartWriter() { /* writer started in ctor */ }

    private async Task WriterLoopAsync()
    {
        try
        {
            await foreach (var json in _queue.Reader.ReadAllAsync(_cts.Token))
            {
                if (_ws.State != WebSocketState.Open) break;
                var bytes = Encoding.UTF8.GetBytes(json);
                await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, _cts.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        catch (Exception) { /* 单个连接写失败不拖垮进程 */ }
    }

    public void TrySend(string json)
    {
        if (!_queue.Writer.TryWrite(json))
        {
            // 队列已关闭（连接已断开），忽略。
        }
    }

    /// <summary>关闭连接：停止 writer，尝试正常关闭 WebSocket。</summary>
    public async Task CloseAsync()
    {
        lock (_cts)
        {
            if (_cts.IsCancellationRequested) return;
            _cts.Cancel();
        }
        _queue.Writer.TryComplete();
        try
        {
            if (_ws.State == WebSocketState.Open)
            {
                using var cts = new CancellationTokenSource(1500);
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", cts.Token);
            }
        }
        catch { }
        finally { _ws.Dispose(); }
        if (_writer != null) { try { await _writer; } catch { } }
    }

    public ValueTask DisposeAsync() => new(CloseAsync());
}
