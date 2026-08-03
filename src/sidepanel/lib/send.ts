import type { Request, Response } from '@/background/messages'

export async function send(request: Request): Promise<Response> {
  return (await chrome.runtime.sendMessage(request)) as Response
}
