# Luker 执行模式重构方案

> 状态：方案已拍板，待实现
>
> 开发基线：`custom-release@112baa3b5f2ad1109a0b143bcffa3d39ec8dc470`
>
> 功能分支：`feat/execution-mode-redesign`

## 1. 背景

当前多智能体编排对外暴露 5 种执行模式：

- `spec`
- `single`
- `agenda`
- `loop`
- `director`

它们在能力和 UI 心智模型上存在明显重叠，尤其是：

- `single` 与单节点 `spec` 本质重叠；
- `agenda` 与 `spec` 都属于“多 Agent 先编排，再输出 Capsule”；
- `loop` 与 `single` 都表现为单 Agent，但运行哲学完全不同；
- `director` 与 `agenda` 都可动态调用 Agent，但 `director` 实际拥有最终正文控制权。

本次重构目标不是删除成熟能力，而是重新定义模式边界，让每个模式都拥有不可替代的优势，并让用户一眼理解“我为什么要选它”。

---

## 2. 最终模式模型

公开执行模式从 5 种收敛为 4 种：

| 新名称 | 内部兼容 ID | 核心定位 | 最终产物 |
| --- | --- | --- | --- |
| 流程编排 Flow | `spec` | 用户定义固定工作流 | 编排建议 Capsule |
| 动态调度 Planner | `agenda` | AI Planner 动态决定调用哪些 Agent | 编排建议 Capsule |
| 自治循环 Agent Loop | `loop` | 单 Agent 连续调用工具自主完成任务 | 编排建议 Capsule |
| 导演接管 Director | `director` | 主 Agent 接管最终正文并动态调用子 Agent | 最终正文 |

原 `single` 不再作为一级公开执行模式。

它的能力保留为：

> **流程编排 Flow → 快速单节点模板**

`single` 仍保留 Legacy 兼容路径，用于读取和运行旧配置，但新 UI 不再将其作为推荐模式。

---

## 3. 四种模式的唯一价值

### 3.1 流程编排 Flow

原内部模式：`spec`

一句话定义：

> **我决定流程。**

适用于用户已经知道任务应如何分阶段完成的情况。

核心能力：

- 多 Stage；
- Stage 串行 / 并行；
- Worker；
- Review；
- Review 定向返工；
- 节点级模型 / Prompt Preset；
- 节点级 Tools / Skills；
- 稳定、可复现的固定拓扑。

独特优势：

> **确定性、可复现性和质量门控最强。**

Flow 不负责动态决定“本轮是否需要某个 Agent”。如果用户需要运行时动态选择 Agent，应使用 Planner。

---

### 3.2 动态调度 Planner

原内部模式：`agenda`

一句话定义：

> **AI 决定用哪些专家。**

用户提供 Agent 团队和 Planner，由 Planner 在运行时根据当前任务维护 TODO、选择 Agent、控制调用次数并决定何时结束。

核心能力：

- Planner；
- TODO；
- 动态 Dispatch；
- Agent Pool；
- 最大 Planner 轮数；
- 最大并发 Agent；
- 最大总 Agent Runs；
- Final Agent 汇总。

独特优势：

> **多智能体适应性最强。**

简单任务可以只调用少量 Agent，复杂任务可以自动扩大分析范围。

Planner 不直接写最终正文，其最终产物仍然是 Capsule。

---

### 3.3 自治循环 Agent Loop

原内部模式：`loop`

一句话定义：

> **一个 Agent 自己查到搞定。**

没有 Planner，没有固定多 Agent Pipeline，也没有下属 Agent。

Agent 在同一运行上下文中连续执行：

`LLM → Tool → Result → LLM → ... → finalize`

核心能力：

- 单 Agent；
- 多轮工具调用；
- 聊天记录 / 世界书 / Memory / Notes / 插件工具查询；
- 结构化工具错误反馈；
- 自我纠错；
- 最大轮数 / wall-clock / no-tool-call-streak 等预算；
- `finalize` 输出 Capsule。

独特优势：

> **工具自治能力最强，同时多 Agent 协调成本最低。**

Agent Loop 不应增加 Sub-Agent 能力，否则会侵入 Planner / Director 的职责范围。

---

### 3.4 导演接管 Director

内部模式：`director`

一句话定义：

> **AI 团队直接把正文写完。**

Director 与其他三个模式最重要的区别是：

> **它不是生成编排建议，而是直接拥有最终正文。**

核心能力：

- Main Director；
- 配置好的 Sub-Agent；
- Inline Sub-Agent；
- `dispatch_subagent` / `await_subagents`；
- Tools / Skills；
- `get_draft` / draft search；
- `write_message`；
- message patch；
- `finalize` 直接提交正文。

独特优势：

> **唯一拥有最终回复所有权、可围绕实时草稿协作的模式。**

Director 不应演化成固定 Pipeline 编辑器。需要明确固定步骤时应使用 Flow。

---

## 4. 为什么移除 Single 一级模式

当前 `single` 没有独立的执行哲学。

其本质等价于：

- 一个 Stage；
- 一个 Worker Node；
- 串行执行；
- 两个单独 Prompt 字段。

这完全属于 Flow 可以表达的范围。

因此：

> **“单 Agent”是工作流规模，不是执行模式。**

继续把 `single` 放在执行模式列表里，只会制造：

- `Single` 与 `Loop` 的命名混淆；
- 特殊 Prompt UI；
- 特殊 preset 行为；
- 特殊显隐逻辑；
- 长期维护分支。

---

## 5. Single 的兼容策略

禁止升级时静默迁移旧配置。

内部继续接受：

```text
executionMode = "single"
```

旧配置显示为：

> **旧版单 Agent（兼容模式）**

并提供显式操作：

> **转换为「流程编排 · 快速单节点」**

转换流程：

1. 读取旧 Single System Prompt；
2. 读取旧 Single User Prompt Template；
3. 创建等价的 Flow 单节点配置；
4. 确认保存成功；
5. 再切换执行模式。

不得因为版本升级或角色切换自动迁移。

---

## 6. 内部模式 ID 保持不变

本次重构不为了改名而破坏持久化协议。

继续保留：

```text
spec
agenda
loop
director
single
```

其中：

```text
single = legacy only
```

新 UI 只允许新建 / 主动切换到：

```text
spec
agenda
loop
director
```

这样可以尽量避免对以下内容进行无意义迁移：

- preset library；
- 角色卡绑定；
- 全局预设；
- chat scoped 数据；
- snapshot / swipe / branch 状态；
- Skills 作用域；
- portable profile 导入导出。

---

## 7. UI 设计原则

执行模式不再只用裸下拉框展示。

推荐使用四张清晰的模式卡，并在标题旁永久显示最终产物类型。

### Flow

**固定流程 · 精确控制**

> 按你设计好的 Stage / Agent / Review 工作流稳定执行。

标签：

`固定拓扑` `可并行` `可 Review` `输出 Capsule`

### Planner

**动态专家团队 · 按需调用**

> Planner 根据当前任务决定调用哪些 Agent，以及调用多少次。

标签：

`动态拓扑` `多 Agent` `TODO` `输出 Capsule`

### Agent Loop

**单 Agent · 深度工具自治**

> 一个 Agent 连续查询聊天、世界书、记忆和工具，直到完成任务。

标签：

`单 Agent` `工具循环` `低协调开销` `输出 Capsule`

### Director

**动态创作团队 · 直接生成正文**

> Director 直接编写和修改最终回复，并按需调用 Sub-Agent。

标签：

`动态拓扑` `Sub-Agent` `实时草稿` `直接正文`

### 产物类型必须显式展示

- Flow：`产物：编排建议`
- Planner：`产物：编排建议`
- Agent Loop：`产物：编排建议`
- Director：`产物：最终正文`

这是整个 UI 重构的最高优先级信息之一。

---

## 8. 模式工作区必须隔离

### Flow 工作区

只展示与固定工作流有关的内容：

- Workflow；
- Stage；
- Worker；
- Review；
- 串行 / 并行；
- 节点模型 / Preset；
- 节点 Tools / Skills；
- Review / Rerun 参数。

### Planner 工作区

只展示动态调度相关内容：

- Planner；
- Agent Pool；
- Final Agent；
- Planner 最大轮数；
- 最大并发 Agent；
- 最大 Agent Runs；
- Agent Tools / Skills。

### Agent Loop 工作区

只展示单 Agent 自治相关内容：

- Agent Prompt；
- Agent 模型 / Preset；
- Tools；
- Skills；
- 最大轮数；
- Wall-clock Budget；
- Finalize 行为。

### Director 工作区

只展示正文接管相关内容：

- Main Director；
- Sub-Agents；
- Inline Sub-Agent；
- Tools / Skills；
- Draft Tools；
- Message Write / Patch；
- Director Budget。

---

## 9. 公共能力保持统一

以下能力不是“模式”，不能因重构复制出四套实现：

- API Preset 解析；
- Prompt Preset 解析；
- Character-first / Card-first 解析；
- 世界书上下文；
- Memory / Layer-2 tools；
- Custom Tools；
- Skills；
- Run State；
- Abort；
- Trace；
- Preset Scope；
- Character / Global Scope；
- Import / Export；
- Snapshot / Branch / Swipe 绑定。

模式只负责回答：

> **任务如何被组织和完成？**

---

## 10. 新增统一 Mode Registry

建议新增统一的执行模式元数据源，避免 UI 和业务代码继续散落大量：

```text
if spec ...
if agenda ...
if loop ...
if director ...
if single ...
```

概念结构：

```text
Flow
id: spec
selectable: true
topology: fixed
agents: multi
output: capsule
presetLibrary: true

Planner
id: agenda
selectable: true
topology: dynamic
agents: multi
output: capsule
presetLibrary: true

Agent Loop
id: loop
selectable: true
topology: autonomous-single
agents: single
output: capsule
presetLibrary: true

Director
id: director
selectable: true
topology: dynamic-hierarchical
agents: main+subagents
output: takeover
presetLibrary: true

Legacy Single
id: single
selectable: false
legacy: true
output: capsule
presetLibrary: false
```

UI 显隐、标签、帮助文本、是否可新建等逻辑应优先从 Registry 能力读取。

---

## 11. 不重写成熟 Runtime

本次重构不应为了形式统一而重写：

- `spec-runtime.js`
- `agenda-runtime.js`
- `loop-runtime.js`
- `director-runtime.js`

这四套 runtime 已经具有真实不同的执行语义。

本次主要重构目标：

1. 模式定义；
2. 模式选择 UI；
3. 模式说明；
4. Single 产品定位；
5. Mode capability registry；
6. Workspace 显隐逻辑；
7. Legacy Single 兼容；
8. Flow 快速单节点模板。

---

## 12. 四模式不可替代性检查

| 能力 | Flow | Planner | Agent Loop | Director |
| --- | ---: | ---: | ---: | ---: |
| 用户固定执行顺序 | ★★★★★ | ★ | ★ | ★ |
| 动态决定调用哪些专家 | ★ | ★★★★★ | — | ★★★★ |
| 单 Agent 连续工具探索 | ★★ | ★★ | ★★★★★ | ★★★ |
| Review / 定点返工 | ★★★★★ | ★★ | ★ | ★★★ |
| 低多 Agent 协调开销 | ★★ | ★★★ | ★★★★★ | ★ |
| 每轮自适应复杂度 | ★★ | ★★★★★ | ★★★★ | ★★★★★ |
| 保留正常正文生成链 | ★★★★★ | ★★★★★ | ★★★★★ | — |
| 直接控制最终正文 | — | — | — | ★★★★★ |
| 实时围绕草稿协作 | — | — | — | ★★★★★ |

今后新增新的“执行模式”时，必须证明它拥有现有四种模式无法覆盖的新优势区域。

否则它应该被实现为：

- 模板；
- 预设；
- 能力开关；
- Agent 配置；
- 工具能力；

而不是新的执行模式。

---

## 13. 用户心智模型

用户最终只需要记住四句话：

- **Flow：我决定流程。**
- **Planner：AI 决定用哪些专家。**
- **Agent Loop：一个 Agent 自己查到搞定。**
- **Director：AI 团队直接把正文写完。**

如果模式选择 UI 无法在很短时间内让新用户理解这四个区别，则视为设计失败。

---

## 14. 不提供“自动模式”

不新增自动选择执行模式的上层 Meta Mode。

原因：

Flow / Planner / Loop 与 Director 之间不仅是调度策略不同，还涉及“谁拥有最终正文”的根本差异。

自动在 Capsule 模式和 Director takeover 之间切换会造成行为不可预测。

执行模式必须保持显式选择。

---

## 15. 兼容性红线

实现过程中不得破坏 `custom-release` 已有私人行为，包括但不限于：

1. 角色卡 / 全局编排预设作用域；
2. preset library；
3. card-first 模型 / Prompt Preset 解析；
4. Skills 绑定；
5. Custom Tools；
6. Layer-2 Tools；
7. Snapshot / Swipe / Branch 绑定；
8. Abort；
9. Run State / Trace；
10. Agenda chat override；
11. portable profile 导入导出；
12. Director takeover；
13. Android WebView 与 Web 共用的编排逻辑。

不得为了 UI 改名而随意修改持久化格式。

不得自动删除旧 `single` 数据。

---

## 16. 推荐实施顺序

### 阶段一：模式模型

- 建立 Mode Registry；
- 四个公开模式；
- Single 标记 Legacy；
- 内部模式 ID 保持不变。

### 阶段二：模式选择 UI

- 用清晰的模式选择器 / 模式卡替代难理解的裸模式选择；
- 显示“产物类型”；
- 显示一句话定位；
- 仅展示当前模式相关配置。

### 阶段三：Single 收编

- 新增 Flow「快速单节点」模板；
- Legacy Single 继续正常运行；
- 提供显式转换；
- 禁止静默迁移。

### 阶段四：清理重复 UI 与条件分支

- 移除新建 Single 的一级入口；
- 清理不必要的模式特殊判断；
- 优先从 Mode Registry 控制 UI capability。

### 阶段五：回归验证

重点验证：

- 四种 runtime 的核心行为与重构前保持一致；
- Legacy Single 仍能运行；
- Flow 快速单节点与旧 Single 行为等价；
- 全局预设正常；
- 角色卡预设正常；
- 角色切换正常；
- 聊天切换正常；
- 导入导出正常；
- Skills / Tools scope 正常；
- Director takeover 正常；
- swipe / regenerate / continue 正常；
- Abort 正常。

---

## 17. 最终拍板

公开执行模式固定为四种：

### 流程编排 Flow

固定工作流，优势是：

> **确定性与质量门控。**

### 动态调度 Planner

动态多智能体，优势是：

> **按任务自适应调度。**

### 自治循环 Agent Loop

单 Agent 工具自治，优势是：

> **低协调成本的深度工具探索。**

### 导演接管 Director

直接控制最终正文，优势是：

> **端到端动态创作与实时草稿协作。**

原 Single 不再作为一级执行模式。

其能力保留为：

> **Flow · 快速单节点模板**

旧 `single` 数据保留兼容运行路径，不静默迁移。

本方案作为 `feat/execution-mode-redesign` 后续实现、测试和评审的设计基准。
