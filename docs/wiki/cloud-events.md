> 摘要：本页维护 JCGO 云比赛公开赛事与“我的比赛”数据流、外部接口边界和请求控制约定。

# 云比赛

## 页面职责

`CloudEventsPage` 展示杭州公开赛事和当前账号的云比赛报名。公开赛事由前端调用云比赛公开接口加载；“我的比赛”由 JCGO 后端完成扫码授权、凭证持有、订单过滤和赛事详情适配，前端只接收脱敏领域模型。

云比赛 token、Cookie、扫码流程中的 openId/sCode/sceneId/key 只存在后端或后端内存流程中，不进入前端资源、URL、RPC 结果或普通日志。

## 我的比赛详情数据流

赛事基础详情通过 `yunbisai.myEventDetail` 按订单号加载。取得赛事 ID 后，前端调用一次 `yunbisai.eventGroups`，后端访问：

```text
GET https://data-center.yunbisai.com/api/lswl-groups/event/{eventId}
```

该接口返回赛事全部组别、组别 ID、人数和比赛时间。报名棋手的组别来自服务器返回的赛事详情，前端仅据此计算“我的组别”展示高亮，不重新实现云比赛业务规则。

点击组别后，前端按需调用 `yunbisai.groupPairings`，后端访问：

```text
GET https://api.yunbisai.com/request/group/againstplan?groupid={groupId}&bout={bout}
```

省略 `bout` 时读取接口返回的最后一轮；返回的 `lastbout` 和 `total_bout` 是轮次导航的权威值。后端解包 JSONP，并把台号、双方棋手、队伍、结果和得分转换为前端安全模型。

对阵响应同时提供双方的当前累计积分（`p1_integral`/`p2_integral`）。后端将其转换为 `totalScore`，前端在每位棋手信息中显示“当前总分”，并显示同台对手的“对手当前总分”。这不是跨所有历史轮次计算的标准对手分。

## 请求约定

- 赛事详情只加载一次组别列表。
- 进入组别才加载当前轮，不预加载其他组别或轮次。
- 上一轮/下一轮只请求目标轮次；当前面板已访问的组别和轮次使用前端缓存。
- 不请求独立的成绩/名次表接口。
- 当前对阵总分和对手当前总分复用同一次对阵请求，不新增成绩请求。
- 组别或对阵请求失败时，只重试对应的局部请求，保留已加载的赛事基础详情。

订单或赛事详情接口返回未登录、401 或 403 时，后端保留授权文件并标记会话失效，状态检查不再使用该凭证；用户主动退出时才清理授权文件，重新登录会覆盖旧状态。

## 来源

- 赛事组别与对阵功能设计：`docs/scope/2026-08-19-yunbisai-event-brackets/spec-yunbisai-event-brackets.md`
- 当前前端入口：`web/src/components/CloudEventsPage.tsx`
- 当前云比赛面板：`web/src/components/YunbisaiMyEventsPanel.tsx`
