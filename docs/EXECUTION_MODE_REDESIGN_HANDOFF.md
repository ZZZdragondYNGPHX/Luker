# 执行模式重构开发交接

> 状态：**功能已实装并完成针对性回归验证，尚未合并 `custom-release`**
>
> 仓库：`ZZZdragondYNGPHX/Luker`
>
> 功能分支：`feat/execution-mode-redesign`
>
> 开发基线：`custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470`
>
> 功能代码最终验证点：`5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb`
>
> 最终验证：**28 suites / 206 tests 全通过**

## 1. 接手规则

继续维护前仍应先读取当前 `custom-release`：

1. `AGENTS.md`
2. `AI_HANDOFF.md`
3. `FORK_MAINTENANCE.md`
4. `NEW_FEATURE_PROMPT.md`
5. `.github/copilot-instructions.md`（环境会使用时）

然后重新检查 live `custom-release` HEAD。

本功能最初严格从：

```text
custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470
```

创建：

```text
feat/execution-mode-redesign
```

没有以上游 `release` 作为开发基线，也没有准备上游 PR。

---

## 2. 已完成的产品决策

公开执行模式固定为四种：

| 产品名 | 持久化 ID | 核心优势 | 产物 |
| --- | --- | --- | --- |
| Flow · 流程编排 | `spec` | 固定流程、Review/Rerun、确定性 | Capsule |
| Planner · 动态调度 | `agenda` | Planner 动态选择专家 | Capsule |
| Agent Loop · 自治循环 | `loop` | 单 Agent 深度工具自治 | Capsule |
| Director · 导演接管 | `director` | 主/子 Agent 直接拥有最终正文 | Final Reply |

`single`：

- ID 继续被 runtime / persistence 接受；
- 不再作为一级 selectable mode；
- 显示为 Legacy compatibility；
- 通过显式迁移进入 Flow quick single-node；
- 不做升级时静默迁移。

没有 Auto mode。

---

## 3. 本次没有修改的核心

四套成熟 runtime 未改写：

```text
spec-runtime.js
agenda-runtime.js
loop-runtime.js
director-runtime.js
```

这是刻意的。

本功能只重新组织产品层：

- 模式元数据；
- 模式选择 UI；
- 输出所有权展示；
- Legacy Single 兼容入口；
- Quick Flow 迁移事务。

---

## 4. 中央 Mode Registry

文件：

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
```

Registry 是以下产品信息的 source of truth：

- title；
- summary；
- mental model；
- capability label；
- topology；
- agent shape；
- output ownership；
- preset library participation；
- selectable；
- legacy。

Selectable 顺序：

```text
spec
agenda
loop
director
```

Output ownership：

```text
spec     → capsule
agenda   → capsule
loop     → capsule
director → takeover
single   → capsule (legacy only)
```

只有 Director 拥有最终正文。

---

## 5. Mode Picker UI

文件：

```text
public/scripts/extensions/orchestrator/execution-mode-ui.js
```

实现策略：

1. 不删除旧 `#luker_orch_execution_mode` select；
2. 隐藏 select；
3. Registry 渲染四张一级模式卡；
4. 点击卡片只设置 select value；
5. dispatch 原 `change` event；
6. 原 `main.js` 继续拥有 settings 保存、workspace 切换、skill cache、preset refresh 等副作用。

因此本功能没有复制第二套 execution-mode 状态机。

UI 卡片明确显示：

- 模式定位；
- 独特能力；
- `产物：编排建议` / `产物：最终正文`。

Legacy `single` 不渲染为第五张卡，只渲染兼容面板。

Flow 模式提供：

```text
创建 Flow 快速单节点预设
```

---

## 6. Product Sync

文件：

```text
public/scripts/extensions/orchestrator/execution-mode-product-sync.js
```

作用仅限产品元数据同步：

- Capsule 设置是否可见；
- 编辑器顶部公开模式名称。

是否拥有最终正文不再另外硬编码 `mode === director` 作为产品真相，而是读取 Registry 的 `output`。

Runtime dispatch 本身没有迁移到这个模块。

Observer 已做范围收紧，仅响应编排相关 DOM，不因普通聊天消息新增反复扫描整个 document。

---

## 7. Quick Flow 事务核心

文件：

```text
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
```

这是纯事务核心。

它不静态 import：

- editor display；
- snapshot cache；
- character persistence；
- preset library。

这些生产依赖通过 adapter 注入，因此核心可以在 Node/Jest 独立验证。

关键 API：

```text
buildQuickSingleNodeFlowPayload
configureQuickFlowRuntimeDeps
createQuickSingleNodeFlowPreset
```

失败类型：

```text
SETTINGS_UNAVAILABLE
NOT_LEGACY_SINGLE
CREATE_FAILED
ACTIVATE_FAILED
WRITE_FAILED
PERSIST_FAILED
```

---

## 8. Browser Adapter

文件：

```text
public/scripts/extensions/orchestrator/execution-mode-quick-flow-browser-deps.js
```

生产环境注入 canonical helper：

```text
createPreset
deletePreset
getActivePresetId
setActivePresetId
writeActivePreset
getDisplayedScope
getCurrentAvatar
getCharacterExtensionDataByAvatar
getCharacterIndexByAvatar
persistOrchestratorCharacterExtension
```

入口文件顺序：

```text
main.js
execution-mode-quick-flow-browser-deps.js
execution-mode-ui.js
execution-mode-product-sync.js
```

这样 UI 触发 Quick Flow 前生产依赖已经注册。

---

## 9. Legacy Single → Flow 转换

显式迁移语义：

```text
旧 Single prompts
→ 新 Flow preset
→ one stage / one worker
→ 保存成功
→ 原生 select change 切到 spec
```

核心事务本身**不修改** `settings.executionMode`。

只有 UI 在事务成功后才走原 `main.js` change 链切换模式。

旧 Single prompts 不删除。

### 普通 Quick Flow

普通新建 Quick Flow 不读取旧 Single 自定义字段，而使用 shipped defaults。

### Legacy 转换

只有显式 Legacy 转换复制旧 Single：

- `singleAgentSystemPrompt`
- `singleAgentUserPromptTemplate`

---

## 10. Global 回滚

新 Flow preset 创建过程中，只要失败发生在：

- activate；
- write；
- persist；

都会恢复旧 active preset 并移除新 preset。

如果 `saveSettings()` 抛错：

1. 内存回滚；
2. best-effort 再做一次 `saveSettings()`；
3. 尝试把恢复后的状态重新落盘。

---

## 11. Character 回滚

真实 preset-library 的 character scope 会直接修改：

```text
character.data.extensions.orchestrator
```

因此事务在修改前保存整个 extension 快照。

失败时：

- 原地恢复完整快照；
- 保留 sibling modes；
- 保留未知/private fields；
- best-effort 将原快照重新持久化到卡片。

成功时：

```text
override.mode = spec
overrideEnabled.spec = true
```

并保留：

- 其他 `overrideEnabled` flag；
- 其他 preset libraries；
- 其他私人 extension 字段。

如果 character scope 当前没有可写 preset container：

- 不制造 phantom override；
- 恢复可能发生的角色 live-container 修改；
- 回退 Global preset library。

---

## 12. 测试文件

新增：

```text
tests/orchestrator/execution-mode-registry.test.js
tests/orchestrator/execution-mode-product-sync.test.js
tests/orchestrator/execution-mode-ui.test.js
tests/orchestrator/execution-mode-quick-flow.test.js
tests/orchestrator/execution-mode-quick-flow-integration.test.js
```

覆盖：

- 仅四个 selectable modes；
- Single legacy-only；
- 只有 Director takeover；
- UI 实际只显示四张卡；
- Legacy Single 兼容面板；
- card click 复用原 select change；
- Global success / rollback；
- Character success / rollback；
- character→global fallback；
- 普通 Quick Flow 不吃旧 prompt；
- Legacy 转换复制旧 prompt；
- 真实 preset-library integration；
- 私人字段保留。

---

## 13. 实际验证记录

### 第一批

Run：`35041881989`

```text
Test Suites: 8 passed, 8 total
Tests:       53 passed, 53 total
```

用于确认新增 Registry / Quick Flow / character rollback 与最关键旧回归。

### 广回归

Run：`35042005261`

```text
Test Suites: 27 passed, 27 total
Tests:       205 passed, 205 total
```

覆盖：

- preset library CRUD / migration / seed；
- preset lifecycle；
- editor persistence/state；
- effective profile；
- ensureSettings migration；
- character override；
- card-first preset routing；
- card import custom tools；
- portable custom tools；
- skills scope/runtime plumbing；
- Spec/Agenda/Loop runtime shape；
- Director preset swap；
- 四模式 custom-tool runtime；
- abort mid-run。

### 最终 UI + 广回归

Run：`35042132992`

功能代码 SHA：

```text
5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb
```

结果：

```text
Test Suites: 28 passed, 28 total
Tests:       206 passed, 206 total
Snapshots:   0 total
```

其中 `execution-mode-ui.test.js` 实际通过。

用于验证的临时 workflow 已删除，最终功能 diff 不包含临时 CI 文件。

---

## 14. 私人行为兼容情况

本轮没有重写或另建以下基础设施：

- character/global preset library；
- card-first API / prompt preset 解析；
- Skills；
- Custom Tools；
- Layer-2 tools；
- snapshot / branch / swipe；
- abort；
- run-state；
- agenda chat override；
- portable profile；
- Director takeover；
- Web / Android WebView 共用 orchestrator 逻辑。

针对其中多个路径已有旧测试随本功能一起跑过并保持通过。

---

## 15. 最终核心文件

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
public/scripts/extensions/orchestrator/execution-mode-ui.js
public/scripts/extensions/orchestrator/execution-mode-product-sync.js
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
public/scripts/extensions/orchestrator/execution-mode-quick-flow-browser-deps.js
public/scripts/extensions/orchestrator/index.js
```

没有修改四套 runtime 文件。

---

## 16. 当前集成状态

截至本文更新：

- 分支：`feat/execution-mode-redesign`；
- 基线仍为 `custom-release@112baa3b...`；
- 尚未合并 `custom-release`；
- 未创建上游 PR；
- 临时验证 workflow 已删除；
- 是否合并由用户下一步明确决定。

如果后续 `custom-release` 已被其他并行任务推进，合并前必须重新检查 HEAD 与编排相关改动，不能假设仍停在本基线。
