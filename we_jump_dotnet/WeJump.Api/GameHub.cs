using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using WeJump.Api.Data;
using WeJump.Api.Models;
using WeJump.Api.Services;

namespace WeJump.Api;

/// <summary>处理单条 WebSocket 连接：鉴权 -> 绑定用户资料 -> 循环读取协议消息并派发。</summary>
public sealed class GameHub
{
    private readonly Db _db;
    private readonly AuthService _auth;
    private readonly RoomManager _manager;

    public GameHub(Db db, AuthService auth, RoomManager manager)
    {
        _db = db;
        _auth = auth;
        _manager = manager;
    }

    public async Task RunAsync(WebSocket ws, string token, CancellationToken ct)
    {
        var userId = await _auth.ResolveUserIdAsync(token);
        var user = userId > 0 ? await _db.FindUserByIdAsync(userId) : null;
        if (user == null || ws.State != WebSocketState.Open)
        {
            try { await ws.CloseAsync(WebSocketCloseStatus.PolicyViolation, "unauthorized", CancellationToken.None); }
            catch { /* ignore */ }
            return;
        }

        var session = new WsSession(ws)
        {
            UserId = user.Id,
            Nickname = user.Nickname,
            AvatarUrl = user.AvatarUrl,
            AvatarChar = user.AvatarChar
        };
        _manager.RegisterSession(session);   // 同一账号只保留最新连接（旧连接被踢下线）

        try
        {
            var buffer = new byte[8192];
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                WebSocketReceiveResult result;
                using (var ms = new MemoryStream())
                {
                    do
                    {
                        result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                        if (result.MessageType == WebSocketMessageType.Close) return;
                        ms.Write(buffer, 0, result.Count);
                    }
                    while (!result.EndOfMessage);

                    var text = Encoding.UTF8.GetString(ms.ToArray());
                    if (string.IsNullOrWhiteSpace(text)) continue;
                    await DispatchAsync(session, text);
                }
            }
        }
        catch (WebSocketException) { /* 客户端异常断开 */ }
        catch (OperationCanceledException) { }
        catch (Exception) { /* 单条连接异常不影响进程 */ }
        finally
        {
            _manager.OnSessionClosed(session);
            await session.DisposeAsync();
        }
    }

    private async Task DispatchAsync(WsSession session, string text)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(text); }
        catch { return; }

        if (root is not JsonObject obj) return;
        var type = obj["type"]?.GetValue<string>() ?? "";
        var data = obj["data"] as JsonObject;

        switch (type)
        {
            case Msg.CreateRoom:
            {
                var room = _manager.CreateRoom(session);
                if (room == null) SendError(session, "已在其他房间");
                else SendJoined(session, room);
                break;
            }
            case Msg.JoinRoom:
            {
                var roomNo = data?["roomNo"]?.GetValue<string>() ?? "";
                var err = _manager.JoinRoom(session, roomNo);
                if (err != null) { SendError(session, err); break; }

                var room = _manager.GetRoomByNo(roomNo);
                if (room != null)
                {
                    SendJoined(session, room);
                    room.Broadcast(Msg.RoomState, room.ToDto());
                    // 对局中重连：补发一次完整状态快照，客户端据此恢复棋盘
                    var engine = room.Engine;   // 取一次本地引用，避免中途被置 null
                    if (engine != null && room.Phase == RoomPhase.Playing) engine.SendSnapshotTo(session);
                }
                break;
            }
            case Msg.LeaveRoom:
            {
                _manager.LeaveRoom(session);
                break;
            }
            case Msg.SelectMap:
            {
                var mapId = data?["mapId"]?.GetValue<int>() ?? 0;
                var err = _manager.SelectMap(session, mapId);
                if (err != null) SendError(session, err);
                break;
            }
            case Msg.StartGame:
            {
                var err = _manager.StartGame(session);
                if (err != null) SendError(session, err);
                break;
            }
            case Msg.PlayAgain:
            {
                var err = _manager.PlayAgain(session);
                if (err != null) SendError(session, err);
                break;
            }
            case Msg.Jump:
            {
                var room = _manager.GetRoomOfUser(session.UserId);
                if (room == null) break;
                var p = room.FindByUser(session.UserId);
                var engine = room.Engine;   // 取一次本地引用，避免中途被置 null
                if (p == null || engine == null || room.Phase != RoomPhase.Playing) break;
                var elapsedMs = data?["elapsedMs"]?.GetValue<double>() ?? 0;
                engine.SubmitJump(p.Seat, elapsedMs);
                break;
            }
            case Msg.Ping:
            {
                session.TrySend(WsJson.Msg("pong", null));
                break;
            }
        }
        await Task.CompletedTask;
    }

    private void SendJoined(WsSession session, Room room)
    {
        var p = room.FindByUser(session.UserId);
        session.TrySend(WsJson.Msg(Msg.Joined, new
        {
            room = room.ToDto(),
            mySeat = p?.Seat ?? -1
        }));
    }

    private static void SendError(WsSession session, string msg)
        => session.TrySend(WsJson.Msg(Msg.Error, new { code = "bad_request", msg }));
}
