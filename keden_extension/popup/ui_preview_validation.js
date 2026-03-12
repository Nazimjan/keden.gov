// KEDEN Extension - Preview Validation
// Inline validation, validation summary rendering, field highlighting

function initInlineValidation() {
    const inputs = document.querySelectorAll('.preview-input');
    inputs.forEach(input => {
        const type = input.dataset.validate;
        if (!type) return;

        const validate = () => {
            let isValid = true;
            let msg = '';
            const val = input.value.trim();

            if (type === 'bin') {
                isValid = /^\d{12}$/.test(val);
                msg = 'Должно быть 12 цифр';
            } else if (type === 'tnved') {
                isValid = /^\d{6}$/.test(val);
                msg = 'Должно быть 6 цифр';
            } else if (type === 'positive') {
                isValid = parseFloat(val) > 0;
                msg = 'Должно быть > 0';
            } else if (type === 'date') {
                const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(val);
                const localDate = /^\d{2}\.\d{2}\.\d{4}$/.test(val);
                isValid = (isoDate || localDate);
                if (isValid) {
                    const parts = localDate ? val.split('.').reverse() : val.split('-');
                    isValid = !isNaN(Date.parse(parts.join('-')));
                }
                msg = 'Формат ГГГГ-ММ-ДД или ДД.ММ.ГГГГ';
            } else if (type === 'required') {
                isValid = val.length > 0;
                msg = 'Обязательное поле';
            }

            if (!isValid && val.length > 0) {
                input.classList.add('input-error');
                let hint = input.nextElementSibling;
                if (!hint || !hint.classList.contains('validation-hint')) {
                    hint = document.createElement('div');
                    hint.className = 'validation-hint';
                    input.parentNode.insertBefore(hint, input.nextSibling);
                }
                hint.innerText = msg;
            } else {
                input.classList.remove('input-error');
            }
        };

        input.addEventListener('input', validate);
        validate(); // Initial check
    });
}

function renderValidationSummary(validation) {
    const summaryEl = document.getElementById('validationSummary');
    if (!summaryEl) return;

    summaryEl.style.marginBottom = '24px';
    summaryEl.innerHTML = '';

    // Заголовок
    const header = document.createElement('h3');
    header.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        Отчет о кросс-валидации
    `;
    summaryEl.appendChild(header);

    const allErrors = validation.errors || [];
    const criticals = allErrors.filter(e => e.severity === 'CRITICAL');
    const errors    = allErrors.filter(e => e.severity !== 'CRITICAL');
    const successes = (validation.warnings || []).filter(w => w.severity === 'SUCCESS');
    const warnings  = (validation.warnings || []).filter(w => w.severity !== 'SUCCESS');

    if (allErrors.length === 0 && warnings.length === 0 && successes.length === 0) {
        const ok = document.createElement('div');
        ok.className = 'validation-card success';
        ok.innerHTML = '<div class="validation-icon">✅</div>';
        const t = document.createElement('div');
        t.className = 'validation-text';
        t.textContent = 'Данные во всех документах совпадают. Противоречий не обнаружено.';
        ok.appendChild(t);
        summaryEl.appendChild(ok);
        return;
    }

    // Создаёт сворачиваемую группу
    function makeGroup(label, icon, colorVar, items, defaultOpen) {
        if (items.length === 0) return null;

        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom: 6px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.07);';

        // Шапка группы
        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; cursor: pointer; user-select: none;
            background: rgba(255,255,255,0.04);
            transition: background 0.15s;
        `;
        groupHeader.onmouseenter = () => groupHeader.style.background = 'rgba(255,255,255,0.08)';
        groupHeader.onmouseleave = () => groupHeader.style.background = 'rgba(255,255,255,0.04)';

        const left = document.createElement('div');
        left.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px;';

        const iconEl = document.createElement('span');
        iconEl.textContent = icon;

        const labelEl = document.createElement('span');
        labelEl.style.color = colorVar;
        labelEl.textContent = label;

        const badge = document.createElement('span');
        badge.style.cssText = `
            font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 20px;
            background: ${colorVar}22; color: ${colorVar};
        `;
        badge.textContent = items.length;

        left.appendChild(iconEl);
        left.appendChild(labelEl);
        left.appendChild(badge);

        const chevron = document.createElement('span');
        chevron.style.cssText = `color: var(--text-muted); font-size: 11px; transition: transform 0.2s;`;
        chevron.textContent = '▼';

        groupHeader.appendChild(left);
        groupHeader.appendChild(chevron);

        // Тело группы
        const body = document.createElement('div');
        body.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 0 8px 8px 8px;';

        items.forEach(item => {
            const msg = item.message || String(item);
            const card = document.createElement('div');
            card.className = 'validation-card ' + (
                item.severity === 'CRITICAL' ? 'error' :
                item.severity === 'ERROR'    ? 'error' :
                item.severity === 'SUCCESS'  ? 'success' : 'warning'
            );
            card.style.margin = '0';

            const cardIcon = document.createElement('div');
            cardIcon.className = 'validation-icon';
            cardIcon.textContent = icon;

            const text = document.createElement('div');
            text.className = 'validation-text';
            text.textContent = msg;

            card.appendChild(cardIcon);
            card.appendChild(text);
            body.appendChild(card);
        });

        // Сворачивание
        if (!defaultOpen) {
            body.style.display = 'none';
            chevron.style.transform = 'rotate(-90deg)';
        }

        groupHeader.onclick = () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'flex';
            chevron.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
        };

        wrap.appendChild(groupHeader);
        wrap.appendChild(body);
        return wrap;
    }

    const hasCriticals = criticals.length > 0;
    const hasErrors    = errors.length > 0;
    const hasWarnings  = warnings.length > 0;

    const critGroup = makeGroup('Критично (VIN/Номера ТС)', '🚨', '#dc2626', criticals, true);
    const errGroup  = makeGroup('Ошибки',                   '❌', '#ef4444', errors,    !hasCriticals);
    const warnGroup = makeGroup('Предупреждения',            '⚠️', '#f59e0b', warnings,  !hasCriticals && !hasErrors);
    const okGroup   = makeGroup('Подтверждено',              '✅', '#22c55e', successes,  !hasCriticals && !hasErrors && !hasWarnings);

    if (critGroup) summaryEl.appendChild(critGroup);
    if (errGroup)  summaryEl.appendChild(errGroup);
    if (warnGroup) summaryEl.appendChild(warnGroup);
    if (okGroup)   summaryEl.appendChild(okGroup);
}

function highlightFieldsUI(validation) {
    const map = {
        'consignor.name': 'prev-agent-name-consignor',
        'consignee.bin': 'prev-agent-bin-consignee',
        'consignee.name': 'prev-agent-name-consignee',
        'vehicle.tractor': 'prev-tractor-num',
        'vehicle.trailer': 'prev-trailer-num',
        'weight.brutto': 'prev-products-body'
    };

    [...validation.errors, ...validation.warnings].forEach(v => {
        const id = map[v.field];
        if (id) {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add(v.severity === 'ERROR' ? 'error-field' : 'warning-field');
                el.title = v.message;
            }
        }
    });
}
