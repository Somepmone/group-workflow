# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 业务模块：「小组作业工作流」

面向大学生的课程小组作业协作工具。组长创建项目 → 拆解节点工作流 → 分享链接邀请成员（昵称加入，无账号体系）→ 看板跟踪进度。

### 核心数据表（Supabase / drizzle）

- `projects`：id、name、template（course_report / experiment_report / club_activity / blank）、owner_name、lock_state（三态锁定 none / workflow / full，默认 none）、created_at、updated_at
- `nodes`：id、project_id、name、type（linear 普通蓝 / converge 汇聚橙，由前置关系自动推断，不可手工写）、assignee（兼容保留，同步为 assignees[0]）、assignees（jsonb 多负责人，写入真相）、ddl（DDL 型截止）、node_kind（ddl 普通 / point 点状，point 用日期+时间点）、point_date、point_all_day、point_start_time、point_end_time、note（备注，取代 strictness）、prev_node_ids（jsonb 有效边，派生视图）、intent_prev_node_ids（jsonb 依赖意图，用户勾选全集持久化）、status（仅存 todo / done / blocked，"未开始/进行中/已超时"由时间实时派生，见 node-status.ts）、blocked_note（卡住说明）、completed_at（完成时间）、position
- `members`：id、project_id、name（昵称，project_id+name 唯一）
- `node_comments`：id、project_id、node_id、author_name（评论者昵称）、content（正文）、kind（'comment' 评论 / 'help' 求助，非法回落 comment）、created_at；索引 idx_node_comments_node(node_id)、idx_node_comments_project(project_id)

> **双轨存储约定（关键）**：`intent_prev_node_ids` 是「用户显式勾选的完整前置」，为持久化真相、写入接口（POST/PATCH 的 prev_node_ids 字段）的唯一落库目标；`prev_node_ids` 是派生视图，由 `syncWorkflow` 每次从 intent 全集重新计算传递约简得到，所有渲染/类型推断/编号/布局只读它。当替代路径被破坏时，原本约简的边会自动恢复（粘滞）。节点对象返回时同时带这两个字段与 `removedEdges`（本次被约简的边，前端用于「已简化」提示）。

> **状态派生约定（关键）**：`status` 只存用户主动设置的 `done`（标记完成，写 completed_at）/ `blocked`（标记卡住了，必填 blocked_note ≥2 字）/ `todo`（取消标记，清空 completed_at + blocked_note）。「进行中 / 未开始 / 可进行 / 已超时」由 `deriveNodeStatus`（`src/lib/node-status.ts` 纯函数）按节点时间区间实时计算，不写库。时间区间（`computeNodeRange`）：起点 = 所有前置节点完成时刻（nodeEndTime：DDL 当天结束 23:59 / point 当天 23:59）的最晚值；**无前置 → start = null（视为随时可开始，不做「未开始/可进行」判断）**；终点 = 自身 ddl / point 当天 23:59。派生逻辑顺序：done → blocked → 无 end → in_progress → `start && now < start`（前置全部 done → **ready（可进行，teal-600/700 稍暗）**，否则 not_started）→ now > end → overdue → in_progress。派生六态：not_started 灰 / in_progress teal / **ready `teal-600/700`（可进行）** / overdue 玫红（文案「已超时 X 小时/天」）/ done 绿 / blocked 橙。看板与统计将 ready 并入「进行中」，不单独开列。

### 关键代码位置

- 数据库 schema：`src/storage/database/shared/schema.ts`（修改表结构后用 `coze-coding-ai db upgrade` 同步）
- 客户端连接：`src/storage/database/supabase-client.ts`（service_role 直连，RLS 已启用但无 policy，服务端 API 全权访问）
- 共享类型与常量：`src/lib/types.ts`（NodeType/NodeStatus(todo|done|blocked)/DerivedStatus/NodeKind/NodeComment 枚举与中文标签着色）
- 评论面板：`src/components/comment-panel.tsx`（CommentPanel 弹窗 + CommentBody 内嵌区：列表首字头像/相对时间/help 橙边框加粗/删除二次确认；输入区双按钮「发表评论/发起求助」，求助必填 ≥2 字，失败 toast 回滚）
- 状态派生：`src/lib/node-status.ts`（nodeEndTime/computeNodeRange/overdueLabel/deriveNodeStatus 纯函数，派生六态非写库）
- 三态锁定：`src/lib/lock-utils.ts`（LockState='none'|'workflow'|'full'、LOCK_STATES、getProjectLockState、NODE_STRUCT_FIELDS(name/node_kind/ddl/point*/note/prev_node_ids/intent_prev_node_ids/type/position)、NODE_PERSON_FIELDS(assignees/assignee)、NODE_EXEC_FIELDS(status/blocked_note/completed_at)、assertWorkflowEditable：none→全允许；workflow→结构字段变更 403（人员/状态仍可改）；full→结构+人员变更 403（执行字段 status/blocked_note/completed_at 与评论仍放行，只锁「安排」不锁「执行」））
- 类型推断：`src/lib/node-types.ts`（inferNodeType：入度>=2→converge，否则 linear；reduceIntents：基于 intent 全集的传递约简；wouldCreateCycle：基于 intent 的环检测；另有拓扑重排/传递约简底层）
- 编号计算：`src/lib/workflow-labels.ts`（按稳定拓扑序分配纯整数编号 1、2、3…，连续不跳号）
- 布局算法：`src/lib/barycenter-layout.ts`（同层节点重心法排序，减少箭头交叉）
- 模板定义：`src/lib/templates.ts`（四个模板的默认节点与依赖关系，依赖用 prevIndexes 显式声明）
- API 路由：
  - `POST /api/projects` 创建项目（含默认节点+组长入成员）
  - `GET /api/projects` 项目列表（聚合 nodeCount + members + lock_state，一次拉取避免 N+1）
  - `GET /api/projects/[id]` 项目详情（含成员+节点+lock_state）
  - `POST/GET /api/projects/[id]/members` 成员加入/列表（full 锁定时禁加入 403）
  - `PATCH /api/projects/[id]` 更新 lock_state（校验 none/workflow/full 合法值）
  - `DELETE /api/projects/[id]` 删除项目（级联删节点/评论/成员）
  - `POST /api/projects/[id]/nodes` 创建节点（lock_state!=='none' 时 403）
  - `PATCH/DELETE /api/nodes/[id]` 更新/删除节点（删除时移除其他节点对其引用；PATCH 过 assertWorkflowEditable，workflow 锁结构字段 403、full 全 403；DELETE 在 lock_state!=='none' 时 403）
  - `GET /api/projects/[id]/comment-counts` 项目评论计数聚合 `{counts:{[nodeId]:{commentCount,helpCount}}}`
  - `GET/POST/DELETE /api/nodes/[id]/comments` 节点评论：GET 升序列表；POST `{authorName,content,kind}`（content trim≥1，kind 仅 comment/help）；DELETE `{id,authorName}`（仅作者本人可删，他人 403）
  - `GET /api/me/nodes?name=<昵称>` 个人任务跨项目聚合：assignees 含该昵称（`filter('assignees','cs',JSON.stringify([name]))` 精确匹配，jsonb 数组 contains 不能用 `.contains`，会报 invalid input syntax for type json）；**派生状态必须用「节点所属项目全量节点」计算**——先按涉及的 projectId 一次性 `in` 查询全部项目节点并按项目分组缓存（不 N+1），再对每条用户节点用 `allNodesByProject[project_id]` 调 deriveNodeStatus（禁止用当前用户节点子集当全量，否则跨用户前置节点缺失、start 退化 null、状态误判 in_progress）；响应含 projectId/projectName/nodeKind/ddl/point*/assignees/status/blockedNote/completedAt/note/prevNodeIds/derivedStatus/overdueLabel/commentCount/helpCount/lastCommentAt；评论计数按涉及 node_id 一次性 `in` 查询聚合，不 N+1；排序：已完成最后，其余按截止时刻升序
- 页面：
  - `src/app/page.tsx` 首页（创建项目+模板选择；项目卡片网格 grid-cols-1/2/3：项目名+节点数+成员头像+最近更新+锁定标识，点击卡片开总览弹窗，卡右上「⋯」菜单 进入项目/复制链接/删除；右上「我的任务」入口）
  - `src/app/me/page.tsx` 个人页面（昵称门槛→一次拉取，不做轮询；顶部统计=参与项目/待办(status!=='done')/已超时 + 筛选 Tab(全部/已超时/进行中(含 ready)/未开始/已完成)；**按项目分组**：每个项目一个可折叠区块（默认展开），区块头=折叠箭头+项目名(点击弹项目总览)+右侧非零状态徽章（已超时/进行中/未开始/已完成）；区块内排序 已超时→可进行→进行中→未开始（同状态按 DDL 升序），已完成任务在区块内单独折叠（「▸ N 个已完成」，展开后降饱和度）；项目区块排序=该项目任务最早 DDL 升序（无 DDL 排最后）；筛选后只显示有匹配任务的项目区块；空态：「你还没有被分配到任何任务」/「没有符合条件的任务」；卡片可状态操作/开评论面板/项目名开项目总览）
  - `src/app/project/[id]/page.tsx` 工作流搭建页（昵称门槛→builder-page）
  - `src/app/project/[id]/timeline/page.tsx` 时间轴页（甘特图式，昵称门槛→timeline-page）
  - `src/app/project/[id]/board/page.tsx` 看板页
- 组件：`src/components/builder/*`（搭建页）、`src/components/board/*`（看板）、`src/components/timeline/*`（时间轴）、`view-tabs.tsx`（三视图切换）、`nickname-gate.tsx`（昵称加入）、`share-dialog.tsx`（分享链接）、`member-avatars.tsx`（顶部协作成员头像）、`me-link.tsx`（三视图顶部小人图标入口→/me）、`overview-button.tsx`（三视图顶部总览图标按钮→项目总览弹窗）、`project-overview-dialog.tsx`（项目总览弹窗：统计/进度/成员/时间范围/锁定区/进入项目/删除项目）、`comment-panel.tsx`（评论/求助面板）
- Hooks：`src/hooks/use-project-auto-refresh.ts`（多设备协作自动刷新）

### 时间轴（timeline）约定

- 三视图切换：流程图 `/project/[id]`、时间轴 `/project/[id]/timeline`、看板 `/project/[id]/board`，顶部导航统一走 `view-tabs.tsx`
- 数据完全复用 `nodes`（不新增数据库字段）；时间条起止、刻度、连线全部前端计算（`src/components/timeline/timeline-view.tsx`）
- 任务条起止统一按【DDL 当天结束】(日序号+1，方案 A) 计算：起点 = 所有有 DDL 前置节点的最晚 DDL 当天结束（无前置 → 轴起点）；终点 = 自身 DDL 当天结束；起点晚于终点 → 最小宽 24px 标红警示；前置与自身同日 → 条宽 0 → 渲染最小宽 24px + zIndex 置顶不被前置遮挡 + tooltip「与前置任务截止时间相同」；条左端无任何竖线/描边，起点由渐变 0 透明度表达
- **只渲染有时间的节点**（DDL 型有 ddl、点状型有 point_date）：`timedNodes = nodes.filter(nodeTimeDay)`；无时间节点完全不占泳道、不参与布局、不渲染任何元素；依赖连线仅两端都有时间才渲染（一端无 → 跳过，不自动补线）；时间范围只考虑有时间节点
- **点状节点（node_kind='point'）**：`computePointGeom` 水平位置 = `(dayIndex+0.5)*ppd`（列中心），垂直居中在第 0 泳道中心（不参与 assignLanes 泳道压缩）；渲染为旋转 45° 的正方形菱形（14×14px，填充类型色、白描边 2px、轻微阴影），名称显示在菱形下方（10px 灰、max-w 88px、居中省略、pointer-events-none），同天多个点状名称交替上下显示（第 1 个在下、第 2 个在上…）；hover 放大 1.15 倍 + tooltip（名称/日期/时间段/全部负责人/备注），点击开详情；作为依赖时完成时刻按 point_date 当天结束（23:59）计，作为后继时起点 = 前置最晚完成时刻
- 时间范围：有 DDL 节点的最小~最大 ±3 天（保证包含今天）；跨度 >30 天按周刻度；全部节点无 DDL → 空状态「所有任务都还没有设定截止时间」+ 跳转流程图按钮（空项目则「还没有任务」）
- 行序 = 泳道压缩：`timeline-math.ts` 的 `assignLanes(inputs)` 按「拓扑序 + 开始时刻升序」遍历，startDay/endDay 为 `computeBarGeom` 返回的【DDL 当天结束】浮点天（日序号+1；泳道分配与渲染共用同一几何函数，禁止两套算法）；找与泳道内所有任务区间不相交的泳道（首尾相接 end≤start 视为不重叠，可共享行），多条可用优先直接前置所在泳道，无可建新行；【硬性断言】选中泳道后若与任意任务 [start,end) 交集非空则回退新建泳道；`lanes` = WorkflowNode[][]（泳道 0..n-1 按首次使用排序），行高 44px，任务条 absolute 定位在泳道行内
- 矩阵边：`edges` 为贝塞尔曲线 + 实心三角箭头（fill），起点 `up.x + up.w`（上游右端）、终点 `down.x`（下游左端），y = HEADER_H + lane*ROW_H + ROW_H/2；hover 相关 70% 其余 8%；仅两端都有时间（在 timedIdSet 内）才渲染
- 渐变：最左端 opacity 0，渐变区 = 宽 >=200px 固定 100px / <200px 占一半（gradientPct = gradLen/barWidth×100），随后纯色 0.85；任务名始终条内居中（overflow visible，窄条向两侧自然溢出、中心与条中心对齐，字号 11px），hover tooltip 展示完整信息；负责人仅 tooltip/详情弹窗；已超时任务条加玫红描边 + 发光（按 derived.status === 'overdue'）
- 详情弹窗复用 `node-detail-dialog.tsx`（onUpdate=PATCH 节点，状态操作即时生效）；弹窗底部内嵌评论区（`CommentBody`，只读列表 + 输入，不重复弹窗，作者为本地昵称 `getLocalNickname()`）

### 业务约定

- 三态锁定（项目总览弹窗内切换，`PATCH /api/projects/{id}` 更新 lock_state，toast「已锁定工作流」/「已完全锁定」/「已解锁」）：`none` 未锁定（🔓，可改工作流+人员）；`workflow` 工作流锁定（🔒，禁止节点创建/删除/结构字段 PATCH(name/node_kind/ddl/point*/note/prev_node_ids 等)，人员 assignees 与状态 status 仍可改）；`full` 完全锁定（🔐，只锁「安排」不锁「执行」：禁止节点结构/人员字段变更与成员加入，但状态 status/blocked_note/completed_at 与评论仍可操作）；锁定状态由服务端 API 强制校验（`assertWorkflowEditable`，full 下 NODE_EXEC_FIELDS 放行），前端同时置灰禁用对应操作
- 昵称识别：本地昵称统一走 `getLocalNickname()/saveLocalNickname()`（`src/lib/client-utils.ts`，key `gw_nickname`），无则弹昵称门槛加入
- 协作成员列表 `member-avatars.tsx`：横向头像圈（主色系渐变 32px、昵称首字：中文取首字/英文取首字母大写），最多 5 个 +「+N」灰圈；当前用户（本地昵称）头像带主色描边；hover 显示昵称 tooltip；点击区域展开完整成员弹层（Popover，显示全部成员昵称 + 加入时间 MM/DD HH:mm + 当前用户标注「（我）」）
- 多设备自动刷新 `use-project-auto-refresh.ts`（三视图共同启用，enabled=joined）：
  - 每 10 秒静默 GET `/api/projects/[id]`；仅 `document.visibilityState === 'visible'` 时请求，切回前台立即刷新一次
  - 指纹（members 数 + nodes 数 + 各节点关键字段，`projectFingerprint`）无变化 → 跳过 setState 不触发重渲染；失败静默跳过
  - **编辑暂停**：节点详情弹窗打开（`wf:editing` CustomEvent，由 `node-detail-dialog.tsx` 在 open 变化时发射）或 input/textarea/select 聚焦（focusin/focusout 监听）→ 暂停刷新；关闭弹窗/失焦后立即恢复并刷新一次；编辑期间返回的数据不落库也不缓存，等恢复后拉到最新
- 禁用节点删除逻辑：被其他节点设为前置的节点不可删除（需先解除引用）
- 节点名称编辑（`node-editor.tsx`）：输入过程不校验不提交（onChange 仅本地 `setName`）；失焦时空名静默恢复上一次有效名（`nameRef`）、非空则 `nameRef.current = trimmed; updatePatch('name', trimmed)`（NodeEditor 侧栏无保存按钮，名称一律失焦保存，无内联空名提示死代码）
- 节点负责人多选（`node-editor.tsx`）：成员昵称 chip 可点选 + 自定义输入回车添加 + 已选 chip 带 × 可移除；至少选 1 个，全删光失焦静默恢复上一次值（`assigneesRef`）；写入 `assignees` 数组并同步 `assignee = assignees[0]`；流程图卡片显示第一个 + `+N`，看板显示全部（最多 3 个 +N），看板按人分组时多负责人节点在每组都出现
- 点状/DDL 切换（`node-editor.tsx`）：节点类型区域下方「DDL 型 / 点状（会议等）」切换；点状时隐藏 DDL 日期、显示日期 + All day 开关（默认开）+ 时间段 input（结束 ≤ 开始显示内联提示「结束时间需晚于开始时间」，不弹窗）；切回 DDL 型时点状字段清空
- 备注（`node-editor.tsx`）：多行 textarea（placeholder「比如：需要查重、必须包含图表、交给学委前要过一遍…」，3 行高可滚动）失焦 `updatePatch('note')` 保存；严格程度 strictness 彻底弃用（UI 不读不写）；其他界面只读：时间轴 tooltip（超 2 行省略）、看板卡片底部小图标 + 1 行截断、详情弹窗完整只读（whitespace-pre-wrap）
- 看板派生状态列（`board-page.tsx`）：5 列「未开始 / 进行中 / 卡住了 / 已超时 / 已完成」（xl 5 列、sm 2 列、手机 1 列），卡片按 `deriveNodeStatus` 结果归列（done→已完成列、blocked→卡住了列、overdue→已超时列、其余按时间）；「已完成」列默认折叠（只显示标题 + 数量，点击展开，展开后卡片降饱和度）；按人分组视图 `assignees.includes(m.name)` 多负责人重复出现，未分配归「待分配」；已超时卡片状态标签显示「已超时 X 小时/天」具体文案；卡片右下角状态标签旁有评论入口：💬+评论总数（0 不显示）、helpCount>0 显示红色「求助 N」，stopPropagation 直接开评论面板不触详情弹窗；评论计数由看板挂载时 `GET /api/projects/[id]/comment-counts` 拉取一次
- 状态操作（`task-card.tsx` 右下角 + 详情弹窗）：根元素为 `div role="button" tabIndex onKeyDown`（避免 button 嵌套），Popover 三操作「标记完成 / 标记卡住了 / 取消标记」（`stopPropagation` 不触发详情弹窗）；「标记完成」→ status='done' + completed_at=now()；「标记卡住了」→ 弹输入框填说明（必填 ≥2 字，否则内联提示）+ status='blocked' + blocked_note；「取消标记」→ status='todo' + 清空 completed_at/blocked_note；`pick`（task-card）async：先乐观更新（`board-page` 的 `handleStatusChange` 立即 setNodes 换列）→ PATCH → 成功 `toast.success('已更新为「XXX」', 1.5s)`，失败回滚原状态 + `toast.error('状态修改失败，请重试')`，请求期间按钮转圈（Loader2 + pending 防连点）；点击区 ≥ 32px（h-8）；卡住了卡片显示说明（line-clamp-2 + 橙色左边框 border-l-amber-400），已完成卡片显示完成时间（formatCompletedAtShort）
- 前置节点泡泡容器：`flex max-h-[132px] flex-wrap gap-2 overflow-y-auto`（约 3 行），细圆角半透明滚动条（webkit thumb + Firefox scrollbar-width: thin），不足 3 行不留空白，内边距留够防裁切
- **全站禁用 `alert(`**：错误提示一律内联或 `toast.error`（sonner，根 layout 已挂 `<Toaster position="top-center" richColors />`）；`window.confirm` 仅保留节点删除确认
- 设计规范见 `DESIGN.md`

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
