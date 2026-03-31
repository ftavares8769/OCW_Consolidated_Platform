import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Settings, Cpu, Key, Eye, EyeOff, Check, Loader,
  Library, Compass, Layers, ChevronRight, Save, MessageSquare, Link, Unlink,
  FileText, ChevronDown, ChevronUp, RotateCcw,
} from 'lucide-react'
import RegenerateModal from '../components/settings/RegenerateModal.jsx'
import './SettingsPage.css'

// Fields that, when changed, indicate the AI model itself changed
const MODEL_FIELDS = ['ai_provider', 'local_model', 'openai_model', 'anthropic_model']

function effectiveModelLabel(s) {
  if (!s) return ''
  const p = s.ai_provider || 'local'
  if (p === 'openai')    return `OpenAI / ${s.openai_model    || 'gpt-4o-mini'}`
  if (p === 'anthropic') return `Anthropic / ${s.anthropic_model || 'claude-3-haiku'}`
  return `Local / ${s.local_model || 'unknown'}`
}

// ── Context window presets ────────────────────────────────────────────────────
const CONTEXT_PRESETS = [
  { tokens: 512,   label: 'Very fast',   hint: 'Minimal output, best for tiny models' },
  { tokens: 1024,  label: 'Fast',        hint: 'Short responses' },
  { tokens: 2048,  label: 'Balanced',    hint: 'Good for 1B–3B models', recommended: true },
  { tokens: 4096,  label: 'Standard',    hint: 'Default — works for most models', recommended: true },
  { tokens: 8192,  label: 'Extended',    hint: 'For 7B+ models' },
  { tokens: 16384, label: 'Long context', hint: 'Large models / cloud APIs' },
]

// ── Cloud model options ───────────────────────────────────────────────────────
const OPENAI_MODELS = [
  { value: 'gpt-4o-mini',    label: 'GPT-4o Mini',  hint: 'Fast & cheap — recommended' },
  { value: 'gpt-4o',         label: 'GPT-4o',       hint: 'Most capable OpenAI model' },
  { value: 'gpt-3.5-turbo',  label: 'GPT-3.5 Turbo', hint: 'Older, very inexpensive' },
]

const ANTHROPIC_MODELS = [
  { value: 'claude-3-haiku-20240307',     label: 'Claude 3 Haiku',     hint: 'Fast & cheap — recommended' },
  { value: 'claude-3-5-sonnet-20241022',  label: 'Claude 3.5 Sonnet',  hint: 'Best quality Anthropic model' },
  { value: 'claude-3-opus-20240229',      label: 'Claude 3 Opus',      hint: 'Most powerful, most expensive' },
]

// ── Suggested local models (shown when none are installed) ────────────────────
const SUGGESTED_MODELS = [
  { name: 'qwen3:1.7b',   hint: '~1 GB  · Recommended for 4–8 GB RAM' },
  { name: 'qwen3:4b',     hint: '~3 GB  · Better quality, 8 GB+ RAM' },
  { name: 'qwen3:8b',     hint: '~5 GB  · High quality, 16 GB+ RAM' },
  { name: 'llama3.2:3b',  hint: '~2 GB  · Fast, good general quality' },
  { name: 'gemma3:4b',    hint: '~3 GB  · Google\'s efficient model' },
  { name: 'mistral:7b',   hint: '~4 GB  · Balanced performance' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ icon: Icon, title, desc, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <Icon size={16} className="settings-section-icon" />
        <span className="settings-section-title">{title}</span>
        {desc && <span className="settings-section-desc">{desc}</span>}
      </div>
      <div className="settings-section-body">{children}</div>
    </div>
  )
}

function Field({ label, hint, recommended, children }) {
  return (
    <div className="settings-field">
      <label className="settings-label">
        {label}
        {recommended && <span className="settings-recommended">recommended</span>}
      </label>
      {children}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings]       = useState(null)
  const [localModels, setLocalModels] = useState([])
  const [ollamaOk, setOllamaOk]       = useState(null)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState(null)   // null | 'success' | 'error'
  const [saveMsg, setSaveMsg]         = useState('')

  // Edited key values (only sent on save if non-empty)
  const [openaiKeyDraft, setOpenaiKeyDraft]         = useState('')
  const [anthropicKeyDraft, setAnthropicKeyDraft]   = useState('')
  const [showOpenaiKey, setShowOpenaiKey]           = useState(false)
  const [showAnthropicKey, setShowAnthropicKey]     = useState(false)

  // Custom context window input
  const [customCtx, setCustomCtx] = useState('')

  // Regenerate modal
  const [regenModal, setRegenModal] = useState(null)  // null | { prevModel, newModel }
  const savedSettingsRef = useRef(null)               // snapshot before save

  // Prompt defaults (fetched once for "View default" disclosure)
  const [promptDefaults, setPromptDefaults] = useState({ quiz: '', problems: '' })
  const [showDefaultQuiz, setShowDefaultQuiz]         = useState(false)
  const [showDefaultProblems, setShowDefaultProblems] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, mRes, dRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/settings/models'),
        fetch('/api/settings/prompt-defaults'),
      ])
      const s = await sRes.json()
      const m = await mRes.json()
      const d = await dRes.json()
      setSettings(s)
      savedSettingsRef.current = s          // record baseline
      setLocalModels(m.models || [])
      setOllamaOk(m.available)
      setPromptDefaults(d)
    } catch (e) {
      console.error('Failed to load settings', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const set = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))

  const save = async () => {
    setSaving(true)
    setSaveStatus(null)
    const prevSettings = savedSettingsRef.current   // snapshot before this save
    try {
      const body = { ...settings }
      // Only send API keys if the user typed something new
      if (openaiKeyDraft.trim())    body.openai_api_key    = openaiKeyDraft.trim()
      else                          delete body.openai_api_key
      if (anthropicKeyDraft.trim()) body.anthropic_api_key = anthropicKeyDraft.trim()
      else                          delete body.anthropic_api_key

      // Remove read-only fields
      delete body.openai_api_key_set
      delete body.anthropic_api_key_set

      // Tutor fields: explicitly set so they survive JSON.stringify
      // (JS silently drops `undefined` keys, which would cause the backend
      // to treat them as "not sent" and keep the old value instead)
      body.tutor_ai_provider     = settings.tutor_ai_provider     ?? ''
      body.tutor_local_model     = settings.tutor_local_model     ?? ''
      body.tutor_openai_model    = settings.tutor_openai_model    ?? 'gpt-4o-mini'
      body.tutor_anthropic_model = settings.tutor_anthropic_model ?? 'claude-3-haiku-20240307'

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Save failed')
      const data = await res.json()
      setSettings(data.settings)
      savedSettingsRef.current = data.settings     // update baseline
      setOpenaiKeyDraft('')
      setAnthropicKeyDraft('')
      setSaveStatus('success')
      setSaveMsg('Settings saved')

      // ── Check if the effective AI model changed ───────────────────
      if (prevSettings) {
        const modelChanged = MODEL_FIELDS.some(
          f => (prevSettings[f] ?? '') !== (data.settings[f] ?? '')
        )
        if (modelChanged) {
          // Check if any AI-generated content exists (study materials OR flashcards)
          const regenRes = await fetch('/api/lectures/regenerable')
          const courses  = await regenRes.json()
          const hasContent = Array.isArray(courses) && courses.some(
            c => c.lectures?.some(
              l => l.has_summary || l.material_types?.length > 0 || l.flashcard_count > 0
            )
          )
          if (hasContent) {
            setRegenModal({
              prevModel: effectiveModelLabel(prevSettings),
              newModel:  effectiveModelLabel(data.settings),
            })
          }
        }
      }
    } catch (e) {
      setSaveStatus('error')
      setSaveMsg(e.message)
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }

  const clearKey = (provider) => {
    if (provider === 'openai') {
      setOpenaiKeyDraft('')
      set('openai_api_key_set', false)
      setSettings(prev => ({ ...prev, openai_api_key_set: false, openai_api_key: '' }))
      // Send empty string explicitly to server
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai_api_key: '' }),
      })
    } else {
      setAnthropicKeyDraft('')
      setSettings(prev => ({ ...prev, anthropic_api_key_set: false, anthropic_api_key: '' }))
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropic_api_key: '' }),
      })
    }
  }

  if (loading || !settings) {
    return (
      <div className="settings-page">
        <div className="settings-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', paddingTop: 40 }}>
            <Loader size={20} className="spin" />
            <span>Loading settings…</span>
          </div>
        </div>
      </div>
    )
  }

  const provider = settings.ai_provider || 'local'
  const isLocalPreset = CONTEXT_PRESETS.some(p => p.tokens === settings.context_window)

  return (
    <div className="settings-page">
      <div className="settings-inner">
        {/* Header */}
        <div>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">Configure AI model, flashcards, and app behaviour</p>
        </div>

        {/* ── AI Model section ───────────────────────────────────────── */}
        <Section icon={Cpu} title="AI Model" desc="Powers summaries, tutor, flashcard generation">

          {/* Provider toggle */}
          <Field label="Provider">
            <div className="provider-toggle">
              {[
                { id: 'local',     icon: Cpu,  label: 'Local LLM' },
                { id: 'openai',    icon: Key,  label: 'OpenAI' },
                { id: 'anthropic', icon: Key,  label: 'Anthropic' },
              ].map(p => (
                <button
                  key={p.id}
                  className={`provider-btn ${provider === p.id ? 'active' : ''}`}
                  onClick={() => set('ai_provider', p.id)}
                >
                  <p.icon size={13} />
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          {/* ── Local LLM ────────────────────────────────────────────── */}
          {provider === 'local' && (
            <>
              <Field
                label="Model"
                hint={
                  ollamaOk
                    ? `${localModels.length} model${localModels.length !== 1 ? 's' : ''} installed via Ollama`
                    : 'Ollama not detected — install from ollama.com, then run: ollama pull <model>'
                }
              >
                {localModels.length > 0 ? (
                  <select
                    className="settings-select"
                    value={settings.local_model || ''}
                    onChange={e => set('local_model', e.target.value)}
                  >
                    {localModels.map(m => (
                      <option key={m.name} value={m.name}>
                        {m.name}  ({m.size_gb} GB)
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      className="settings-input"
                      value={settings.local_model || ''}
                      onChange={e => set('local_model', e.target.value)}
                      placeholder="e.g. qwen3:1.7b"
                    />
                    <div className="settings-hint" style={{ marginTop: 6 }}>
                      Suggested models (install with <code>ollama pull &lt;name&gt;</code>):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      {SUGGESTED_MODELS.map(m => (
                        <button
                          key={m.name}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                            background: settings.local_model === m.name ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                            border: `1px solid ${settings.local_model === m.name ? 'var(--accent)' : 'var(--border)'}`,
                            cursor: 'pointer', textAlign: 'left',
                          }}
                          onClick={() => set('local_model', m.name)}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                            {m.name}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.hint}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Field>

              <Field
                label="Context Window (tokens)"
                hint="Controls how much text the model processes at once. Larger = slower but handles longer lectures."
              >
                <div className="context-options">
                  {CONTEXT_PRESETS.map(p => (
                    <button
                      key={p.tokens}
                      className={`context-option ${settings.context_window === p.tokens ? 'selected' : ''}`}
                      onClick={() => { set('context_window', p.tokens); setCustomCtx('') }}
                    >
                      <span className="context-option-tokens">
                        {p.tokens.toLocaleString()}
                        {p.recommended && (
                          <span className="settings-recommended" style={{ marginLeft: 5 }}>★</span>
                        )}
                      </span>
                      <span className="context-option-label">{p.label}</span>
                      <span className="context-option-label" style={{ opacity: 0.7 }}>{p.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="context-custom-row">
                  <label>Custom:</label>
                  <input
                    type="number"
                    className="settings-input"
                    style={{ width: 120 }}
                    placeholder="e.g. 6000"
                    value={customCtx}
                    min={128}
                    max={131072}
                    onChange={e => {
                      setCustomCtx(e.target.value)
                      const n = parseInt(e.target.value)
                      if (!isNaN(n) && n >= 128) set('context_window', n)
                    }}
                  />
                  <span className="settings-hint">tokens</span>
                </div>
              </Field>
            </>
          )}

          {/* ── OpenAI ───────────────────────────────────────────────── */}
          {provider === 'openai' && (
            <>
              <Field label="API Key" hint="Your OpenAI API key — stored locally, never sent anywhere else.">
                {settings.openai_api_key_set && !openaiKeyDraft ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="key-set-badge"><Check size={11} /> Configured</span>
                    <button className="key-clear-btn" onClick={() => clearKey('openai')}>Clear key</button>
                    <button className="key-clear-btn" style={{ textDecoration: 'none', color: 'var(--accent)' }}
                      onClick={() => setOpenaiKeyDraft(' ')}>Change</button>
                  </div>
                ) : (
                  <div className="api-key-row">
                    <input
                      className="settings-input"
                      type={showOpenaiKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={openaiKeyDraft.trim() === '' ? '' : openaiKeyDraft}
                      onChange={e => setOpenaiKeyDraft(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="btn-toggle-key"
                      onClick={() => setShowOpenaiKey(v => !v)}
                      title={showOpenaiKey ? 'Hide' : 'Show'}
                    >
                      {showOpenaiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                )}
              </Field>

              <Field label="Model">
                <select
                  className="settings-select"
                  value={settings.openai_model || 'gpt-4o-mini'}
                  onChange={e => set('openai_model', e.target.value)}
                >
                  {OPENAI_MODELS.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Max Tokens (output)"
                hint="Maximum tokens the model generates per response. Higher = longer answers but costs more."
              >
                <div className="context-options">
                  {[
                    { tokens: 1024,  label: 'Short' },
                    { tokens: 2048,  label: 'Standard', recommended: true },
                    { tokens: 4096,  label: 'Long',     recommended: true },
                    { tokens: 8192,  label: 'Very long' },
                    { tokens: 16384, label: 'Maximum' },
                  ].map(p => (
                    <button
                      key={p.tokens}
                      className={`context-option ${settings.context_window === p.tokens ? 'selected' : ''}`}
                      onClick={() => set('context_window', p.tokens)}
                    >
                      <span className="context-option-tokens">
                        {p.tokens.toLocaleString()}
                        {p.recommended && <span className="settings-recommended" style={{ marginLeft: 5 }}>★</span>}
                      </span>
                      <span className="context-option-label">{p.label}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}

          {/* ── Anthropic ────────────────────────────────────────────── */}
          {provider === 'anthropic' && (
            <>
              <Field label="API Key" hint="Your Anthropic API key — stored locally, never sent anywhere else.">
                {settings.anthropic_api_key_set && !anthropicKeyDraft ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="key-set-badge"><Check size={11} /> Configured</span>
                    <button className="key-clear-btn" onClick={() => clearKey('anthropic')}>Clear key</button>
                    <button className="key-clear-btn" style={{ textDecoration: 'none', color: 'var(--accent)' }}
                      onClick={() => setAnthropicKeyDraft(' ')}>Change</button>
                  </div>
                ) : (
                  <div className="api-key-row">
                    <input
                      className="settings-input"
                      type={showAnthropicKey ? 'text' : 'password'}
                      placeholder="sk-ant-..."
                      value={anthropicKeyDraft.trim() === '' ? '' : anthropicKeyDraft}
                      onChange={e => setAnthropicKeyDraft(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="btn-toggle-key"
                      onClick={() => setShowAnthropicKey(v => !v)}
                      title={showAnthropicKey ? 'Hide' : 'Show'}
                    >
                      {showAnthropicKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                )}
              </Field>

              <Field label="Model">
                <select
                  className="settings-select"
                  value={settings.anthropic_model || 'claude-3-haiku-20240307'}
                  onChange={e => set('anthropic_model', e.target.value)}
                >
                  {ANTHROPIC_MODELS.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Max Tokens (output)"
                hint="Maximum tokens Claude generates per response."
              >
                <div className="context-options">
                  {[
                    { tokens: 1024,  label: 'Short' },
                    { tokens: 2048,  label: 'Standard', recommended: true },
                    { tokens: 4096,  label: 'Long',     recommended: true },
                    { tokens: 8192,  label: 'Very long' },
                  ].map(p => (
                    <button
                      key={p.tokens}
                      className={`context-option ${settings.context_window === p.tokens ? 'selected' : ''}`}
                      onClick={() => set('context_window', p.tokens)}
                    >
                      <span className="context-option-tokens">
                        {p.tokens.toLocaleString()}
                        {p.recommended && <span className="settings-recommended" style={{ marginLeft: 5 }}>★</span>}
                      </span>
                      <span className="context-option-label">{p.label}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
        </Section>

        {/* ── AI Tutor section ───────────────────────────────────────── */}
        {(() => {
          const tutorInherits = !settings.tutor_ai_provider   // "" or undefined → inherit
          const tutorProvider = settings.tutor_ai_provider || ''
          const effectiveTutorLabel = tutorInherits
            ? effectiveModelLabel(settings)
            : (() => {
                if (tutorProvider === 'openai')    return `OpenAI / ${settings.tutor_openai_model    || 'gpt-4o-mini'}`
                if (tutorProvider === 'anthropic') return `Anthropic / ${settings.tutor_anthropic_model || 'claude-3-haiku'}`
                return `Local / ${settings.tutor_local_model || settings.local_model || 'unknown'}`
              })()

          return (
            <Section icon={MessageSquare} title="AI Tutor" desc="Model used for the interactive chat tutor">

              {/* Inherit toggle */}
              <Field label="Model source">
                <div className="tutor-source-row">
                  <button
                    className={`tutor-inherit-btn ${tutorInherits ? 'active' : ''}`}
                    onClick={() => set('tutor_ai_provider', tutorInherits ? (settings.ai_provider || 'local') : '')}
                  >
                    {tutorInherits ? <Link size={13} /> : <Unlink size={13} />}
                    {tutorInherits ? 'Using same AI as content generation' : 'Using a different AI'}
                  </button>
                  <span className="tutor-effective-label">
                    {effectiveTutorLabel}
                  </span>
                </div>
                <span className="settings-hint">
                  {tutorInherits
                    ? 'The tutor will use whichever model is selected above. Toggle to override.'
                    : 'The tutor uses its own model — independent of the content generation AI.'}
                </span>
              </Field>

              {/* Custom tutor provider + model — only shown when not inheriting */}
              {!tutorInherits && (
                <>
                  <Field label="Tutor Provider">
                    <div className="provider-toggle">
                      {[
                        { id: 'local',     icon: Cpu, label: 'Local LLM' },
                        { id: 'openai',    icon: Key, label: 'OpenAI' },
                        { id: 'anthropic', icon: Key, label: 'Anthropic' },
                      ].map(p => (
                        <button
                          key={p.id}
                          className={`provider-btn ${tutorProvider === p.id ? 'active' : ''}`}
                          onClick={() => set('tutor_ai_provider', p.id)}
                        >
                          <p.icon size={13} />
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  {tutorProvider === 'local' && (
                    <Field
                      label="Tutor Model"
                      hint={localModels.length > 0
                        ? `${localModels.length} model${localModels.length !== 1 ? 's' : ''} installed`
                        : 'Ollama not detected'}
                    >
                      {localModels.length > 0 ? (
                        <select
                          className="settings-select"
                          value={settings.tutor_local_model || settings.local_model || ''}
                          onChange={e => set('tutor_local_model', e.target.value)}
                        >
                          {localModels.map(m => (
                            <option key={m.name} value={m.name}>
                              {m.name}  ({m.size_gb} GB)
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="settings-input"
                          value={settings.tutor_local_model || ''}
                          onChange={e => set('tutor_local_model', e.target.value)}
                          placeholder="e.g. llama3.2:3b"
                        />
                      )}
                    </Field>
                  )}

                  {tutorProvider === 'openai' && (
                    <Field label="Tutor Model" hint="API key is shared with the content generation setting above.">
                      <select
                        className="settings-select"
                        value={settings.tutor_openai_model || 'gpt-4o-mini'}
                        onChange={e => set('tutor_openai_model', e.target.value)}
                      >
                        {OPENAI_MODELS.map(m => (
                          <option key={m.value} value={m.value}>
                            {m.label} — {m.hint}
                          </option>
                        ))}
                      </select>
                      {!settings.openai_api_key_set && (
                        <span className="settings-hint" style={{ color: 'var(--error)' }}>
                          No OpenAI API key set — add it in the AI Model section above.
                        </span>
                      )}
                    </Field>
                  )}

                  {tutorProvider === 'anthropic' && (
                    <Field label="Tutor Model" hint="API key is shared with the content generation setting above.">
                      <select
                        className="settings-select"
                        value={settings.tutor_anthropic_model || 'claude-3-haiku-20240307'}
                        onChange={e => set('tutor_anthropic_model', e.target.value)}
                      >
                        {ANTHROPIC_MODELS.map(m => (
                          <option key={m.value} value={m.value}>
                            {m.label} — {m.hint}
                          </option>
                        ))}
                      </select>
                      {!settings.anthropic_api_key_set && (
                        <span className="settings-hint" style={{ color: 'var(--error)' }}>
                          No Anthropic API key set — add it in the AI Model section above.
                        </span>
                      )}
                    </Field>
                  )}
                </>
              )}
            </Section>
          )
        })()}

        {/* ── Flashcards section ─────────────────────────────────────── */}
        <Section icon={Layers} title="Flashcards" desc="Spaced-repetition settings">
          <Field
            label="Daily New Card Limit"
            hint="Maximum new cards introduced per day. Cards already in 'learning' state are always shown."
            recommended
          >
            <div className="settings-number-row">
              <input
                type="number"
                className="settings-number"
                min={1}
                max={200}
                value={settings.daily_new_limit ?? 20}
                onChange={e => {
                  const n = parseInt(e.target.value)
                  if (!isNaN(n) && n >= 1) set('daily_new_limit', n)
                }}
              />
              <span className="settings-number-hint">cards / day</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {[10, 20, 30, 50].map(n => (
                <button
                  key={n}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: settings.daily_new_limit === n ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                    border: `1px solid ${settings.daily_new_limit === n ? 'var(--accent)' : 'var(--border)'}`,
                    color: settings.daily_new_limit === n ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                  onClick={() => set('daily_new_limit', n)}
                >
                  {n}{n === 20 ? ' ★' : ''}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        {/* ── Generation Prompts section ────────────────────────────── */}
        <Section icon={FileText} title="Generation Prompts" desc="Customise how quiz questions and practice problems are generated">

          {/* Quiz prompt */}
          <Field
            label="Quiz — additional instructions"
            hint="Appended to the default quiz prompt. Examples: 'Focus on mathematical proofs.' or 'Write exactly 5 questions.'"
          >
            <textarea
              className="settings-prompt-textarea"
              rows={4}
              placeholder="Leave blank to use the default. Type extra instructions to add them to the prompt…"
              value={settings.prompt_quiz_extra ?? ''}
              onChange={e => set('prompt_quiz_extra', e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {(settings.prompt_quiz_extra ?? '').trim() && (
                <button
                  className="prompt-reset-btn"
                  onClick={() => set('prompt_quiz_extra', '')}
                  title="Clear extra instructions"
                >
                  <RotateCcw size={11} /> Reset to default
                </button>
              )}
              <button
                className="prompt-view-btn"
                onClick={() => setShowDefaultQuiz(v => !v)}
              >
                {showDefaultQuiz ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {showDefaultQuiz ? 'Hide' : 'View'} default prompt
              </button>
            </div>
            {showDefaultQuiz && (
              <pre className="settings-prompt-default">{promptDefaults.quiz}</pre>
            )}
          </Field>

          {/* Problems prompt */}
          <Field
            label="Practice Problems — additional instructions"
            hint="Appended to the default problems prompt. Examples: 'Include word problems.' or 'Write solutions in full sentences.'"
          >
            <textarea
              className="settings-prompt-textarea"
              rows={4}
              placeholder="Leave blank to use the default. Type extra instructions to add them to the prompt…"
              value={settings.prompt_problems_extra ?? ''}
              onChange={e => set('prompt_problems_extra', e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {(settings.prompt_problems_extra ?? '').trim() && (
                <button
                  className="prompt-reset-btn"
                  onClick={() => set('prompt_problems_extra', '')}
                  title="Clear extra instructions"
                >
                  <RotateCcw size={11} /> Reset to default
                </button>
              )}
              <button
                className="prompt-view-btn"
                onClick={() => setShowDefaultProblems(v => !v)}
              >
                {showDefaultProblems ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {showDefaultProblems ? 'Hide' : 'View'} default prompt
              </button>
            </div>
            {showDefaultProblems && (
              <pre className="settings-prompt-default">{promptDefaults.problems}</pre>
            )}
          </Field>
        </Section>

        {/* ── Library section ───────────────────────────────────────── */}
        <Section icon={Library} title="Library" desc="Course management">
          <div className="settings-placeholder">
            <ChevronRight size={14} />
            More Library settings coming soon — auto-processing, download behaviour, etc.
          </div>
        </Section>

        {/* ── Discover section ──────────────────────────────────────── */}
        <Section icon={Compass} title="Discover" desc="Course discovery">
          <div className="settings-placeholder">
            <ChevronRight size={14} />
            More Discover settings coming soon — subject filters, language preferences, etc.
          </div>
        </Section>

        {/* Spacer so sticky bar doesn't hide content */}
        <div style={{ height: 20 }} />
      </div>

      {/* ── Sticky save bar ─────────────────────────────────────────── */}
      <div className="settings-save-bar">
        <button className="btn-save-settings" onClick={save} disabled={saving}>
          {saving
            ? <><Loader size={14} className="spin" /> Saving…</>
            : <><Save size={14} /> Save Settings</>
          }
        </button>
        {saveStatus && (
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === 'success' ? <Check size={13} style={{ marginRight: 4 }} /> : null}
            {saveMsg}
          </span>
        )}
      </div>

      {/* ── Regenerate modal (shown after model change) ──────────────── */}
      {regenModal && (
        <RegenerateModal
          prevModel={regenModal.prevModel}
          newModel={regenModal.newModel}
          onClose={() => setRegenModal(null)}
        />
      )}
    </div>
  )
}
