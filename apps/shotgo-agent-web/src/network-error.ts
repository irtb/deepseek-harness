export function isAbortError(cause: unknown): boolean {
  return (cause instanceof DOMException || cause instanceof Error) && cause.name === 'AbortError'
}

export function isNetworkFailure(cause: unknown): boolean {
  if (!(cause instanceof TypeError) && !(cause instanceof Error)) return false
  if (isAbortError(cause)) return false
  const message = cause.message
  return (
    message === 'Failed to fetch' ||
    message === 'Load failed' ||
    message === 'NetworkError when attempting to fetch resource.' ||
    /failed to fetch/i.test(message)
  )
}

export function gatewayUnreachableMessage(gatewayBaseUrl: string, pageOrigin?: string): string {
  const origin = pageOrigin ?? (typeof window === 'undefined' ? undefined : window.location.origin)
  if (origin !== undefined && gatewayBaseUrl === origin) {
    return '无法连接本机 Agent 网关。请先启动 3012 上的 Gateway（开发态 /api/agent 会代理到该端口）。'
  }
  return `无法连接 Agent 网关（${gatewayBaseUrl}）。请确认 Gateway 已启动，且浏览器不要跨源直连。`
}

export function apiUnreachableMessage(): string {
  return '当前无法连接服务。请检查网络后重试。'
}

export function gatewayStatusMessage(status: number, code: string | undefined, fallback: string): string {
  if (code === 'AGENT_TRAFFIC_DISABLED') return 'Agent 网关已启动，但流量开关关闭，无法发送。'
  if (code === 'ORIGIN_NOT_ALLOWED') return '当前页面来源未被 Agent 网关允许。本机请把 Gateway 的 SHOTGO_CANVAS_ORIGIN 设为 http://localhost:3011。'
  if (code === 'CREATIVE_RUN_ADMISSION_UNAVAILABLE') return '当前工作台走普通图/视频生成，不经过 Creative Project 准入。请刷新后再发送。'
  if (code === 'SESSION_BUSY') return '上一轮还占着会话。已为你开新会话，请再发送一次。'
  if (code === 'GENERATION_CONTEXT_INVALID') return '参考素材或生成参数不被当前网关接受。请确认已选参考素材后重试。'
  if (code !== undefined && code.length > 0) return code
  if (status === 502 || status === 504 || status === 500) {
    return 'Agent 网关未就绪。本机请确认 3012 正在监听。'
  }
  if (status === 503) return 'Agent 网关未就绪（503）。'
  return fallback
}

/** Client lost the Gateway stream; the paid Run must stay hung, never resubmitted. */
export function connectionInterruptedMessage(detail?: string): string {
  const base =
    '连接已中断。服务端生成任务不会因此取消或重提；网络恢复后将自动重连，也可点「恢复原任务连接」。'
  if (detail === undefined || detail.length === 0) return base
  if (detail.includes('不会因此取消') || detail.includes('任务未重新提交')) return detail
  if (detail.includes('无法连接') || detail.includes('网络已断开') || detail.includes('连接')) {
    return detail.includes('不会取消') || detail.includes('不会因此取消')
      ? detail
      : `${detail} 服务端任务不会取消；恢复后可继续查看进度。`
  }
  return `${base}（${detail}）`
}

/** Send failed before the Gateway accepted a Run — nothing to hang or resume. */
export function sendBlockedOfflineMessage(detail?: string): string {
  const base = '当前无法连接 Agent。请检查网络或本机 Gateway（3012）后重试。尚未创建生成任务，不会扣费。'
  if (detail === undefined || detail.length === 0) return base
  if (detail.includes('尚未创建生成任务')) return detail
  if (detail.includes('无法连接') || detail.includes('网络已断开')) {
    return detail.includes('不会扣费') ? detail : `${detail} 尚未创建生成任务，不会扣费。`
  }
  return base
}

/** Default connect budget when network/Gateway/proxy hangs instead of failing fast. */
export const GATEWAY_CONNECT_TIMEOUT_MS = 12_000
export const API_CONNECT_TIMEOUT_MS = 12_000

function requestOrigin(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return new URL(input, typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin).origin
  }
  if (input instanceof URL) return input.origin
  return new URL(input.url).origin
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 0) return new AbortController().signal
  const only = signals[0]
  if (signals.length === 1 && only) return only
  const anyFn = (AbortSignal as unknown as { any?: (input: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === 'function') return anyFn(signals)
  const controller = new AbortController()
  const forward = () => controller.abort()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', forward, { once: true })
  }
  return controller.signal
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Fetch with a connect timeout. Timer is cleared once headers arrive so SSE bodies can
 * run long; the caller signal still cancels the in-flight body.
 */
export async function fetchWithConnectTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number; unreachableMessage?: string },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? GATEWAY_CONNECT_TIMEOUT_MS
  const connectController = new AbortController()
  let timedOut = false
  const timer =
    timeoutMs > 0
      ? window.setTimeout(() => {
        timedOut = true
        connectController.abort()
      }, timeoutMs)
      : undefined
  const signal = mergeAbortSignals([
    connectController.signal,
    ...(init?.signal ? [init.signal] : []),
  ])
  try {
    const response = await fetch(input, { ...init, signal })
    if (timer !== undefined) window.clearTimeout(timer)
    return response
  } catch (cause) {
    if (init?.signal?.aborted) throw cause
    if (timedOut || isAbortError(cause) || isNetworkFailure(cause)) {
      throw new Error(
        options?.unreachableMessage
          ?? gatewayUnreachableMessage(requestOrigin(input).replace(/\/$/, '')),
      )
    }
    throw cause
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export async function gatewayFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number },
): Promise<Response> {
  return fetchWithConnectTimeout(input, init, {
    timeoutMs: options?.timeoutMs ?? GATEWAY_CONNECT_TIMEOUT_MS,
    unreachableMessage: gatewayUnreachableMessage(requestOrigin(input).replace(/\/$/, '')),
  })
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number },
): Promise<Response> {
  return fetchWithConnectTimeout(input, init, {
    timeoutMs: options?.timeoutMs ?? API_CONNECT_TIMEOUT_MS,
    unreachableMessage: apiUnreachableMessage(),
  })
}
