// KEDEN Extension - UI Files (файлы и drag-and-drop)
// Зависит от: ui_core.js (setStatus, showToast)

window.appExtensionFiles = [];

function handleFiles(newFiles) {
    window.appExtensionFiles = window.appExtensionFiles.concat(newFiles);
    renderFileList();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    if (!fileList) return;
    fileList.innerHTML = '';

    if (window.appExtensionFiles.length > 0) {
        window.appExtensionFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item';

            const icon = document.createElement('div');
            icon.className = 'file-icon';
            icon.innerHTML = '📄';

            const info = document.createElement('div');
            info.className = 'file-info';

            const name = document.createElement('div');
            name.className = 'file-name';
            name.textContent = file.name;

            const size = document.createElement('div');
            size.className = 'file-size';
            size.textContent = (file.size / 1024).toFixed(1) + ' KB';

            info.appendChild(name);
            info.appendChild(size);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = () => {
                window.appExtensionFiles.splice(index, 1);
                renderFileList();
            };

            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(removeBtn);
            fileList.appendChild(item);
        });
        document.getElementById('statusMessage').style.display = 'block';
        document.getElementById('statusMessage').innerText = `Готово к анализу: ${window.appExtensionFiles.length} файла(ов)`;
    } else {
        document.getElementById('statusMessage').style.display = 'none';
    }
}

// Drag and drop logic
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

if (dropZone && fileInput) {
    dropZone.onclick = () => fileInput.click();

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#3b82f6';
        dropZone.style.background = 'rgba(59, 130, 246, 0.05)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        dropZone.style.background = 'transparent';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        dropZone.style.background = 'transparent';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(Array.from(files));
        }
    });

    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
        // Сбрасываем input, чтобы можно было выбрать тот же файл еще раз, если его удалили из списка
        e.target.value = '';
    };
}

function initSmartDragAndDrop() {
    const overlay = document.getElementById('smart-drop-overlay');
    if (!overlay) return;

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('visible');
    });

    overlay.addEventListener('dragleave', (e) => {
        // Only hide if we actually leave the overlay area (not just child elements)
        if (e.relatedTarget === null || !overlay.contains(e.relatedTarget)) {
            overlay.classList.remove('visible');
        }
    });

    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('visible');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(Array.from(files));
        }
    });
}

// Initialize Smart Drag & Drop immediately
initSmartDragAndDrop();
