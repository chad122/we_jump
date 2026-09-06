using System.Text.Json;
using System.Text.Json.Serialization;

namespace WeJump.Api.Services;

/// <summary>统一 JSON 序列化（camelCase），出站消息一律用 WsJson.Msg 封装为 {type,data}。</summary>
public static class WsJson
{
    public static readonly JsonSerializerOptions Opts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static string Msg(string type, object? data)
        => JsonSerializer.Serialize(new { type, data }, Opts);
}
