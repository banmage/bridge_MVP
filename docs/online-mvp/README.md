# 联网 MVP 交付文档包

**版本**: v1.2  
**基线日期**: 2026-11-01（CR-006/007/008 于 2026-11-02 补充）  
**状态**: 已评审（需求、设计、编码规范、测试与发布门禁）  
**适用特性**: `specs/001-online-pair-game/`（联网双人赛与贴点制对局，一期）

本目录是联网 MVP 的“可交付、可评审、可运维”文档基线。需求与协议的单一事实来源仍是
`specs/001-online-pair-game/` 下的 spec/plan/contracts；本目录负责把技术负责人视角的
范围、计划、设计、规范、评审与验收结论固定下来。

## 文档地图

| 文档 | 用途 | 主要读者 |
|------|------|----------|
| [01-需求规格说明书.md](./01-需求规格说明书.md) | 范围、角色、功能/非功能需求、验收标准、追踪矩阵 | 产品、开发、测试 |
| [02-项目计划.md](./02-项目计划.md) | WBS、里程碑、质量门禁、风险、发布计划 | 项目负责人、全体 |
| [03-系统设计说明书.md](./03-系统设计说明书.md) | 架构、模块、协议、状态机、视角隔离、部署 | 开发、运维 |
| [04-编码规范.md](./04-编码规范.md) | TypeScript/Vue/Node 规范、测试与评审清单 | 开发 |
| [05-评审记录.md](./05-评审记录.md) | 需求/设计/代码/测试评审结论与变更单 | 全体 |
| [06-测试与验收计划.md](./06-测试与验收计划.md) | 测试分层、用例、回归与发布检查 | 测试、开发 |
| [07-运行手册.md](./07-运行手册.md) | 部署、配置、监控、故障处理、回滚 | 运维、值班 |

## 相关基线

- 需求与验收：[`spec.md`](../../specs/001-online-pair-game/spec.md)
- 技术方案与宪法检查：[`plan.md`](../../specs/001-online-pair-game/plan.md)
- 数据模型：[`data-model.md`](../../specs/001-online-pair-game/data-model.md)
- 协议契约：[`contracts/protocol.md`](../../specs/001-online-pair-game/contracts/protocol.md)
- HTTP 契约：[`contracts/http-api.md`](../../specs/001-online-pair-game/contracts/http-api.md)
- 任务清单：[`tasks.md`](../../specs/001-online-pair-game/tasks.md)
- 本地联调：[`quickstart.md`](../../specs/001-online-pair-game/quickstart.md)
- 玩法与部署（用户向）：[`../联网对战.md`](../联网对战.md)

## 版本策略

- 文档版本与代码提交同步递增；需求变更必须走 `05-评审记录.md` 的 CR 流程。
- 协议不兼容变更时递增 `PROTOCOL_VERSION`，并同步协议契约、客户端与服务端。
- 发布前必须满足 `06-测试与验收计划.md` 的发布门禁。
