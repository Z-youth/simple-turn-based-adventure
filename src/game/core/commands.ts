export const EndTurnConfirmation = {
  NotProvided: 'notProvided',
  Confirmed: 'confirmed',
  Cancelled: 'cancelled',
} as const

export type EndTurnConfirmation =
  (typeof EndTurnConfirmation)[keyof typeof EndTurnConfirmation]

export interface EndTurnRequest {
  readonly hasLegalAction: boolean
  readonly confirmation?: EndTurnConfirmation
}
