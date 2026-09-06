-- =============================================================
-- 微信小游戏《多人跳一跳》数据库初始化 DDL（基准文件）
-- 说明：改动库表结构时，将增量 DDL 追加到带日期的 sql 文件并同步本文件。
-- 版本：v1  (2026-09-06)
-- =============================================================

-- 玩家（微信用户）
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `open_id`     VARCHAR(64)  NOT NULL COMMENT '微信 openid',
  `nickname`    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '昵称',
  `avatar_url`  VARCHAR(512) NOT NULL DEFAULT '' COMMENT '头像地址',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_open_id` (`open_id`)
) ENGINE = InnoDB COMMENT = '玩家';

-- 对局主记录
DROP TABLE IF EXISTS `game_record`;
CREATE TABLE `game_record` (
  `id`           BIGINT      NOT NULL AUTO_INCREMENT COMMENT '对局ID',
  `room_no`      VARCHAR(16) NOT NULL COMMENT '房间号',
  `map_id`       INT         NOT NULL COMMENT '地图ID',
  `map_name`     VARCHAR(64) NOT NULL DEFAULT '' COMMENT '地图名快照',
  `end_reason`   TINYINT     NOT NULL COMMENT '结束原因: 1=冠军倒计时(模式A) 2=地图超时(模式B)',
  `player_count` TINYINT     NOT NULL DEFAULT 0 COMMENT '参赛人数',
  `started_at`   DATETIME    NOT NULL COMMENT '开始时间',
  `ended_at`     DATETIME    NOT NULL COMMENT '结束时间',
  `duration_ms`  INT         NOT NULL DEFAULT 0 COMMENT '对局时长(ms)',
  `created_at`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room_no` (`room_no`),
  KEY `idx_map_id` (`map_id`)
) ENGINE = InnoDB COMMENT = '对局记录';

-- 单局玩家成绩（供排行榜等使用）
DROP TABLE IF EXISTS `game_player_result`;
CREATE TABLE `game_player_result` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `game_id`     BIGINT       NOT NULL COMMENT '对局ID',
  `user_id`     BIGINT       NOT NULL COMMENT '玩家ID',
  `nickname`    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '昵称快照',
  `avatar_url`  VARCHAR(512) NOT NULL DEFAULT '' COMMENT '头像快照',
  `seat`        TINYINT      NOT NULL DEFAULT 0 COMMENT '座位号',
  `rank`        TINYINT      NOT NULL COMMENT '名次(1=第一)',
  `finished`    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否抵达终点',
  `end_index`   INT          NOT NULL DEFAULT 0 COMMENT '结束时所在格',
  `jump_count`  INT          NOT NULL DEFAULT 0 COMMENT '有效跳跃次数',
  `out_count`   INT          NOT NULL DEFAULT 0 COMMENT '出界次数',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_game_user` (`game_id`, `user_id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE = InnoDB COMMENT = '对局玩家成绩';
