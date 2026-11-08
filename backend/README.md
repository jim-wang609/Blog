# Kimon Blog 后端（Spring Boot + MyBatis-Plus + MySQL）

一个给个人博客用的单体后端：内容全部入库，管理员能改一切；留言与评论免登录，访客账号权限受限。
前端是纯静态 HTML/CSS/JS，由这个后端或 Nginx 直接发。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Spring Boot 3.3.5（Java 17） |
| 持久层 | MyBatis-Plus 3.5.x |
| 数据库 | **MySQL**（本机 9.2，生产 8 亦可），本地与线上同一套，不再有 H2 |
| 数据库结构 | 新库：`schema-mysql.sql`（启动时执行，幂等）；老库增量：`SchemaMigrator`（启动时幂等补列 / 索引，零额外依赖） |
| 鉴权 | JWT（HttpOnly Cookie） + PBKDF2-SHA256 12 万次迭代存密码；改密后旧 JWT 立即失效 |
| 安全 | 角色拦截器、SecurityHeadersFilter、上传白名单与文件头校验、CORS 白名单 |
| 定时任务 | `@EnableScheduling`：每天 03:30 清理过期访问明细（visits） |

## 目录

```
backend/
├── src/main/java/com/kimon/blog/
│   ├── entity/     9 个实体（posts/comments/resources/diary_books/diary_entries/documents/visits/users/settings）
│   ├── mapper/     Mapper 接口，VisitMapper 带统计聚合 SQL、PostMapper / ResourceMapper 带原子自增
│   ├── service/    业务：内容、评论、日记、笔记、统计、账号、种子导入、SchemaMigrator（结构迁移）
│   ├── web/        控制器：公开接口、后台内容接口、后台系统接口、统一异常
│   ├── auth/       JWT、密码、Cookie、登录过滤器、admin 拦截器
│   └── config/     静态资源映射、CORS、安全响应头
├── src/main/resources/
│   ├── application.yml        默认数据源与业务配置（MySQL）
│   ├── application-prod.yml   生产 profile：DB_* 必须由环境变量提供、Cookie 强制 Secure
│   ├── schema-mysql.sql       新建库建表脚本（启动时自动执行，全部 IF NOT EXISTS）
│   ├── logback-spring.xml     访客日志 / 运行日志输出配置（按天 + 50MB 滚动，总量上限 2GB）
│   └── seed.json              首次启动导入的初始内容
└── storage/                   JWT 密钥 secret.key（不要提交；日志在 backend/logs/）
```

## 本地运行（MySQL）

先建一次库（已建好可跳过）：

```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS kimon_blog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cd backend
mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=8080"
```

- 默认连 `127.0.0.1:3306/kimon_blog`，账号 `root` / 密码 `root`；不同密码用 `DB_USER` / `DB_PASSWORD` 覆盖，别的地址用 `DB_URL`。
- 连接串**不再带 `createDatabaseIfNotExist`**：本地库必须先按上一段手动 `CREATE DATABASE`，否则启动会报「Unknown database」。生产同理，数据库由 DBA / 部署脚本预先建好。
- 建表由 `spring.sql.init` 自动执行 `schema-mysql.sql`（全部 `CREATE TABLE IF NOT EXISTS`，重复启动安全），无需手工 source。
  已有库的增量结构（如 `users.pass_changed_at` 列、`comments.parent_id` 列、评论 / 访问查询索引）由
  `service/SchemaMigrator` 在启动时自动补齐，版本号记在 `settings` 表 `k='schema_version'`；
  它先查 `information_schema` 再执行 DDL，重复启动可安全重入。
  当前结构版本是 **v3**（v2：`pass_changed_at` + 查询索引；v3：`comments.parent_id` + 父级索引）。
  迁移失败会直接让启动失败（避免带病运行）；要加 v4 就在 `SchemaMigrator` 里追加一个 step 并把 `CURRENT_VERSION` 加 1，
  不要再引入外部迁移工具。
- 首次启动会把 `seed.json` 导入**一次**，整个导入在一个事务里（`SeedService.importSeed`）：
  失败会整体回滚、不写 `seeded` 标记，下次启动重试；成功后才写 `settings.seeded=1`。之后一切以数据库为准（见下节）。
- 打开 <http://127.0.0.1:8080/home.html> 就是自己的首页；顶栏和页脚都有「站主入口」→ <http://127.0.0.1:8080/enter.html>，
  登录后可直接回首页或进管理台 <http://127.0.0.1:8080/studio.html>。双击「启动服务器.bat」默认落在首页，不再强制先去管理台登录。
- 想从零再来一遍：停掉服务，`DROP DATABASE kimon_blog; CREATE DATABASE ...;`，重启即可重新建表并导入种子（**会清空全部内容，先导出备份**）。

## 数据来源：唯一真源是数据库

页面加载链路：`config.js`（配置 + 连通性探测）→ `boot.js`（**渲染前**同步取 bootstrap，失败整页跳 `offline.html`）
→ `remote.js`（写入全局数据）→ `render.js` / `main.js`（渲染与交互）。前台、后台、站主入口同一套。

部署到服务器后**没有任何内容写进静态文件**，所以静态目录设成只读也完全不影响改内容：

| 数据 | 写入 | 读取 |
|---|---|---|
| 文章 / 随笔 | 后台 studio → `PUT /api/admin/posts` → `posts` 表 | `GET /api/bootstrap` |
| 站点信息 / 资源 / 笔记 / 相册 | 同上 → `settings` / `resources` / `documents` 表（相册是 `k="gallery"` 的文档） | `GET /api/bootstrap` |
| 日记 | 后台 → `diary_books` / `diary_entries` 表 | 仅管理员 `GET /api/admin/diary` |
| 留言 / 评论 | 前台 → `POST /api/comments` → `comments` 表（回复用 `parent_id` 挂在顶层评论下） | `GET /api/comments` |
| 访问量 / 阅读量 | `POST /api/track`、`/api/view/{id}` → 原子自增 | `GET /api/bootstrap` 的 `counts` |
| 图片 / 下载文件 | `POST /api/admin/upload` → `uploads/` | `/uploads/**` |

几个容易踩的点：

- **`seed.json` 只在数据库第一次初始化时导入一次**，由 `settings` 表里的 `seeded=1` 标记控制；导入本身在 `SeedService.importSeed()` 的单个事务里完成，失败整体回滚且不写标记。之后哪怕把文章全删光再重启，它也不会把旧内容灌回来。想重置就清空 MySQL 的 `settings` 表或整库重建，让标记一起消失。
- **站点里没有任何静态内容快照**：仓库根不再有 `data/` 目录和 `feed.xml`，所有 HTML 只负责渲染，内容一律来自 `/api/bootstrap`。要改内容一律进 `studio.html`。RSS 订阅功能已整体移除。
- **连不上就整页跳断连页**：`boot.js` 在页面渲染前同步探测，失败（包括用 `file://` 直接打开）立刻跳 `offline.html`；不会闪一下空壳、不显示错误条、不回退旧数据。断连页只有一句轻松提示，不展示报错码与排查清单；每 5 秒静默复查，后端恢复后自动回到刚才的页面。留言只走接口，不存在浏览器本地，更不会伪造「已发布」。
- 备份用后台「导出 JSON 备份」（`/api/admin/export`，读库生成），**不要**把导出的 JSON 放回静态目录当数据源。

### 后台改完，前台什么时候更新

前台每个页面加载时同步拉一次 `/api/bootstrap`。为了避免「后台改了、已经打开的前台标签还停在旧内容」，加了三层同步：

1. **同源标签即时刷新**：studio 里任何写操作（POST/PUT/DELETE `/api/admin/**`）成功后写 `localStorage['kimon-content-changed']`；其他同源标签收到 `storage` 事件立刻复查数据库，内容真变了就自动整页刷新。
2. **切回页面 / 定时复查**：`visibilitychange`、`focus` 时复查；页面一直开着时每 60 秒静默复查一次（这一路只显示「内容有更新 · 点击刷新」提示条，不打断阅读和输入）。
3. **手动刷新永远生效**：所有 `/api/**` 响应带 `Cache-Control: no-store`，本地开发静态资源也不缓存；bootstrap 请求带时间戳参数。

比对用的是「内容指纹」：只取文章 / 站点 / 资源 / 笔记 / 留言的实际内容，**排除访问数、阅读量、下载数、统计**——这些会随浏览变化，算进指纹会让前台反复误刷新。检测到变化时若用户正在填表单，也只给提示条不强刷。

> 排查顺序：前台看到旧内容 → ① 确认 8080 服务还在跑（连不上会整页跳到 `offline.html`）；② 手动刷新一次；③ 直接看 `/api/bootstrap` 返回的是不是新值。接口是新值而页面仍旧，才是前端问题。

生产部署只要保证**MySQL 账号有读写权限**（首次部署 / 结构升级时还需要 DDL 权限，见下文）、`STATIC_DIR` 指向只读目录即可。Nginx 反代 `/api/` 时**不要开 proxy_cache**，否则会盖掉后端的 `no-store`，前台又会拿到旧数据。

> **端口被环境变量改掉时**：Spring 的宽松绑定会把 `SERVER__PORT`（双下划线）当成 `server.port`。
> 根目录的 `启动服务器.bat` 已经先清掉这个变量，双击启动即可；手动跑命令时若日志出现
> `Tomcat initialized with port 5xxxx`，用命令行参数强制指定：
> ```bash
> mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=8080"
> ```
>
> 站点固定使用 **8080**：前端 `config.js` 走相对路径，Nginx 反代、启动脚本、预览地址都按 8080 写死。
> 开发排错时换到 8090 之类的端口是可以的，但浏览器也必须跟着换地址，否则会看到连接失败／502——
> 这是「看起来后端没启动」最常见的原因。启动脚本会先探测 8080：服务已在跑就直接开页面，
> 不会重复启动导致端口冲突。

## 生产 / 换机器：MySQL 配置

```bash
# 1. 建库（utf8mb4 必须）
mysql -uroot -p -e "CREATE DATABASE kimon_blog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. 打包
mvn -DskipTests clean package        # 产物 target/blog-backend.jar

# 3. 用环境变量喂配置后启动（生产一定要带 prod profile）
export SPRING_PROFILES_ACTIVE=prod
export DB_URL='jdbc:mysql://127.0.0.1:3306/kimon_blog?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false'
export DB_USER=kimon
export DB_PASSWORD='你的数据库密码'
export UPLOAD_DIR=/var/www/kimon-blog/uploads
export STATIC_DIR=/var/www/kimon-blog
export JWT_SECRET='一串足够长的随机字符串'   # 不填会自动生成并存到 storage/secret.key
export SETUP_TOKEN='一串随机口令'            # 可选：首次初始化管理员时要求额外口令
java -jar target/blog-backend.jar
```

`application-prod.yml` 里 `DB_URL` / `DB_USER` / `DB_PASSWORD` **没有默认值**：少给任何一个都会启动失败，
不会再悄悄连到默认的本地 `root/root` 库。prod profile 还会把 `app.cookie-secure` 强制为 `true`（要求 HTTPS）。

**数据库账号权限**：启动时会执行 `schema-mysql.sql`（新库建表）并跑 `SchemaMigrator` 增量迁移，
所以生产 MySQL 账号需要 **DDL 权限**（`CREATE` / `ALTER` / `INDEX`），至少首次部署与结构升级时需要。
若不想常驻 DDL 权限：首次用高权限账号启动完成迁移后，再换回只有读写权限的账号；
之后每次升级版本时临时授权一次即可。迁移进度记录在 `settings.schema_version`，不要手工改它。

### 配置文件与常用环境变量

`application.yml` 提供本地默认值，`application-prod.yml`（`SPRING_PROFILES_ACTIVE=prod` 时加载）只覆盖生产必须不同的部分。
`app.*` 下的可覆盖项：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `STATIC_DIR` | `../` | 静态站点目录（index.html 所在） |
| `UPLOAD_DIR` | `../uploads` | 上传文件目录 |
| `JWT_SECRET` | 空 | 空则自动生成并保存到 `storage/secret.key` |
| `COOKIE_SECURE` | `false`（prod 强制 `true`） | Cookie 是否只走 HTTPS |
| `COOKIE_SAME_SITE` | `Lax` | Cookie SameSite |
| `ALLOWED_ORIGINS` | 空 | 前后端分离时的 CORS 白名单，逗号分隔 |
| `INIT_ADMIN_PASSWORD` | 空 | 首次启动自动建 `admin`（≥10 位） |
| `SETUP_TOKEN` | 空 | `/api/admin/setup` 初始化口令，空则不需要 |
| `TRUST_PROXY` | `true` | 是否信任反向代理的 `X-Forwarded-*` |
| `MAX_JSON_BODY_BYTES` | `2097152` | JSON 请求体上限（2 MiB） |
| `APP_TIME_ZONE` | `Asia/Shanghai` | 业务时区（service 层 `Time` 固定北京时间） |
| `VISITS_RETENTION_DAYS` | `180` | visits 明细保留天数 |
| `BASE_URL` | 空 | 站点对外地址，用于生成绝对链接 |

### 首次进后台

第一次打开 `/enter.html`（或 `/studio.html`）会要求「设置管理员账号密码」（`/api/admin/setup`，只在系统里还没有管理员时可用）。
管理员密码 **至少 10 位**（访客账号密码至少 6 位）。并发初始化由 `AuthService.createFirstAdminIfNone()` 的 `synchronized` + 「已有管理员」检查兜住。
配置了 `SETUP_TOKEN` 时，初始化请求必须带上该口令，防止公网裸奔的站点被人抢先创建管理员。
也可以启动前设 `INIT_ADMIN_PASSWORD=xxx`（同样要求 ≥10 位），会自动建一个名为 `admin` 的管理员。

## 账号与权限

| 角色 | 能做什么 |
|---|---|
| `admin` | 所有后台接口：文章、日记、笔记、资源、评论删除、账号、设置、上传、统计 |
| `guest` | 只能 `POST /api/comments` 留言；所有 `/api/admin/**` 一律 403 |
| 未登录 | 只能读公开接口；`/api/admin/**` 一律 401 |

拦截器 `AdminInterceptor` 在服务端校验角色，前端改 JS 也绕不过去。
访客账号由管理员在后台「账号」里创建。

**密码策略**：管理员密码至少 **10 位**（站点初始化 / 后台重置 / 修改自己的密码一致），访客账号密码至少 **6 位**。
账号名 trim 后不能为空、最长 60 字符。

**改密码后旧 JWT 立即失效**：`AuthService.changePassword` 成功后会写 `users.pass_changed_at`（Instant 字符串）；
`AuthFilter` 每个请求调 `AuthService.tokenStillValid(name, issuedAt)`，签发时间早于该字段的 token 直接视为未登录。
这样「改密码」才真正把旧设备踢下线。该列由 `SchemaMigrator` 自动添加，老库无需手工迁移。

**站点「更新时间」自动生成**：后台任意一次成功的写操作（文章 / 随笔 / 日记 / 笔记 / 资源 / 相册 / 分类标签 / 站点设置 / 留言删除 / 上传 / 账号）之后，
`AdminInterceptor.afterCompletion()` 会调用 `SettingsService.touchUpdated()`，把 `settings` 表里 `site.updated` 写成当前北京时间（`yyyy-MM-dd HH:mm`）。
`SettingsService.site()` 用严格 JSON 解析：库里的 site 数据损坏时更新会失败而不是把设置清空。
前台首页「更新于 …」与后台「设置 → 最近更新」读的是同一个值；后台是只读框，**不需要也不能手填**。
登录、退出、首次初始化、只读查询、访问埋点、访客留言不计入。`seed.json` 里的 `2026-11-04` 只是首次初始化的占位值，第一次后台改动后即被自动值取代。

**留言 / 评论免登录**：`guestbook.html` 与 `post.html` 的表单不再带登录条，全站登录统一走 `enter.html`。
访客填个称呼（留空显示「匿名访客」）即可提交到 `/api/comments`，称呼记在浏览器本地，下次自动填好。
留言**免审核、发布即显示**；站长唯一的管理动作是在后台「留言 / 评论」里删除，
`POST /api/admin/comments/{id}` 改状态接口与「评论先审」开关已移除。

**文章评论支持楼中回复**：`post.html` 每条评论下方有「回复」，提交时带 `parentId`（顶层评论 id）。
服务端只允许两层——回复某条回复时会自动挂到它所属的顶层评论，且必须是同一篇文章 / `target`。
删除顶层评论会连同它的回复一起删，不留孤儿数据；留言板不做回复，仍是便签墙。

**分类 / 标签可先建后用**：后台「分类标签」里新增的项存在 `documents` 表 `k="terms"` 文档，
与文章里已用到的分类 / 标签合并后一起返回；新增项立刻出现在文章编辑器的候选中，改名、删除同样会同步。

**前台只读 + 全站可见的站主入口**：前台不再提供任何就地修改（头像、所在地都已从首页移除），
所有内容与站点信息统一在后台 `studio.html` 修改。

`remote.js` 统一给每个公开页面注入两个入口（`syncOwnerEntry()`）：顶栏「站主入口」胶囊和页脚「站主入口」小链接，
未登录也能看见，点进去是 `enter.html`。登录时可选「回我的首页 / 进管理台」，默认是回自己的首页；
已登录管理员访问 `enter.html` 会看到「我的空间」门厅（实时统计 + 管理台 / 首页 / 文章入口）。
管理员登录后顶栏另有一个直达后台的「管理」胶囊（`syncAdminEntry()`，只认 `role === "admin"`）；
访客账号看不到它，也不会被误放进管理台。开始页 `index.html` 左上角有独立入口。

**日记是站长私有的**：`/api/bootstrap` 不下发任何日记数据，日记只走 `GET /api/admin/diary`（必须 admin）。
前台的日记页 `diary.html` 自带门禁：未登录显示登录框，访客账号只能看到「去留言板」，登录管理员后才拉取内容；
所有页面导航里的「日记」入口默认隐藏，确认是管理员后才显示；公共接口不下发日记，内容只存在数据库里。

**相册分组**：`/api/bootstrap` 里的 `gallery` 是 `{ title, intro, albums[], photos[] }`，和笔记库一样整份 JSON
存在 `documents` 表（`k="gallery"`），没有新增表。`albums[]` 是站长在后台维护的分组名列表（去重、去空、最多 60 个）；
`photos[]` 每条是 `{ id, src, title, desc, album, date, pos }`，`src` 只存图片路径，
`album` 必须是 `albums` 里的分组名——空白或分组已被删除时后端会把它归一成空字符串（前台显示「未分组」），不会丢照片。
单次保存超过 200 张照片或 60 个分组时后端会**直接报错**（`照片最多 200 张` / `分组最多 60 个`），不再静默截断；
读取历史旧数据不做上限校验，旧库照常兼容。

后台 `studio.html#gallery` 是**两级流程**：先看到分组列表（可新建 / 改名 / 删除分组，结构改动即时写库），
点「进入上传」后才出现该组的照片与上传入口；「未分组」是固定虚拟分组，用来收散图。
照片可以用「所属分组」下拉移动到别的分组。删除分组不会删照片，照片自动移到「未分组」。
相册页的筛选按钮直接读 `albums`（空分组也会显示，点开有空态兜底），首页 hero 右侧预览固定取前 3 张。
`remote.js` 的内容指纹包含 `gallery`，改完前台会自动同步。
首次访问时若库里还没有 gallery 文档，会写入一组站内自带的示例插画与示例分组
（`assets/img/gallery/*.svg`）；一旦保存过就以库里内容为准，把相册清空也不会重新灌示例。
旧库没有 `albums` 字段时，`GalleryService.get()` 会按照片里出现过的分组名兜底生成，部署前无需手工改数据。

## 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 一次性返回 site/posts/resources/notes/gallery/guestbook/counts（**不含日记**），前端首屏就靠它 |
| GET | `/api/comments?target=&limit=&beforeId=` | 评论 / 留言分页：`created_at DESC, id DESC` 游标分页（`beforeId` 传上一页最后一条 id），返回 `{items, hasMore}`；免审核，仅历史标记 spam 的不显示 |
| POST | `/api/comments` | 留言 / 评论（免登录、免审核，提交即显示；带 `parentId` 即为文章评论的楼中回复） |
| POST | `/api/track` | 访问统计埋点（写 visits 表，带访客 Cookie） |
| POST | `/api/view/{id}` | 文章阅读量 +1，后台「热门文章」靠它排序 |
| GET | `/api/session` | 当前登录者 |
| POST | `/api/login` `/api/logout` | 访客/管理员登录登出 |
| GET | `/api/download/{id}` | 资源下载并计数（原子自增） |
| GET | `/api/github` | 按后台填的 GitHub 用户名自动读公开仓库数量与名称 |

后台接口（都要 admin）：`/api/admin/state` `setup` `login` `logout` `overview` `posts` `diary` `diary/books` `diary/entries`
`notes` `gallery` `terms` `terms/add` `terms/rename` `terms/delete` `resources` `comments` `users` `settings` `upload` `export` `github/refresh`。
后台评论列表 `GET /api/admin/comments?guestbook=&posts=&limit=&offset=` 返回 `{items, total}`（分页由 `CommentService.adminPage` 提供）。

**分页约定**：前台评论用游标分页（`pageVisible`，多取一条判断 `hasMore`，单页上限 100）；
后台评论用 `LIMIT/OFFSET`（`adminPage`，`total` 为同条件 count，单页上限 200）。两者参数越界会自动 clamp。

**GitHub 标识怎么填**：后台「设置 → GitHub 用户名 / 主页」只填**用户名**即可，例如 `octocat`；也支持 `@octocat`、
`https://github.com/octocat`、`github.com/octocat` 甚至某个仓库地址——服务端统一取第一段路径作为用户名
（只允许字母、数字、连字符，最长 39 字符）。填错或账号不存在时 `/api/github` 返回 `ok=false`，
前台把「开源项目」整块隐藏，不会编造数据。结果在内存缓存 30 分钟，后台「重新读取」可立即刷新。
同一个值也用于页脚的 GitHub 链接。站点设置里的 `status` / `nowWriting` 两个字段前台从未消费，已删除。

### 统计与订阅

- `counts.visits` / `counts.uniques` 随 `/api/bootstrap` 下发，首页「累计访问」显示真实埋点数，
  不再是静态占位数字；`counts.views` 是所有文章的阅读量之和。
- `POST /api/view/{id}` 用 `UPDATE ... views = views + 1` 原子自增，草稿不计；后台编辑文章时不会把已累计的阅读量覆盖掉（更新后重新读库返回）。
- `GET /api/download/{id}` 的下载计数同样改成 `UPDATE resources SET downloads = downloads + 1` 原子自增，不再读-改-写。
- **visits 明细保留 180 天**：`StatsService.cleanupOldVisits()` 每天 03:30 删除 `day_no` 早于 retention 的记录，
  天数用 `VISITS_RETENTION_DAYS` 覆盖（默认 180）。只清明细，所以「累计访问」可能随保留策略略微下降，这是预期行为。
- **统一北京时间**：service 层所有 `now()` / `today()` 走 `util/Time`（固定 `Asia/Shanghai`），
  「今天」、更新时间、访问统计的日切都以中国时区为准，不受服务器时区影响。
- 前后端分离部署时在 `assets/js/config.js` 填后端地址；前后台都会自动切到跨站 Cookie 模式。

## 文章正文：Markdown 是唯一格式

后台「写文章」是 Markdown 写作模式：左侧源码、右侧实时预览，可切「编辑 / 分栏 / 预览 / 全屏」，
工具栏插入的是 `##`、`**加粗**`、`` `code` ``、列表、表格、链接、图片等 Markdown 语法；
支持 `Ctrl/⌘+S` 存草稿、`+B` 加粗、`+I` 斜体、`+K` 链接、Tab 缩进、回车自动续列表，底部有字数行数。

正文以 **Markdown 原文**存进 `posts.body`，前台 `post.html` 与后台预览共用 `assets/js/markdown.js`
的 `KIMON.mdToHtml()` 渲染。原始 HTML 一律转义（挡住 `javascript:` 之类链接），不会执行注入脚本。
`##` 标题会生成 `<h2>`，自动进入文章目录。历史 HTML 正文已一次性迁移为 Markdown，
`seed.json` 里的示例正文也同步转换；新站不用再做迁移。

## 访客行为日志

用 SLF4J / logback 输出，logger 名为 `VISITOR`，一行一个 `key=value` 事件：

- 文件：`logs/visitor.log`（按天 + 按大小滚动：单文件 50MB、该类日志总量上限 2GB、保留 90 天）；同时进控制台和 `logs/kimon-blog.log`
  （运行日志保留 30 天，同样 50MB / 2GB 上限）。目录可用环境变量 `LOG_DIR` 覆盖，配置在 `logback-spring.xml`。
- 通用访问行由 `VisitorLogFilter` 在请求结束时补上：`act=page / load_site / admin_put`，
  带 `ip`、`user`、`path`、`query`、`status`、`ms`、`ua`。静态资源和 `/api/admin/state` 轮询不记。
- 业务动作由控制器补详细字段：`act=visit`（访问路径、来源、vid）、`read_article`（文章 id）、
  `download`（资源 id、文件名、字节数、结果）、`comment` / `reply`（target、parent、长度、昵称）、
  `login` / `admin_login`（账号、成功失败）、`logout`、`admin_setup`、`admin_get/put/delete`。
- **不记录请求体**，密码、留言正文都不会进日志；换行、制表符会先清掉，避免日志注入。

## 展示数据一律来自真实事件

- 资源下载次数只由 `GET /api/download/{id}` 自增，种子数据里写死的假基数已清零；
  首页/后台的「累计下载」是这些真实次数之和。
- 资源卡片的文件大小由后端按磁盘上的真实文件字节数计算（`ResourceService.realSize`），
  手填值不再参与展示；没有真实文件的资源显示「文件待上传 / 待上传」，不会给出假的下载按钮。
- 访问量、独立访客、阅读量、留言数、GitHub 仓库数都来自数据库埋点或 GitHub API，
  没有占位数字。首页「第 N 年」由站点设置里的开站时间推算。

## 数据结构上踩过的几个坑（改代码时注意）

1. `day` 早期为了兼容 H2 保留字，`diary_entries` / `visits` 的列名沿用 `day_no`，实体字段叫 `dayNo`。
   对外 JSON 仍然是 `day`，由 Service 组装。别把列名改回 `day`。
2. MyBatis-Plus 对「字段名 ≠ 列名」的 `@TableField` 会生成 `列 AS 属性` 的别名，
   而 `AS day` / `AS desc` 在部分数据库里是语法错误。所以宁可把 Java 字段改名为 `dayNo`、`intro`，
   也不要用 `@TableField` 硬指一个保留字列名。
3. 增量结构（`users.pass_changed_at`、`comments.parent_id`、`idx_comments_ip_time` / `idx_comments_time` /
   `idx_comments_parent` / `idx_visits_path`）在两个地方分工不同，缺一不可：
   - `schema-mysql.sql`：只管**空库**建表（`CREATE TABLE IF NOT EXISTS`，重复启动安全）；
   - `SchemaMigrator` 的版本 step：负责**已有库**补列 / 建索引，先查 `information_schema` 保证幂等可重入。
   新增这类结构**必须**走迁移器并 `CURRENT_VERSION + 1`，否则老库升级会报 `Unknown column`；
   建表脚本里写不写这一列都行（`users.pass_changed_at` 就只在 V2 里），若写了要和迁移器类型一致。
4. 种子导入是「单事务 + 成功后写 `seeded`」：改 `SeedService` 时别把写标记放进事务里，也别捕获异常后继续写标记，
   否则会出现「导了一半但标记已写、下次不再重试」的残缺库。
