export type CloudEvent = {
  id: string
  title: string
  sport: string
  startDate: string
  endDate: string
  fee: number
  registeredCount: number
  organizer: string
}

const endpoint = 'https://open.yunbisai.com/api/Join/event'
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const sportLabels: Record<string, string> = {
  '1': '象棋',
  '2': '围棋',
  '4': '国际象棋',
  '8': '国际跳棋',
  '16': '五子棋',
  '32': '牌类',
  '64': '飞镖',
  '128': '游泳',
  '256': '桥牌',
  '512': '其他',
  '1024': '摔跤',
  '2048': '柔道',
  '4096': '柔术',
}

export async function fetchHangzhouEvents(month: string, signal?: AbortSignal): Promise<CloudEvent[]> {
  if (!monthPattern.test(month)) throw new Error('月份格式无效')

  const url = new URL(endpoint)
  url.searchParams.set('province_name', '浙江省')
  url.searchParams.set('city_name', '杭州市')
  url.searchParams.set('event_value', '')
  url.searchParams.set('date', month)
  url.searchParams.set('pagesize', '')
  url.searchParams.set('page', '')
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`云比赛请求失败（${response.status}）`)

  const payload: unknown = await response.json()
  const root = asRecord(payload)
  const data = asRecord(root?.datArr)
  if (root?.error !== 0 || !Array.isArray(data?.rows)) throw new Error('云比赛数据格式无效')
  return data.rows.map(mapRow)
}

export function cloudEventDetailURL(eventId: string) {
  const url = new URL('https://m.yunbisai.com/signUp')
  url.searchParams.set('eventid', eventId)
  return url.toString()
}

function mapRow(value: unknown): CloudEvent {
  const row = asRecord(value)
  const id = stringValue(row?.event_id)
  const title = stringValue(row?.title)
  const startDate = datePart(stringValue(row?.min_time))
  const endDate = datePart(stringValue(row?.max_time))
  if (!row || !id || !title || !startDate || !endDate) throw new Error('云比赛数据格式无效')
  return {
    id,
    title,
    sport: sportLabels[String(row.event_value ?? '')] ?? '其他',
    startDate,
    endDate,
    fee: numberValue(row.min_sumcost),
    registeredCount: numberValue(row.pay_num),
    organizer: stringValue(row.lswlorganization__cname) || '未知主办方',
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function datePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}
