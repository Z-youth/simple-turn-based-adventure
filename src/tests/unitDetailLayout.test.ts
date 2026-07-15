import { describe, expect, it } from 'vitest'
import { UNIT_DETAIL_SCROLL_STYLE } from '../game/ui/battleUiAdapter'

describe('unit detail layout', () => {
  it('keeps long detail content in a vertically scrollable extension area', () => {
    expect(UNIT_DETAIL_SCROLL_STYLE).toEqual({
      maxHeight: '118px',
      overflowY: 'auto',
    })
  })
})
