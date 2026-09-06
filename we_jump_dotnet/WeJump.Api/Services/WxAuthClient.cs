using System.Net.Http.Json;
using System.Text.Json;

namespace WeJump.Api.Services;

/// <summary>微信登录凭证校验（code2session）。</summary>
public sealed class WxAuthClient
{
    private readonly HttpClient _http;
    private readonly string _appId;
    private readonly string _appSecret;
    private readonly bool _enabled;

    public WxAuthClient(HttpClient http, string appId, string appSecret)
    {
        _http = http;
        _appId = appId;
        _appSecret = appSecret;
        // appid/secret 未配置时走本地开发模拟（不校验微信），便于联调。
        _enabled = !string.IsNullOrWhiteSpace(appId) && !string.IsNullOrWhiteSpace(appSecret);
    }

    public bool Enabled => _enabled;

    /// <summary>调用 code2session 换取 openid。返回 null 表示校验失败。</summary>
    public async Task<string?> Code2SessionAsync(string code)
    {
        if (!_enabled)
        {
            // 本地模拟：从 code 生成稳定的假 openid。
            return "dev_" + Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(
                System.Text.Encoding.UTF8.GetBytes("dev:" + code)))[..16].ToLowerInvariant();
        }

        var url = $"https://api.weixin.qq.com/sns/jscode2session?appid={_appId}&secret={_appSecret}&js_code={Uri.EscapeDataString(code)}&grant_type=authorization_code";
        using var resp = await _http.GetAsync(url);
        if (!resp.IsSuccessStatusCode) return null;

        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();
        if (json.TryGetProperty("errcode", out var ec) && ec.GetInt32() != 0)
            return null;
        return json.TryGetProperty("openid", out var o) ? o.GetString() : null;
    }
}
