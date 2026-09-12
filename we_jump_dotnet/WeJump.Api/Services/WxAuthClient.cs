using System.Text;
using System.Text.Json;

namespace WeJump.Api.Services;

/// <summary>code2session 结果：成功时 OpenId 非空；失败时 Error 说明原因。</summary>
public sealed record WxSessionResult(string? OpenId, string? Error);

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

    /// <summary>调用 code2session 换取 openid。</summary>
    public async Task<WxSessionResult> Code2SessionAsync(string code)
    {
        if (!_enabled)
        {
            // 本地模拟：从 code 生成稳定的假 openid。
            var devOpenId = "dev_" + Convert.ToHexString(
                System.Security.Cryptography.SHA1.HashData(Encoding.UTF8.GetBytes("dev:" + code)))[..16].ToLowerInvariant();
            return new WxSessionResult(devOpenId, null);
        }

        try
        {
            var url = $"https://api.weixin.qq.com/sns/jscode2session?appid={_appId}&secret={_appSecret}&js_code={Uri.EscapeDataString(code)}&grant_type=authorization_code";
            using var resp = await _http.GetAsync(url);
            var body = await resp.Content.ReadAsStringAsync();

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            if (root.TryGetProperty("errcode", out var ec) && ec.GetInt32() != 0)
            {
                var errmsg = root.TryGetProperty("errmsg", out var em) ? em.GetString() : "";
                return new WxSessionResult(null, $"微信校验失败({ec.GetInt32()}) {errmsg}");
            }
            if (root.TryGetProperty("openid", out var openid) && !string.IsNullOrEmpty(openid.GetString()))
                return new WxSessionResult(openid.GetString(), null);

            return new WxSessionResult(null, "微信未返回 openid（请确认 AppID 与开发者工具登录账号一致）");
        }
        catch (Exception ex)
        {
            return new WxSessionResult(null, "调用微信接口异常：" + ex.Message);
        }
    }
}
