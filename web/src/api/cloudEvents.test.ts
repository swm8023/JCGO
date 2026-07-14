import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudEventDetailURL, fetchHangzhouEvents } from './cloudEvents'

describe('cloudEvents API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('queries one Hangzhou month and maps Yunbisai fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: 0,
      datArr: {
        rows: [{
          event_id: '67043',
          title: '棋通杯围棋业余段级位赛',
          event_value: '2',
          min_time: '2026-07-19 00:00:00.000',
          max_time: '2026-07-20 23:59:59.000',
          min_sumcost: '.00',
          pay_num: '290',
          lswlorganization__cname: '杭州棋通少儿棋院',
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHangzhouEvents('2026-07')).resolves.toEqual([{
      id: '67043',
      title: '棋通杯围棋业余段级位赛',
      sport: '围棋',
      startDate: '2026-07-19',
      endDate: '2026-07-20',
      fee: 0,
      registeredCount: 290,
      organizer: '杭州棋通少儿棋院',
    }])

    const [request, init] = fetchMock.mock.calls[0]
    const url = new URL(String(request))
    expect(url.origin + url.pathname).toBe('https://open.yunbisai.com/api/Join/event')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      province_name: '浙江省',
      city_name: '杭州市',
      date: '2026-07',
    })
    expect(init).toMatchObject({ credentials: 'omit' })
  })

  it('rejects invalid months and malformed upstream data', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":0,"datArr":null}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHangzhouEvents('July 2026')).rejects.toThrow('月份格式无效')
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(fetchHangzhouEvents('2026-07')).rejects.toThrow('云比赛数据格式无效')
  })

  it('builds the original Yunbisai detail URL', () => {
    expect(cloudEventDetailURL('67043')).toBe('https://m.yunbisai.com/signUp?eventid=67043')
  })
})
