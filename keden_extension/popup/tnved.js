/**
 * TNVED Validation Service
 * Validates TNVED codes against the official Keden classifier API.
 */

const TNVED_API_BASE = 'https://keden.kgd.gov.kz/api/v1/cnfea/cnfea';

/**
 * Validates a single TNVED code by querying the Keden API.
 * Uses /es/tree/by-code/{code} endpoint - returns 200 if code exists, 400 if not.
 * @param {string} code - The TNVED code to validate (6+ digits).
 * @returns {Promise<{valid: boolean, description?: string}>}
 */
async function validateTNVEDCode(code) {
    if (!code || code.length < 6) {
        return { valid: false, reason: 'Code too short' };
    }

    // Use only first 6 digits for validation
    const codePrefix = code.substring(0, 6);

    try {
        // Use the correct endpoint: GET /es/tree/by-code/{code}
        const response = await fetch(`${TNVED_API_BASE}/es/tree/by-code/${codePrefix}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        // Status 200 = code exists, 400 = code not found
        if (response.ok) {
            const data = await response.json();
            return { valid: true, description: data.title || data.description };
        } else {
            return { valid: false, reason: 'Not found' };
        }
    } catch (error) {
        console.error('TNVED validation error:', error);
        return { valid: false, reason: 'Network error' };
    }
}

/**
 * Validates all product codes and updates validation status.
 * @param {Array} products - Array of product objects with tnvedCode property.
 * @returns {Promise<Array>} - Array of validation results matching product indices.
 */
async function validateProductCodes(products) {
    if (!products || products.length === 0) {
        return [];
    }

    const validationPromises = products.map(product => validateTNVEDCode(product.tnvedCode));
    return Promise.all(validationPromises);
}

/**
 * Updates the visual status of a TNVED input field.
 * @param {HTMLElement} inputElement - The input element to update.
 * @param {string} status - 'valid', 'invalid', or 'loading'.
 */
function setTNVEDValidationStatus(inputElement, status) {
    if (!inputElement) return;

    // Remove existing status classes
    inputElement.classList.remove('tnved-valid', 'tnved-invalid', 'tnved-loading');

    // Add the new status class
    if (status === 'valid') {
        inputElement.classList.add('tnved-valid');
    } else if (status === 'invalid') {
        inputElement.classList.add('tnved-invalid');
    } else if (status === 'loading') {
        inputElement.classList.add('tnved-loading');
    }
}

/**
 * Validates all TNVED inputs currently visible in the preview table.
 */
async function validateAllVisibleTNVEDInputs() {
    const tnvedInputs = document.querySelectorAll('.prev-prod-tnved');
    if (tnvedInputs.length === 0) return;

    // Set all to loading state
    tnvedInputs.forEach(input => setTNVEDValidationStatus(input, 'loading'));

    // Validate each code
    for (const input of tnvedInputs) {
        const code = input.value.trim();
        const result = await validateTNVEDCode(code);
        setTNVEDValidationStatus(input, result.valid ? 'valid' : 'invalid');
    }
}
