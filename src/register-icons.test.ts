import { describe, expect, it, vi } from 'vitest'
import { registerElementPlusIcons } from './register-icons'

describe('Element Plus icon registration', () => {
  it('registers only the icons used by the application', () => {
    const component = vi.fn()
    const app = { component } as any

    registerElementPlusIcons(app)

    expect(component).toHaveBeenCalledTimes(9)
    expect(component.mock.calls.map(([name]) => name)).toEqual([
      'ArrowLeft',
      'Refresh',
      'DataLine',
      'Download',
      'SwitchButton',
      'Plus',
      'Delete',
      'Upload',
      'Clock',
    ])
  })
})
