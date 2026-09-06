using WeJump.Api.Data;
using WeJump.Api.Models;

namespace WeJump.Api.Services;

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

    public async Task<(User User, string Token)?> LoginAsync(string code, string nickname, string avatarUrl)
    {
        var openId = await _wx.Code2SessionAsync(code);
        if (string.IsNullOrEmpty(openId))
            return null;

        var user = await _db.FindUserByOpenIdAsync(openId);
        if (user is null)
        {
            user = await _db.CreateUserAsync(openId, SanitizeNickname(nickname), avatarUrl ?? "");
        }
        else if (!string.IsNullOrEmpty(nickname))
        {
            await _db.UpdateProfileAsync(user.Id, SanitizeNickname(nickname), avatarUrl ?? "");
            user.Nickname = SanitizeNickname(nickname);
            user.AvatarUrl = avatarUrl ?? "";
        }

        var token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        await _redis.SetTokenAsync(token, user.Id, TokenTtl);
        return (user, token);
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
