# SFTP 文件系统

## 1. 当前状态

Cosmosh 已实现基于标签页作用域的 SFTP 文件系统工作台。

v1 已实现：

- Home 服务器右键菜单与文件动作可以打开 SFTP 标签页。
- 每个 SFTP 标签页创建一个 backend SFTP 会话，并拥有该会话生命周期。
- 目录列表支持面包屑路径跳转、可回退到文本输入的地址编辑、持久化文本地址显示模式、前进/后退历史、返回上级、刷新、当前目录过滤、loading、empty、会话过期与操作失败状态。
- Renderer 展示目录项、元数据详情与独立属性窗口。双击普通文件会将其下载到 Cosmosh 受控的 SFTP 临时目录，并使用系统默认应用打开。
- 左侧目录树展示当前目录的父级链路，并在用户浏览时缓存已加载的子目录；目录导航后，只有已挂载的上级/当前/已展开下级目录上下文不在树视口内时，才会自动将当前目录行滚动到树视口上方约三分之一的位置；还提供目录作用域的右键操作：打开、在新标签页打开、刷新、粘贴、新建文件与新建文件夹。
- 中间列表右键菜单与顶部操作栏提供打开、文件夹新标签打开、属性、在此处打开 SSH、复制地址、复制相对地址、保存普通文件到本地、支持平台上的打开方式、剪切、复制、粘贴、删除、新建文件、新建文件夹与行内重命名。目录列表支持 `Ctrl`/`Cmd` 切换多选与 `Shift` 范围选择。
- Renderer 管理的文件操作会按 SFTP 标签页进入本地队列，并在紧凑的工具栏任务菜单中展示排队、运行、成功、失败与进度状态。
- SFTP 设置控制删除确认的触发范围、中间文件列表是否显示开头的 `..` 父目录行，以及地址栏是否始终以文本形式显示。
- Backend 写操作支持空文件创建、目录创建、重命名/移动、递归复制与递归删除。

v1 明确不包含：

- 上传、目录下载、chmod、拖放、全局搜索、文件编辑，以及带取消/冲突处理的 backend 级传输队列。
- 复用当前 SSH terminal 会话。SFTP 标签页会建立独立的 SSH + SFTP 连接。
- 持久化 SFTP history 或新增数据库表。

## 2. 运行时架构

```mermaid
flowchart LR
  UI[SFTP Workbench Page] --> BRIDGE[window.electron bridge]
  BRIDGE --> MAIN[Main IPC proxy]
  MAIN --> ROUTE[Backend SFTP HTTP routes]
  ROUTE --> SERVICE[SftpSessionService]
  SERVICE --> SSH2[ssh2 Client + sftp subsystem]
  SSH2 --> REMOTE[Remote file system]
```

### 模块归属

- **API contract**：`packages/api-contract/openapi/cosmosh.openapi.yaml` 定义 SFTP path、schema、成功码与错误码。
- **Backend**：`packages/backend/src/http/routes/sftp.ts` 负责 HTTP 输入校验与 API envelope 映射。`packages/backend/src/sftp/session-service.ts` 负责 SSH/SFTP 连接、会话注册表、目录路径归一化、条目映射与资源释放。
- **Main/preload**：`packages/main/src/ipc/register-backend-ipc.ts` 将 SFTP 请求代理到 backend route。`packages/main/src/ipc/register-app-utility-ipc.ts` 负责原生保存/打开辅助能力、校验 Cosmosh SFTP 临时路径，并启动平台级打开方式行为。`packages/main/src/preload.ts` 暴露最小 renderer bridge。
- **Renderer**：`packages/renderer/src/pages/SFTP.tsx` 负责标签页作用域 UI 状态、文件操作、行内重命名/新建状态与预览状态。
- **Settings registry**：`packages/api-contract/src/settings-registry.ts` 负责 renderer settings store 消费的 SFTP 删除确认与父目录行偏好。

## 3. API 契约

所有调用端必须使用 `@cosmosh/api-contract` 生成导出，尤其是 `API_PATHS` 与生成的请求/响应 payload 类型。

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/sftp/sessions` | 为一个 SSH server 创建 SFTP 文件系统会话。 |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/entries?path=...` | 为活动 SFTP 会话列出一个远程目录。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/entries/details` | 获取已选远程条目的非递归元数据，包括 `lstat` 字段和符号链接目标元数据。 |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/file?path=...&maxBytes=...` | 为一个远程文件读取有上限的 UTF-8 预览。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/download` | 将一个远程普通文件流式保存到 main/preload 选定的本地目标。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/files` | 创建一个远程空文件。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/directories` | 创建一个远程目录。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/rename` | 重命名或移动一个远程条目。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/copy` | 复制一个远程文件或目录树。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/entries/delete` | 删除一个远程文件、符号链接或目录树。 |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/batch` | 对多个远程条目执行一次有序批量复制、移动或删除操作。 |
| `DELETE` | `/api/v1/sftp/sessions/{sessionId}` | 关闭 SFTP 会话并释放 SSH 连接。 |

成功码：

- `SFTP_SESSION_CREATE_OK`
- `SFTP_DIRECTORY_LIST_OK`
- `SFTP_ENTRY_DETAILS_OK`
- `SFTP_FILE_READ_OK`
- `SFTP_OPERATION_OK`

SFTP 专属错误码：

- `SFTP_SESSION_NOT_FOUND`
- `SFTP_VALIDATION_FAILED`
- `SFTP_OPERATION_FAILED`

Host fingerprint 信任失败复用 SSH 的 host-trust envelope 与错误码，因为 SFTP 使用同一套 SSH 传输安全模型。

## 4. 会话生命周期

```mermaid
sequenceDiagram
  participant Home as Home Page
  participant UI as SFTP Tab
  participant Main as Main IPC
  participant API as Backend Route
  participant SFTP as SftpSessionService

  Home->>UI: Open SFTP tab for serverId
  UI->>Main: backendSftpCreateSession(payload)
  Main->>API: POST /api/v1/sftp/sessions
  API->>SFTP: createSession(serverId)
  SFTP-->>API: sessionId + currentPath
  API-->>UI: session create success
  UI->>Main: backendSftpListDirectory(sessionId, path)
  Main->>API: GET /api/v1/sftp/sessions/{sessionId}/entries
  API->>SFTP: listDirectory(sessionId, path)
  SFTP-->>UI: normalized directory entries
  UI->>Main: backendSftpRenameEntry / backendSftpBatchOperation / ...
  Main->>API: POST /api/v1/sftp/sessions/{sessionId}/...
  API->>SFTP: Mutating operation on live session
  SFTP-->>UI: operation success or batch summary + background listing revalidation
  UI->>Main: backendSftpCloseSession(sessionId)
  Main->>API: DELETE /api/v1/sftp/sessions/{sessionId}
```

生命周期规则：

- 普通 Home 右键菜单动作会在同一服务器已有 SFTP 标签页时复用该标签页。
- SSH Orbit Bar 与终端右键菜单交接过来的目录始终会用选中的目录路径创建新的 SFTP 标签页，即使同一服务器已经存在其他 SFTP 标签页。
- 显式新标签动作会创建新的 SFTP 标签页，因此也会创建独立 backend SFTP 会话。
- 隐藏的 SFTP 标签页保持挂载，并继续持有会话。
- 关闭标签页或变更连接意图时，会尽力关闭旧 SFTP 会话。
- Backend 关闭时会关闭所有已注册的 SFTP 会话。

## 5. 目录列表与文件操作

Backend 始终将 SFTP 路径视为 POSIX 路径，不受运行 Cosmosh 的宿主 OS 影响。

SSH 到 SFTP 的交接只接受显式远程目录选区：绝对路径、home 相对路径、点相对路径，以及 `file://` URL。Renderer 会在作为结构化 `initialPath` 传递前去掉简单包裹引号和末尾标点；它不会执行 shell 命令，也不会为裸相对名称推断终端当前工作目录。

目录列表步骤：

1. 归一化请求路径。
2. 使用 `realpath` 解析路径。
3. 对解析后的目录执行 `readdir`。
4. 通过共享的 SFTP 元数据 mapper 映射每个条目。目录列表响应包含低成本、非递归字段：`name`、`path`、`parentPath`、`type`、`size`、`mode`、`permissions`、`permissionOctal`、`uid`、`gid`、`modifiedAt`、`accessedAt`、`extension`、`shellEscapedPath`、`isHidden`，以及可选的 `longname`。
5. 目录优先排序，再按名称进行支持数字感知的 locale 排序。

条目类型收敛为：

- `directory`
- `file`
- `symlink`
- `other`

当服务器提供的 SFTP extended attribute 包含可识别的隐藏标记，或条目名称以`.`开头且不是`.`/`..`时，backend 会设置 `isHidden`。Renderer 会在内存中保留完整目录结果，并只在可见界面上应用隐藏条目偏好。

Renderer 当前显示名称、大小、修改时间与 mode 列。目录面板只支持过滤当前目录条目，不是远端递归搜索。`sftpShowHiddenEntries` 默认值为 `true`，控制隐藏文件与文件夹是否出现在中间列表、左侧目录树和面包屑目录菜单中。`sftpDimHiddenEntries` 也默认开启；隐藏条目可见时，只对条目图标和名称应用 80% 透明度，不改变行选择、元数据列、按钮、hover 状态与右键菜单。顶部工具栏 overflow 菜单包含`显示隐藏文件`复选项；行、空白区域和树节点右键菜单不暴露该偏好。详情面板在单选时展示已选条目的元数据，多选时展示已选择数量。行内 info 按钮与行右键菜单的`属性`动作会打开独立的同源 renderer 弹窗，通过现有详情端点拉取所选条目，并以接近 Windows/macOS 的属性页形式展示常规、权限与符号链接分区，同时包含条目的隐藏状态。多条目属性会显示共通值、混合标记、共同父目录、类型数量、元数据失败数量、隐藏状态一致性与总大小。Raw metadata 不再展示在详情侧边栏；属性窗口可在条目标题区触发有意的七连击后显示所选条目的 details payload。Electron 弹窗使用当前 preload 支持的 SFTP 会话；网页弹窗在 web SFTP runtime 支持前显示明确的未支持提示。启用 `sftpShowParentDirectoryEntry` 且 backend 返回父路径时，中间列表会在真实条目前添加一个不可选择的 `..` 行，用于返回上一级目录且不改变 backend 数据。

目录结果会在 SFTP 标签页生命周期内缓存在 renderer 内存中。再次访问已加载路径会立即使用缓存结果；刷新动作会绕过缓存，并从当前 backend 会话重新请求目录列表，同时在新结果返回前保留当前可见列表。

条目详情使用与目录列表相同的元数据 mapper，并只额外添加需要逐条调用才能得到的字段。Backend 会对每个已选路径执行 `lstat`，因此符号链接会按链接自身描述。对于符号链接，backend 还会执行 `readlink`，将相对目标按链接父目录解析，并尝试对目标执行 `stat`。目标状态会报告为 `exists`、`broken`、`permission-denied` 或 `unknown`；只有目标存在且可读时才包含目标 stats。目录列表和详情请求都不会递归计算目录大小。

写操作规则：

- 所有写请求都作用于当前活动 SFTP 会话，并使用 POSIX 风格路径。
- 创建空文件使用独占写语义，不覆盖已有远程文件。
- 目录复制是递归操作。当请求的目标已存在时，backend 会选择 `copy`、`copy 2` 等后缀。
- 不允许将目录复制到自身或其子目录中。
- 删除使用 `lstat`，因此符号链接会作为链接本身删除，而不会跟随到目标。
- Renderer 请求删除目录时使用递归删除。
- 删除确认是 renderer 侧安全门，由 `sftpDeleteConfirmationMode` 控制：`always` 每次删除前确认，`batch` 仅在删除多个已选条目时确认，`shortcut` 仅在键盘快捷键触发删除时确认，`off` 直接调用 backend 删除流程。
- Renderer 文件操作会先进入标签页本地 FIFO 任务队列，再调用 backend。队列运行期间仍可继续使用导航、选择、过滤与刷新；工具栏任务菜单会在任务完成后保留一小段可检查时间再移除。
- 多条目剪切、复制、删除与粘贴会对当前 SFTP 会话发起一次 backend 批量 API 请求。Service 按顺序执行条目，遇到第一个失败后停止，返回每个条目的 `success`/`failed`/`skipped` 结果，且不会回滚已经完成的条目。重命名、打开、打开方式、本地保存、空文件创建与目录创建仍是单条目任务。新标签打开仍是即时动作，因为它不会修改当前会话。
- 本地保存仍是单条目动作，仅支持普通文件。`保存到“下载”` 由 main 返回系统下载目录，`保存到...` 由 main 打开原生保存对话框，backend 通过当前 SFTP 会话将远程文件流式写入本地临时文件，成功后再替换最终目标。
- 默认文件打开与打开方式也仍是普通文件的单条目动作。Renderer 会先向 main 请求 `app.getPath('temp')/cosmosh-sftp` 下的唯一路径，复用现有 SFTP 下载端点将文件落地，再要求 main 仅打开该已校验的临时路径。
- 在 Windows 上，`打开方式...` 是没有二级菜单的普通菜单项，会先通过隐藏 PowerShell 进程调用 shell `openas` verb；已校验的临时文件路径会通过子进程环境变量传入，以避开 PowerShell 参数解析边界问题。如果该 shell verb 被操作系统针对某类文件拒绝，main 会回退到 `rundll32.exe shell32.dll,OpenAs_RunDLL`。在 macOS 上，`打开方式...` 是由 `packages/main/resources/helpers` 中的 NSWorkspace helper 填充的二级菜单；`prebuild` 会在 macOS 上编译 helper 二进制，开发态可回退到 Swift 源码。Linux 不渲染打开方式动作。
- 操作成功后会使当前目录缓存失效，并在后台重新校验可见列表；在服务器结果返回前保留当前列表、过滤条件与选择状态。

## 6. 安全与错误模型

SFTP 使用与 SSH 相同的服务器、钥匙链、凭据解密与 host fingerprint 信任模型：

- 凭据在 backend 进程中通过 `SshServer` -> `SshKeychain` 解析。
- 解密后的 secret 不会跨到 renderer 或 preload。
- Main 注入内部 backend 鉴权 token 与 locale header。
- 未知或不受信任的 host fingerprint 通过与 SSH 相同的确认流程返回。

错误映射：

- 缺失或非法请求数据 -> `SFTP_VALIDATION_FAILED`。
- 缺失 session id 或会话已关闭 -> `SFTP_SESSION_NOT_FOUND`。
- 连接失败、权限不足、路径不可读、复制/删除/重命名失败与远端 SFTP 错误 -> `SFTP_OPERATION_FAILED`。
- 未知 host fingerprint -> `SSH_HOST_UNTRUSTED`，并携带 fingerprint 确认数据。

安全约束：

- Renderer 与 preload 永远不会接收解密后的 SSH 凭据。
- SFTP 路径通过结构化 API payload 传递，不通过 shell 命令执行。
- 本地保存目标由 main/preload 选择或解析，并作为显式路径传给 backend；renderer 不接收文件系统写入能力。
- 本地系统打开动作仅允许 Cosmosh SFTP 临时根目录下的路径。Main 会归一化候选路径，确认其仍位于该根目录内，并在调用 `shell.openPath`、Windows `openas` 或 macOS helper 前检查它是已存在的文件。
- Backend 会拒绝空的可变目标，以及用于写操作的根目录/当前目录标记。

## 7. Renderer UX 契约

SFTP 页面遵循 Cosmosh workbench 布局规则：

- 使用三个高密度圆角工作台卡片：左侧目录树、中间目录列表、右侧详情/预览。
- 目录树面板保持窄而任务导向，目前对齐 Cosmosh 250 px 侧栏节奏。
- 使用内部 UI wrappers（`Button`、`Tooltip`、`Dialog`）与 tokenized classes。
- SFTP 标签页使用文件夹图标；启用共享的 SSH/SFTP 服务器视觉标签页设置时，继承对应服务器的颜色背景。
- 顶部工具栏保持紧凑，并按路径控制、远程路径地址栏、文件操作按钮与当前目录过滤的顺序排列。
- 地址栏默认使用 Windows 风格的面包屑控件。点击层级文本会跳转到该路径，点击层级箭头会展示该层级下可用的子目录；目录数据优先复用 renderer 目录缓存，不足时通过当前会话按需加载。点击地址栏空白区域会临时恢复到可编辑的纯文本 input。地址栏右键菜单保留`复制地址`与`编辑地址`，并提供`将地址显示为文本`动作来持久化 `sftpShowAddressAsText`。启用该设置后，即使 input 没有焦点，地址栏也始终渲染为纯 input；input 右键菜单提供反向显示动作，让用户无需先离开输入框即可回到层级地址栏。
- 后退与前进工具栏控件使用纯方向箭头图标。左键单步跳转；仅在存在可跳转历史目标时，右键才会打开上下文菜单，并按离当前位置最近优先列出目标，以匹配桌面文件管理器导航习惯。
- 工具栏分割线使用 `MenubarSeparator`，确保分割线尺寸与颜色跟随共享菜单 token。
- 仅当标签页有活动任务或刚完成的任务时显示 SFTP 任务入口。该入口位于地址控件与文件操作按钮之间，使用 `ListTodo`/spinner 图标，并打开右对齐的高密度任务菜单，展示每个任务的状态文本与紧凑进度条。
- 中间列表右键菜单与工具栏暴露文件操作；不可用操作必须禁用。
- 行内 info 图标打开该条目的独立属性窗口，并且不能触发行双击打开。
- 通过左侧目录树右键菜单暴露树节点操作。这些操作以被点击的目录为作用域，不得继承中间列表的多选状态。
- 目录列表行选择对齐桌面文件管理器习惯：普通点击替换选择，`Ctrl`/`Cmd` 切换单行，`Shift` 从当前锚点选择可见范围。对已选行打开右键菜单时保留现有多选。
- 左侧目录树与中间文件列表使用 roving focus：`Tab` 只进入每个列表一次，随后通过 `ArrowUp`/`ArrowDown` 在行之间移动。文件列表中，方向键导航会选中当前聚焦的文件行；可选的 `..` 父目录行仅用于激活跳转，不参与选择。
- 避免工具栏 overflow 菜单与右键菜单之间出现重复项。行右键菜单聚焦已选条目，空白区域右键菜单聚焦粘贴/新建动作，树右键菜单聚焦被点击的目录，工具栏 overflow 菜单只放没有独立工具栏按钮的动作。
- 属性界面是独立 Electron/browser 窗口。第一版复用现有 SFTP 卡片、文本与按钮样式，字段标签与值可被选中，并通过权限分区末尾的标准编辑按钮预留权限编辑入口。
- 行内重命名与新建 input 保持在同一行网格中，不改变图标或文字 baseline 位置。
- 从右键菜单或 overflow 菜单启动的行内重命名与新建动作，必须等菜单关闭处理开始后再切换编辑状态，在 input 挂载期间屏蔠菜单关闭 autofocus，并随后聚焦且选中行内 input。这样可以避免第一次通过菜单触发编辑时，输入框在用户输入前就被 blur 并提交或取消。
- 快捷键标签遵循平台习惯：macOS 使用 `Cmd`，Windows/Linux 使用 `Ctrl`/`Delete`。右键菜单与工具栏 overflow 菜单必须为已有键盘处理的动作显示一致的快捷键标签。
- `在新标签页打开` 只在目标是目录时渲染，`打开方式...` 直接放在它之后的打开动作组中。`打开方式...` 不得包含前置图标。Windows 将其显示为单个项目并打开系统选择器。macOS 将其显示为包含 main 返回应用名称和图标的二级菜单；Linux 省略该动作。
- 删除确认使用共享 `Dialog` wrapper，必须在用户确认或取消前保留待执行操作。键盘触发删除时会传入明确的 shortcut 来源，让确认设置区分仅快捷键安全提示与工具栏/右键菜单删除。
- 可选 `..` 父目录行只属于中间文件列表。它必须渲染在真实条目前，不参与选择与详情状态，像普通文件行一样使用双击/Enter 激活，并在远端根目录没有父路径时显示为禁用状态。
- 目录树展示当前目录和所有父级目录；展开目录行会加载其子目录列表，加载期间显示行内 spinner。
- 从任意 SFTP 导航入口打开目录后，只有对应左侧树行及其已挂载的上级/已展开下级目录上下文都在可见树视口内时，才保持当前位置；否则在当前行挂载后，将它滚动到树视口上方约三分之一的位置。
- 对齐文件管理器行为：展开或收起目录树节点不会切换中间目录列表。通过中间列表打开目录或在路径工具栏跳转时，才会改变当前目录。
- 保持稳定列表列宽，长名称/路径截断，避免布局抖动。路径层级过深时，地址栏必须将较早层级折叠到省略号菜单中，确保窄工具栏内仍优先露出当前目录。

## 8. 后续范围

后续 SFTP 能力应单独规划。可能的下一阶段：

1. 带进度与取消的流式下载/上传。
2. chmod 与更完整的权限编辑。
3. 面向长时间复制/上传/下载的传输队列与冲突处理。
4. 带保存/写回语义的完整文件编辑器集成。
5. 在 SSH terminal 与 SFTP 会话模型能安全共享状态后，再考虑 terminal path handoff。
