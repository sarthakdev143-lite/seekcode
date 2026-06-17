export function isValidPrompt(prompt: string): boolean {
  return prompt.trim().length > 0;
}

export function isValidSessionId(id: string | null): boolean {
  return !!id && id.length > 0;
}
