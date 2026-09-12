namespace WeJump.Api.Utils;

/// <summary>
/// 蓄力时长 -> 步数的映射（服务端权威，与客户端保持一致；开局面板会把参数下发给客户端）。
/// 第 k 格蓄满耗时 = FirstCellMs * Ratio^(k-1) ms；蓄满 k 格累计耗时 C(k) = FirstCellMs * (1 - Ratio^k)/(1 - Ratio) ms。
/// </summary>
public static class Charge
{
    /// <summary>单跳最大格数上限（全局，两端一致），由服务端下发给客户端。</summary>
    public const int MaxStep = 10;

    /// <summary>第 1 格蓄满耗时(ms)。</summary>
    public const double FirstCellMs = 300.0;

    /// <summary>逐格衰减系数。</summary>
    public const double Ratio = 0.9;

    /// <summary>蓄满 k 格所需累计时长(ms)，k>=1。</summary>
    public static double CumTimeMs(int k)
    {
        double acc = 0;
        for (int i = 1; i <= k; i++)
            acc += FirstCellMs * Math.Pow(Ratio, i - 1);
        return acc;
    }

    /// <summary>给定蓄力时长(ms)反推步数：能充满几格就算几步，至少 1 步。</summary>
    public static int StepsForMs(double ms)
    {
        if (ms < 0) return 1;
        int s = 1;
        for (int k = 1; k <= MaxStep; k++)
        {
            if (ms >= CumTimeMs(k) - 1) s = k;
            else break;
        }
        return s;
    }
}
