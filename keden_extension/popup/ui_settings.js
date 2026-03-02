// KEDEN Extension - Settings Panel
// Manages kedenDirectorySettings: load from chrome.storage, save, UI handlers

let kedenDirectorySettings = {};

// Load settings from Chrome storage and populate form inputs
chrome.storage.local.get(['kedenDirectorySettings'], (result) => {
    if (result.kedenDirectorySettings) {
        kedenDirectorySettings = result.kedenDirectorySettings;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; }
        setVal('prefCarrierBin', kedenDirectorySettings.carrierBin);
        setVal('prefDeclarantBin', kedenDirectorySettings.declarantBin);

        setVal('prefCustomsCode', kedenDirectorySettings.customsCode);
        setVal('prefDestCustomsCode', kedenDirectorySettings.destCustomsCode);
        setVal('prefTransportMode', kedenDirectorySettings.transportMode);
        setVal('prefRepCertNum', kedenDirectorySettings.repCertNum);
        setVal('prefRepCertDate', kedenDirectorySettings.repCertDate);
        setVal('prefAeoCertNum', kedenDirectorySettings.aeoCertNum);
        setVal('prefAeoCertDate', kedenDirectorySettings.aeoCertDate);
        setVal('prefExpDogNum', kedenDirectorySettings.expDogNum);
        setVal('prefExpDogDate', kedenDirectorySettings.expDogDate);
    }
});

// Settings panel UI handlers
document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('settingsPanel').style.display = 'block';
};

document.getElementById('closeSettingsBtn').onclick = () => {
    document.getElementById('settingsPanel').style.display = 'none';
};

document.getElementById('saveSettingsBtn').onclick = () => {
    kedenDirectorySettings = {
        carrierBin: document.getElementById('prefCarrierBin').value.trim(),
        declarantBin: document.getElementById('prefDeclarantBin').value.trim(),

        customsCode: document.getElementById('prefCustomsCode').value.trim(),
        destCustomsCode: document.getElementById('prefDestCustomsCode').value.trim(),
        transportMode: document.getElementById('prefTransportMode').value.trim(),
        repCertNum: document.getElementById('prefRepCertNum').value.trim(),
        repCertDate: document.getElementById('prefRepCertDate').value.trim(),
        aeoCertNum: document.getElementById('prefAeoCertNum').value.trim(),
        aeoCertDate: document.getElementById('prefAeoCertDate').value.trim(),
        expDogNum: document.getElementById('prefExpDogNum').value.trim(),
        expDogDate: document.getElementById('prefExpDogDate').value.trim()
    };
    chrome.storage.local.set({ kedenDirectorySettings }, () => {
        const status = document.getElementById('settingsSaveStatus');
        status.style.display = 'block';
        setTimeout(() => status.style.display = 'none', 2000);
    });
};
