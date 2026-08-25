# Agent Note: ShotGo 幂等生成提交

Status: implemented

[English](2026-08-25-shotgo-idempotent-generation-submit.md) | 中文

## 问题

一次已批准的生成可能因浏览器、Gateway、HTTP、队列或进程故障发生重试。重试不得重复扣费、创建两个任务、调用供应商两次，也不得让不同参数静默复用同一个 Key。

## 决策

只有 Harness 单次批准门禁通过后，`generation_submit` 才接收 opaque Quote 与可信 Session 写上下文。Gateway 根据 Session 和 Quote 派生稳定的 64 字符 `clientRequestId`，同时写入 `Idempotency-Key` 和 `context.clientRequestId`。

Laravel 重新验证 Capability Grant、授权上下文、报价有效期、规范化参数、当前价格指纹、模型、供应商、存储配额与积分余额。在同一个数据库事务中，它先占用现有的 `(user_id, client_request_id)` 请求日志唯一键，再扣积分并关联扣费流水，仅在事务提交后派发任务。相同指纹重放已有日志；指纹变化则返回冲突。Worker 原子认领 `queued → processing`，供应商凭据根据请求日志冻结的可空 `team_id` 解析，不读取用户之后切换的 active team。

## 考虑过的替代方案

先扣费再占用请求 Key 不可接受，因为并发重试可能都先扣费，之后才由其中一个插入输掉唯一键竞争。每次 Tool 执行生成随机 Key 也不可接受，因为传输或进程重试会变成无法识别的新购买。无需新增幂等表，因为现有请求日志唯一索引已经提供所需的占位边界。

## 影响

本阶段复用现有请求日志唯一索引，不需要数据库迁移。当前创建响应返回稳定的生成与操作标识、状态、扣除积分、余额和重放标记。状态、取消和资产投影仍属于后续独立阶段。
