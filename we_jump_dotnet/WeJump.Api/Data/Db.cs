using System.Data;
using Dapper;
using MySqlConnector;
using WeJump.Api.Models;

namespace WeJump.Api.Data;

/// <summary>极简 MySQL 访问（Dapper + MySqlConnector）。DDL 见 docs/sql/。</summary>
public sealed class Db
{
    private readonly string _connectionString;

    public Db(string connectionString) => _connectionString = connectionString;

    private MySqlConnection Open() => new(_connectionString);

    public async Task<User?> FindUserByOpenIdAsync(string openId)
    {
        const string sql = @"SELECT id, open_id AS OpenId, nickname, avatar_url AS AvatarUrl
                             FROM `user` WHERE open_id = @openId LIMIT 1";
        using var c = Open();
        return await c.QueryFirstOrDefaultAsync<User>(sql, new { openId });
    }

    public async Task<User> CreateUserAsync(string openId, string nickname, string avatarUrl)
    {
        const string sql = @"INSERT INTO `user`(open_id, nickname, avatar_url)
                             VALUES(@openId, @nickname, @avatarUrl);
                             SELECT LAST_INSERT_ID();";
        using var c = Open();
        var id = await c.ExecuteScalarAsync<long>(sql, new { openId, nickname, avatarUrl });
        return new User { Id = id, OpenId = openId, Nickname = nickname, AvatarUrl = avatarUrl };
    }

    public async Task<User?> FindUserByIdAsync(long id)
    {
        const string sql = @"SELECT id, open_id AS OpenId, nickname, avatar_url AS AvatarUrl
                             FROM `user` WHERE id = @id LIMIT 1";
        using var c = Open();
        return await c.QueryFirstOrDefaultAsync<User>(sql, new { id });
    }

    /// <summary>写回一次微信登录拿到的昵称头像（可空，更新同 openid 的旧行）。</summary>
    public async Task UpdateProfileAsync(long id, string nickname, string avatarUrl)
    {
        const string sql = @"UPDATE `user` SET nickname = @nickname, avatar_url = @avatarUrl WHERE id = @id";
        using var c = Open();
        await c.ExecuteAsync(sql, new { id, nickname, avatarUrl });
    }

    public async Task<long> InsertGameRecordAsync(GameRecord r)
    {
        const string sql = @"INSERT INTO `game_record`
                             (room_no, map_id, map_name, end_reason, player_count, started_at, ended_at, duration_ms)
                             VALUES(@RoomNo, @MapId, @MapName, @EndReason, @PlayerCount, @StartedAt, @EndedAt, @DurationMs);
                             SELECT LAST_INSERT_ID();";
        using var c = Open();
        return await c.ExecuteScalarAsync<long>(sql, r);
    }

    public async Task InsertPlayerResultsAsync(IEnumerable<GamePlayerResult> list)
    {
        const string sql = @"INSERT INTO `game_player_result`
                             (game_id, user_id, nickname, avatar_url, seat, `rank`, finished, end_index, jump_count, out_count)
                             VALUES(@GameId, @UserId, @Nickname, @AvatarUrl, @Seat, @Rank, @Finished, @EndIndex, @JumpCount, @OutCount)";
        using var c = Open();
        await c.ExecuteAsync(sql, list);
    }
}
