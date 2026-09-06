using System.Text.Json.Serialization;

namespace WeJump.Api.Models;

/// <summary>棋盘路径上的一个格点坐标（行列均为网格坐标，单位为格）。</summary>
public sealed class GridPoint
{
    [JsonPropertyName("x")]
    public int X { get; set; }

    [JsonPropertyName("y")]
    public int Y { get; set; }

    public GridPoint() { }

    public GridPoint(int x, int y)
    {
        X = x;
        Y = y;
    }
}

/// <summary>地图定义。路径为一串连续格点（四邻接，可含直角拐弯），是唯一的单向线路。</summary>
public sealed class GameMap
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Difficulty { get; set; } = ""; // 简单/中等/困难/极难
    public int TotalCells { get; set; }
    public int TurnCount { get; set; }
    public int DurationSeconds { get; set; }     // 模式B 硬性时限
    public List<GridPoint> Path { get; set; } = new();
}
