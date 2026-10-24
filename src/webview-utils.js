// Collect script errors from the moment the page starts. This classic script runs before the ES module
// entry point, so errors thrown while the modules load are captured too. `acquireVsCodeApi` may only be
// called once per page, so the module side (core/api.js) flushes these to the extension host.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.__fcmErrors = window.__fcmErrors || [];
    const record = (entry) => {
        if (typeof window.__fcmReportError === 'function') {
            window.__fcmReportError(entry);
        } else {
            window.__fcmErrors.push(entry);
        }
    };
    window.addEventListener('error', (event) => {
        record({
            message: String((event && event.message) || (event && event.error && event.error.message) || 'Script error'),
            source: event && event.filename ? String(event.filename) : undefined,
            line: event && typeof event.lineno === 'number' ? event.lineno : undefined,
            stack: event && event.error && event.error.stack ? String(event.error.stack) : undefined,
        });
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason;
        record({
            message: `Unhandled promise rejection: ${reason && reason.message ? reason.message : String(reason)}`,
            stack: reason && reason.stack ? String(reason.stack) : undefined,
        });
    });
}

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PermissionManagerUtils = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    function normalizeText(value) {
        return (value || '').toString().toLowerCase();
    }

    function dedupePermissions(permissions) {
        const seen = new Set();
        return permissions.filter(permission => {
            const key = normalizeText(permission.constantValue || permission.permission || '');
            if (!key || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    function filterPermissions(permissions, query, category) {
        const normalizedQuery = normalizeText(query);
        const normalizedCategory = normalizeText(category);
        return permissions.filter(permission => {
            const matchesCategory = !normalizedCategory || normalizeText(permission.category) === normalizedCategory;
            if (!normalizedQuery) {
                return matchesCategory;
            }
            const haystack = [
                permission.permission,
                permission.description,
                permission.constantValue,
                permission.category
            ].map(normalizeText).join(' ');
            return matchesCategory && haystack.includes(normalizedQuery);
        });
    }

    function sortPermissions(permissions, column, direction) {
        const sorted = [...permissions];
        sorted.sort((a, b) => {
            const valueA = normalizeText(a[column]);
            const valueB = normalizeText(b[column]);
            if (valueA === valueB) {
                return 0;
            }
            if (direction === 'desc') {
                return valueA < valueB ? 1 : -1;
            }
            return valueA > valueB ? 1 : -1;
        });
        return sorted;
    }

    function validateSelection(selection) {
        if (!selection) {
            return { valid: false, message: 'Select a permission before adding.' };
        }
        if (!selection.permission && !selection.constantValue) {
            return { valid: false, message: 'Invalid permission entry.' };
        }
        return { valid: true, message: '' };
    }

    return {
        normalizeText,
        dedupePermissions,
        filterPermissions,
        sortPermissions,
        validateSelection
    };
});
