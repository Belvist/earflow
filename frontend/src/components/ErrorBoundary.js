import React from 'react';

const RELOAD_FLAG_KEY = 'eb_last_reload_at';
const CRASH_LOOP_THRESHOLD_MS = 6000;

function isInCrashLoop() {
    try {
        const raw = sessionStorage.getItem(RELOAD_FLAG_KEY);
        if (!raw) return false;
        return Date.now() - Number(raw) < CRASH_LOOP_THRESHOLD_MS;
    } catch {
        return false;
    }
}

function markReload() {
    try {
        sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
    } catch { }
}

function clearAppData() {
    try { localStorage.clear(); } catch { }
    try { sessionStorage.clear(); } catch { }
    if ('caches' in window) {
        caches.keys().then((names) => names.forEach((n) => caches.delete(n))).catch(() => { });
    }
}

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, isCrashLoop: false, errorMessage: '', errorStack: '' };
        this.handleReload = this.handleReload.bind(this);
        this.handleClearAndReload = this.handleClearAndReload.bind(this);
    }

    static getDerivedStateFromError() {
        return { hasError: true, isCrashLoop: isInCrashLoop() };
    }

    componentDidCatch(error, info) {
        const message = error && typeof error.message === 'string' ? error.message : String(error || 'unknown');
        const stack = error && typeof error.stack === 'string' ? error.stack : '';
        const componentStack = info && typeof info.componentStack === 'string' ? info.componentStack : '';
        try {
            window.__EARFLOW_LAST_RENDER_ERROR__ = { message, stack, componentStack, at: Date.now() };
        } catch {
            // ignore
        }
        this.setState({
            errorMessage: message,
            errorStack: stack || componentStack,
        });
    }

    handleReload() {
        markReload();
        window.location.reload();
    }

    handleClearAndReload() {
        clearAppData();
        window.location.reload();
    }

    render() {
        if (this.state.hasError) {
            const { isCrashLoop } = this.state;
            return (
                <div
                    style={{
                        minHeight: '100vh',
                        background: 'black',
                        color: 'rgba(255,255,255,0.9)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px',
                        fontFamily: 'Unbounded, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
                    }}
                >
                    <div style={{ maxWidth: '520px', width: '100%', textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>Произошла ошибка</div>
                        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6, marginBottom: '18px' }}>
                            {isCrashLoop
                                ? 'Кажется, кэш повреждён. Сбросьте данные приложения — это поможет.'
                                : 'Приложение не смогло корректно отрисоваться. Перезагрузите страницу. Если проблема повторяется, проверьте консоль браузера.'}
                        </div>
                        {this.state.errorMessage ? (
                            <pre
                                style={{
                                    textAlign: 'left',
                                    fontSize: '11px',
                                    lineHeight: 1.45,
                                    color: 'rgba(255,255,255,0.55)',
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '10px',
                                    padding: '10px 12px',
                                    marginBottom: '16px',
                                    maxHeight: '160px',
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}
                            >
                                {this.state.errorMessage}
                            </pre>
                        ) : null}
                        {isCrashLoop ? (
                            <button
                                type="button"
                                onClick={this.handleClearAndReload}
                                style={{
                                    background: 'rgba(239,68,68,0.18)',
                                    color: 'rgba(255,255,255,0.92)',
                                    border: '1px solid rgba(239,68,68,0.4)',
                                    borderRadius: '14px',
                                    padding: '12px 16px',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    fontWeight: 600,
                                }}
                            >
                                Сбросить данные и выйти
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={this.handleReload}
                                style={{
                                    background: 'rgba(255,255,255,0.10)',
                                    color: 'rgba(255,255,255,0.92)',
                                    border: '1px solid rgba(255,255,255,0.18)',
                                    borderRadius: '14px',
                                    padding: '12px 16px',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    fontWeight: 600,
                                }}
                            >
                                Перезагрузить
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
