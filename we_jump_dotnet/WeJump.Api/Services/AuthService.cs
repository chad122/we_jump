using WeJump.Api.Data;
using WeJump.Api.Models;

namespace WeJump.Api.Services;

/// <summary>登录结果：成功时 User/Token 非空；失败时 Error 说明原因。</summary>
public sealed record LoginOutcome(User? User, string? Token, string? Error);

/// <summary>登录：微信 code -> openid -> 本地 user upsert -> 签发 Redis 令牌。</summary>
public sealed class AuthService
{
    private readonly Db _db;
    private readonly RedisStore _redis;
    private readonly WxAuthClient _wx;

    private static readonly TimeSpan TokenTtl = TimeSpan.FromDays(7);

    public AuthService(Db db, RedisStore redis, WxAuthClient wx)
    {
        _db = db;
        _redis = redis;
        _wx = wx;
    }

    public async Task<LoginOutcome> LoginAsync(string code, string nickname, string avatarUrl, bool wxAuthorized = false)
    {
        var wx = await _wx.Code2SessionAsync(code);
        if (string.IsNullOrEmpty(wx.OpenId))
            return new LoginOutcome(null, null, wx.Error ?? "微信登录凭证校验失败");

        var openId = wx.OpenId!;
        var nick = SanitizeNickname(nickname);

        var user = await _db.FindUserByOpenIdAsync(openId);
        if (user is null)
        {
            user = await _db.CreateUserAsync(openId, nick, avatarUrl ?? "", wxAuthorized);
        }
        else if (wxAuthorized)
        {
            // 用户授权了微信头像昵称：以授权资料为准并落库（下次进来直接用库里的）
            await _db.UpdateWxProfileAsync(user.Id, nick, avatarUrl ?? "");
            user.Nickname = nick;
            user.AvatarUrl = avatarUrl ?? "";
            user.WxAuthorized = true;
        }
        else if (string.IsNullOrEmpty(user.Nickname))
        {
            // 库里没有昵称（历史数据）：用客户端兜底昵称补齐，但不标记为已授权
            await _db.UpdateProfileAsync(user.Id, nick, avatarUrl ?? "");
            user.Nickname = nick;
            user.AvatarUrl = avatarUrl ?? "";
        }
        // 其余情况：保留库内资料，避免客户端兜底昵称把已授权的资料覆盖

        var token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        await _redis.SetTokenAsync(token, user.Id, TokenTtl);
        return new LoginOutcome(user, token, null);
    }

    public async Task<long> ResolveUserIdAsync(string token)
        => await _redis.GetUserIdAsync(token);

    private static string SanitizeNickname(string? nickname)
    {
        var n = (nickname ?? "").Trim();
        if (string.IsNullOrEmpty(n) || n.Length > 32) n = "玩家" + Random.Shared.Next(1000, 9999);
        return n;
    }
}
