// KEDEN Extension - UI Core (базовые хелперы)
// Должен загружаться ПЕРВЫМ среди ui-скриптов.

function logButtonClick(buttonId) {
    console.log('[popup] Button click:', {
        buttonId,
        timestamp: new Date().toISOString()
    });
}

function setStatus(msg) {
    const el = document.getElementById('statusMessage');
    if (el) {
        el.style.display = 'block';
        el.innerText = msg;
        el.style.animation = 'fadeIn 0.3s ease-out';
    }

    // Also update central loader status if exists
    const loaderStatus = document.getElementById('loaderStatus');
    if (loaderStatus) {
        loaderStatus.innerText = msg;
    }
}

function getConfidenceHTML(score) {
    if (score === undefined || score === null) return '';

    let type = 'high';
    let text = 'Высокая';
    let icon = 'M20 6L9 17l-5-5'; // Check icon

    if (score < 0.6) {
        type = 'low';
        text = 'Низкая';
        icon = 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01'; // Alert icon
    } else if (score < 0.85) {
        type = 'medium';
        text = 'Средняя';
        icon = 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-10v.01M12 16h.01'; // Info/Question
    }

    const percent = Math.round(score * 100);

    return `
        <div class="confidence-badge confidence-${type}" title="Точность ИИ: ${percent}%">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="${icon}"></path>
            </svg>
            ${text} ${percent}%
        </div>
    `;
}

function updateStepper(stepNumber) {
    const steps = document.querySelectorAll('.step');
    steps.forEach(step => {
        const s = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');

        if (s < stepNumber) {
            step.classList.add('completed');
        } else if (s === stepNumber) {
            step.classList.add('active');
        }
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    const iconSpan = document.createElement('span');
    iconSpan.style.fontSize = '18px';
    iconSpan.textContent = icon;

    const msgDiv = document.createElement('div');
    msgDiv.style.flex = '1';
    msgDiv.textContent = message;

    const progressDiv = document.createElement('div');
    progressDiv.className = 'toast-progress';

    toast.appendChild(iconSpan);
    toast.appendChild(msgDiv);
    toast.appendChild(progressDiv);

    container.appendChild(toast);

    // Progress bar animation
    const progress = toast.querySelector('.toast-progress');
    const duration = 4000;
    progress.style.transition = `transform ${duration}ms linear`;
    progress.style.transform = 'scaleX(0)';

    const timeout = setTimeout(() => {
        toast.style.animation = 'toastOut 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 500);
    }, duration);

    toast.onclick = () => {
        clearTimeout(timeout);
        toast.style.animation = 'toastOut 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 500);
    };
}

function updatePreviewPlaceholder() {
    const previewContent = document.getElementById('previewContent');

    if (previewContent && !currentAIData) {
        previewContent.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: var(--text-secondary); text-align: center;">
                <div style="font-size: 48px; opacity: 0.2; margin-bottom: 24px;">🔍</div>
                <div style="font-size: 15px; font-weight: 500; color: #fff;">Ожидание документов</div>
                <div style="font-size: 12px; margin-top: 8px; max-width: 200px;">После анализа здесь появятся извлеченные данные и предпросмотр</div>
            </div>
        `;
    }
}

let _timerInterval = null;
let _timerStartTime = null;

function showLoading(show, message, forcedStartTime = null) {
    const loader = document.getElementById('loader');
    const startBtn = document.getElementById('startBtn');
    const confirmBtn = document.getElementById('confirmFillBtn');

    if (loader) loader.style.display = show ? 'block' : 'none';

    // Блокируем только при анализе (когда message содержит 'анализ' или пусто)
    const isAnalysis = !message || message.includes('анализ');

    if (isAnalysis) {
        if (startBtn) startBtn.disabled = show;
        if (confirmBtn) confirmBtn.disabled = show;
    }

    const previewContent = document.getElementById('previewContent');
    const existingTimer = document.getElementById('aiTimer');

    if (show && isAnalysis) {
        if (previewContent && !existingTimer) {
            // Разворачиваем контейнер для анализа
            const container = document.getElementById('mainContainer');
            const previewArea = document.getElementById('previewArea');
            if (container) {
                container.classList.add('expanded');
                document.body.style.width = '100vw';
            }
            if (previewArea) previewArea.style.display = 'block';

            updateStepper(2); // Step 2: Analysis

            previewContent.innerHTML = `
                <div id="centralStatusOverlay" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 320px; text-align: center;">
                    <div class="loader central-spinner" style="display: block; margin-bottom: 28px; width: 48px; height: 48px; border-width: 4px; border-top-color: #007AFF;"></div>
                    <div id="loaderStatus" style="font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 24px;">${message || 'AI анализирует документы...'}</div>
                    <div id="aiTimerContainer">
                        <div id="aiTimer" style="font-family: monospace; font-size: 22px; color: #fff; background: #0f172a; padding: 10px 24px; border-radius: 12px;">
                            <span id="aiTimerValue">00:00.0</span>
                        </div>
                    </div>
                </div>
            `;
        }
        startTimer(forcedStartTime);
    } else if (!show) {
        if (previewContent) {
            previewContent.style.pointerEvents = 'auto';
            previewContent.style.filter = 'none';
        }
        const finalTime = stopTimer();
        const spinner = document.querySelector('.central-spinner');
        if (spinner) spinner.style.display = 'none';

        const timer = document.getElementById('aiTimer');
        if (timer) {
            timer.style.animation = 'none';
            timer.style.color = '#4ade80';
            const container = document.getElementById('aiTimerContainer');
            if (container) container.style.background = 'linear-gradient(135deg, rgba(74,222,128,0.4), rgba(34,197,94,0.4))';
        }
        return finalTime;
    }
}

function showFillSuccess(finalTime) {
    const statusEl = document.getElementById('loaderStatus');
    const spinner = document.querySelector('.central-spinner');
    const timer = document.getElementById('aiTimer');
    const container = document.getElementById('aiTimerContainer');

    if (spinner) spinner.style.display = 'none';

    if (statusEl) {
        statusEl.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 20px; animation: scaleIn 0.5s cubic-bezier(0.17, 0.67, 0.83, 0.67)">✅</div>
            <div style="color: #4ade80;">Данные успешно заполнены!</div>
            <div style="font-size: 14px; font-weight: 400; color: #94a3b8; margin-top: 12px; line-height: 1.5;">
                Страница Keden будет обновлена<br>в течение пары секунд...
            </div>
        `;
    }

    if (timer) {
        timer.style.animation = 'none';
        timer.style.color = '#4ade80';
        timer.style.borderColor = '#4ade80';
        const timerVal = document.getElementById('aiTimerValue');
        if (timerVal) timerVal.innerText = finalTime || 'Готово';
    }

    if (container) {
        container.style.background = 'linear-gradient(135deg, rgba(74,222,128,0.4), rgba(34,197,94,0.4))';
    }

    // Блокируем кнопку подтверждения окончательно, чтобы не нажали во время релоада
    const confirmBtn = document.getElementById('confirmFillBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '✨ Заполнено успешно';
        confirmBtn.style.background = 'var(--success)';
        confirmBtn.style.boxShadow = '0 0 20px var(--success-glow)';
    }

    // Небольшой звуковой эффект или вибрация (опционально, но здесь просто визуально)
    setTimeout(() => {
        showLoading(false);
    }, 2500);
}

function startTimer(forcedStartTime = null) {
    if (_timerInterval) {
        // If already running but we have a forced start time, update it
        if (forcedStartTime) _timerStartTime = forcedStartTime;
        return;
    }
    _timerStartTime = forcedStartTime || Date.now();
    _timerInterval = setInterval(updateTimerUI, 100);
}

function stopTimer() {
    let finalTime = '00:00';
    if (_timerInterval) {
        const el = document.getElementById('aiTimerValue');
        if (el) finalTime = el.innerText;
        clearInterval(_timerInterval);
        _timerInterval = null;
    }
    return finalTime;
}

function updateTimerUI() {
    const el = document.getElementById('aiTimerValue');
    if (!el) return;

    const diff = (Date.now() - _timerStartTime) / 1000;
    const minutes = Math.floor(diff / 60);
    const seconds = Math.floor(diff % 60);
    const ms = Math.floor((diff % 1) * 10);

    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms}`;
    el.innerText = timeStr;
}

function showError(msg) {
    const previewContent = document.getElementById('previewContent');
    const container = document.getElementById('mainContainer');
    const previewArea = document.getElementById('previewArea');

    if (previewContent && container) {
        // Ensure container is expanded and preview area is visible to show error
        container.classList.add('expanded');
        if (window.innerWidth <= 860) {
            document.body.style.width = '800px';
        } else {
            document.body.style.width = '100vw';
        }
        if (previewArea) previewArea.style.display = 'block';

        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #ef4444; text-align: center; padding: 20px;';

        const iconEl = document.createElement('div');
        iconEl.style.cssText = 'font-size: 40px; margin-bottom: 16px;';
        iconEl.textContent = '⚠️';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size: 14px; font-weight: 500; margin-bottom: 8px;';
        titleEl.textContent = 'Ошибка анализа';

        const msgEl = document.createElement('div');
        msgEl.style.cssText = 'font-size: 12px; color: #94a3b8;';
        msgEl.textContent = msg || 'Неизвестная ошибка';

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn';
        retryBtn.id = 'retryAnalysisBtn';
        retryBtn.style.cssText = 'margin-top: 20px; width: auto; padding: 8px 16px;';
        retryBtn.textContent = 'ПОПРОБОВАТЬ СНОВА';
        retryBtn.onclick = () => {
            const startBtn = document.getElementById('startBtn');
            if (startBtn) startBtn.click();
        };

        errorDiv.appendChild(iconEl);
        errorDiv.appendChild(titleEl);
        errorDiv.appendChild(msgEl);
        errorDiv.appendChild(retryBtn);
        previewContent.innerHTML = '';
        previewContent.appendChild(errorDiv);
    }
    const fillBtn = document.getElementById('confirmFillBtn');
    if (fillBtn) fillBtn.style.display = 'none';
}

function resetApp() {
    window.appExtensionFiles = [];
    currentAIData = null;
    renderFileList();

    const container = document.getElementById('mainContainer');
    if (container) container.classList.remove('expanded');

    const previewContent = document.getElementById('previewContent');
    if (previewContent) updatePreviewPlaceholder();

    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
        statusMsg.innerText = '';
        statusMsg.style.display = 'none';
    }

    // Reset layout for popup mode
    if (window.innerWidth <= 860) {
        document.body.style.width = '380px';
    }
    updateStepper(1); // Reset Stepper to Step 1
}

// Visual feedback for online status
function updateOnlineStatus() {
    const dot = document.getElementById('onlineDot');
    if (dot) {
        const isOnline = navigator.onLine;
        dot.style.background = isOnline ? '#34C759' : '#FF3B30';
        dot.style.boxShadow = isOnline ? '0 0 12px #34C759' : '0 0 12px #FF3B30';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();
