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
