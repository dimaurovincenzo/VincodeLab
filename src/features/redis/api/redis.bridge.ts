import { bridgeNamespace, getVincodeLabBridge, type RedisApi } from '@/bridge'

export const redisBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get redis() { return getVincodeLabBridge().redis },
}

export function redisApi(): RedisApi {
  return bridgeNamespace('redis')
}
