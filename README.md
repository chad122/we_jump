# 多人跳一跳（棋盘版 · 实时竞速）— v1 MVP

微信小游戏：经典“跳一跳”机制 + 飞行棋棋盘路径 + 好友实时同屏竞速。
依据 `docs/prd/大家一起跳.v1.md` 与 `docs/技术方案.md` 实现。

## 目录结构

```
we_jump_dotnet/         服务端（.NET 8.0 + WebSocket + MySQL + Redis）
  WeJump.Api/           单项目
    Program.cs          入口：HTTP(登录/地图/我在的房间) + /ws
    GameHub.cs          WebSocket 连接与消息派发
    Models/             地图/实体/协议 DTO
    Services/           登录、房间、对局引擎、Redis、WS 会话
    Utils/Charge.cs     蓄力->步数权威公式
we_jump_wx/             微信小游戏客户端（原生 JS + Canvas 2D）
  game.js               入口
  js/app.js             场景编排 / 触摸 / 主循环 / 消息路由
  js/scenes/            主菜单 / 房间 / 对局 / 结算
  js/logic/             蓄力公式、路径工具、地图元信息
  js/net/               HTTP + WebSocket（含自动重连）
  js/render|ui/         绘制工具、按钮
docs/openDataContext-placeholder/  好友排行榜（开放数据域占位；接入时再放回游戏根目录并配置）
docs/sql/               MySQL DDL（手动执行）
```

## 运行与配置

1. 建库：`mysql -uroot -p < docs/sql/20260906-we-jump-init.sql`（或直接执行 `docs/sql/init-ddl.sql`）；已有库按日期顺序执行 `docs/sql/` 下的增量 DDL（如 `20260912-we-jump-user-wx-authorized.sql`）。
2. 服务端：改 `WeJump.Api/appsettings.json` 中 `WeJump.MySql/Redis/WxAppId/WxAppSecret`（微信凭证留空时登录走本地模拟，便于联调）；`dotnet run`（默认 5000 端口由 launchSettings/ASPNETCORE_URLS 决定）。
3. 客户端：用微信开发者工具导入 `we_jump_wx/`，把 `js/config.js` 的 `HTTP_BASE/WS_BASE` 指向服务端；本地联调需关闭“合法域名校验”。

### 登录（code2session）排错

- **服务端 `WeJump.WxAppId/WxAppSecret` 必须与客户端 `project.config.json` 的 `appid` 完全一致**。不一致时 `wx.login` 拿到的 code 无法兑换，报错形如 `微信校验失败(40029) invalid code`。
- 开发者工具若用“游客模式（touristappid）”，无法与真实 AppID 匹配：
  - 纯本地前后端联调：把服务端 `WxAppId/WxAppSecret` **留空**，登录走本地模拟（不校验微信）；
  - 需要真实微信登录：把 `project.config.json` 的 `appid` 改为真实 AppID，并用具备该 AppID 权限的微信号登录开发者工具。
- 服务端现在会把微信返回的 `errcode/errmsg` 透传到客户端提示，便于定位。
- ⚠️ 安全提示：`appsettings.json` 目前含真实 AppSecret 且会被 git 提交，建议迁移到不入库的 `appsettings.Local.json`（已在 `.gitignore` 中）或环境变量 `WeJump__WxAppSecret`。

### 开发者工具报 `worker path empty`

这是**工具侧**错误（找不到游戏运行 worker 的入口），与业务代码无关。按顺序排查：

1. 开发者工具「导入项目」的目录必须是 **`we_jump_wx/`**（该层同时含 `game.js`、`game.json`、`project.config.json`），项目类型选**小游戏**；不要导入仓库根目录。
2. 关闭项目 → 「工具-清除缓存-全部清除」→ 重新打开/编译。
3. `project.config.json` 的 `compileType` 必须是 `game`；`libVersion` 用 `latest`（指定了工具本地不存在的版本会导致基础库 worker 解析为空）。
4. 「详情-本地设置」确认调试基础库为**小游戏**基础库；必要时切换一个版本。
5. 若仍报错，多为工具版本问题（如夜间版）：重启工具、或升级/回退到稳定版开发者工具。

## 通信协议（WebSocket，JSON 信封 `{type,data}`）

客户端->服务端：`create_room` / `join_room{roomNo}` / `leave_room` / `select_map{mapId}` / `start_game` / `again` / `jump{elapsedMs}` / `ping`
服务端->客户端：`joined` / `room_state` / `game_start{mapId,mapName,durationSeconds,startTs,maxStep,firstCellMs,ratio,path,players[]}` / `countdown{n}`（n=0 表示开始，此后可自由跳跃） / `player_move{seat,from,steps,index,isOut,isFinish,rank}` / `game_state{...}`（断线重连快照，与 `game_start` 同构） / `champion{championSeat,nickname,deadlineTs}` / `game_end{reason,ranks}` / `error`

## 玩法规则的实现裁定（对 PRD 4.2/4.3 的歧义澄清）

- 蓄力格累计时长 $C(k)=3000(1-0.9^k)$ ms（第 k 格 300×0.9^{k-1}，`Utils/Charge.cs` 的 `FirstCellMs=300/Ratio=0.9`）。
- 蓄力上限恒为 **10 格**（不再随“到终点的剩余距离”收窄）：临近拐弯/终点若蓄力过头，同样按 $s>d$ 判定**飞出边界回到起点**，因此需要精准松手（按钮进度环会提示危险）。
- 蓄力参数（`maxStep/firstCellMs/ratio`）**全部由服务端下发**（config 常量在 `Utils/Charge.cs`，随 `game_start/game_state` 快照下发）；客户端 `js/config.js` **不再保留**任何规则常量，在 `js/logic/charge.js` 里通过 `apply()` 接收后本地预估步数（仅用于进度环/危险提示，结算始终以服务端为准）。
- 路径按“直线段”分组，玩家从当前格直线跳跃若步数 $s$ 未超过**当前直线段安全步数 $d$**（到下一拐弯/终点格）则落在 $s$ 格处；恰好拐弯格则下一回合自动转向；恰好终点则抵达。
- $s>d$（跳越过拐弯/终点所在直线边界）→ **飞出边界，回到起点**。
- **实时自由跳跃（无回合等待）**：3-2-1 倒计时后，所有玩家可各自随时蓄力松手、互不等待；客户端只上报蓄力时长 `elapsedMs`，服务端每收到一次跳跃即反推步数并**立即广播该玩家移动**（防变速作弊占位）。
- 落地恢复：每次跳跃后有短暂冷却（客户端 700ms / 服务端最小间隔 500ms），防止“连点小跳”刷进度；蓄力越久跳得越远，单位时间收益更高。
- 结束：首名抵达 → **冠军倒计时 10s（模式A）**；全程无人抵达且达地图硬时限 → **超时结算（模式B）**。

## MVP 范围与“后置占位”清单

已实现（核心闭环）：房间/座位、选图、3-2-1 开局、五张地图与出界回起点、回合制同屏跳跃、取消(上划)、模式A/B 结算、落库、再来一局、断线自动重连恢复座位。**支持单人开局**（PRD 原为“至少 2 人”，MVP 放宽为 1 人，便于单人练习/计时挑战）。

占位（后续迭代）：微信分享卡片入口（已有分享按钮，可直达房间）、好友排行榜开放数据域（脚手架已就位）、超时踢出/挂机细化、蓄力时长窗口级反作弊。

## 备注

- 房间与对局均为服务端内存态（MVP 不落库房间），重启用 Redis 令牌鉴权。
- 地图路径为服务端权威，开局 `game_start.path` 下发；客户端仅本地渲染。
- 对局结束写入 `game_record`/`game_player_result`，供排行榜等使用。
