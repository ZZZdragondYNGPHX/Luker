# 执行模式重构开发交接

> 状态：**主体功能已实装，但尚未满足原始方案书的全部完成条件；禁止合并 `custom-release`**
>
> 仓库：`ZZZdragondYNGPHX/Luker`
>
> 功能分支：`feat/execution-mode-redesign`
>
> 开发基线：`custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470`
>
> 已验证功能代码点：`5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb`
>
> 已完成的 targeted regression：**28 suites / 206 tests 全通过**
>
> 2026-09-16 方案对照审计结论：**不能把上述 206 tests 视为原始方案全部完成；当前不得合并。**

## 1. 接手规则

继续开发前必须重新读取 live `custom-release` 中：

1. `AGENTS.md`
2. `AI_HANDOFF.md`
3. `FORK_MAINTENANCE.md`
4. `NEW_FEATURE_PROMPT.md`
5. `.github/copilot-instructions.md`（环境会使用时）

并重新检查：

- `custom-release` 当前 HEAD；
- `feat/execution-mode-redesign` 当前 HEAD；
- 两者是否出现新的 orchestrator / preset / character-scope 并行改动。

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

## 2. 本次审计为什么判定“尚未完成”

原始方案书（最初提交 `69e8648c658688d97bade0321ca2e46666f6b13d`）不只是要求“做四张模式卡”。它还明确要求：

### 阶段四：清理重复 UI 与条件分支

- 移除新建 Single 的一级入口；
- 清理不必要的模式特殊判断；
- **优先从 Mode Registry 控制 UI capability。**

### 阶段五：回归验证

原始方案明确列出必须重点验证：

- 四种 runtime 核心行为；
- Legacy Single 仍能运行；
- Flow 快速单节点与旧 Single 行为等价；
- 全局预设；
- 角色卡预设；
- **角色切换**；
- **聊天切换**；
- **导入导出**；
- Skills / Tools scope；
- **Director takeover**；
- **swipe / regenerate / continue**；
- Abort。

现有 28 / 206 targeted regression 覆盖了其中相当一部分，但不是全部。因此不能因为 targeted CI 全绿就把整个方案标记为完成。

---

## 3. 已完成的产品改造

公开执行模式已经收敛为四种：

| 产品名 | 持久化 ID | 核心优势 | 最终产物 |
| --- | --- | --- | --- |
| Flow · 流程编排 | `spec` | 固定流程、Review/Rerun、确定性 | Capsule |
| Planner · 动态调度 | `agenda` | Planner 动态选择专家 | Capsule |
| Agent Loop · 自治循环 | `loop` | 单 Agent 深度工具自治 | Capsule |
| Director · 导演接管 | `director` | 主/子 Agent 直接拥有最终正文 | Final Reply |

`single` 已经完成以下产品定位：

- 内部 ID 继续接受；
- 不再显示为第五个一级 selectable mode；
- 显示为 Legacy compatibility；
- 提供显式 Legacy Single → Flow quick single-node 转换；
- 不做升级时静默迁移；
- 旧 Single prompts 不删除。

没有新增 Auto mode。

---

## 4. 已完成的核心实现

### 4.1 Mode Registry

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
```

已经统一：

- title；
- summary；
- mental model；
- capability label；
- topology；
- agents shape；
- output ownership；
- presetLibrary；
- selectable；
- legacy。

Selectable 顺序：

```text
spec
agenda
loop
director
```

只有 Director 的 output 是 `takeover`。

### 4.2 四卡 Mode Picker

```text
public/scripts/extensions/orchestrator/execution-mode-ui.js
```

实现方式：

1. 保留旧 `#luker_orch_execution_mode` select；
2. 隐藏旧 select；
3. 用 Registry 渲染四张一级模式卡；
4. 点击卡片写回 select value；
5. dispatch 原生 `change`；
6. 继续复用 `main.js` 原有模式切换副作用链。

因此没有复制第二套 execution-mode 状态机。

### 4.3 Product Sync

```text
public/scripts/extensions/orchestrator/execution-mode-product-sync.js
```

已让以下产品信息读取 Registry：

- 编辑器顶栏公开模式名；
- Capsule / Final Reply 的产品所有权展示。

Observer 已限制在编排相关 DOM，不随普通聊天消息反复全页面扫描。

### 4.4 Quick Flow / Legacy Single 事务迁移

```text
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
public/scripts/extensions/orchestrator/execution-mode-quick-flow-browser-deps.js
```

已完成：

- 普通 Quick Flow 使用 shipped defaults；
- 只有显式 Legacy 转换复制旧 Single prompts；
- Global create / activate / write / persist 失败回滚；
- `saveSettings()` 抛错后的补偿保存；
- Character scope 完整 orchestrator extension 快照；
- Character 失败后完整恢复；
- 保留 sibling mode / private fields；
- 无 writable character preset container 时恢复后回退 Global；
- 事务核心不直接切换 `executionMode`；
- 成功后由 UI 走旧 select `change` 链切到 Flow。

---

## 5. 尚未完成：Registry 还没有真正收口 canonical UI visibility

这是目前最明确的代码层未完成项。

当前 `main.js` 仍是 canonical workspace visibility owner，并且 `applyOrchestratorModeVisibility(...)` 仍包含产品级硬编码：

```text
executionMode === ORCH_EXECUTION_MODE_DIRECTOR
```

用于决定 Capsule 显隐。

与此同时，新 `execution-mode-product-sync.js` 又在 render 之后依据 Registry 做一次产品层覆盖。

也就是说现在是：

```text
main.js 旧硬编码
+ product-sync.js Registry 覆盖
```

而不是原始方案想要的：

```text
Registry → canonical UI capability / visibility source
```

### 下一步要求

不要机械把所有 `if (mode === ...)` 都删掉。

需要先分类：

1. **必须保留的 runtime / persistence compatibility 分支**
   - 例如 Legacy Single 的运行兼容；
   - 不应为了“形式统一”删除。

2. **可以由 Registry 表达的产品/UI capability 分支**
   - Capsule ownership；
   - selectable / legacy；
   - public title / output label；
   - 其他纯 UI capability。

只清理第 2 类。

目标是让 `main.js` 的 canonical visibility path 直接消费 Registry 所有权定义，避免“旧硬编码先执行、Registry 再补丁覆盖”的双重真相。

完成后要补测试锁定：

- Flow / Planner / Loop 显示 Capsule 设置；
- Director 隐藏 Capsule 设置；
- 该行为来自 Registry output，而不是 `mode === director`；
- 各模式 workspace 只显示自己的配置；
- Legacy Single 保留兼容 UI，但不是新建入口。

---

## 6. 尚未完成：原始方案要求的回归矩阵没有全部跑完

目前最终 targeted CI：

```text
Test Suites: 28 passed, 28 total
Tests:       206 passed, 206 total
Snapshots:   0 total
```

这个结果是真实有效的，但覆盖范围不能被夸大。

### 已覆盖较充分

- Mode Registry；
- 四卡 picker；
- Legacy compatibility panel；
- Quick Flow transaction；
- Global / Character preset 写入与回滚；
- preset library CRUD / migration / seed；
- character override enable / clear；
- card-first prompt routing 数据；
- Custom Tools portable / card import；
- Skills scope / runtime plumbing；
- Spec / Agenda / Loop profile 独立性；
- 四模式 custom-tool runtime plumbing；
- Director preset swap；
- Abort mid-run。

### 还必须补的方案级验收

#### A. Legacy Single 实际运行兼容

已有源码兼容分支，但 targeted regression 没有直接证明：

```text
executionMode = single
→ effective profile synthesized
→ 旧 one-stage / one-worker 路径仍能完整跑通
```

需要新增或选取直接覆盖该路径的测试。

#### B. Quick Flow 与旧 Single 的等价性

现在验证了 payload shape 和旧 prompts 迁移，但还缺更接近 runtime 行为的等价性验证：

```text
Legacy Single synthesized spec
vs
Flow quick single-node preset
```

至少要确认核心 one-stage / one-worker / prompt mapping 行为一致。

#### C. Character 切换

原始方案明确要求验证角色切换。

需要覆盖：

- Global → Character override；
- Character A → Character B；
- 无 override 的角色回退 Global；
- 切换后 mode picker / workspace / active preset 与 canonical state 一致。

#### D. Chat 切换

原始方案明确要求验证聊天切换。

需要覆盖：

- agenda chat override；
- snapshot/cache refresh；
- mode UI 不残留上一聊天状态；
- active preset scope 不串线。

#### E. Import / Export

当前跑过 `custom-tool-portable-roundtrip`，但这不等于完整 orchestrator portable profile 的导入导出验收。

需要按四个公开模式分别确认 portable profile / preset import-export 仍保持 mode ID、preset scope、skills/custom tools 相关字段兼容。

#### F. Director takeover 的真实生成类型

仓库已有 Director integration / dispatch 相关测试目录，但它们没有进入这次最终 206 targeted set。

原始方案明确要求：

```text
normal
regenerate
swipe
continue
```

至少要跑覆盖这些 takeover generation types 的现有测试，并确认本分支全绿。

#### G. Snapshot / Swipe / Branch

本次改动宣称未破坏这些私人行为，但最终 targeted set 没有把对应完整回归纳入完成证据。

需要补跑 snapshot / structural-event / swipe / branch 相关既有测试。

---

## 7. 建议下一轮最小完成路径

不要再扩大产品范围；只做原方案收尾。

### Step 1：收口 Registry UI capability

修改 canonical visibility 逻辑，让纯产品所有权直接读取 Registry。

不要改四套 runtime dispatch。

### Step 2：补 Legacy Single / Quick Flow 等价测试

目标不是重写 Single，而是证明旧数据继续运行、显式迁移后行为不退化。

### Step 3：补状态切换测试

至少覆盖：

- character switch；
- chat switch；
- global ↔ character preset scope；
- agenda chat override。

### Step 4：补生成链 / takeover 回归

运行现有 Director integration / dispatch tests，明确覆盖：

- normal；
- regenerate；
- swipe；
- continue。

同时补 snapshot / swipe / branch 相关测试。

### Step 5：补完整 import/export 验收

不要只用 Custom Tools roundtrip 代替 orchestrator profile/preset import-export。

### Step 6：重新跑最终回归

最终完成证据应至少包含：

- 本功能新增测试；
- 上述方案级回归；
- 原 206 targeted set；
- 任何新增的 Registry visibility 测试。

全部通过后，才可以把方案状态改为“完成”，再重新检查 live `custom-release` 并决定合并。

---

## 8. 四套 Runtime 仍然不要重写

继续保持：

```text
spec-runtime.js
agenda-runtime.js
loop-runtime.js
director-runtime.js
```

本次剩余工作是：

- 产品 capability 真相收口；
- 兼容路径验证；
- 状态切换与 takeover 回归补齐。

不是 runtime 架构翻修。

---

## 9. 当前核心实现文件

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
public/scripts/extensions/orchestrator/execution-mode-ui.js
public/scripts/extensions/orchestrator/execution-mode-product-sync.js
public/scripts/extensions/orchestrator/execution-mode-quick-flow.js
public/scripts/extensions/orchestrator/execution-mode-quick-flow-browser-deps.js
public/scripts/extensions/orchestrator/index.js
```

新增测试：

```text
tests/orchestrator/execution-mode-registry.test.js
tests/orchestrator/execution-mode-product-sync.test.js
tests/orchestrator/execution-mode-ui.test.js
tests/orchestrator/execution-mode-quick-flow.test.js
tests/orchestrator/execution-mode-quick-flow-integration.test.js
```

---

## 10. 已验证记录（保留，不能误称全方案验收）

### 第一批

Run：`35041881989`

```text
8 suites / 53 tests passed
```

### 广回归

Run：`35042005261`

```text
27 suites / 205 tests passed
```

### UI + 广回归

Run：`35042132992`

功能代码点：

```text
5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb
```

结果：

```text
28 suites / 206 tests passed
```

这些结果证明当前主体实现没有打坏已覆盖路径，但**不等于原始方案阶段五全部验收完成**。

用于验证的临时 workflow 已删除。

---

## 11. 合并门槛

在以下条件全部满足前，不合并 `custom-release`：

- [ ] Registry 接管可由 metadata 表达的 canonical UI capability / visibility；
- [ ] Legacy Single 实际运行路径有直接回归；
- [ ] Quick Flow 与 Legacy Single 核心单节点行为完成等价性验证；
- [ ] Character switch 回归通过；
- [ ] Chat switch / agenda chat override 回归通过；
- [ ] 完整 orchestrator import/export 回归通过；
- [ ] Director normal / regenerate / swipe / continue takeover 回归通过；
- [ ] Snapshot / Swipe / Branch 相关回归通过；
- [ ] 原有 preset / skills / tools / abort 回归仍通过；
- [ ] 合并前重新检查 live `custom-release` HEAD 与并行 orchestrator 改动。

全部打勾后才进入合并步骤。

---

## 12. 当前集成状态

截至本次方案对照审计：

- 功能分支：`feat/execution-mode-redesign`；
- **不合并 `custom-release`**；
- 未创建上游 PR；
- 未改用官方 `release` 作为开发基线；
- 四套 mature runtime 未重写；
- 主体实现已通过 28 / 206 targeted regression；
- **原始方案仍有收口与验收项未完成。**

下一位接手者应从第 5、6、7、11 节继续，而不是重新设计四种执行模式。