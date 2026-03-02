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
    summaryEl.innerHTML = `<h3>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        Отчет о кросс-валидации
    </h3>`;

    if (validation.errors.length === 0 && validation.warnings.length === 0) {
        summaryEl.innerHTML += `
            <div class="validation-card success">
                <div class="validation-icon">✅</div>
                <div class="validation-text">Данные во всех документах совпадают. Противоречий не обнаружено.</div>
            </div>
        `;
        return;
    }

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';

    validation.errors.forEach(err => {
        const div = document.createElement('div');
        div.className = 'validation-card error';

        const iconEl = document.createElement('div');
        iconEl.className = 'validation-icon';
        iconEl.textContent = '❌';

        const textEl = document.createElement('div');
        textEl.className = 'validation-text';
        const strong = document.createElement('strong');
        strong.textContent = 'Ошибка: ';
        textEl.appendChild(strong);
        textEl.appendChild(document.createTextNode(err.message));

        div.appendChild(iconEl);
        div.appendChild(textEl);
        list.appendChild(div);
    });

    validation.warnings.forEach(warn => {
        const div = document.createElement('div');
        const isSuccess = warn.severity === 'SUCCESS';
        div.className = `validation-card ${isSuccess ? 'success' : 'warning'}`;

        const iconEl = document.createElement('div');
        iconEl.className = 'validation-icon';
        iconEl.textContent = isSuccess ? '✅' : '⚠️';

        const textEl = document.createElement('div');
        textEl.className = 'validation-text';
        if (!isSuccess) {
            const strong = document.createElement('strong');
            strong.textContent = 'Внимание: ';
            textEl.appendChild(strong);
        }
        textEl.appendChild(document.createTextNode(warn.message));

        div.appendChild(iconEl);
        div.appendChild(textEl);
        list.appendChild(div);
    });

    summaryEl.appendChild(list);
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
