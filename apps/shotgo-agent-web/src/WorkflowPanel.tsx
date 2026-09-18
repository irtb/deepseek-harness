import type {
  CreativeRevisionLifecycleProjection,
  CreativeWorkflowProjection,
  WorkflowStatus,
} from './agent-session.ts'

const labels: Record<WorkflowStatus, string> = {
  pending: '等待',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  'needs-revision': '待修改',
}

const revisionLabels: Record<CreativeRevisionLifecycleProjection['status'], string> = {
  'evaluation-failed': '质量评测未通过',
  'revision-planned': '已生成返修计划',
  'revision-running': '正在自动返修',
  'awaiting-run-start': '等待开始执行',
  blocked: '返修已阻塞',
  completed: '返修已完成',
}

export function WorkflowPanel({
  workflow,
  revision,
}: {
  workflow: CreativeWorkflowProjection | undefined
  revision?: CreativeRevisionLifecycleProjection
}) {
  if (!workflow && !revision) return null
  return (
    <aside className="workflow-panel" aria-label="工作流进度">
      {revision ? (
        <section className={`revision-lifecycle ${revision.status}`} role="status">
          <strong>{revisionLabels[revision.status]}</strong>
          <span>{revision.confirmationRequired ? '本次 Skill Run 仅需一次开始确认' : '非阻塞自动推进'}</span>
        </section>
      ) : null}
      {!workflow ? null : (
        <>
          <header>
            <div>
              <strong>制作流程</strong>
              <span>{workflow.uat?.mode === 'manual' ? '手动模式 · 每个 Skill Run 最多一次开始确认' : workflow.uat?.mode === 'automatic' ? '自动模式 · 正常流程无需确认' : '状态自动同步 · 确认要求以当前授权为准'}</span>
            </div>
            <i className={`workflow-status ${workflow.runStatus}`}>{labels[workflow.runStatus]}</i>
          </header>
          {workflow.uat ? (
            <section aria-label="UAT 质量与交付">
              <p>合成工程验收 · 非真实媒体或业务验收</p>
              <p>{workflow.uat.mode === 'automatic' ? '自动模式' : '手动模式'} · 硬约束 {workflow.uat.hardConstraintCount} 项 · 软偏好 {workflow.uat.softPreferenceCount} 项</p>
              <p>软偏好变更 {workflow.uat.planDiff.length} 项 · 未改变硬约束</p>
              <p>尝试报价：{workflow.uat.cost.quoted ?? '未知'} credits · 实际费用：{workflow.uat.cost.actual ?? '未知'} credits · 剩余额度：{workflow.uat.cost.remaining ?? '未知'} credits</p>
              {workflow.uat.cost.authority ? <p>合成账本 · 观察时间 {workflow.uat.cost.authority.observedAt}
                {' · 预算快照 '}{workflow.uat.cost.authority.budgetRef}</p> : null}
              {workflow.uat.details ? <section aria-label="计划与返修追溯">
                <p>Brief {workflow.uat.details.briefRef} · Plan {workflow.uat.details.planRef}</p>
                <p>开始 {workflow.uat.details.startedAt} · 完成 {workflow.uat.details.completedAt ?? '尚未完成'} · 已记录耗时 {workflow.uat.details.elapsedMs === null ? '未知' : `${workflow.uat.details.elapsedMs} ms`}</p>
                <p>停止原因：{workflow.uat.details.stopReason === 'none' ? '无' : workflow.uat.details.stopReason === 'quality-failed' ? '质量未通过' : workflow.uat.details.stopReason === 'cancelled' ? '已取消' : '执行已停止'}</p>
                <p>局部返修 {workflow.uat.details.repairRunRefs.length} 次 · {workflow.uat.details.repairRunRefs.join(' · ') || '暂无返修记录'}</p>
                <details><summary>约束与变更摘要（不含输入正文）</summary>
                  <ul>{workflow.uat.details.hardConstraintDigests.map((digest, i) => <li key={`hard-${i}`}>硬约束 {i + 1} · {digest}</li>)}</ul>
                  <ul>{workflow.uat.details.softPreferenceDigests.map((digest, i) => <li key={`soft-${i}`}>软偏好 {i + 1} · {digest}</li>)}</ul>
                  <ul>{workflow.uat.planDiff.map((row, i) => <li key={`diff-${i}`}>移除软偏好 · {row.valueDigest}</li>)}</ul>
                  <ul>{workflow.uat.details.gateVersions.map(row => <li key={row.gateId}>{row.gateId} 评测版本 · {row.version ?? '未知'}</li>)}</ul>
                </details>
              </section> : null}
              <ul>{workflow.uat.gates.map(gate => <li key={gate.gateId}>{gate.gateId}：{gate.status === 'passed' ? '通过' : gate.status === 'failed' ? '未通过' : gate.status === 'inconclusive' ? '无法判定' : '缺少证据'}</li>)}</ul>
              <p role="status">{workflow.uat.delivery.status === 'ready' ? '合成交付证据完整' : '交付证据不完整，不可交付'}</p>
              {workflow.uat.delivery.status === 'ready' ? <p>交付证据摘要 · {workflow.uat.delivery.digest}</p> : null}
            </section>
          ) : <p>UAT 质量与交付证据不可用；流程完成不代表可交付。</p>}
          <ol>
            {workflow.stages.map((stage, index) => (
              <li key={stage.id} className={`workflow-stage ${stage.status}`}>
                <div className="workflow-stage__head">
                  <b>{index + 1}</b>
                  <strong>{stage.title}</strong>
                  <span>{labels[stage.status]}</span>
                </div>
                <ul>
                  {stage.actions.map(action => (
                    <li key={action.id}>
                      <span className={`action-dot ${action.status}`} />
                      <span>{action.title}</span>
                      <em>
                        {labels[action.status]}
                        {action.attemptCount > 1 ? ` · 第 ${action.attemptCount} 次尝试` : ''}
                      </em>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {workflow.artifacts.length === 0 ? null : (
            <section className="workflow-artifacts" aria-label="产物看板">
              <h3>产物</h3>
              <div>
                {workflow.artifacts.map(artifact => (
                  <article key={artifact.id}>
                    <span>
                      {artifact.kind === 'video'
                        ? '视频'
                        : artifact.kind === 'image'
                          ? '图片'
                          : artifact.kind === 'audio'
                            ? '音频'
                            : artifact.kind === 'report'
                              ? '报告'
                              : '文件'}
                    </span>
                    <strong>{artifact.id}</strong>
                    <em>
                      {artifact.status === 'available'
                        ? '可用'
                        : artifact.status === 'approved'
                          ? '已通过'
                          : artifact.status === 'revision-required'
                            ? '待修改'
                            : artifact.status === 'rejected'
                              ? '已拒绝'
                              : '已失效'}
                    </em>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </aside>
  )
}
