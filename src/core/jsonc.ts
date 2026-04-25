function stripComments(value: string): string {
  let result = ''
  let inString = false
  let isEscaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]
    const next = value[index + 1]

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false
        result += current
      }
      continue
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (!inString && current === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (!inString && current === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    result += current

    if (current === '"' && !isEscaped) {
      inString = !inString
    }

    isEscaped = current === '\\' && !isEscaped
    if (current !== '\\') {
      isEscaped = false
    }
  }

  return result
}

function stripTrailingCommas(value: string): string {
  let result = ''
  let inString = false
  let isEscaped = false

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]

    if (!inString && current === ',') {
      let lookahead = index + 1
      while (lookahead < value.length && /\s/.test(value[lookahead] ?? '')) {
        lookahead += 1
      }

      const next = value[lookahead]
      if (next === '}' || next === ']') {
        continue
      }
    }

    result += current

    if (current === '"' && !isEscaped) {
      inString = !inString
    }

    isEscaped = current === '\\' && !isEscaped
    if (current !== '\\') {
      isEscaped = false
    }
  }

  return result
}

export function parseJsonc<T>(value: string, filePath: string): T {
  const sanitized = stripTrailingCommas(stripComments(value))

  try {
    return JSON.parse(sanitized) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSONC file ${filePath}: ${message}`)
  }
}
