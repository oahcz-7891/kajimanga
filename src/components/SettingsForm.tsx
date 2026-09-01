import { forwardRef, useImperativeHandle, useState } from 'react'
import { EyeClosedIcon, EyeIcon } from '@primer/octicons-react'
import { PROVIDERS, PROVIDER_THINKING, THINKING_LABELS, defaultSettings, testConnection } from '../lib/visionApi'
import { clearTranslationCache } from '../lib/translationCache'
import {
  DOUBLE_TAP_LABELS,
  DOUBLE_TAP_RATIOS,
  MODE_LABELS,
  type AppSettings,
  type ConfigMap,
  type ProviderKey,
  type ReadMode,
  type ThinkingStrength,
} from '../lib/types'

interface Props {
  configs: ConfigMap
  provider: ProviderKey
  appSettings: AppSettings
  onSave: (c: ConfigMap, provider: ProviderKey) => void
  onAppSettingsSave: (s: AppSettings) => void
  onClose: () => void
  hideFoot?: boolean
}

export interface SettingsFormHandle {
  submit: () => void
}

const SettingsForm = forwardRef<SettingsFormHandle, Props>(function SettingsForm(
  {
    configs,
    provider,
    appSettings,
    onSave,
    onAppSettingsSave,
    onClose,
    hideFoot = false,
  },
  ref,
) {
  // 本地草稿：每个供应商一份，编辑即时生效；保存时一次性提交
  const [draft, setDraft] = useState<ConfigMap>(() =>
    (Object.keys(configs) as ProviderKey[]).reduce<ConfigMap>(
      (acc, k) => {
        acc[k] = { ...configs[k] }
        return acc
      },
      {} as ConfigMap,
    ),
  )
  const [formProvider, setFormProvider] = useState<ProviderKey>(provider)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheMsg, setCacheMsg] = useState('')
  const [appDraft, setAppDraft] = useState<AppSettings>(() => ({ ...appSettings }))

  const cur = draft[formProvider]

  function update(field: Partial<ConfigMap[ProviderKey]>) {
    setDraft((d) => ({ ...d, [formProvider]: { ...d[formProvider], ...field } }))
  }

  function resetCurrent() {
    setDraft((d) => ({ ...d, [formProvider]: defaultSettings(formProvider) }))
  }

  function submit() {
    const cleaned = (Object.keys(draft) as ProviderKey[]).reduce<ConfigMap>((acc, k) => {
      acc[k] = { ...draft[k], baseUrl: draft[k].baseUrl.trim(), model: draft[k].model.trim() }
      return acc
    }, {} as ConfigMap)
    onSave(cleaned, formProvider)
    onAppSettingsSave(appDraft)
    onClose()
  }

  useImperativeHandle(ref, () => ({ submit }))

  async function runTest() {
    const s = draft[formProvider]
    if (!s.apiKey.trim()) {
      setTestResult({ ok: false, message: '请先填写 API Key' })
      return
    }
    if (!s.model.trim()) {
      setTestResult({ ok: false, message: '请先填写模型名' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testConnection(formProvider, {
        ...s,
        baseUrl: s.baseUrl.trim(),
        model: s.model.trim(),
      })
      setTestResult(r)
    } finally {
      setTesting(false)
    }
  }

  async function clearCache() {
    setClearingCache(true)
    setCacheMsg('')
    try {
      await clearTranslationCache()
      setCacheMsg('翻译缓存已清空')
    } catch {
      setCacheMsg('清空失败')
    } finally {
      setClearingCache(false)
    }
  }

  return (
    <>
      <div className="settings-card">
        <div className="settings-card-title">API 设置</div>

      <div className="field">
        <label className="label">服务商</label>
        <select
          className="input select"
          value={formProvider}
          onChange={(e) => setFormProvider(e.target.value as ProviderKey)}
        >
          {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
            <option key={key} value={key}>
              {PROVIDERS[key].label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">模型名</label>
        <input
          className="input"
          value={cur.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder="填写模型名"
        />
      </div>

      <div className="field">
        <label className="label">思考强度</label>
        <select
          className="input select"
          value={cur.thinking}
          onChange={(e) => update({ thinking: e.target.value as ThinkingStrength })}
        >
          {PROVIDER_THINKING[formProvider].map((v) => (
            <option key={v} value={v}>
              {THINKING_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">API Base URL</label>
        <input
          className="input"
          value={cur.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://.../v1"
        />
      </div>

      <div className="field">
        <label className="label">API Key</label>
        <div className="key-field">
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={cur.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="sk-..."
            autoComplete="off"
          />
          <button
            type="button"
            className="icon-btn key-toggle"
            onClick={() => setShowKey((s) => !s)}
            title={showKey ? '隐藏 Key' : '显示 Key'}
          >
            {showKey ? <EyeClosedIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
        <div className="hint">Key 仅保存在本机浏览器 localStorage，请勿公开部署。</div>
      </div>

      <div className="field actions-row">
        <div className="test-group">
          <button className="btn" onClick={runTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {testResult && (
            <span className={`test-msg ${testResult.ok ? 'test-msg-ok' : 'test-msg-fail'}`}>
              {testResult.message}
            </span>
          )}
        </div>
        <button className="btn danger" onClick={resetCurrent}>
          重置当前供应商
        </button>
        <button className="btn danger" onClick={clearCache} disabled={clearingCache}>
          {clearingCache ? '清空中…' : '清空翻译缓存'}
        </button>
      </div>
      {cacheMsg && <div className="hint">{cacheMsg}</div>}
      </div>

      <div className="settings-card">
        <div className="settings-card-title">阅读与翻译</div>

      <div className="field row-field">
        <div className="row-info">
          <label className="label">双击缩放</label>
          <div className="hint">阅读页双击图片放大 / 缩小，放大后可拖动。</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={appDraft.doubleTapZoom}
            onChange={(e) => setAppDraft((s) => ({ ...s, doubleTapZoom: e.target.checked }))}
          />
          <span className="switch-slider" />
        </label>
      </div>

      <div className="field">
        <label className="label">双击缩放比例</label>
        <select
          className="input select"
          value={appDraft.doubleTapRatio}
          onChange={(e) =>
            setAppDraft((s) => ({ ...s, doubleTapRatio: Number(e.target.value) }))
          }
        >
          {DOUBLE_TAP_RATIOS.map((r) => (
            <option key={r} value={r}>
              {DOUBLE_TAP_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">模式</label>
        <select
          className="input select"
          value={appDraft.mode}
          onChange={(e) => setAppDraft((s) => ({ ...s, mode: e.target.value as ReadMode }))}
        >
          {(Object.keys(MODE_LABELS) as ReadMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <div className="hint">学习模式会在译文外额外解释语法和单词。</div>
      </div>


      </div>

      {!hideFoot && (
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            保存
          </button>
        </div>
      )}
    </>
  )
})

export default SettingsForm