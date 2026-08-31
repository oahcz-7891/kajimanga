import { XIcon } from '@primer/octicons-react'
import SettingsForm from './SettingsForm'
import type { AppSettings, ConfigMap, ProviderKey } from '../lib/types'

interface Props {
  configs: ConfigMap
  provider: ProviderKey
  appSettings: AppSettings
  onSave: (c: ConfigMap, provider: ProviderKey) => void
  onAppSettingsSave: (s: AppSettings) => void
  onClose: () => void
}

export default function SettingsModal({
  configs,
  provider,
  appSettings,
  onSave,
  onAppSettingsSave,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">设置</span>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <XIcon size={16} />
          </button>
        </div>
        <div className="modal-scroll">
          <SettingsForm
            configs={configs}
            provider={provider}
            appSettings={appSettings}
            onSave={onSave}
            onAppSettingsSave={onAppSettingsSave}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
}