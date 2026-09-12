using System.Text.Json;
using WeJump.Api;
using WeJump.Api.Data;
using WeJump.Api.Models;
using WeJump.Api.Services;

// ---------- 配置 ----------
var builder = WebApplication.CreateBuilder(args);
var opts = builder.Configuration.GetSection("WeJump").Get<WeJumpOptions>() ?? new WeJumpOptions();
if (opts.MaxStep <= 0) opts.MaxStep = 6;

builder.Services.AddSingleton(opts);
builder.Services.AddSingleton(new Db(opts.MySql));
builder.Services.AddSingleton(new RedisStore(opts.Redis));
builder.Services.AddSingleton(sp => new WxAuthClient(new HttpClient(), opts.WxAppId, opts.WxAppSecret));
builder.Services.AddSingleton<AuthService>();
builder.Services.AddSingleton<RoomManager>();
builder.Services.AddSingleton<GameHub>();

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();
app.UseWebSockets();

// ---------- HTTP：健康检查 ----------
app.MapGet("/healthz", () => Results.Ok(new { ok = true, ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));

// ---------- HTTP：登录（微信 code -> 令牌） ----------
app.MapPost("/api/auth/login", async (JsonElement body, AuthService auth) =>
{
    var code = body.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";
    var nickname = body.TryGetProperty("nickname", out var n) ? n.GetString() ?? "" : "";
    var avatarUrl = body.TryGetProperty("avatarUrl", out var a) ? a.GetString() ?? "" : "";
    if (string.IsNullOrEmpty(code))
        return Results.BadRequest(new { code = "bad_request", msg = "缺少 code" });

    var outcome = await auth.LoginAsync(code, nickname, avatarUrl);
    if (outcome.User == null || outcome.Token == null)
        return Results.Json(new { code = "wx_login_failed", msg = outcome.Error ?? "微信登录凭证校验失败" }, statusCode: 401);

    return Results.Ok(new
    {
        token = outcome.Token,
        user = new
        {
            id = outcome.User.Id,
            nickname = outcome.User.Nickname,
            avatarUrl = outcome.User.AvatarUrl
        }
    });
});

// ---------- HTTP：地图列表（菜单用，不含路径） ----------
app.MapGet("/api/maps", async (string? token, AuthService auth) =>
{
    var uid = await auth.ResolveUserIdAsync(token ?? "");
    if (uid <= 0)
        return Results.Json(new { code = "unauthorized", msg = "无效的令牌" }, statusCode: 401);

    var metas = MapCatalog.All.Select(m => new MapMetaDto
    {
        Id = m.Id,
        Name = m.Name,
        Difficulty = m.Difficulty,
        TotalCells = m.TotalCells,
        TurnCount = m.TurnCount,
        DurationSeconds = m.DurationSeconds
    }).ToList();
    return Results.Ok(metas);
});

// ---------- WebSocket ----------
app.Map("/ws", async (HttpContext ctx) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        await ctx.Response.WriteAsync("websocket only");
        return;
    }

    var token = ctx.Request.Query["token"].ToString();
    var hub = ctx.RequestServices.GetRequiredService<GameHub>();
    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    await hub.RunAsync(ws, token, ctx.RequestAborted);
});

app.Run();

/// <summary>WeJump 配置节。</summary>
internal sealed class WeJumpOptions
{
    public string MySql { get; set; } = "";
    public string Redis { get; set; } = "";
    public string WxAppId { get; set; } = "";
    public string WxAppSecret { get; set; } = "";
    public int MaxStep { get; set; } = 6;
}
