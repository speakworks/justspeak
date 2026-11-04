import type { PermissionStatus, PreferencesView } from '../../shared/ipc'
import { redactDiagnosticText, type RedactionPaths } from './redact'

export interface DiagnosticsAppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  locale: string
}

export interface DiagnosticsSummaryInput {
  generatedAt: string
  app: DiagnosticsAppInfo
  preferences: PreferencesView
  permissions: PermissionStatus
  historyEntries: number
  redaction?: RedactionPaths
}

export interface DiagnosticsSummary {
  generatedAt: string
  app: DiagnosticsAppInfo
  permissions: PermissionStatus
  history: { entries: number }
  preferences: {
    theme: string
    /** The accelerator itself is not needed to diagnose a binding failure. */
    hotkeyConfigured: boolean
    provider: {
      id: string
      label: string
      selectable: boolean
      reason: string
    }
    vocabulary: {
      state: string
      replaceCount: number
      protectCount: number
      message?: string
    }
    llm: {
      backend: string
      endpoint: {
        configured: boolean
        modelConfigured: boolean
        hasKey: boolean
      }
      local: {
        runtimeReady: boolean
        modelReady: boolean
        state: string
        modelName: string
        error?: string
      }
    }
  }
}

/**
 * Build the only structured data the bundle carries. It is assembled from
 * explicit fields, never by copying userData: endpoint URLs, model paths,
 * vocabulary paths, and transcripts do not have a route into this object.
 */
export function buildDiagnosticsSummary(input: DiagnosticsSummaryInput): DiagnosticsSummary {
  const { preferences, redaction } = input
  const redact = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : redactDiagnosticText(value, redaction)

  const vocabularyMessage = redact(preferences.vocabulary.message)
  const localError = redact(preferences.llm.local.error)

  return {
    generatedAt: input.generatedAt,
    app: input.app,
    permissions: input.permissions,
    history: { entries: input.historyEntries },
    preferences: {
      theme: preferences.theme,
      hotkeyConfigured: preferences.hotkey.length > 0,
      provider: {
        id: preferences.provider.id,
        label: preferences.provider.label,
        selectable: preferences.provider.selectable,
        reason: redactDiagnosticText(preferences.provider.reason, redaction)
      },
      vocabulary: {
        state: preferences.vocabulary.state,
        replaceCount: preferences.vocabulary.replaceCount,
        protectCount: preferences.vocabulary.protectCount,
        ...(vocabularyMessage === undefined ? {} : { message: vocabularyMessage })
      },
      llm: {
        backend: preferences.llm.backend,
        endpoint: {
          configured:
            preferences.llm.endpoint.baseUrl.trim().length > 0 &&
            preferences.llm.endpoint.model.trim().length > 0,
          modelConfigured: preferences.llm.endpoint.model.trim().length > 0,
          hasKey: preferences.llm.endpoint.hasKey
        },
        local: {
          runtimeReady: preferences.llm.local.runtimeReady,
          modelReady: preferences.llm.local.modelReady,
          state: preferences.llm.local.state,
          modelName: preferences.llm.local.modelName,
          ...(localError === undefined ? {} : { error: localError })
        }
      }
    }
  }
}
