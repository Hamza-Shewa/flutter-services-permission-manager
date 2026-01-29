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
    const toastContainer = document.getElementById('toastContainer');
    const refreshButton = document.getElementById('refreshButton');

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

    const crossPlatformModalBackdrop = document.getElementById('crossPlatformModalBackdrop');
    const crossPlatformModalTitle = document.getElementById('crossPlatformModalTitle');
    const crossPlatformModalMessage = document.getElementById('crossPlatformModalMessage');
    const crossPlatformSuggestions = document.getElementById('crossPlatformSuggestions');
    const crossPlatformModalError = document.getElementById('crossPlatformModalError');
    const crossPlatformModalSkip = document.getElementById('crossPlatformModalSkip');
    const crossPlatformModalAdd = document.getElementById('crossPlatformModalAdd');

    const equivalentModalBackdrop = document.getElementById('equivalentModalBackdrop');
    const equivalentModalTitle = document.getElementById('equivalentModalTitle');
    const equivalentModalMessage = document.getElementById('equivalentModalMessage');
    const equivalentSuggestions = document.getElementById('equivalentSuggestions');
    const equivalentModalError = document.getElementById('equivalentModalError');
    const equivalentModalCancel = document.getElementById('equivalentModalCancel');
    const equivalentModalAdd = document.getElementById('equivalentModalAdd');

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
        modalMode: 'android',
        modalCategory: '',
        hasAndroidManifest: false,
        hasIOSPlist: false,
        pendingCrossPlatformPermissions: [],
        crossPlatformMode: null,
        pendingCrossPlatformModal: null,
        pendingEquivalentModal: null,
        equivalentPermissions: []
    };

    /**
     * Shows an animated toast notification
     * @param {string} message - The message to display
     * @param {'success' | 'error' | 'info'} type - The type of toast
     * @param {number} duration - How long to show the toast (ms)
     */
    function showToast(message, type = 'info', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-content">${message}</div>
            <button class="toast-close" aria-label="Close">×</button>
            <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
        `;
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => dismissToast(toast));
        
        toastContainer.appendChild(toast);
        
        // Auto dismiss after duration
        setTimeout(() => dismissToast(toast), duration);
        
        return toast;
    }
    
    /**
     * Dismisses a toast with animation
     */
    function dismissToast(toast) {
        if (!toast || toast.classList.contains('hiding')) return;
        
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }

    // Legacy setStatus function - now uses toast
    function setStatus(message, type) {
        if (!message) return;
        
        // Map old types to toast types
        const toastType = type === 'success' ? 'success' : type === 'error' ? 'error' : 'info';
        showToast(message, toastType);
        
        // Also update hidden status element for compatibility
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
            cell.colSpan = 6;
            cell.className = 'empty-state';
            cell.textContent = 'No permissions found.';
            row.appendChild(cell);
            androidTableBody.appendChild(row);
            return;
        }

        sorted.forEach((permission, index) => {
            const row = document.createElement('tr');
            
            // Permission cell with equivalent button
            const permissionCell = document.createElement('td');
            const permissionText = document.createElement('span');
            permissionText.textContent = permission.permission || '';
            permissionCell.appendChild(permissionText);
            
            if (permission.equivalentIosPermissions && permission.equivalentIosPermissions.length > 0) {
                const equivalentButton = document.createElement('button');
                equivalentButton.className = 'equivalent-button';
                equivalentButton.textContent = 'Add equivalent';
                equivalentButton.addEventListener('click', () => {
                    showEquivalentModal(permission, 'ios');
                });
                permissionCell.appendChild(equivalentButton);
            }
            row.appendChild(permissionCell);
            
            // Other cells
            const otherCells = [
                permission.description || '',
                permission.constantValue || '',
                permission.category || '',
                permission.apiLevel || ''
            ];
            otherCells.forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            
            // Add delete button
            const actionsCell = document.createElement('td');
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => {
                state.androidPermissions.splice(state.androidPermissions.indexOf(permission), 1);
                updateView();
            });
            actionsCell.appendChild(deleteButton);
            row.appendChild(actionsCell);
            
            androidTableBody.appendChild(row);
        });
    }

    function renderIOSTable() {
        iosTableBody.innerHTML = '';
        const filtered = utils.filterPermissions(state.iosPermissions || [], state.iosSearch, state.iosCategory);
        if (!filtered || filtered.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            cell.className = 'empty-state';
            cell.textContent = 'No permissions found.';
            row.appendChild(cell);
            iosTableBody.appendChild(row);
            return;
        }
        filtered.forEach(permission => {
            const index = state.iosPermissions.indexOf(permission);
            const row = document.createElement('tr');
            
            // Permission cell with equivalent button
            const permissionCell = document.createElement('td');
            const permissionText = document.createElement('span');
            permissionText.textContent = permission.permission || '';
            permissionCell.appendChild(permissionText);
            
            if (permission.equivalentAndroidPermissions && permission.equivalentAndroidPermissions.length > 0) {
                const equivalentButton = document.createElement('button');
                equivalentButton.className = 'equivalent-button';
                equivalentButton.textContent = 'Add equivalent';
                equivalentButton.addEventListener('click', () => {
                    showEquivalentModal(permission, 'android');
                });
                permissionCell.appendChild(equivalentButton);
            }
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

            // Add delete button
            const actionsCell = document.createElement('td');
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-button';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => {
                state.iosPermissions.splice(index, 1);
                updateView();
            });
            actionsCell.appendChild(deleteButton);
            row.appendChild(actionsCell);

            iosTableBody.appendChild(row);
        });
    }

    function renderCategoryOptions() {
        const categoryFilter = document.getElementById('categoryFilter');
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
        const iosCategoryFilter = document.getElementById('iosCategoryFilter');
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

    function renderModalCategoryTabs() {
        const modalCategoryTabs = document.getElementById('modalCategoryTabs');
        const isIos = state.modalMode === 'ios';
        const sourceList = isIos ? state.allIosPermissions : state.allAndroidPermissions;
        const categories = Array.from(new Set(sourceList.map(permission => permission.category).filter(Boolean))).sort();
        
        modalCategoryTabs.innerHTML = '';
        
        // Create "All" tab
        const allTab = document.createElement('button');
        allTab.className = 'category-tab active';
        allTab.dataset.category = '';
        allTab.textContent = 'All';
        allTab.addEventListener('click', () => {
            modalCategoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            allTab.classList.add('active');
            state.modalCategory = '';
            renderModalResults();
        });
        modalCategoryTabs.appendChild(allTab);
        
        categories.forEach(category => {
            const tab = document.createElement('button');
            tab.className = 'category-tab';
            tab.dataset.category = category;
            tab.textContent = category;
            tab.addEventListener('click', () => {
                // Update active tab
                modalCategoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                // Update modal filter
                state.modalCategory = category;
                renderModalResults();
            });
            modalCategoryTabs.appendChild(tab);
        });
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
        state.modalCategory = '';
        modalValueInput.value = '';
        modalValueSelect.value = 'true';
        modalValueContainer.style.display = mode === 'ios' ? 'block' : 'none';
        modalValueInput.style.display = 'block';
        modalValueSelect.style.display = 'none';
        modalValueHint.textContent = 'Provide a usage description required by Apple.';
        renderModalCategoryTabs();
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
        const filtered = utils.filterPermissions(sourceList, state.modalQuery, state.modalCategory);
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

        // Check for cross-platform equivalents
        const equivalents = isIos ? selected.equivalentAndroidPermissions : selected.equivalentIosPermissions;
        const hasCrossPlatformFile = isIos ? state.hasAndroidManifest : state.hasIOSPlist;
        
        if (equivalents && equivalents.length > 0 && hasCrossPlatformFile) {
            // Ensure we have the target platform permissions loaded
            if (!isIos && state.allIosPermissions.length === 0) {
                vscode.postMessage({ type: 'requestAllIOSPermissions' });
            } else if (isIos && state.allAndroidPermissions.length === 0) {
                vscode.postMessage({ type: 'requestAllAndroidPermissions' });
            }
            // Show cross-platform suggestion modal
            showCrossPlatformModal(selected, equivalents, isIos);
            return;
        }

        // No equivalents or no cross-platform file, add directly
        try {
            addPermissionDirectly(selected, isIos);
            closeModal();
            updateView();
        } catch (error) {
            modalError.textContent = error.message;
            modalError.className = 'status error';
        }
    }

    function addPermissionDirectly(selected, isIos) {
        // Check for duplicates
        const existing = (isIos ? state.iosPermissions : state.androidPermissions).some(permission =>
            utils.normalizeText(permission.constantValue || permission.permission) ===
            utils.normalizeText(selected.constantValue || selected.permission)
        );

        if (existing) {
            throw new Error('Permission already added.');
        }

        if (isIos) {
            const type = (selected.type || '').toLowerCase();
            let value;
            if (type === 'boolean') {
                value = modalValueSelect.value === 'true';
            } else {
                value = modalValueInput.value.trim();
                if (!value || value === 'TODO: Provide usage description.') {
                    throw new Error('Please provide a valid usage description for this iOS permission.');
                }
            }
            state.iosPermissions = [...state.iosPermissions, { ...selected, value }];
            showToast(`iOS permission "${selected.permission}" added successfully`, 'success');
        } else {
            state.androidPermissions = [...state.androidPermissions, selected];
            showToast(`Android permission "${selected.permission}" added successfully`, 'success');
        }
    }

    function showCrossPlatformModal(selected, equivalents, isSourceIos) {
        // Ensure target platform permissions are loaded
        const needsTargetPermissions = isSourceIos ? state.allAndroidPermissions.length === 0 : state.allIosPermissions.length === 0;
        
        if (needsTargetPermissions) {
            // Load target permissions first
            const messageType = isSourceIos ? 'requestAllAndroidPermissions' : 'requestAllIOSPermissions';
            vscode.postMessage({ type: messageType });
            
            // Store the modal data and show modal after permissions load
            state.pendingCrossPlatformModal = { selected, equivalents, isSourceIos };
            return;
        }
        
        showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
    }
    
    function showCrossPlatformModalInternal(selected, equivalents, isSourceIos) {
        state.pendingCrossPlatformPermissions = [];
        state.crossPlatformMode = isSourceIos ? 'ios-to-android' : 'android-to-ios';
        
        crossPlatformModalTitle.textContent = `Add ${isSourceIos ? 'Android' : 'iOS'} Equivalents`;
        crossPlatformModalMessage.textContent = `The ${isSourceIos ? 'iOS' : 'Android'} permission "${selected.permission || selected.constantValue}" has equivalent permissions on the other platform. Would you like to add them?`;
        
        crossPlatformSuggestions.innerHTML = '';
        
        equivalents.forEach((equivalent, index) => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.className = 'cross-platform-suggestion';
            suggestionDiv.dataset.permissionName = equivalent; // Store permission name
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `equivalent-${index}`;
            checkbox.checked = true; // Default to checked
            
            const label = document.createElement('label');
            label.htmlFor = `equivalent-${index}`;
            label.textContent = equivalent;
            
            // For iOS permissions, add value input if needed
            let valueInput = null;
            if (isSourceIos) { // Adding Android equivalents, so no value input needed
                // Android permissions don't need values
            } else { // Adding iOS equivalents, may need values
                const iosPermission = state.allIosPermissions.find(p => p.permission === equivalent);
                if (iosPermission && (iosPermission.type || '').toLowerCase() !== 'boolean') {
                    valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.placeholder = 'Usage description (required)';
                    valueInput.className = 'equivalent-value-input';
                    valueInput.required = true;
                }
            }
            
            suggestionDiv.appendChild(checkbox);
            suggestionDiv.appendChild(label);
            if (valueInput) {
                suggestionDiv.appendChild(valueInput);
            }
            
            crossPlatformSuggestions.appendChild(suggestionDiv);
        });
        
        crossPlatformModalBackdrop.style.display = 'flex';
    }

    function addCrossPlatformPermissions() {
        const suggestions = crossPlatformSuggestions.querySelectorAll('.cross-platform-suggestion');
        const isSourceIos = state.crossPlatformMode === 'ios-to-android';
        let addedCount = 0;
        const errors = [];
        
        suggestions.forEach((suggestion) => {
            const checkbox = suggestion.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                const permissionName = suggestion.dataset.permissionName;
                
                if (isSourceIos) {
                    // Adding Android permission - check if it already exists
                    const existing = state.androidPermissions.some(permission =>
                        utils.normalizeText(permission.constantValue || permission.permission) === 
                        utils.normalizeText(permissionName)
                    );
                    if (!existing) {
                        const androidPermission = state.allAndroidPermissions.find(p => 
                            p.constantValue === permissionName || p.permission === permissionName);
                        if (androidPermission) {
                            state.androidPermissions = [...state.androidPermissions, androidPermission];
                            addedCount++;
                        }
                    }
                } else {
                    // Adding iOS permission - check if it already exists
                    const existing = state.iosPermissions.some(permission =>
                        utils.normalizeText(permission.permission) === utils.normalizeText(permissionName)
                    );
                    if (!existing) {
                        const iosPermission = state.allIosPermissions.find(p => p.permission === permissionName);
                        if (iosPermission) {
                            const valueInput = suggestion.querySelector('.equivalent-value-input');
                            let value;
                            const type = (iosPermission.type || '').toLowerCase();
                            if (type === 'boolean') {
                                value = true; // Default to true for cross-platform adds
                            } else {
                                value = valueInput ? valueInput.value.trim() : '';
                                if (!value || value === 'TODO: Provide usage description.') {
                                    errors.push(permissionName);
                                    return; // Skip this permission
                                }
                            }
                            state.iosPermissions = [...state.iosPermissions, { ...iosPermission, value }];
                            addedCount++;
                        }
                    }
                }
            }
        });
        
        if (errors.length > 0) {
            showToast(`Please provide usage descriptions for: ${errors.join(', ')}`, 'error', 5000);
            return; // Don't close modal
        }
        
        if (addedCount > 0) {
            const platform = isSourceIos ? 'Android' : 'iOS';
            showToast(`${addedCount} ${platform} equivalent permission${addedCount > 1 ? 's' : ''} added`, 'success');
        }
        
        closeCrossPlatformModal();
        try {
            addPermissionDirectly(state.modalSelection, state.modalMode === 'ios');
            closeModal();
            updateView();
        } catch (error) {
            showToast(error.message, 'error');
            return; // Don't close modal if there's an error
        }
        closeModal();
        updateView();
    }

    function closeCrossPlatformModal() {
        crossPlatformModalBackdrop.style.display = 'none';
        state.pendingCrossPlatformPermissions = [];
        state.crossPlatformMode = null;
    }

    function showEquivalentModal(permission, targetPlatform) {
        const sourceList = targetPlatform === 'ios' ? state.allIosPermissions : state.allAndroidPermissions;
        if (sourceList.length === 0) {
            // Request the permissions if not loaded
            const messageType = targetPlatform === 'ios' ? 'requestAllIOSPermissions' : 'requestAllAndroidPermissions';
            vscode.postMessage({ type: messageType });
            state.pendingEquivalentModal = { permission, targetPlatform };
            return;
        }

        const equivalents = targetPlatform === 'ios' ? permission.equivalentIosPermissions : permission.equivalentAndroidPermissions;
        if (!equivalents || equivalents.length === 0) {
            showToast('No equivalent permissions found for this permission.', 'info');
            return;
        }
        const equivalentPermissions = equivalents.map(name => sourceList.find(p => p.permission === name || p.constantValue === name)).filter(Boolean);
        
        // Compute available permissions (not already added)
        const availablePermissions = equivalentPermissions.filter(perm => {
            const isAlreadyAdded = targetPlatform === 'ios' ? state.iosPermissions.some(p => p.permission === perm.permission) : state.androidPermissions.some(p => p.permission === perm.permission);
            return !isAlreadyAdded;
        });
        
        // Check if all equivalents are already added
        if (availablePermissions.length === 0) {
            showToast('All equivalent permissions are already added.', 'info');
            return;
        }
        
        const categories = Array.from(new Set(availablePermissions.map(p => p.category).filter(Boolean))).sort();
        
        // Update modal title to indicate target platform
        equivalentModalTitle.textContent = targetPlatform === 'ios' ? 'Add Equivalent iOS Permissions' : 'Add Equivalent Android Permissions';
        
        // Render category tabs
        const equivalentCategoryTabs = document.getElementById('equivalentCategoryTabs');
        equivalentCategoryTabs.innerHTML = '<button class="category-tab active" data-category="">All</button>';
        const allTab = equivalentCategoryTabs.querySelector('.category-tab');
        allTab.addEventListener('click', () => {
            equivalentCategoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            allTab.classList.add('active');
            renderEquivalentSuggestions(equivalentPermissions, targetPlatform, '');
        });
        categories.forEach(category => {
            const tab = document.createElement('button');
            tab.className = 'category-tab';
            tab.dataset.category = category;
            tab.textContent = category;
            tab.addEventListener('click', () => {
                equivalentCategoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderEquivalentSuggestions(equivalentPermissions, targetPlatform, category);
            });
            equivalentCategoryTabs.appendChild(tab);
        });
        
        state.equivalentCategory = '';
        renderEquivalentSuggestions(equivalentPermissions, targetPlatform, '');
        
        equivalentModalError.textContent = '';
        equivalentModalBackdrop.style.display = 'flex';
    }

    function renderEquivalentSuggestions(equivalentPermissions, targetPlatform, category) {
        equivalentSuggestions.innerHTML = '';
        state.equivalentPermissions = [];

        const filteredByCategory = category ? equivalentPermissions.filter(p => p.category === category) : equivalentPermissions;
        const availablePermissions = filteredByCategory.filter(perm => {
            const isAlreadyAdded = targetPlatform === 'ios' ? state.iosPermissions.some(p => p.permission === perm.permission) : state.androidPermissions.some(p => p.permission === perm.permission);
            return !isAlreadyAdded;
        });

        if (availablePermissions.length === 0) {
            const messageDiv = document.createElement('div');
            messageDiv.textContent = 'All equivalent permissions are already added to your project.';
            messageDiv.style.textAlign = 'center';
            messageDiv.style.padding = '20px';
            messageDiv.style.color = '#666';
            messageDiv.style.fontStyle = 'italic';
            equivalentSuggestions.appendChild(messageDiv);
            return;
        }

        availablePermissions.forEach(perm => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.className = 'cross-platform-suggestion';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'suggestion-content';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.permissionName = perm.permission;
            const checkboxId = `checkbox-${perm.permission.replace(/[^a-zA-Z0-9]/g, '-')}`;
            checkbox.id = checkboxId;
            
            const label = document.createElement('label');
            label.textContent = perm.permission;
            label.htmlFor = checkboxId;
            
            contentDiv.appendChild(checkbox);
            contentDiv.appendChild(label);
            suggestionDiv.appendChild(contentDiv);
            
            // Add value input for iOS permissions
            if (targetPlatform === 'ios') {
                if ((perm.type || '').toLowerCase() !== 'boolean') {
                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.className = 'equivalent-value-input';
                    valueInput.placeholder = 'Usage description (required)';
                    valueInput.required = true;
                    // Ensure interacting with the value marks the permission as selected
                    valueInput.addEventListener('focus', () => { checkbox.checked = true; });
                    valueInput.addEventListener('input', () => { checkbox.checked = true; });
                    suggestionDiv.appendChild(valueInput);
                }
            }
            
            equivalentSuggestions.appendChild(suggestionDiv);
        });
    }

    function closeEquivalentModal() {
        equivalentModalBackdrop.style.display = 'none';
        state.equivalentPermissions = [];
    }

    function addEquivalentPermissions() {
        const suggestions = equivalentSuggestions.querySelectorAll('.cross-platform-suggestion');
        const targetPlatform = equivalentModalTitle.textContent.includes('iOS') ? 'ios' : 'android';
        let addedCount = 0;
        const errors = [];
        
        suggestions.forEach((suggestion) => {
            const checkbox = suggestion.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                const permissionName = checkbox.dataset.permissionName;
                
                if (targetPlatform === 'ios') {
                    // Adding iOS permission - check if it already exists
                    const existing = state.iosPermissions.some(permission =>
                        utils.normalizeText(permission.permission) === utils.normalizeText(permissionName)
                    );
                    if (!existing) {
                        const iosPermission = state.allIosPermissions.find(p => p.permission === permissionName);
                        if (iosPermission) {
                            const valueInput = suggestion.querySelector('.equivalent-value-input');
                            let value;
                            const type = (iosPermission.type || '').toLowerCase();
                            if (type === 'boolean') {
                                value = true; // Default to true for equivalent adds
                            } else {
                                value = valueInput ? valueInput.value.trim() : '';
                                if (!value || value === 'TODO: Provide usage description.') {
                                    errors.push(permissionName);
                                    return; // Skip this permission
                                }
                            }
                            state.iosPermissions = [...state.iosPermissions, { ...iosPermission, value }];
                            addedCount++;
                        }
                    }
                } else {
                    // Adding Android permission - check if it already exists
                    const existing = state.androidPermissions.some(permission =>
                        utils.normalizeText(permission.constantValue || permission.permission) === 
                        utils.normalizeText(permissionName)
                    );
                    if (!existing) {
                        const androidPermission = state.allAndroidPermissions.find(p => 
                            p.constantValue === permissionName || p.permission === permissionName);
                        if (androidPermission) {
                            state.androidPermissions = [...state.androidPermissions, androidPermission];
                            addedCount++;
                        }
                    }
                }
            }
        });
        
        if (errors.length > 0) {
            showToast(`Please provide usage descriptions for: ${errors.join(', ')}`, 'error', 5000);
            return; // Don't close modal
        }
        
        if (addedCount > 0) {
            showToast(`${addedCount} ${targetPlatform === 'ios' ? 'iOS' : 'Android'} permission${addedCount > 1 ? 's' : ''} added successfully`, 'success');
        } else {
            showToast('No permissions were selected to add.', 'error');
        }
        
        closeEquivalentModal();
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

    categoryFilter.addEventListener('change', event => {
        state.category = event.target.value;
        updateView();
    });

    iosCategoryFilter.addEventListener('change', event => {
        state.iosCategory = event.target.value;
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

    console.log('[PermissionManager] Initializing...');
    if (saveButton) {
        saveButton.addEventListener('click', handleSave);
    }
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });
    }

    modalCancel.addEventListener('click', closeModal);
    modalAdd.addEventListener('click', addSelectedPermission);
    modalSearch.addEventListener('input', event => {
        state.modalQuery = event.target.value;
        renderModalResults();
    });

    crossPlatformModalSkip.addEventListener('click', () => {
        // Validate the permission first before closing anything
        const isIos = state.modalMode === 'ios';
        
        if (isIos) {
            const selected = state.modalSelection;
            const type = (selected?.type || '').toLowerCase();
            if (type !== 'boolean') {
                const value = modalValueInput.value.trim();
                if (!value || value === 'TODO: Provide usage description.') {
                    // Just close the cross-platform modal and show error, keep main modal open
                    closeCrossPlatformModal();
                    showToast('Please provide a valid usage description for this iOS permission.', 'error');
                    modalValueInput.focus();
                    return;
                }
            }
        }
        
        closeCrossPlatformModal();
        try {
            addPermissionDirectly(state.modalSelection, isIos);
            closeModal();
            updateView();
        } catch (error) {
            // If there's an error, show it but keep the main modal open
            showToast(error.message, 'error');
        }
    });
    
    crossPlatformModalAdd.addEventListener('click', addCrossPlatformPermissions);

    equivalentModalCancel.addEventListener('click', closeEquivalentModal);
    equivalentModalAdd.addEventListener('click', addEquivalentPermissions);

    window.addEventListener('message', event => {
        const message = event.data;
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'permissions':
                state.androidPermissions = message.androidPermissions || [];
                state.iosPermissions = message.iosPermissions || [];
                state.hasAndroidManifest = message.hasAndroidManifest || false;
                state.hasIOSPlist = message.hasIOSPlist || false;
                updateView();
                break;
            case 'allAndroidPermissions':
                state.allAndroidPermissions = message.permissions || [];
                renderModalCategoryTabs();
                renderModalResults();
                // Check if we have a pending cross-platform modal
                if (state.pendingCrossPlatformModal && state.pendingCrossPlatformModal.isSourceIos) {
                    const { selected, equivalents, isSourceIos } = state.pendingCrossPlatformModal;
                    state.pendingCrossPlatformModal = null;
                    showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
                }
                // Check if we have a pending equivalent modal
                if (state.pendingEquivalentModal && state.pendingEquivalentModal.targetPlatform === 'android') {
                    const { permission, targetPlatform } = state.pendingEquivalentModal;
                    state.pendingEquivalentModal = null;
                    showEquivalentModal(permission, targetPlatform);
                }
                break;
            case 'allIOSPermissions':
                state.allIosPermissions = message.permissions || [];
                renderModalCategoryTabs();
                renderModalResults();
                // Check if we have a pending cross-platform modal
                if (state.pendingCrossPlatformModal && !state.pendingCrossPlatformModal.isSourceIos) {
                    const { selected, equivalents, isSourceIos } = state.pendingCrossPlatformModal;
                    state.pendingCrossPlatformModal = null;
                    showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
                }
                // Check if we have a pending equivalent modal
                if (state.pendingEquivalentModal && state.pendingEquivalentModal.targetPlatform === 'ios') {
                    const { permission, targetPlatform } = state.pendingEquivalentModal;
                    state.pendingEquivalentModal = null;
                    showEquivalentModal(permission, targetPlatform);
                }
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
