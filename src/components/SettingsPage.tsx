import { useRef } from 'react'
import { ChevronLeftIcon } from '@primer/octicons-react'
import SettingsForm, { type SettingsFormHandle } from './SettingsForm'
import type { AppSettings, ConfigMap, ProviderKey } from '../lib/types'

interface Props {
  configs: ConfigMap
  provider: ProviderKey
  appSettings: AppSettings
  onSave: (c: ConfigMap, provider: ProviderKey) => void
  onAppSettingsSave: (s: AppSettings) => void
  onBack: () => void
}

export default function SettingsPage({
  configs,
  provider,
  appSettings,
  onSave,
  onAppSettingsSave,
  onBack,
}: Props) {
  const formRef = useRef<SettingsFormHandle>(null)

  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <button className="btn" onClick={onBack}>
          <ChevronLeftIcon size={14} /> 返回
        </button>
        <span className="settings-page-title">设置</span>
        <button className="btn primary save-btn" onClick={() => formRef.current?.submit()}>
          保存
        </button>
      </div>
      <div className="settings-page-body">
        <SettingsForm
          ref={formRef}
          configs={configs}
          provider={provider}
          appSettings={appSettings}
          onSave={onSave}
          onAppSettingsSave={onAppSettingsSave}
          onClose={onBack}
          hideFoot
        />
      </div>
    </div>
  )
}