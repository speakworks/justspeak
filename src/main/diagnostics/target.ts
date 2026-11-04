import path from 'node:path'

export interface SaveDialogResult {
  canceled: boolean
  filePath?: string
}

export async function resolveDiagnosticsTarget(input: {
  /** Development-only override used by the export E2E. */
  devTarget?: string
  showSaveDialog: () => Promise<SaveDialogResult>
}): Promise<{ canceled: true } | { canceled: false; target: string }> {
  const devTarget = input.devTarget?.trim()
  // Resolve relative dev paths now: zip runs with cwd=staging, so a relative
  // target would be written inside the directory that is deleted afterwards.
  if (devTarget) return { canceled: false, target: path.resolve(devTarget) }
  const result = await input.showSaveDialog()
  if (result.canceled || !result.filePath) return { canceled: true }
  return { canceled: false, target: result.filePath }
}
