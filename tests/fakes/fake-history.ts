import type { HistoryApi, HistoryVisit } from '@/core/ports'

export interface FakeHistory {
  api: HistoryApi
}

export function createFakeHistory(initial: HistoryVisit[] = []): FakeHistory {
  return {
    api: {
      async search() {
        return [...initial]
      },
    },
  }
}
