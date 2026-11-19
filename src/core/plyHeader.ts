import { PLY_HEADER_LIMIT } from './plyLimits';

/** Latin-1 header indices are byte offsets. Keep recognition and payload offsets shared. */
export function plyHeaderBoundary(text: string): { headerEnd: number; bodyStart: number } | null {
  // Prefer CRLF over legacy bare CR. A CR at the prefix edge is ambiguous until
  // the next byte is available; never misclassify a split CRLF as payload.
  const match = /(?:^|\n)end_header[ \t]*(?:\r\n|\n|\r(?=[^\n]))/.exec(text.slice(0, PLY_HEADER_LIMIT));
  if (!match) return null;
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  return { headerEnd: start + 'end_header'.length, bodyStart: match.index + match[0].length };
}
