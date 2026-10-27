/**
 * The capture PCM channel is high-bandwidth and only the app's main window may
 * use it. The sender id comes from the Electron event, never from the payload.
 */
export function isTrustedSender(
  senderId: number | undefined,
  allowedWebContentsId: number | null | undefined
): boolean {
  return (
    typeof senderId === 'number' &&
    typeof allowedWebContentsId === 'number' &&
    senderId === allowedWebContentsId
  )
}
