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

export function gatewayStatusMessage(status: number, code: string | undefined, fallback: string): string {
  if (code === 'AGENT_TRAFFIC_DISABLED') return 'Agent 网关已启动，但流量开关关闭，无法发送。'
  if (code === 'ORIGIN_NOT_ALLOWED') return '当前页面来源未被 Agent 网关允许。本机请把 Gateway 的 SHOTGO_CANVAS_ORIGIN 设为 http://localhost:3011。'
  if (code === 'CREATIVE_RUN_ADMISSION_UNAVAILABLE') return '当前工作台走普通图/视频生成，不经过 Creative Project 准入。请刷新后再发送。'
  if (code !== undefined && code.length > 0) return code
  if (status === 502 || status === 504 || status === 500) {
    return 'Agent 网关未就绪。本机请确认 3012 正在监听。'
  }
  if (status === 503) return 'Agent 网关未就绪（503）。'
  return fallback
}

export async function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (cause) {
    if (isAbortError(cause)) throw cause
    if (isNetworkFailure(cause)) {
      const base =
        typeof input === 'string'
          ? new URL(input, typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin).origin
          : input instanceof URL
            ? input.origin
            : new URL(input.url).origin
      throw new Error(gatewayUnreachableMessage(base.replace(/\/$/, '')))
    }
    throw cause
  }
}
