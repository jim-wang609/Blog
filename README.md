# Kimon's Blog

> 一个可以直接跑起来的个人博客 / 数字花园：原生 HTML/CSS/JS 前台 + Spring Boot 3 + MySQL 后端，
> 自带内容管理后台。前端零构建，改完刷新就生效。

![预览](assets/img/land-dark.jpg)

> **关于这个仓库**：这里只有「项目骨架 + 代码」，站主的真实文章、相册、日记、
> 服务器信息和密钥都已被 `.gitignore` 排除，不会出现在 GitHub 上。
> 具体排除了什么、为什么排除，见 [开源说明](#开源说明仓库里不包含什么)。

## 目录

- [特性](#特性)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [配置项](#配置项)
- [初始化内容（种子数据）](#初始化内容种子数据)
- [开源说明：仓库里不包含什么](#开源说明仓库里不包含什么)
- [数据备份与恢复](#数据备份与恢复)

## 特性

**前台**

- 首页、技术、随笔、日记、相册、资源、笔记、留言等页面
- 正文 Markdown 渲染，代码块、引用、列表齐全
- 深色 / 浅色主题（跟随系统，可手动切换并记住选择）
- 站点信息、文章、日记、相册、资源全部来自数据库，后台改完刷新即生效
- 后端不可达时整页跳到 `offline.html`，不会显示空壳页面
- SEO：动态 `robots.txt` / `sitemap.xml`、canonical、Open Graph

**后台**（`studio.html`）

- 文章、日记、相册、资源、笔记的增删改
- 留言审核、站点设置、访问统计
- 用户与密码管理

**后端**

- JWT + HttpOnly Cookie 鉴权，管理员接口拦截
- MyBatis-Plus 0 手写 XML；启动时自动建表，增量字段由 `SchemaMigrator` 幂等补齐
- 访客访问日志（IP / UA / 路径 / 耗时）
- 安全响应头、请求体大小限制、静态路径越权守卫
- 图片 / 附件上传，单文件上限 120MB

## 技术栈

| 层     | 选型                                                          |
| ------ | ------------------------------------------------------------- |
| 前端   | 原生 HTML + CSS + JavaScript（无框架、无打包、无 node_modules） |
| 后端   | Java 17、Spring Boot 3.3.5、MyBatis-Plus 3.5.7、JJWT 0.12.6   |
| 数据库 | MySQL 8（utf8mb4），唯一数据源                                  |

## 目录结构

```text
blog/
├─ *.html                   前台页面（原生 HTML，无构建步骤）
│  ├─ index.html            入口页（noindex，跳转到首页）
│  ├─ home.html             首页
│  ├─ tech.html / essays.html / diary.html / gallery.html
│  ├─ resources.html / notes.html / guestbook.html / post.html
│  ├─ enter.html            站主入口（登录 / 首次初始化管理员）
│  ├─ studio.html           内容管理后台
│  └─ offline.html / 404.html
├─ assets/
│  ├─ css/                  样式（style.css 为设计系统主体）
│  ├─ js/                   前端逻辑，config.js 是接口地址配置入口
│  └─ img/                  站点图片、图标、封面
├─ backend/                 Spring Boot 后端
│  ├─ pom.xml
│  └─ src/main/
│     ├─ java/com/kimon/blog/   auth / config / entity / mapper / service / util / web
│     └─ resources/
│        ├─ application.yml          默认配置（本地开发）
│        ├─ application-prod.yml     生产配置（强制 HTTPS Cookie）
│        ├─ schema-mysql.sql         建表脚本（CREATE TABLE IF NOT EXISTS）
│        ├─ logback-spring.xml       日志与访客日志
│        └─ seed.example.json        种子数据示例（真实 seed.json 不进仓库）
├─ uploads/                 后台上传的图片 / 附件（内容被忽略，仅留 .gitkeep 占位）
├─ 启动服务器.bat            本地启动后端（Windows）
└─ README.md
```

> `deploy/`、`一键更新.bat` 这类「上线到服务器」的文件只在本机保留，不进仓库。

## 快速开始

### 1. 环境

- JDK 17
- Maven 3.8+
- MySQL 8（字符集必须是 `utf8mb4`）

### 2. 建库

```sql
CREATE DATABASE kimon_blog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

表结构不用手动建：首次启动时 `schema-mysql.sql` 会自动创建（幂等）。

### 3. （可选）准备种子内容

```bash
cp backend/src/main/resources/seed.example.json backend/src/main/resources/seed.json
```

没有 `seed.json` 也能启动，只是站点里没有文章；有的话首次启动会导入一次，详见
[初始化内容](#初始化内容种子数据)。

### 4. 启动

Windows 双击 `启动服务器.bat`，或者手动：

```bash
cd backend
mvn spring-boot:run
```

默认连接 `127.0.0.1:3306/kimon_blog`，账号 `root` / 密码 `root`（**仅为本地开发的默认值**，
不同就用环境变量 `DB_USER` / `DB_PASSWORD` / `DB_URL` 覆盖）。

### 5. 打开页面

| 地址                                    | 作用                     |
| --------------------------------------- | ------------------------ |
| <http://127.0.0.1:8080/home.html>        | 前台首页                 |
| <http://127.0.0.1:8080/enter.html>       | 站主入口（首次设置管理员） |
| <http://127.0.0.1:8080/studio.html>      | 管理后台                 |
| <http://127.0.0.1:8080/api/bootstrap>    | 接口连通性 / 健康检查     |

首次进后台：打开 `/enter.html` 创建管理员。管理员密码至少 10 位。
如果设置了 `SETUP_TOKEN`，创建管理员时必须输入它（防止别人抢注）。

## 配置项

全部通过环境变量覆盖，`application.yml` 里的默认值只适合本地开发。

| 环境变量                | 默认值                          | 说明                                              |
| ----------------------- | ------------------------------- | ------------------------------------------------- |
| `PORT`                  | `8080`                          | 后端监听端口                                      |
| `DB_URL`                | 本机 `kimon_blog`               | JDBC URL，生产必须显式提供（prod profile 不写默认） |
| `DB_USER` / `DB_PASSWORD` | `root` / `root`                | 数据库账号，生产必须显式提供                       |
| `STATIC_DIR`            | `../`（仓库根）                 | 前台静态文件目录                                  |
| `UPLOAD_DIR`            | `../uploads`                    | 上传文件目录                                      |
| `JWT_SECRET`            | 空（自动生成）                  | 空的会自动生成并写入 `storage/secret.key`；≥32 字符 |
| `COOKIE_SECURE`         | `false`                         | 生产走 HTTPS 时必须 `true`                        |
| `COOKIE_SAME_SITE`      | `Lax`                           | 前后端跨站部署时改 `None`                          |
| `ALLOWED_ORIGINS`       | 空                              | 跨域部署时允许的前端源，逗号分隔                   |
| `INIT_ADMIN_PASSWORD`   | 空                              | 首次空库时自动创建管理员（≥10 位）                 |
| `SETUP_TOKEN`           | 空                              | `/api/admin/setup` 的初始化口令                   |
| `TRUST_PROXY`           | `true`                          | 在 Nginx 之后时信任 `X-Forwarded-*`                |
| `MAX_JSON_BODY_BYTES`   | `2097152`                       | JSON 请求体上限（2 MiB）                          |
| `APP_TIME_ZONE`         | `Asia/Shanghai`                 | 业务时间时区                                      |
| `VISITS_RETENTION_DAYS` | `180`                           | 访问明细保留天数，每天 03:30 清理                  |
| `BASE_URL`              | 空                              | 站点对外地址，用于生成绝对链接                     |

前端接口地址在 `assets/js/config.js`：

- 前后端同机：`window.KIMON_API = ""`（默认，走相对路径）
- 前后端分离：填后端地址，如 `https://api.example.com`，同时后端设
  `ALLOWED_ORIGINS` + `COOKIE_SAME_SITE=None` + `COOKIE_SECURE=true`

## 初始化内容（种子数据）

- 首次启动（且 `settings.seeded` 标记为空）时，后端会把
  `backend/src/main/resources/seed.json` 导入 MySQL，然后写入 `seeded=1`。
- 导入之后就**不再读取**这个文件，所有内容都在数据库里维护。
  把文章删光再重启也不会被种子数据「反向覆盖」。
- 文件不存在只会跳过导入并打一条日志，不影响启动。
- 仓库里只提供结构示例 `seed.example.json`：复制成 `seed.json` 后再改成自己的内容。
  真实的 `seed.json` 被 `.gitignore` 忽略，不会上传。

种子文件结构：`site`（站点资料）、`posts`（文章）、`resources`（资源）、
`diaryBooks`（日记本与条目）、`notes`（速查表与链接）、`guestbook`（留言）。
