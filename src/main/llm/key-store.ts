import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'

/**
 * Endpoint keys live encrypted under userData. The renderer only ever learns
 * whether a key exists; the plaintext never crosses IPC.
 */
export class LlmKeyStore {
  private readonly file: string

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'llm-key.bin')
  }

  async load(): Promise<string | undefined> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return undefined
    try {
      const encoded = await readFile(this.file)
      const decrypted = await safeStorage.decryptStringAsync(encoded)
      return decrypted.result
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[llm] could not read endpoint key', error)
      return undefined
    }
  }

  async save(key: string): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('系统钥匙串不可用，无法安全保存 API Key。')
    }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(this.file, await safeStorage.encryptStringAsync(key))
  }

  async clear(): Promise<void> {
    await unlink(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
