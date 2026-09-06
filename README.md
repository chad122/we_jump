# 多人跳一跳（棋盘版 · 实时竞速）— v1 MVP

微信小游戏：经典“跳一跳”机制 + 飞行棋棋盘路径 + 好友实时同屏竞速。
依据 `docs/prd/大家一起跳.v1.md` 与 `docs/技术方案.md` 实现。

## 目录结构

```
we_jump_dotnet/         服务端（.NET 8.0 + WebSocket + MySQL + Redis）
  WeJump.Api/           单项目
    Program.cs          入口：HTTP(登录/地图) + /ws
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
  openDataContext/      好友排行榜（开放数据域占位）
docs/sql/               MySQL DDL（手动执行）
```

## 运行与配置

1. 建库：`mysql -uroot -p < docs/sql/20260906-we-jump-init.sql`（或直接执行 `docs/sql/init-ddl.sql`）。
2. 服务端：改 `WeJump.Api/appsettings.json` 中 `WeJump.MySql/Redis/WxAppId/WxAppSecret`（微信凭证留空时登录走本地模拟，便于联调）；`dotnet run`（默认 5000 端口由 launchSettings/ASPNETCORE_URLS 决定）。
3. 客户端：用微信开发者工具导入 `we_jump_wx/`，把 `js/config.js` 的 `HTTP_BASE/WS_BASE` 指向服务端；本地联调需关闭“合法域名校验”。

## 通信协议（WebSocket，JSON 信封 `{type,data}`）

客户端->服务端：`create_room` / `join_room{roomNo}` / `leave_room` / `select_map{mapId}` / `start_game` / `again` / `jump{seq,elapsedMs}` / `skip{seq}` / `ping`
服务端->客户端：`joined` / `room_state` / `game_start` / `countdown{n}` / `wave_start{seq,players:[{seat,index,n,remaining}]}` / `wave_result{seq,results:[{seat,from,steps,index,isOut,isFinish,rank}]}` / `champion{championSeat,nickname,deadlineTs}` / `game_end{reason,ranks}` / `error`

## 玩法规则的实现裁定（对 PRD 4.2/4.3 的歧义澄清）

- 蓄力格累计时长 $C(k)=5000(1-0.9^k)$ ms（第 k 格 500×0.9^{k-1}）。
- 进度条最大格数 $N=\min(\text{剩余到终点格数},6)$。
- 路径按“直线段”分组，玩家从当前格直线跳跃若步数 $s$ 未超过**当前直线段安全步数 $d$**（到下一拐弯/终点格）则落在 $s$ 格处；恰好拐弯格则下一回合自动转向；恰好终点则抵达。
- $s>d$（跳越过拐弯/终点所在直线边界）→ **飞出边界，回到起点**。
- 每回合(wave)服务端权威结算：客户端只上报蓄力时长 `elapsedMs`，服务端反推步数并校验，防变速作弊占位。
- 结束：首名抵达 → **冠军倒计时 10s（模式A）**；全程无人抵达且达地图硬时限 → **超时结算（模式B）**。

## MVP 范围与“后置占位”清单

已实现（核心闭环）：房间/座位、选图、3-2-1 开局、五张地图与出界回起点、回合制同屏跳跃、取消(上划)、模式A/B 结算、落库、再来一局、断线自动重连恢复座位。

占位（后续迭代）：微信分享卡片入口（已有分享按钮，可直达房间）、好友排行榜开放数据域（脚手架已就位）、超时踢出/挂机细化、蓄力时长窗口级反作弊。

## 备注

- 房间与对局均为服务端内存态（MVP 不落库房间），重启用 Redis 令牌鉴权。
- 地图路径为服务端权威，开局 `game_start.path` 下发；客户端仅本地渲染。
- 对局结束写入 `game_record`/`game_player_result`，供排行榜等使用。
