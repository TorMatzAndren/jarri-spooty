export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitize(error.message);
  }

  if (typeof error === 'string') {
    return sanitize(error);
  }

  return 'Unknown error';
}

function sanitize(text: string): string {
  return text
    .replace(/\/home\/[^\s]+/g, '[path]')
    .replace(/\/root\/[^\s]+/g, '[path]')
    .replace(/token=[^\s&]+/gi, 'token=[redacted]')
    .replace(/authorization:[^\n]+/gi, 'authorization:[redacted]')
    .slice(0, 500);
}
