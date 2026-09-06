namespace WeJump.Api.Models;

/// <summary>内置地图目录（服务端为路径权威，开局下发 Path 给客户端渲染）。</summary>
public static class MapCatalog
{
    public static IReadOnlyList<GameMap> All { get; } = Build();

    private static List<GameMap> Build()
    {
        return new List<GameMap>
        {
            new GameMap
            {
                Id = 1,
                Name = "新手草原",
                Difficulty = "简单",
                TotalCells = 20,
                TurnCount = 2,
                DurationSeconds = 300,
                Path = BuildPath(1, new[] { (7, Dir.Right), (6, Dir.Up), (6, Dir.Right) })
            },
            new GameMap
            {
                Id = 2,
                Name = "森林迷宫",
                Difficulty = "中等",
                TotalCells = 35,
                TurnCount = 4,
                DurationSeconds = 420,
                Path = BuildPath(2, new[] { (6, Dir.Right), (8, Dir.Up), (4, Dir.Left), (9, Dir.Up), (7, Dir.Right) })
            },
            new GameMap
            {
                Id = 3,
                Name = "城市天际线",
                Difficulty = "中等",
                TotalCells = 30,
                TurnCount = 4,
                DurationSeconds = 360,
                Path = BuildPath(3, new[] { (6, Dir.Right), (7, Dir.Up), (4, Dir.Left), (6, Dir.Up), (6, Dir.Right) })
            },
            new GameMap
            {
                Id = 4,
                Name = "火山熔岩",
                Difficulty = "困难",
                TotalCells = 40,
                TurnCount = 7,
                DurationSeconds = 480,
                Path = BuildPath(4, new[]
                {
                    (4, Dir.Right), (3, Dir.Up), (5, Dir.Right), (4, Dir.Up),
                    (6, Dir.Right), (3, Dir.Up), (7, Dir.Right), (7, Dir.Up)
                })
            },
            new GameMap
            {
                Id = 5,
                Name = "星空幻境",
                Difficulty = "极难",
                TotalCells = 50,
                TurnCount = 9,
                DurationSeconds = 600,
                Path = BuildPath(5, new[]
                {
                    (5, Dir.Right), (4, Dir.Up), (6, Dir.Right), (5, Dir.Up), (3, Dir.Right),
                    (6, Dir.Up), (5, Dir.Right), (4, Dir.Up), (6, Dir.Right), (5, Dir.Up)
                })
            }
        };
    }

    private enum Dir { Right, Up, Left, Down }

    /// <summary>按“段长 + 方向”顺序生成连续格点路径：起点 (0,0)，第一段方向必须为 Right。</summary>
    private static List<GridPoint> BuildPath(int mapId, IReadOnlyList<(int len, Dir dir)> segs)
    {
        var pts = new List<GridPoint>();
        int x = 0, y = 0;
        pts.Add(new GridPoint(x, y));
        foreach (var (len, dir) in segs)
        {
            for (int i = 0; i < len; i++)
            {
                switch (dir)
                {
                    case Dir.Right: x++; break;
                    case Dir.Up: y++; break;
                    case Dir.Left: x--; break;
                    case Dir.Down: y--; break;
                }
                pts.Add(new GridPoint(x, y));
            }
        }
        return pts;
    }

    public static GameMap? Get(int id) => All.FirstOrDefault(m => m.Id == id);

    public static GameMap Default => All[0];
}
