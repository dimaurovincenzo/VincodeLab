import { bridgeNamespace, getVincodeLabBridge } from '@/bridge'
import type { RedisApi } from '../model/redis-types'

export const redisBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get redis() { return getVincodeLabBridge().redis },
}

export function redisApi(): RedisApi {
  return bridgeNamespace('redis')
}
