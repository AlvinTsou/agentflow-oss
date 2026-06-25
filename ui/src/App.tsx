import { useState, useEffect } from 'react'
import {
  Activity,
  Terminal,
  Cpu,
  DollarSign,
  AlertCircle,
  RefreshCw,
  Send,
  Folder,
  Clock,
  GitBranch,
  Search,
  Eye,
  Sliders
} from 'lucide-react'
import './App.css'

const API_BASE = 'http://localhost:3000/api'

interface SprintSummary {
  sprintId: string;
  recipeName: string;
  sprintDir: string;
  phase: "initialized" | "completed" | "failed" | "running";
  currentStepIdx: number;
  completedSteps: string[];
  startedAt: string;
  lastEventTs: string;
  totalTokens: number;
  totalCostUsd: number;
  readiness?: string;
}

interface StreamingCheckpoint {
  version: 1;
  ts: string;
  sprintId: string;
  step: string;
  iteration?: string;
  phase: "produce" | "review" | "fix";
  attempt: number;
  provider: string;
  score?: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  artifactPath: string;
  outputPreview: string;
  outputSha256: string;
}

interface SprintEvent {
  ts: string;
  type: string;
  step?: string;
  iteration?: string;
  attempt?: number;
  score?: number;
  tokens?: number;
  costUsd?: number;
  msg?: string;
  action?: {
    action: string;
    note?: string;
  };
}

function App() {
  const [sprints, setSprints] = useState<SprintSummary[]>([])
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'checkpoints' | 'timeline' | 'control'>('checkpoints')
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [loadingSprints, setLoadingSprints] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Selected Sprint Details
  const [checkpoints, setCheckpoints] = useState<StreamingCheckpoint[]>([])
  const [events, setEvents] = useState<SprintEvent[]>([])
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<StreamingCheckpoint | null>(null)

  // Control Form
  const [actionType, setActionType] = useState<string>('approve')
  const [actionStep, setActionStep] = useState<string>('')
  const [actionNote, setActionNote] = useState<string>('')
  const [submittingAction, setSubmittingAction] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null)

  // Fetch Sprints
  const fetchSprints = async () => {
    setLoadingSprints(true)
    try {
      const res = await fetch(`${API_BASE}/sprints`)
      if (!res.ok) throw new Error('API response failed')
      const data = await res.json()
      setSprints(data)
      setServerOnline(true)
      
      // Auto-select first sprint if none is selected
      if (data.length > 0 && !selectedSprintId) {
        setSelectedSprintId(data[0].sprintId)
      }
    } catch (err) {
      console.error(err)
      setServerOnline(false)
    } finally {
      setLoadingSprints(false)
    }
  }

  // Fetch checkpoints & events for selected sprint
  const fetchSprintDetails = async (sprintId: string) => {
    try {
      const [cpRes, evRes] = await Promise.all([
        fetch(`${API_BASE}/sprints/${sprintId}/checkpoints`),
        fetch(`${API_BASE}/sprints/${sprintId}/events`)
      ])
      
      if (cpRes.ok) {
        const cpData = await cpRes.json()
        setCheckpoints(cpData)
        if (cpData.length > 0) {
          setSelectedCheckpoint(cpData[cpData.length - 1]) // Default to latest
        } else {
          setSelectedCheckpoint(null)
        }
      }
      
      if (evRes.ok) {
        const evData = await evRes.json()
        setEvents(evData)
      }
    } catch (err) {
      console.error('Failed to load sprint details:', err)
    }
  }

  // Initial load & poll
  useEffect(() => {
    fetchSprints()
    const interval = setInterval(fetchSprints, 10000) // Poll index every 10s
    return () => clearInterval(interval)
  }, [])

  // Refetch details when sprint changes
  useEffect(() => {
    if (selectedSprintId) {
      fetchSprintDetails(selectedSprintId)
      // Reset form variables
      setActionStep('')
      setActionNote('')
      setActionFeedback(null)
    }
  }, [selectedSprintId])

  const selectedSprint = sprints.find(s => s.sprintId === selectedSprintId)

  // Handle Control Action Submission
  const handleControlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSprintId) return

    setSubmittingAction(true)
    setActionFeedback(null)

    try {
      const res = await fetch(`${API_BASE}/sprints/${selectedSprintId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          step: actionStep || undefined,
          note: actionNote || undefined
        })
      })

      const data = await res.json()
      if (res.ok) {
        setActionFeedback({ type: 'success', msg: `Action "${actionType}" submitted successfully!` })
        setActionNote('')
        // Refresh details instantly
        fetchSprintDetails(selectedSprintId)
      } else {
        throw new Error(data.error || 'Failed to submit action')
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', msg: err.message || 'Server error occurred' })
    } finally {
      setSubmittingAction(false)
    }
  }

  // Filters
  const filteredSprints = sprints.filter(s => 
    s.sprintId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.recipeName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(cost)
  }

  const formatDate = (isoStr: string) => {
    if (!isoStr) return 'N/A'
    try {
      const d = new Date(isoStr)
      return d.toLocaleString()
    } catch {
      return isoStr
    }
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <h1>AgentFlow OSS</h1>
          <span className="subtitle">Management Console</span>
        </div>
        <div className="server-status">
          <span className={`status-dot ${serverOnline === true ? 'online' : serverOnline === false ? 'offline' : ''}`}></span>
          <span>
            {serverOnline === true ? 'Server Online' : serverOnline === false ? 'Server Disconnected (Port 3000)' : 'Connecting...'}
          </span>
          <button onClick={fetchSprints} className="tab-btn" style={{ padding: '0 0.5rem', cursor: 'pointer' }} title="Reload Sprints">
            <RefreshCw size={14} className={loadingSprints ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="main-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Sprints Registry</h2>
            <span className="sprint-count">{filteredSprints.length} Sprints</span>
          </div>

          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search sprint or recipe..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.5rem 0.5rem 2rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div className="sprint-list">
            {filteredSprints.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem', fontSize: '0.9rem' }}>
                No Sprints found.
              </div>
            ) : (
              filteredSprints.map(s => (
                <div
                  key={s.sprintId}
                  onClick={() => setSelectedSprintId(s.sprintId)}
                  className={`sprint-item ${selectedSprintId === s.sprintId ? 'active' : ''}`}
                >
                  <div className="sprint-item-header">
                    <span className="sprint-id-tag">{s.sprintId}</span>
                    <span className={`phase-badge ${s.phase}`}>{s.phase}</span>
                  </div>
                  <span className="recipe-text">Recipe: {s.recipeName}</span>
                  <div className="sprint-item-footer">
                    <span>Tokens: {s.totalTokens.toLocaleString()}</span>
                    <span>Cost: {formatCost(s.totalCostUsd)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Detail Panel */}
        <main className="detail-area">
          {selectedSprint ? (
            <>
              {/* Header Info */}
              <div className="sprint-detail-header">
                <div className="detail-header-top">
                  <div className="detail-header-info">
                    <h2>Sprint: {selectedSprint.sprintId}</h2>
                    <span className={`phase-badge ${selectedSprint.phase}`}>{selectedSprint.phase}</span>
                  </div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Clock size={14} /> Last Event: {formatDate(selectedSprint.lastEventTs)}
                  </span>
                </div>
                <div className="detail-header-path">
                  Path: {selectedSprint.sprintDir}
                </div>

                {/* Metrics Row */}
                <div className="metrics-row" style={{ marginTop: '1.5rem' }}>
                  <div className="metric-card">
                    <div className="metric-icon-box blue">
                      <Cpu size={20} />
                    </div>
                    <div className="metric-data">
                      <span className="metric-label">Tokens Accrued</span>
                      <span className="metric-value">{selectedSprint.totalTokens.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box purple">
                      <DollarSign size={20} />
                    </div>
                    <div className="metric-data">
                      <span className="metric-label">Total Cost</span>
                      <span className="metric-value">{formatCost(selectedSprint.totalCostUsd)}</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box green">
                      <GitBranch size={20} />
                    </div>
                    <div className="metric-data">
                      <span className="metric-label">Completed Steps</span>
                      <span className="metric-value">
                        {selectedSprint.completedSteps?.length || 0} (Index: {selectedSprint.currentStepIdx})
                      </span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box amber">
                      <Activity size={20} />
                    </div>
                    <div className="metric-data">
                      <span className="metric-label">Readiness Report</span>
                      <span className="metric-value" style={{ textTransform: 'capitalize' }}>
                        {selectedSprint.readiness || 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="tabs-row">
                <button
                  onClick={() => setActiveTab('checkpoints')}
                  className={`tab-btn ${activeTab === 'checkpoints' ? 'active' : ''}`}
                >
                  <Eye size={16} /> Checkpoints ({checkpoints.length})
                </button>
                <button
                  onClick={() => setActiveTab('timeline')}
                  className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                >
                  <Terminal size={16} /> Event Timeline ({events.length})
                </button>
                <button
                  onClick={() => setActiveTab('control')}
                  className={`tab-btn ${activeTab === 'control' ? 'active' : ''}`}
                >
                  <Sliders size={16} /> Control Actions
                </button>
              </div>

              {/* Tab Content Panel */}
              <div className="tab-content">
                {/* 1. Checkpoints Panel */}
                {activeTab === 'checkpoints' && (
                  <div className="checkpoint-view">
                    <div className="checkpoint-list">
                      {checkpoints.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
                          No streaming checkpoints recorded.
                        </div>
                      ) : (
                        checkpoints.map((cp, idx) => (
                          <div
                            key={idx}
                            onClick={() => setSelectedCheckpoint(cp)}
                            className={`checkpoint-item ${selectedCheckpoint === cp ? 'active' : ''}`}
                          >
                            <div className="cp-header">
                              <span className="cp-step">{cp.step}</span>
                              <span className={`cp-phase ${cp.phase}`}>{cp.phase}</span>
                            </div>
                            <div className="cp-info-row" style={{ marginTop: '0.2rem' }}>
                              <span>Attempt: {cp.attempt} ({cp.provider})</span>
                              {cp.score !== undefined && (
                                <span className="cp-score-badge">Score: {cp.score}</span>
                              )}
                            </div>
                            <div className="cp-info-row" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                              <span>Cost: {formatCost(cp.costUsd)}</span>
                              <span>Tokens: {cp.tokens.toLocaleString()}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {selectedCheckpoint && (
                      <div className="checkpoint-preview">
                        <div className="preview-header">
                          <div className="preview-title">
                            <h3>Checkpoint: {selectedCheckpoint.step} ({selectedCheckpoint.phase})</h3>
                            <p>SHA-256: {selectedCheckpoint.outputSha256}</p>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                            <div>Duration: {selectedCheckpoint.durationMs}ms</div>
                            <div>Artifact: {selectedCheckpoint.artifactPath}</div>
                          </div>
                        </div>
                        <div className="preview-body">
                          <pre className="preview-code-block">
                            {selectedCheckpoint.outputPreview}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Timeline Panel */}
                {activeTab === 'timeline' && (
                  <div className="timeline">
                    {events.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
                        No events logged for this sprint.
                      </div>
                    ) : (
                      events.map((ev, idx) => {
                        let markerClass = 'info'
                        if (ev.type === 'sprint-completed' || ev.type === 'step-passed') markerClass = 'success'
                        if (ev.type?.includes('failed') || ev.type === 'error') markerClass = 'danger'
                        if (ev.type === 'web-action') markerClass = 'warning'

                        return (
                          <div key={idx} className="timeline-item">
                            <div className={`timeline-marker ${markerClass}`}></div>
                            <div className="timeline-card">
                              <div className="timeline-meta">
                                <span className="timeline-type">{ev.type}</span>
                                <span>{formatDate(ev.ts)}</span>
                              </div>
                              <div className="timeline-msg">{ev.msg || `Step event`}</div>
                              {(ev.step || ev.tokens !== undefined || ev.costUsd !== undefined) && (
                                <div className="timeline-details">
                                  {ev.step && <div className="detail-metric">Step: <strong>{ev.step}</strong></div>}
                                  {ev.tokens !== undefined && <div className="detail-metric">Tokens: <strong>{ev.tokens.toLocaleString()}</strong></div>}
                                  {ev.costUsd !== undefined && <div className="detail-metric">Cost: <strong>{formatCost(ev.costUsd)}</strong></div>}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {/* 3. Control Panel */}
                {activeTab === 'control' && (
                  <div className="control-tab-layout">
                    <h3>Submit Control Action</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Trigger actions directly onto the active sprint workflow state. Actions will append audit events and coordinate with the CLI runner.
                    </p>

                    <form onSubmit={handleControlSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                      <div className="control-form-group">
                        <label>Action Type</label>
                        <div className="control-action-cards">
                          {[
                            { id: 'approve', title: 'Approve', desc: 'Confirm step completion and proceed.' },
                            { id: 'request-changes', title: 'Request Changes', desc: 'Trigger quality loop fixes.' },
                            { id: 'force-pass', title: 'Force Pass', desc: 'Bypass rating constraints directly.' },
                            { id: 'resume', title: 'Resume', desc: 'Re-trigger a blocked or paused sprint.' }
                          ].map(opt => (
                            <div
                              key={opt.id}
                              onClick={() => setActionType(opt.id)}
                              className={`action-card-option ${actionType === opt.id ? 'selected' : ''}`}
                            >
                              <span className="action-card-title">{opt.title}</span>
                              <span className="action-card-desc">{opt.desc}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="control-form-group">
                        <label htmlFor="action-step">Target Step (Optional)</label>
                        <input
                          id="action-step"
                          type="text"
                          className="control-input"
                          placeholder="e.g. review, develop, or empty for current"
                          value={actionStep}
                          onChange={e => setActionStep(e.target.value)}
                        />
                      </div>

                      <div className="control-form-group">
                        <label htmlFor="action-note">Action Notes</label>
                        <textarea
                          id="action-note"
                          className="control-textarea"
                          rows={3}
                          placeholder="Provide context, approval notes, or feedback remarks..."
                          value={actionNote}
                          onChange={e => setActionNote(e.target.value)}
                        />
                      </div>

                      {actionFeedback && (
                        <div className={`control-feedback ${actionFeedback.type}`}>
                          {actionFeedback.type === 'error' ? <AlertCircle size={16} style={{ display: 'inline', marginRight: '0.5rem' }} /> : null}
                          {actionFeedback.msg}
                        </div>
                      )}

                      <button
                        type="submit"
                        className="control-btn"
                        disabled={submittingAction}
                      >
                        <Send size={16} /> {submittingAction ? 'Submitting Action...' : 'Dispatch Control Action'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="no-sprint-selected">
              <Folder size={48} />
              <p>Select a Sprint from the registry to view metrics and dashboards.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
