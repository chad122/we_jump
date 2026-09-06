using StackExchange.Redis;

namespace WeJump.Api.Services;

/// <summary>
/// Redis 会话存储：登录令牌 -> 用户Id。
/// 断线重连、WebSocket 鉴权均依赖令牌，令牌存在 Redis 并设置过期时间。
/// </summary>
public sealed class RedisStore
{
    private readonly ConnectionMultiplexer _redis;
    private const string TokenKeyPrefix = "wj:token:";

    public RedisStore(string connectionString)
    {
        _redis = ConnectionMultiplexer.Connect(connectionString);
    }

    private IDatabase Db => _redis.GetDatabase();

    public async Task SetTokenAsync(string token, long userId, TimeSpan ttl)
        => await Db.StringSetAsync(TokenKeyPrefix + token, userId.ToString(), ttl);

    public async Task<long> GetUserIdAsync(string token)
    {
        var val = await Db.StringGetAsync(TokenKeyPrefix + token);
        return long.TryParse(val, out var id) ? id : 0;
    }

    public async Task RemoveTokenAsync(string token)
        => await Db.KeyDeleteAsync(TokenKeyPrefix + token);
}
