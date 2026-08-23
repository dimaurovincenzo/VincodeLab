import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

class TestResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get() {
      return this.hidden ? 0 : 1
    },
  },
  offsetWidth: {
    configurable: true,
    get() {
      return this.hidden ? 0 : 1
    },
  },
})

window.ResizeObserver = TestResizeObserver

const storageValues = new Map<string, string>()
const testLocalStorage: Storage = {
  get length() { return storageValues.size },
  clear() { storageValues.clear() },
  getItem(key) { return storageValues.get(String(key)) ?? null },
  key(index) { return [...storageValues.keys()][index] ?? null },
  removeItem(key) { storageValues.delete(String(key)) },
  setItem(key, value) { storageValues.set(String(key), String(value)) },
}
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })

afterEach(() => {
  cleanup()
  testLocalStorage.clear()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })
  document.body.removeAttribute('data-inert')
  document.body.removeAttribute('data-scroll-lock')
  document.body.removeAttribute('style')
  document.documentElement.removeAttribute('style')
})
