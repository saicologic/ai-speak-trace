import '@testing-library/jest-dom/vitest'

// URL.createObjectURL / revokeObjectURL のモック（jsdomでは未実装）
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = vi.fn()
}
