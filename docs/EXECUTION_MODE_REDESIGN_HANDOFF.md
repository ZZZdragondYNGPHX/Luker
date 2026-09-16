# 执行模式重构开发交接

> 状态：开发中，尚未合并 `custom-release`
>
> 仓库：`ZZZdragondYNGPHX/Luker`
>
> 开发分支：`feat/execution-mode-redesign`
>
> 开发基线：`custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470`
>
> 当前功能分支 HEAD：`1ce80004c46b7e684685ce8b64a493cf830d9e9a`
>
> 截至本交接文档创建时：功能分支相对基线 `ahead 12 / behind 0`

## 1. 接手前必须先读

继续开发前，先重新读取当前 `custom-release` 中：

1. `AGENTS.md`
2. `AI_HANDOFF.md`
3. `FORK_MAINTENANCE.md`
4. `NEW_FEATURE_PROMPT.md`
5. `.github/copilot-instructions.md`（如果当前工作环境会使用）

并重新检查 GitHub 当前 `custom-release` HEAD。

本功能最初严格从：

```text
custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470
```

创建独立分支：

```text
feat/execution-mode-redesign
```

禁止默认改用上游 `release` 作为基线，也不要默认准备上游 PR。

如果接手时 `custom-release` 已经继续前进，应先评估新私人改动是否会与本分支冲突，再决定如何同步；不得为了省事丢弃 `custom-release` 中新增的私人修复和功能。

---

## 2. 方案文档

完整拍板方案：

```text
docs/EXECUTION_MODE_REDESIGN.md
```

核心结论：公开执行模式从 5 个收敛为 4 个：

| 产品名称 | 内部兼容 ID | 核心定位 | 最终产物 |
| --- | --- | --- | --- |
| Flow / 流程编排 | `spec` | 用户定义固定工作流 | Capsule / 编排建议 |
| Planner / 动态调度 | `agenda` | Planner 动态选择专家 | Capsule / 编排建议 |
| Agent Loop / 自治循环 | `loop` | 单 Agent 工具自治 | Capsule / 编排建议 |
| Director / 导演接管 | `director` | 主导演 + 子 Agent 直接完成正文 | 最终正文 |

原：

```text
single
```

不再作为新用户一级模式，但必须继续保持旧配置兼容运行。

新的产品定位：

```text
Single = Legacy compatibility only
```

其能力归入：

```text
Flow → 快速单节点模板
```

不得静默迁移旧 Single 配置。

---

## 3. 当前已完成实现

### 3.1 Mode Registry

新增：

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
```

这是本次重构新增的产品层模式元数据源。

当前 Registry 定义：

- `spec`：selectable，fixed，multi-agent，输出 `capsule`
- `agenda`：selectable，dynamic，multi-agent，输出 `capsule`
- `loop`：selectable，autonomous-single，single-agent，输出 `capsule`
- `director`：selectable，dynamic-hierarchical，main + subagents，输出 `takeover`
- `single`：non-selectable，legacy，输出 `capsule`，无 preset library

公开一级模式列表固定为：

```text
spec
agenda
loop
director
```

`single` 仍保留在运行时和持久化兼容层，不允许因本次 UI 重构而删除 ID。

### 3.2 新执行模式选择 UI

新增：

```text
public/scripts/extensions/orchestrator/execution-mode-ui.js
```

入口：

```text
public/scripts/extensions/orchestrator/index.js
```

当前实现没有删除旧：

```html
<select id="luker_orch_execution_mode">
```

而是把它隐藏并保留为模式切换的既有事件入口。

新的四张模式卡通过修改原 select 的 value 并触发原生 `change` 事件，继续复用 `main.js` 已有的：

- executionMode 保存
- character mode pin
- preset / workspace 刷新
- skill cache 刷新
- 模式显隐链路

这样没有另造一套模式切换状态机。

模式卡已经明确展示：

- 模式名称
- 模式一句话说明
- 核心能力标签
- 最终产物类型

其中：

```text
Flow / Planner / Agent Loop → 产物：编排建议
Director → 产物：最终正文
```

### 3.3 Legacy Single 显式迁移入口

当当前配置仍是：

```text
executionMode = "single"
```

新 UI 会显示 Legacy Single 兼容提示，并提供显式按钮：

```text
转换为 Flow 快速单节点
```

禁止自动迁移。

旧 Single 的以下字段仍保留：

```text
singleAgentSystemPrompt
singleAgentUserPromptTemplate
singleAgentModeEnabled
```

迁移成功后也不会删除它们，确保可回退 / 兼容读取。

### 3.4 Flow 快速单节点模板

即使用户不是 Legacy Single，也可以在 Flow 下主动创建：

```text
Flow 快速单节点预设
```

模板结构与旧 Single 实际 runtime 合成结构保持一致：

```text
Stage: single
  mode: serial
  Node: single_agent
    preset: single_agent
```

Prompt 数据来自：

```text
settings.singleAgentSystemPrompt
settings.singleAgentUserPromptTemplate
```

没有值时使用原 Single 默认值。

### 3.5 快速 Flow 事务层

新增：

```text
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
```

这是目前第二阶段已经完成的重要拆分。

目的：把“创建快速 Flow preset”的存储逻辑从 DOM/UI 文件中移出，UI 只负责：

- 展示
- 提示
- 调用 service
- service 成功后触发原模式 change

Service 负责：

1. 决定当前 scope
2. 创建 preset
3. 激活 preset
4. 写入单节点 Flow payload
5. 持久化 Global / Character scope
6. 出错时删除本次新建 preset
7. 恢复之前 active preset id
8. 只有全部成功才返回 `ok: true`

### 3.6 Character / Global Scope 行为

本实现继续复用现有：

```text
preset-library.js
editor-display.js
editor-persist.js
character-overrides.js
```

没有新建第二套 preset store。

Character scope 已有可写 preset container 时：

- 创建角色卡 Flow preset
- pin `override.mode = spec`
- 设置 `overrideEnabled.spec = true`
- 通过现有 `persistOrchestratorCharacterExtension()` 持久化

如果 UI 当前显示 character scope，但角色卡没有可写 Spec preset container：

- 不在 UI helper 中偷偷构造 phantom character override
- 回退到 Global Flow library 创建 preset

这个行为是刻意设计，用于保持当前 custom-release 的“角色卡无配置时不要读操作自动生成 override”规则。

---

## 4. 当前没有修改的 Runtime

以下四个成熟 runtime 本次目前都没有改写：

```text
spec-runtime.js
agenda-runtime.js
loop-runtime.js
director-runtime.js
```

原因：它们已经拥有真实不同的执行语义。

本次重构目标是产品层模式定义、选择 UI、Single 定位、preset 模板和模式元数据，不应为了形式统一重写成熟 runtime。

---

## 5. 已新增测试

新增：

```text
tests/orchestrator/execution-mode-registry.test.js
tests/orchestrator/execution-mode-quick-flow.test.js
```

Registry 测试覆盖：

- 一级公开模式严格为四个
- `single` 仍存在但 `selectable = false`
- `single` 仍是 legacy
- 只有 Director 输出 takeover / 最终正文
- Flow / Planner / Loop 输出 capsule
- 未知 mode metadata 回退 Flow，但不改变持久化 ID 合法性判断

Quick Flow 事务测试目标覆盖：

- 旧 Single prompt → Flow 单节点 payload
- 创建成功路径
- 激活失败回滚
- write 失败回滚
- Global `saveSettings()` 抛异常时回滚
- Character override 持久化
- Character scope 无可写 container 时回退 Global

---

## 6. 测试状态

重要：不要把“测试文件已经提交”误认为“Jest 已完整通过”。

前一阶段做过：

- 新模块 JavaScript 语法检查
- Registry / Legacy Single → Flow 的独立 Node VM smoke test

结果通过。

但截至本交接文档创建时，**最新的 `execution-mode-quick-flow.js` 拆分和 `execution-mode-quick-flow.test.js` 还没有在完整仓库 Jest 环境中实际跑完并确认 PASS**。

因此下一位接手必须优先运行：

```bash
cd tests
npm run test:unit -- execution-mode-registry.test.js execution-mode-quick-flow.test.js
```

或按仓库当前 Jest 调用方式执行等价命令。

然后至少补跑与以下功能直接相关的现有测试：

- preset library
- character override
- execution mode / card pin
- clear character override
- import / export
- loop / agenda / spec / director profile persistence

只能报告实际执行过的测试结果。

---

## 7. 当前开发停点：第二阶段尚未完成

用户要求“继续”后，第二阶段计划是让 Registry 不只驱动模式卡，而是进一步成为产品层唯一元数据源。

目前已经完成：

- Quick Flow service 拆分
- Quick Flow 事务回滚
- Quick Flow 失败路径测试文件

但以下工作**尚未提交**：

### 7.1 `main.js` Capsule 显隐改为 Registry 驱动

当前 `main.js` 中：

```text
applyOrchestratorModeVisibility(...)
```

仍然直接判断：

```text
executionMode === ORCH_EXECUTION_MODE_DIRECTOR
```

决定是否隐藏 capsule fieldset。

应改为从 Registry 的：

```text
mode.output
```

判断，例如：

```text
output === takeover
```

意义：

> “谁拥有最终正文”只由 Registry 定义一次，不再让 UI 另写 Director 特判。

注意：只收口产品元数据判断，不要趁机重写整个 visibility 系统。

### 7.2 弹窗顶部模式名称改为 Registry 驱动

当前 orchestration editor popup 顶部的 `modeChipLabel` 仍使用手写分支：

```text
if director → Director
else if loop → Loop
else if agenda → Agenda
else if single → Single
else → Spec
```

应该继续保留每种模式不同的 character override 检测逻辑，但：

```text
modeChipLabel
```

应直接从 Registry：

```text
getOrchExecutionModeDefinition(currentMode).title
```

再走 `i18n()`。

这样模式命名不会同时存在：

- Registry 新名称
- popup 老名称

两套真相。

### 7.3 继续审计“产品元数据硬编码”，但禁止过度重构

建议搜索：

```text
ORCH_EXECUTION_MODE_SPEC
ORCH_EXECUTION_MODE_AGENDA
ORCH_EXECUTION_MODE_LOOP
ORCH_EXECUTION_MODE_DIRECTOR
ORCH_EXECUTION_MODE_SINGLE
```

然后只迁移以下类别到 Registry：

- 模式名称
- 是否一级可选
- output owner / capsule vs takeover
- 是否 legacy
- 是否有 preset library

不要把真正 runtime dispatch：

```text
if agenda → runAgendaOrchestration
if loop → runLoopOrchestration
...
```

强行做成 Registry 动态函数表。

Runtime 语义分支属于真实行为，不是产品元数据重复。

---

## 8. 必须重点复核的一个实现细节

接手后请首先 review：

```text
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
```

特别关注：

### Character scope persistence failure 的回滚边界

当前 service 会在内存 preset library 中回滚新建 preset 和 active id。

但 Character 持久化属于远端/卡片 extension write；如果：

1. preset library 本身是对 live character extension object 的直接内存修改
2. `persistOrchestratorCharacterExtension()` 部分成功或出现异常边界

需要确认现有 preset-library 的 character container 引用语义，确保失败回滚与卡片实际对象不会出现“内存回滚了但已经写出的 card payload 不一致”。

不要凭感觉修改；先通过现有 `character-overrides-presets` / `clear-character-extension-for-mode` 等测试和源码确认对象引用关系。

---

## 9. UI 回归重点

最终手测至少覆盖：

1. 新用户首次打开：只看到四张一级模式卡
2. Flow 卡正确显示选中
3. Flow → Planner → Loop → Director 连续切换
4. 切换后对应 workspace 正确刷新
5. Director 时 capsule 设置隐藏
6. Flow / Planner / Loop 时 capsule 设置显示
7. Director 明确显示“产物：最终正文”
8. 其他三个模式明确显示“产物：编排建议”
9. Android 窄屏：模式卡自动变单列
10. 打开旧 `executionMode=single` 配置：显示 Legacy Single 区块
11. Legacy Single 不会自动迁移
12. 点击转换后生成 Flow 快速单节点 preset
13. 旧 Single 两个 prompt 字段仍在 settings 中保留
14. 普通 Flow 用户可主动创建快速单节点 preset
15. 当前角色卡有 Spec preset container 时，在 Character scope 创建
16. 没有角色卡 / 没有可写 Character container 时安全回退 Global
17. 角色切换时模式卡 active 状态跟随原 select 更新
18. 重载 orchestrator UI 后卡片状态仍与 settings 一致
19. popup 顶部显示新模式名称，而不是旧 `Spec / Agenda` 产品名
20. Director swipe / regenerate / continue takeover 不受影响

---

## 10. 兼容性红线

不得破坏当前 `custom-release` 已有私人行为：

- character-first / card-first Agent preset 解析
- orchestration preset library
- Global / Character preset scope
- 角色卡 mode pin
- Skills
- Custom Tools
- SillyTavern bridged tools
- Layer-2 memory/search tools
- Agenda chat override
- snapshot / branch / swipe
- Abort / run state / run panel
- portable profile import/export
- Director takeover
- Android WebView 与 Web 共用逻辑

尤其不要因为移除 Single 一级入口而：

- 删除 `single` ID
- 强制迁移旧用户
- 删除旧 Single prompt 字段
- 改旧配置的运行结果

---

## 11. 当前分支改动文件

相对：

```text
custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470
```

当前功能分支涉及：

```text
docs/EXECUTION_MODE_REDESIGN.md
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
public/scripts/extensions/orchestrator/execution-mode-registry.js
public/scripts/extensions/orchestrator/execution-mode-ui.js
public/scripts/extensions/orchestrator/index.js
tests/orchestrator/execution-mode-quick-flow.test.js
tests/orchestrator/execution-mode-registry.test.js
```

注意：截至当前 HEAD，`main.js` **还没有被本功能分支修改**。

因此下一步做 Registry 收口时，如果 diff 中出现大范围 `main.js` 改动，应高度警惕是否超出了最小实现范围。

---

## 12. 推荐接手顺序

建议严格按这个顺序继续：

1. 重新读取仓库协议和最新 `custom-release` HEAD
2. 确认本分支没有落后于新的私人整合提交
3. review `execution-mode-quick-flow.js`
4. 跑两个新增 targeted tests
5. 修复测试暴露的问题
6. 用 Registry 收口 `main.js` 的 capsule/takeover 判断
7. 用 Registry 收口 popup mode chip 文案
8. 再跑 targeted tests + 相关 orchestrator regression tests
9. 做 Web / Android 窄屏手测
10. 更新本交接文档测试状态
11. 检查完整 diff
12. 只有用户明确要求时，才合并回 `custom-release`

不要自动创建上游 PR。

---

## 13. 当前集成状态

```text
Feature branch: feat/execution-mode-redesign
Base custom-release: 112baa3b5f2ad1109a0b143bcffa3d39ec8dc470
Feature HEAD before handoff doc: 1ce80004c46b7e684685ce8b64a493cf830d9e9a
Merged into custom-release: NO
Upstream PR: NO
Feature implementation complete: NO
Design complete: YES
Core picker / registry: IMPLEMENTED
Legacy Single compatibility: IMPLEMENTED
Quick Flow transaction service: IMPLEMENTED
Latest Jest verification: PENDING
main.js Registry metadata convergence: PENDING
Final regression / manual verification: PENDING
```

这份交接应作为 `docs/EXECUTION_MODE_REDESIGN.md` 的开发状态补充；方案本身以方案文档为准，本文件负责记录“现在代码做到哪里”。
