# 数据库安全（当前实现）

本文说明 Cosmosh 当前如何保护本地数据库数据、为何 Linux 可能出现 `safeStorage` 回退报错，以及开发者/运维应如何安全地完成启动排障。

## 1. 一句话理解

可以把 Cosmosh 数据库安全理解成“两把锁”：

1. **数据库密钥生成/恢复**（在 Electron Main 进程完成）。
2. **数据库加解密使用**（Backend 通过 `COSMOSH_DB_ENCRYPTION_KEY` 使用该密钥）。

Main 进程负责决定密钥来源：

- 优先路径：使用 Electron `safeStorage`（依赖系统安全存储）。
- 回退路径：使用“主密码派生密钥”（当 `safeStorage` 不可用时）。

Backend 在生产模式不会自行“猜”密钥，而是强依赖 Main 注入的最终密钥。

## 2. 保护边界与威胁假设

### 2.1 这套方案能保护什么

- 降低数据库明文落地风险。
- 在生产模式下避免把原始数据库密钥明文写入普通配置。
- 将密钥启动逻辑放在 Main 进程，减少 Renderer 直接接触敏感逻辑。

### 2.2 这套方案不能保护什么

- 用户会话已完全被攻破（可读进程内存）的场景。
- 不安全运维操作（例如把回退环境变量暴露到日志或 shell 历史）。
- 回退元数据缺失且“设置主密码”用户流程尚未完成时的可用性问题。

## 3. 运行模式与密钥来源

### 3.1 开发模式（`!app.isPackaged`）

- Main 返回固定密钥 `cosmosh_dev_key`。
- Backend 也使用对应开发模式固定行为。
- 默认数据库路径为工作区 `.dev_data/cosmosh.db`。
- 当通过 `pnpm dev:profile` 或 `COSMOSH_DEV_PROFILE` 启用开发身份时，数据库路径变为 `.cosmosh/dev-profiles/<name>/database/cosmosh.db`，Electron `userData` 与 backend secret 存储也会隔离到同一个身份根目录。

该模式偏向开发便利，不代表生产级安全策略。

### 3.2 生产打包模式（`app.isPackaged`）

Main 调用 `getDatabaseEncryptionKey()`，然后把结果注入 Backend 环境：

- `COSMOSH_DB_ENCRYPTION_KEY=<最终密钥>`
- Backend 在 `packages/backend/src/db/prisma.ts` 中读取

若生产环境 Backend 没拿到该变量，会直接失败并报 `[db:key] Missing COSMOSH_DB_ENCRYPTION_KEY ...`。

### 3.3 Schema 归属与启动策略

- 数据库 schema 由 Prisma 流程负责（开发环境使用 `prisma db push`，打包/生产流程使用 migrations）。
- Backend 启动时仅校验必需表是否存在；若 schema 缺失则快速失败，不再用运行时手写 SQL 建表。
- 生产严格模式下，若出现 SQLCipher/Prisma 不可读错误，不再自动解密或重建本地文件，而是输出明确诊断并中止启动，要求先修复根因。

## 4. 优先路径：Electron `safeStorage`

当 `safeStorage.isEncryptionAvailable()` 为 `true` 时：

1. Main 读取 `app.getPath('userData')` 下的 `security.config.json`。
2. 如果已存在 `encryptedDbMasterKey`：
   - 先 base64 解码，再执行 `safeStorage.decryptString(...)`。
   - 解密结果即数据库密钥。
3. 如果不存在：
   - 生成随机 32-byte 密钥（`randomBytes(32).toString('hex')`）。
   - 用 `safeStorage.encryptString(...)` 加密。
   - 以 `encryptedDbMasterKey` 写回 `security.config.json`。

关键点：

- 配置里保存的是“加密后的 blob”，不是明文数据库密钥。
- 解密能力受系统安全存储能力影响。
- 全流程在 Main 完成，Renderer 不参与该路径。
- 若解密成功但配置里仍存在旧路径或异常写入留下的明文应急回退字段，Main 会尽力清理该明文字段。
- 若运行时发生解密失败或加密持久化失败，Main 会尝试回退解析，但不会在 `safeStorage` 可用时写入明文应急密钥。

## 5. 回退路径：主密码模式（`safeStorage` 不可用或读写失败时）

Main 会在以下任一场景进入回退解析器：

1. `safeStorage.isEncryptionAvailable()` 为 `false`。
2. `safeStorage` 可用，但 `encryptedDbMasterKey` 解密失败。
3. `safeStorage` 可用，但创建新密钥时加密/持久化失败。
4. `safeStorage` 路径不可用但应急回退密钥可用。

当因 `safeStorage` 不可用进入回退时，Main 会先打印：

- `[db:key] Electron safeStorage is unavailable. Falling back to master password mode.`

随后进入主密码回退逻辑。

### 5.1 回退所需元数据

`security.config.json` 必须包含：

- `masterPasswordHash`
- `masterPasswordSalt`

如果缺少 `masterPasswordHash`，会报：

- `secure storage unavailable and no master_password_hash found in config ...`

### 5.2 回退所需输入

必须提供环境变量：

- `COSMOSH_DB_MASTER_PASSWORD`

若密码环境变量或 salt 缺失，会报：

- `secure storage unavailable. Missing COSMOSH_DB_MASTER_PASSWORD or masterPasswordSalt ...`

### 5.3 校验与派生细节

当前实现是：

- 校验哈希：`scryptSync(password, salt, 32).toString('hex')`，与配置里的 `masterPasswordHash` 比较。
- 比较方式：`timingSafeEqual(...)`（常量时间比较）。
- 校验通过后派生数据库密钥：`scryptSync(password, salt, 32).toString('hex')`。

如果校验失败，会报：

- `master password verification failed in fallback mode.`

### 5.4 应急回退密钥路径

仅当 `safeStorage` 不可用时，为避免启动死锁，Main 可能持久化本地应急回退密钥：

- `emergencyFallbackDbMasterKey?: string`

运行时行为：

1. 若 `safeStorage` 不可用且存在应急回退密钥，直接使用。
2. 若 `safeStorage` 不可用且主密码回退成功，写入应急回退密钥，便于后续非交互恢复。
3. 若 `safeStorage` 不可用、不存在数据库文件且回退解析失败，首次启动会自动生成应急回退密钥并继续启动。
4. 若 `safeStorage` 可用，新生成或恢复出的密钥只会以 `encryptedDbMasterKey` 形式持久化；Main 不会在该模式下新写入明文应急回退密钥。

若数据库文件已存在，且既无法通过 `safeStorage` 也无法通过回退材料恢复旧密钥，程序仍会快速失败并给出明确错误，避免静默锁库。

### 5.5 `safeStorage` 恢复后的自动迁移

如果回退成功拿到密钥，且此时 `safeStorage` 已恢复可用，Main 会自动：

1. 使用 `safeStorage` 加密该回退密钥。
2. 将其写入 `security.config.json` 的 `encryptedDbMasterKey`。
3. 从配置中移除 `emergencyFallbackDbMasterKey`。
4. 使用同一把恢复出来的密钥继续启动。

这样可以避免误旋转密钥，并确保此前已加密数据库在恢复后仍可读。

### 5.6 该类 Linux 报错为何出现

该类日志链路通常说明：

1. 目标 Linux 环境下 `safeStorage` 不可用。
2. 应用进入主密码回退模式。
3. `security.config.json` 中缺少 `masterPasswordHash`（或相关元数据不完整）。
4. 当前尚未完成可用的 Renderer “设置主密码”引导流程。
5. 程序按设计中止启动，避免使用未验证密钥。

后面那条 DBus/systemd 错误多数是进程生命周期副作用日志，不是主根因。

## 5.7 开发身份隔离

开发身份以便利性为目标，并始终使用确定性的开发密钥 `cosmosh_dev_key`。它用于本地验证引导、首次运行存储、设置默认值与数据库启动行为。

身份状态存放在 `.cosmosh/dev-profiles/` 下，并被 Git 忽略：

- `.cosmosh/dev-profiles/state.json`：由 `pnpm dev:profile use <name>` 写入的当前身份指针。
- `.cosmosh/dev-profiles/<name>/user-data`：Electron `userData` 覆盖路径。
- `.cosmosh/dev-profiles/<name>/database/cosmosh.db`：通过 `COSMOSH_DB_PATH` 注入的 SQLite 数据库文件。
- `.cosmosh/dev-profiles/<name>/backend-storage`：通过 `COSMOSH_BACKEND_STORAGE_PATH` 注入的 backend secret 存储。
- `.cosmosh/dev-profiles/default/profile.json`：自动导入旧默认身份的 manifest。

第一次执行非帮助类 `pnpm dev:profile` 命令时，工具会把旧的隐式默认身份导入到受管理的 `default` 身份。导入器会在可读取时复制 `.dev_data/cosmosh.db` 以及 SQLite `-wal`、`-shm` 文件，复制旧 Electron `userData` 目录，并复制 backend secret 存储。复制结果是尽力而为，并记录在 `profile.json` 中，因此不可读的旧来源只会生成 `import=partial` 身份，不会删除或修改原始来源。

删除或重置普通身份只影响该身份目录。受管理的 `default` 身份会拒绝普通 reset/delete 命令；如需从旧来源重建，请使用 `pnpm dev:profile import-default --force`。除非在身份工具之外手动删除，否则这些命令不会触碰旧开发数据库 `.dev_data/cosmosh.db`。

## 6. `security.config.json` 当前字段

路径：

- 生产环境：`<userData>/security.config.json`

字段含义：

- `encryptedDbMasterKey?: string`
  - `safeStorage` 路径下保存的 base64 加密载荷。
- `emergencyFallbackDbMasterKey?: string`
  - 仅当 `safeStorage` 不可用时用于可用性恢复的明文应急回退密钥。
- `masterPasswordHash?: string`
  - 回退模式校验主密码的 hex 哈希。
- `masterPasswordSalt?: string`
  - 回退模式用于哈希校验和 scrypt 派生的 salt。

说明：

- 同一文件在恢复期间可短暂同时存在 `safeStorage` 与回退字段，但 `safeStorage` 路径成功解析密钥后会移除明文应急材料。
- 只有当 `safeStorage` 不可用时，回退字段才是启动必需项。
- `safeStorage` 恢复后，可用应急回退密钥回灌 `encryptedDbMasterKey`，随后移除该应急字段。

## 6.1 Prisma 引擎目标兼容（Linux 打包）

为避免后端在目标机器启动时报 `Prisma Client could not locate the Query Engine`，Linux 打包必须包含以下 Prisma Linux 目标：

- `debian-openssl-1.1.x`
- `debian-openssl-3.0.x`

CI 会通过 `COSMOSH_REQUIRED_PRISMA_TARGETS` 在预构建阶段验证 `libquery_engine-*.so.node` 是否齐全，缺失时直接失败，防止发布后再暴露给终端用户。

运行时资源同步现在按目标平台过滤 Prisma 引擎：

- Linux 包仅保留 Linux `*.so.node` 引擎。
- Windows 包仅保留 Windows `*.dll.node` 引擎。
- macOS 包仅保留 Darwin `*.dylib.node` 引擎。

这样可以避免把 Linux 兼容引擎误打进 Windows/macOS 产物，同时保留 Linux 兼容性保障。

## 7. Linux 打包场景行动手册

在 Renderer 端“设置主密码”全链路完成前，可采用受控回退流程。

### 7.1 立即解阻清单

1. 在安全流程中选择强主密码。
2. 生成并保存 `masterPasswordSalt`。
3. 计算 `masterPasswordHash = scryptSync(password, salt, 32).toString('hex')`。
4. 将两项写入 `<userData>/security.config.json`。
5. 启动前注入 `COSMOSH_DB_MASTER_PASSWORD`。
6. 确保该环境变量不泄露到 shell 历史或系统日志。

任一步骤缺失或不匹配，程序都应按设计拒绝启动。

### 7.2 运维注意事项

- 不要把回退密码、salt、派生值提交到仓库。
- 不要在 debug 日志打印回退密钥材料。
- 优先使用一次性密钥注入机制，避免长期明文 env 文件。

## 8. 当前缺口与目标方向

当前缺口：

- 错误信息已提示需要 Renderer IPC “Set Master Password”，但在 `safeStorage` 不可用的一些生产场景下，该初始化链路尚未完整可用。

目标方向（实现目标，当前未完成）：

- 增加安全的 Renderer 发起主密码设置流程。
- 通过受控 IPC 路径持久化 `masterPasswordHash`、`masterPasswordSalt`。
- 改善 Linux 下 `safeStorage` 不可用时的首次启动体验。

## 9. 快速排障矩阵

在桌面端运行时，可直接在“设置 → 高级 → 数据库加密信息”中查看这些诊断状态。

### 症状：`safeStorage is unavailable`

- 含义：当前运行环境无法使用系统安全存储。
- 动作：检查回退元数据与 `COSMOSH_DB_MASTER_PASSWORD`。

### 症状：`no master_password_hash found in config`

- 含义：缺少回退校验元数据。
- 动作：预置 `masterPasswordHash` 与 `masterPasswordSalt`。

### 症状：`verification failed in fallback mode`

- 含义：输入密码与 hash/salt 组合不匹配。
- 动作：核对密码来源、哈希公式与目标配置路径。

### 症状：backend 报缺少 `COSMOSH_DB_ENCRYPTION_KEY`

- 含义：Main 未成功解析数据库密钥。
- 动作：向前查看 Main 日志，定位是 `safeStorage` 还是 fallback 哪一步失败。

## 10. 相关源码入口

- `packages/main/src/security/database-encryption.ts`
- `packages/main/src/index.ts`
- `packages/backend/src/db/prisma.ts`
- `docs/developer/core/architecture.md`
