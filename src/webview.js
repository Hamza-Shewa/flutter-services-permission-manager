(function () {
    const vscode = acquireVsCodeApi();
    const utils = window.PermissionManagerUtils;

    const androidTableBody = document.getElementById('androidPermissionTable');
    const iosTableBody = document.getElementById('iosPermissionTable');
    const searchInput = document.getElementById('permissionSearch');
    const categoryFilter = document.getElementById('categoryFilter');
    const addAndroidButton = document.getElementById('addAndroidPermissionButton');
    const addIosButton = document.getElementById('addIosPermissionButton');
    const iosSearchInput = document.getElementById('iosPermissionSearch');
    const iosCategoryFilter = document.getElementById('iosCategoryFilter');
    const saveButton = document.getElementById('savePermissionsButton');
    const statusMessage = document.getElementById('statusMessage');

    const modalBackdrop = document.getElementById('modalBackdrop');
    const modalSearch = document.getElementById('modalSearch');
    const modalResults = document.getElementById('modalResults');
    const modalError = document.getElementById('modalError');
    const modalValueContainer = document.getElementById('modalValueContainer');
    const modalValueInput = document.getElementById('modalValueInput');
    const modalValueSelect = document.getElementById('modalValueSelect');
    const modalValueHint = document.getElementById('modalValueHint');
    const androidCountChip = document.getElementById('androidCountChip');
    const iosCountChip = document.getElementById('iosCountChip');
    const modalCancel = document.getElementById('modalCancel');
    const modalAdd = document.getElementById('modalAdd');

    const state = {
        androidPermissions: [],
        iosPermissions: [],
        allAndroidPermissions: [],
        allIosPermissions: [],
        search: '',
        category: '',
        iosSearch: '',
        iosCategory: '',
        sort: { column: 'permission', direction: 'asc' },
        modalQuery: '',
        modalSelection: null,
        modalMode: 'android'
    };

    function setStatus(message, type) {
        statusMessage.textContent = message || '';
        statusMessage.className = `status ${type || ''}`.trim();
    }

    function renderAndroidTable() {
        const uniquePermissions = utils.dedupePermissions(state.androidPermissions);
        const filtered = utils.filterPermissions(uniquePermissions, state.search, state.category);
        const sorted = utils.sortPermissions(filtered, state.sort.column, state.sort.direction);

        androidTableBody.innerHTML = '';
        if (sorted.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.className = 'empty-state';
            cell.textContent = 'No permissions found.';
            row.appendChild(cell);
            androidTableBody.appendChild(row);
            return;
        }

        sorted.forEach(permission => {
            const row = document.createElement('tr');
            const cells = [
                permission.permission || '',
                permission.description || '',
                permission.constantValue || '',
                permission.category || '',
                permission.apiLevel || ''
            ];
            cells.forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            androidTableBody.appendChild(row);
        });
    }

    function renderIOSTable() {
        iosTableBody.innerHTML = '';
        const filtered = utils.filterPermissions(state.iosPermissions || [], state.iosSearch, state.iosCategory);
        if (!filtered || filtered.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.className = 'empty-state';
            cell.textContent = 'No permissions found.';
            row.appendChild(cell);
            iosTableBody.appendChild(row);
            return;
        }
        filtered.forEach(permission => {
            const index = state.iosPermissions.indexOf(permission);
            const row = document.createElement('tr');
            const permissionCell = document.createElement('td');
            permissionCell.textContent = permission.permission || '';
            row.appendChild(permissionCell);

            const valueCell = document.createElement('td');
            const type = (permission.type || '').toLowerCase();
            if (type === 'boolean') {
                const select = document.createElement('select');
                select.innerHTML = '<option value="true">true</option><option value="false">false</option>';
                select.value = String(Boolean(permission.value));
                select.addEventListener('change', event => {
                    const target = event.target;
                    state.iosPermissions[index].value = target.value === 'true';
                });
                valueCell.appendChild(select);
            } else {
                const textarea = document.createElement('textarea');
                textarea.placeholder = 'Usage description';
                textarea.value = typeof permission.value === 'string' ? permission.value : '';
                textarea.addEventListener('input', event => {
                    const target = event.target;
                    state.iosPermissions[index].value = target.value;
                });
                valueCell.appendChild(textarea);
            }
            row.appendChild(valueCell);

            const descriptionCell = document.createElement('td');
            descriptionCell.textContent = permission.description || '';
            row.appendChild(descriptionCell);

            const categoryCell = document.createElement('td');
            categoryCell.textContent = permission.category || '';
            row.appendChild(categoryCell);
            iosTableBody.appendChild(row);
        });
    }

    function renderCategoryOptions() {
        const categories = Array.from(new Set(state.androidPermissions.map(permission => permission.category).filter(Boolean))).sort();
        const current = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="">All categories</option>';
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        });
        categoryFilter.value = current;
    }

    function renderIOSCategoryOptions() {
        const categories = Array.from(new Set((state.iosPermissions || []).map(permission => permission.category).filter(Boolean))).sort();
        const current = iosCategoryFilter.value;
        iosCategoryFilter.innerHTML = '<option value="">All categories</option>';
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            iosCategoryFilter.appendChild(option);
        });
        iosCategoryFilter.value = current;
    }

    function applySortIndicator() {
        document.querySelectorAll('th[data-column]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.column === state.sort.column) {
                th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    function updateView() {
        renderCategoryOptions();
        renderIOSCategoryOptions();
        renderAndroidTable();
        renderIOSTable();
        applySortIndicator();
        updateCounts();
    }

    function updateCounts() {
        const androidCount = utils.dedupePermissions(state.androidPermissions).length;
        const iosCount = state.iosPermissions ? state.iosPermissions.length : 0;
        androidCountChip.textContent = `Android: ${androidCount}`;
        iosCountChip.textContent = `iOS: ${iosCount}`;
    }

    function openModal(mode) {
        state.modalMode = mode;
        const modalTitle = document.getElementById('modalTitle');
        modalTitle.textContent = mode === 'ios' ? 'Add iOS Permission' : 'Add Android Permission';
        modalBackdrop.style.display = 'flex';
        modalSearch.value = '';
        modalError.textContent = '';
        state.modalQuery = '';
        state.modalSelection = null;
        modalValueInput.value = '';
        modalValueSelect.value = 'true';
        modalValueContainer.style.display = mode === 'ios' ? 'block' : 'none';
        modalValueInput.style.display = 'block';
        modalValueSelect.style.display = 'none';
        modalValueHint.textContent = 'Provide a usage description required by Apple.';
        renderModalResults();
        modalSearch.focus();
    }

    function closeModal() {
        modalBackdrop.style.display = 'none';
    }

    function renderModalResults() {
        modalResults.innerHTML = '';
        const isIos = state.modalMode === 'ios';
        const usedKeys = new Set(
            (isIos ? state.iosPermissions : state.androidPermissions)
                .map(permission => utils.normalizeText(permission.permission || permission.constantValue))
        );
        const sourceList = isIos ? state.allIosPermissions : state.allAndroidPermissions;
        const filtered = utils.filterPermissions(sourceList, state.modalQuery, '');
        const available = filtered.filter(permission =>
            !usedKeys.has(utils.normalizeText(permission.permission || permission.constantValue))
        );

        if (available.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No matching permissions.';
            modalResults.appendChild(empty);
            return;
        }

        available.forEach(permission => {
            const item = document.createElement('div');
            item.className = 'modal-item';
            const label = permission.permission || '';
            const suffix = permission.constantValue ? ` (${permission.constantValue})` : '';
            item.textContent = `${label}${suffix}`;
            item.addEventListener('click', () => {
                modalResults.querySelectorAll('.modal-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                state.modalSelection = permission;
                modalError.textContent = '';
                if (isIos) {
                    const type = (permission.type || '').toLowerCase();
                    if (type === 'boolean') {
                        modalValueInput.style.display = 'none';
                        modalValueSelect.style.display = 'block';
                        modalValueHint.textContent = 'Select true or false for this key.';
                    } else {
                        modalValueInput.style.display = 'block';
                        modalValueSelect.style.display = 'none';
                        modalValueHint.textContent = 'Provide a usage description required by Apple.';
                    }
                }
            });
            modalResults.appendChild(item);
        });
    }

    function addSelectedPermission() {
        const validation = utils.validateSelection(state.modalSelection);
        if (!validation.valid) {
            modalError.textContent = validation.message;
            modalError.className = 'status error';
            return;
        }

        const selected = state.modalSelection;
        const isIos = state.modalMode === 'ios';
        const existing = (isIos ? state.iosPermissions : state.androidPermissions).some(permission =>
            utils.normalizeText(permission.constantValue || permission.permission) ===
            utils.normalizeText(selected.constantValue || selected.permission)
        );

        if (existing) {
            modalError.textContent = 'Permission already added.';
            modalError.className = 'status error';
            return;
        }

        if (isIos) {
            const type = (selected.type || '').toLowerCase();
            let value;
            if (type === 'boolean') {
                value = modalValueSelect.value === 'true';
            } else {
                value = modalValueInput.value.trim();
                if (!value) {
                    modalError.textContent = 'Enter a usage description for this permission.';
                    modalError.className = 'status error';
                    return;
                }
            }
            state.iosPermissions = [...state.iosPermissions, { ...selected, value }];
        } else {
            state.androidPermissions = [...state.androidPermissions, selected];
        }
        closeModal();
        updateView();
    }

    function handleSave() {
        const androidPermissions = utils.dedupePermissions(state.androidPermissions)
            .map(permission => permission.constantValue || permission.permission)
            .filter(Boolean);
        const iosPermissions = (state.iosPermissions || [])
            .map(permission => ({
                permission: permission.permission,
                value: permission.value,
                type: permission.type
            }))
            .filter(entry => entry.permission);
        setStatus('Saving permissions...', '');
        vscode.postMessage({
            type: 'savePermissions',
            androidPermissions,
            iosPermissions
        });
    }

    searchInput.addEventListener('input', event => {
        state.search = event.target.value;
        updateView();
    });

    iosSearchInput.addEventListener('input', event => {
        state.iosSearch = event.target.value;
        updateView();
    });

    iosCategoryFilter.addEventListener('change', event => {
        state.iosCategory = event.target.value;
        updateView();
    });

    categoryFilter.addEventListener('change', event => {
        state.category = event.target.value;
        updateView();
    });

    document.querySelectorAll('th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;
            if (state.sort.column === column) {
                state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.sort.column = column;
                state.sort.direction = 'asc';
            }
            updateView();
        });
    });

    addAndroidButton.addEventListener('click', () => {
        openModal('android');
        vscode.postMessage({ type: 'requestAllAndroidPermissions' });
    });

    addIosButton.addEventListener('click', () => {
        openModal('ios');
        vscode.postMessage({ type: 'requestAllIOSPermissions' });
    });

    saveButton.addEventListener('click', handleSave);

    modalCancel.addEventListener('click', closeModal);
    modalAdd.addEventListener('click', addSelectedPermission);
    modalSearch.addEventListener('input', event => {
        state.modalQuery = event.target.value;
        renderModalResults();
    });

    window.addEventListener('message', event => {
        const message = event.data;
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'permissions':
                state.androidPermissions = message.androidPermissions || [];
                state.iosPermissions = message.iosPermissions || [];
                updateView();
                break;
            case 'allAndroidPermissions':
                state.allAndroidPermissions = message.permissions || [];
                renderModalResults();
                break;
            case 'allIOSPermissions':
                state.allIosPermissions = message.permissions || [];
                renderModalResults();
                break;
            case 'saveResult':
                setStatus(message.message || '', message.success ? 'success' : 'error');
                break;
            default:
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
})();
