-- ============================================================
-- MySQL 8 建表脚本（正式环境）
-- 直接由 Spring 在启动时执行（spring.sql.init），也可手工 source
-- ============================================================

CREATE TABLE IF NOT EXISTS posts (
  id          VARCHAR(80)  NOT NULL PRIMARY KEY,
  section     VARCHAR(16)  NOT NULL DEFAULT 'tech',
  title       VARCHAR(200) NOT NULL,
  excerpt     VARCHAR(1000) DEFAULT '',
  body        MEDIUMTEXT,
  cat         VARCHAR(80)  DEFAULT '',
  tags        TEXT,
  minutes     INT          DEFAULT 5,
  pinned      TINYINT      DEFAULT 0,
  cover       TEXT,
  status      VARCHAR(16)  NOT NULL DEFAULT 'published',
  views       INT          DEFAULT 0,
  date        VARCHAR(10),
  created_at  VARCHAR(32),
  updated_at  VARCHAR(32),
  KEY idx_posts_status (status, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target      VARCHAR(60)  NOT NULL,
  -- 0 表示顶层留言 / 评论；否则是同一 target 下某条评论的楼中回复
  parent_id   BIGINT       NOT NULL DEFAULT 0,
  name        VARCHAR(60)  DEFAULT '',
  uid         VARCHAR(60)  DEFAULT '',
  body        TEXT         NOT NULL,
  status      VARCHAR(16)  NOT NULL DEFAULT 'pending',
  ip          VARCHAR(64)  DEFAULT '',
  ua          VARCHAR(400) DEFAULT '',
  created_at  VARCHAR(32)  NOT NULL,
  KEY idx_comments_target (target, status),
  KEY idx_comments_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resources (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(160) NOT NULL,
  icon        VARCHAR(12)  DEFAULT 'FILE',
  tint        VARCHAR(16)  DEFAULT 'purple',
  version     VARCHAR(40)  DEFAULT '',
  size        VARCHAR(24)  DEFAULT '',
  lang        VARCHAR(60)  DEFAULT '',
  descr       TEXT,
  downloads   INT          DEFAULT 0,
  date        VARCHAR(10),
  file        VARCHAR(400) DEFAULT '',
  created_at  VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS diary_books (
  id          VARCHAR(60)  NOT NULL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  intro       VARCHAR(400) DEFAULT '',
  accent      VARCHAR(16)  DEFAULT 'amber',
  -- 旧版「日记总结」遗留列，代码已不再读写，保留仅为兼容旧库
  note        TEXT,
  sort        INT          DEFAULT 0,
  created_at  VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS diary_entries (
  id          VARCHAR(80)  NOT NULL PRIMARY KEY,
  book_id     VARCHAR(60)  NOT NULL,
  day_no      INT          NULL,
  date        VARCHAR(10),
  weekday     VARCHAR(12)  DEFAULT '',
  cat         VARCHAR(16)  DEFAULT 'daily',
  title       VARCHAR(200) NOT NULL,
  body        MEDIUMTEXT,
  -- 旧版「今天学到」遗留列，代码已不再读写，保留仅为兼容旧库
  takeaway    VARCHAR(400) DEFAULT '',
  sort        INT          DEFAULT 0,
  created_at  VARCHAR(32),
  KEY idx_diary_book (book_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
  k           VARCHAR(40)  NOT NULL PRIMARY KEY,
  json        MEDIUMTEXT   NOT NULL,
  updated_at  VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visits (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ts          VARCHAR(32)  NOT NULL,
  day_no      VARCHAR(10)  NOT NULL,
  path        VARCHAR(300) DEFAULT '/',
  ref         VARCHAR(400) DEFAULT '',
  vid         VARCHAR(64)  DEFAULT '',
  KEY idx_visits_day (day_no),
  KEY idx_visits_vid (vid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(60)  NOT NULL UNIQUE,
  pass        VARCHAR(200) NOT NULL,
  role        VARCHAR(16)  NOT NULL DEFAULT 'guest',
  created_at  VARCHAR(32)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  k           VARCHAR(60)  NOT NULL PRIMARY KEY,
  v           MEDIUMTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
