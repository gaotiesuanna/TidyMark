import type { HistoryApi, HistoryVisit } from '@/core/ports'

export interface FakeHistory {
  api: HistoryApi
  setVisits(visits: HistoryVisit[]): void
}

export function createFakeHistory(initial: HistoryVisit[] = []): FakeHistory {
  let visits = [...initial]
  return {
    api: {
      async search() {
        return [...visits]
      },
    },
    setVisits(nextVisits) {
      visits = [...nextVisits]
    },
  }
}
