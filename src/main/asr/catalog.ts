import raw from '../../../resources/models.json'
import {
  findModel,
  findRuntime,
  parseModelCatalog,
  toModelDescriptor
} from '../../core/asr/model-catalog'

export const MODEL_CATALOG = parseModelCatalog(raw)
export const PRIMARY_MODEL = findModel(MODEL_CATALOG, 'qwen3-asr-0.6b-q8')
export const PRIMARY_RUNTIME = findRuntime(MODEL_CATALOG, PRIMARY_MODEL.runtime)
export const PRIMARY_MODEL_DESCRIPTOR = toModelDescriptor(PRIMARY_MODEL)
export const SENSEVOICE_MODEL = findModel(MODEL_CATALOG, 'sensevoice-small-q8')
export const SENSEVOICE_MODEL_DESCRIPTOR = toModelDescriptor(SENSEVOICE_MODEL)
