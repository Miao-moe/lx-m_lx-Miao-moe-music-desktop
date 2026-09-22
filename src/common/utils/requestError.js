export const withRequestMessage = (cause, message) => {
  const error = new Error(message, { cause })
  for (const key of ['code', 'errno', 'syscall', 'statusCode', 'retryable', 'retryAfterMs', 'stopSearchFallback', 'kind', 'source']) {
    if (cause?.[key] != null) error[key] = cause[key]
  }
  return error
}
