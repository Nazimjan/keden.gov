// KEDEN Extension - UI History (история и переключение вкладок)
// Зависит от: ui_core.js (setStatus, resetApp), ui_preview.js (renderPreview, currentAIData)
// Должен загружаться ПОСЛЕ ui_preview.js.

// --- Tab Switching Logic ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

            // Add active class to clicked tab
            tab.classList.add('active');
            // Show corresponding content
            const tabId = tab.getAttribute('data-tab');
            const targetContent = document.getElementById(tabId);
            if (targetContent) {
                targetContent.style.display = 'block';
                targetContent.style.animation = 'fadeIn 0.3s ease-out';

                // If switching to history tab, refresh list
                if (tabId === 'historyTab') {
                    renderHistory();
                }
            }
        });
    });

    // --- Clear History ---
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Вы уверены, что хотите очистить всю историю?')) {
                chrome.storage.local.set({ history: [] }, () => {
                    renderHistory();
                });
            }
        });
    }

    // --- Reset Functionality ---
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetApp);
    }
});

function renderHistory() {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    chrome.storage.local.get(['history'], (data) => {
        const history = data.history || [];
        if (history.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.3;">📂</div>
                    <div style="font-size: 13px;">История пока пуста</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        history.forEach((item, index) => {
            const date = new Date(item.timestamp).toLocaleString('ru-RU', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });

            const res = item.result || {};
            const merged = res.mergedData || res;
            const vehicles = merged.vehicles || {};
            const tractor = vehicles.tractorRegNumber || '';
            const trailer = vehicles.trailerRegNumber || '';

            let vehicleText = tractor ? `${tractor}${trailer ? ' / ' + trailer : ''}` : '';

            // Fallback: If mergedData has no vehicle number, check if any document has a number that looks like a vehicle reg
            if (!vehicleText && res.documents) {
                const vDoc = res.documents.find(d =>
                    d.type === '09013' || d.type === '09014' ||
                    ['рег', 'тс', 'номер', 'авто'].some(k => d.filename?.toLowerCase().includes(k))
                );
                if (vDoc && vDoc.number) {
                    vehicleText = vDoc.number;
                }
            }

            if (!vehicleText) {
                vehicleText = item.files[0] || 'Анализ';
            }

            const isVehicle = (vehicleText !== (item.files[0] || 'Анализ'));
            const filesText = item.files.join(', ');

            const card = document.createElement('div');
            card.className = 'history-item';
            card.innerHTML = `
                <div class="history-item-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="history-item-date">${date}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="history-item-duration">${item.duration || ''}</span>
                        <button class="history-delete-btn" title="Удалить">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="history-item-files" title="${filesText}">
                    ${isVehicle ? '🚚 ' : '📄 '}${vehicleText}
                </div>
                <div class="history-item-meta">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        ${item.files.length} док.
                    </div>
                    <span>•</span>
                    <div style="display: flex; align-items: center; gap: 4px;">
                         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                        </svg>
                        ${item.result?.mergedData?.products?.length || 0} товаров
                    </div>
                </div>
            `;

            const deleteBtn = card.querySelector('.history-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('Удалить эту запись?')) {
                        const newHistory = [...history];
                        newHistory.splice(index, 1);
                        chrome.storage.local.set({ history: newHistory }, () => {
                            renderHistory();
                        });
                    }
                });
            }

            card.addEventListener('click', () => {
                // Switch to uploadTab (where preview is)
                document.querySelector('.tab[data-tab="uploadTab"]').click();

                // Load result into preview
                currentAIData = item.result;
                renderPreview(item.result);

                // Expand container if not already
                const mainContainer = document.getElementById('mainContainer');
                if (mainContainer) mainContainer.classList.add('expanded');

                setStatus(`Загружено из истории (${date})`);
            });

            container.appendChild(card);
        });
    });
}
