# Luker 执行模式重构方案

> 状态：**已实装并完成针对性回归验证，待用户决定是否合并 `custom-release`**
>
> 开发基线：`custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470`
>
> 功能分支：`feat/execution-mode-redesign`
>
> 最终验证点：`5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb`（28 suites / 206 tests 全通过）

## 1. 目标

旧版对外暴露五种执行模式：

- `spec`
- `single`
- `agenda`
- `loop`
- `director`

问题不在于 runtime 数量本身，而在于产品心智模型重叠：

- `single` 与单节点 `spec` 本质重叠；
- `single` 与 `loop` 都看起来像“单 Agent”，但执行哲学完全不同；
- `agenda` 与 `director` 都能动态调用 Agent，但只有 Director 拥有最终正文；
- 用户很难从旧下拉框理解“谁组织任务、谁写最终回复”。

本次重构不重写成熟 runtime，而是重新定义公开模式边界、统一产品元数据、改造选择 UI，并为旧 `single` 提供显式兼容迁移。

---

## 2. 最终公开模式

公开执行模式固定为四种：

| 新名称 | 内部兼容 ID | 核心心智模型 | 最终产物 |
| --- | --- | --- | --- |
| Flow · 流程编排 | `spec` | 我决定流程 | 编排建议 Capsule |
| Planner · 动态调度 | `agenda` | AI 决定用哪些专家 | 编排建议 Capsule |
| Agent Loop · 自治循环 | `loop` | 一个 Agent 自己查到搞定 | 编排建议 Capsule |
| Director · 导演接管 | `director` | AI 团队直接把正文写完 | 最终正文 |

原 `single` 不再作为一级公开模式，但内部 ID 继续被接受。

---

## 3. 四种模式的不可替代优势

### 3.1 Flow · 流程编排（`spec`）

定位：**用户定义固定工作流。**

保留现有能力：

- 多 Stage；
- Stage 串行 / 并行；
- Worker；
- Review；
- Review 定向返工 / Rerun；
- 节点级模型、Prompt Preset、Tools、Skills；
- 固定、可复现拓扑。

独特优势：**确定性、可复现性和质量门控最强。**

Flow 不负责运行时动态决定是否需要某个专家；这属于 Planner。

### 3.2 Planner · 动态调度（`agenda`）

定位：**用户给出团队，Planner 运行时决定调用谁。**

保留现有能力：

- Planner；
- TODO Board；
- Agent Pool；
- 动态 Dispatch；
- Final Agent；
- Planner 最大轮数；
- 最大并发 Agent；
- 最大总 Agent Runs。

独特优势：**多智能体适应性最强。**

Planner 的产物仍然是 Capsule，不直接拥有最终助手正文。

### 3.3 Agent Loop · 自治循环（`loop`）

定位：**一个 Agent 在同一上下文中不断查工具、修正、直到完成。**

典型执行：

```text
LLM → Tool → Result → LLM → ... → finalize
```

保留现有能力：

- 单 Agent；
- 多轮工具调用；
- 世界书 / 聊天 / Memory / Notes / 自定义工具查询；
- 工具错误反馈与自我修正；
- 最大轮数 / wall-clock 等预算；
- `finalize` 输出 Capsule。

独特优势：**工具自治最强，多 Agent 协调成本最低。**

Agent Loop 不增加 Sub-Agent，否则会侵入 Planner / Director 的边界。

### 3.4 Director · 导演接管（`director`）

定位：**直接接管最终助手消息。**

保留现有能力：

- Main Director；
- Sub-Agent；
- Inline Sub-Agent；
- `dispatch_subagent` / `await_subagents`；
- Draft tools；
- `write_message`；
- message patch；
- 最终提交 / 放弃。

独特优势：**唯一拥有最终回复所有权、可围绕实时草稿协作的模式。**

Director 不变成固定 Pipeline；固定流程属于 Flow。

---

## 4. 最重要的产品边界：Capsule vs Final Reply

统一规则：

```text
Flow      → Capsule → 正常生成链写正文
Planner   → Capsule → 正常生成链写正文
AgentLoop → Capsule → 正常生成链写正文
Director  → 直接拥有最终正文
```

这一规则现在由中央 Mode Registry 的 `output` 元数据表达：

- `capsule`
- `takeover`

只有 Director 是 `takeover`。

UI 的产物标签、Capsule 配置显隐、编辑器顶部公开模式名均以 Registry 为产品真相来源。

---

## 5. Legacy Single 策略

### 5.1 不删除持久化 ID

继续接受：

```text
executionMode = "single"
```

因此旧设置、旧角色卡和旧聊天不会因为升级直接失效。

### 5.2 不再允许作为新一级模式选择

Mode Registry 中：

```text
single:
  selectable: false
  legacy: true
  presetLibrary: false
  output: capsule
```

用户看到的是：

> 旧版单 Agent（兼容模式）

而不是第五张模式卡。

### 5.3 显式迁移，不静默迁移

旧 Single 面板提供：

> 转换为 Flow 快速单节点

迁移顺序：

1. 读取旧 Single System Prompt；
2. 读取旧 Single User Prompt Template；
3. 创建 Flow preset；
4. 写入一 Stage / 一 Worker 的 Flow 配置；
5. 持久化成功；
6. 最后才通过原生 mode select 的 `change` 链切换到 `spec`。

任何失败都不应把旧 Single 留在半迁移状态。

### 5.4 普通 Quick Flow 与 Legacy 转换不同

这是实装阶段明确收紧的语义：

- **Legacy Single 转换**：复制旧 Single 的有效提示词；
- **普通“创建 Flow 快速单节点预设”**：使用出厂默认单节点提示词，不读取隐藏的旧 Single 自定义字段。

这样旧历史配置不会暗中污染新 Flow。

---

## 6. Quick Flow 事务保证

Quick Flow 创建 / Legacy 转换由独立事务 service 负责。

### Global scope

若创建、激活、写入或保存失败：

- 删除新 preset；
- 恢复原 active preset；
- `saveSettings()` 失败时，在内存回滚后再做一次 best-effort 补偿保存。

### Character scope

角色 preset-library 会原地修改：

```text
character.data.extensions.orchestrator
```

因此迁移前会保存**完整 orchestrator extension 快照**。

失败时：

- 恢复完整快照；
- 保留未知/私人字段；
- best-effort 将原快照重新写回角色卡。

成功时：

- pin `override.mode = spec`；
- 设置 `overrideEnabled.spec = true`；
- 保留其他模式 flag；
- 保留其他私人 extension 字段。

若角色作用域没有可写 preset container，则不制造 phantom override，而是恢复角色快照后回退到 Global preset library。

---

## 7. Mode Registry

实现文件：

```text
public/scripts/extensions/orchestrator/execution-mode-registry.js
```

Registry 统一维护：

- 公开名称；
- 描述；
- 心智模型；
- capability label；
- topology；
- agents 形态；
- output ownership；
- 是否使用 preset library；
- 是否 selectable；
- 是否 legacy。

公开 selectable 顺序固定为：

```text
spec
agenda
loop
director
```

`single` 只保留运行兼容。

---

## 8. UI 实现

实现文件：

```text
public/scripts/extensions/orchestrator/execution-mode-ui.js
public/scripts/extensions/orchestrator/execution-mode-product-sync.js
```

### 8.1 四卡模式选择器

旧 `<select>` 不删除，而是隐藏并继续作为已有 `main.js` 模式切换链的兼容桥梁。

四张卡片只负责：

- 展示 Registry 元数据；
- 设置 select value；
- dispatch 原来的 `change` event。

因此没有复制第二套：

- settings 写入；
- workspace 切换；
- skill cache 刷新；
- preset 切换；
- character 模式 pin。

### 8.2 Legacy 面板

当当前真实值为 `single` 时：

- 四张一级模式卡仍只有四张；
- 额外显示 Legacy Single 兼容面板；
- 提供显式转换按钮。

### 8.3 Flow 快速单节点入口

Flow 模式提供：

> 创建 Flow 快速单节点预设

因此“单 Agent 是工作流规模，而不是执行模式”真正落实为产品入口。

### 8.4 DOM Observer 性能边界

Mode picker 和 product sync 都只监听编排相关 DOM 节点。

普通聊天消息新增不会触发 document-wide 模式 UI 扫描。

---

## 9. Runtime 不改写

本功能没有重写：

- `spec-runtime.js`
- `agenda-runtime.js`
- `loop-runtime.js`
- `director-runtime.js`

原因：四套 runtime 已经具有真实不同的执行语义。

重构只改变：

- 产品定义；
- 选择 UI；
- 输出所有权展示；
- Legacy Single 定位；
- Quick Flow 兼容迁移。

---

## 10. 生产依赖边界

Quick Flow 事务核心：

```text
execution-mode-quick-flow.js
```

保持可注入，不静态拉入完整 browser/preset dependency graph。

生产浏览器适配：

```text
execution-mode-quick-flow-browser-deps.js
```

负责注入现有 canonical helper：

- preset CRUD；
- displayed scope；
- current avatar；
- character extension accessor；
- character extension persistence。

入口顺序：

```text
main.js
→ execution-mode-quick-flow-browser-deps.js
→ execution-mode-ui.js
→ execution-mode-product-sync.js
```

因此 UI 操作前生产依赖已经注册完成。

---

## 11. 持久化兼容

本次没有为了改名修改任何已有模式 ID：

```text
spec
agenda
loop
director
single
```

没有强制迁移：

- preset library；
- global / character scope；
- card-first preset；
- chat scoped 数据；
- snapshot / swipe / branch；
- Skills scope；
- portable profile；
- Director takeover 数据。

---

## 12. 验证结果

最终验证在功能代码 SHA：

```text
5dd2dfa17c5db41242845b7c64b6cc225cd7b1eb
```

GitHub Actions targeted regression：

```text
Test Suites: 28 passed, 28 total
Tests:       206 passed, 206 total
Snapshots:   0 total
```

覆盖包括：

- Mode Registry；
- 四卡 picker UI；
- Legacy Single 显示；
- 原生 select change 路由；
- Quick Flow 成功/失败事务；
- Global / Character 迁移；
- 私人 extension 字段保留；
- preset library CRUD / migration / seed；
- preset lifecycle hooks；
- editor state / persistence；
- effective profile；
- character override enable / clear；
- card import custom tools；
- portable custom tools；
- Skills scope / runtime plumbing；
- Spec / Agenda / Loop 独立运行契约；
- Director preset swap；
- 四模式 custom-tool runtime；
- abort mid-run。

用于验证的临时 workflow 已在验证结束后删除，不属于最终功能产物。

---

## 13. 最终改动文件

核心实现：

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

## 14. 当前集成状态

截至本文更新：

- 功能仅在 `feat/execution-mode-redesign`；
- 尚未合并 `custom-release`；
- 未创建上游 PR；
- 未以官方 `release` 重新作为开发基线；
- 四套成熟 runtime 未被重写。

是否合并 `custom-release` 由用户另行明确决定。
