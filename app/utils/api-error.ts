// What $fetch rejects with when an API fails: `data` is the body built by createError on the server.
export interface ApiFailure {
  statusCode?: number
  response?: { status?: number }
  data?: { statusMessage?: string }
}

export function apiErrorMessage(cause: unknown, fallback: string): string {
  return (cause as ApiFailure | null | undefined)?.data?.statusMessage || fallback
}
