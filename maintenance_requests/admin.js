document.addEventListener('DOMContentLoaded', () => {
    // Global State
    let allRequests = [];
    let filteredRequests = [];
    let requestsRevision=0;
    let statusChartInstance = null;
    let categoryChartInstance = null;
    let currentPage = 1, queueFilter = 'all', lastModalFocus = null, savedBodyOverflow = '';
    const pageSize = 20;
    const refreshBtn = document.getElementById('refreshRequestsBtn');
    const dataStatus = document.getElementById('dataStatus');
    const sortOrder = document.getElementById('sortOrder');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const queueButtons = document.querySelectorAll('[data-queue]');

    // DOM Elements
    const requestsTableBody = document.getElementById('requestsTableBody');
    const requestsMobileList = document.getElementById('requestsMobileList');
    const requestsCount = document.getElementById('requests-count');
    
    // Filter Inputs
    const searchInput = document.getElementById('searchInput');
    const filterStatus = document.getElementById('filterStatus');
    const filterResult = document.getElementById('filterResult');
    const filterType = document.getElementById('filterType');

    // Modal Elements
    const editModal = document.getElementById('editModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const adminActionForm = document.getElementById('adminActionForm');
    let formRevision = 0, formGeneration = 0, savePending = false;
    const markFormDirty = () => adminActionForm.dispatchEvent(new Event('eoffice:form-dirty', {bubbles:true}));
    const markFormClean = () => adminActionForm.dispatchEvent(new Event('eoffice:form-saved', {bubbles:true}));
    for (const type of ['input','change','eoffice:form-dirty']) adminActionForm.addEventListener(type, () => {formRevision++;});
    const addMaterialBtn = document.getElementById('addMaterialBtn');
    const modalMaterialsList = document.getElementById('modalMaterialsList');

    // Modal Info Fields
    const modalRequestId = document.getElementById('modalRequestId');
    const formRequestId = document.getElementById('formRequestId');
    const infoName = document.getElementById('infoName');
    const infoPhone = document.getElementById('infoPhone');
    const infoDept = document.getElementById('infoDept');
    const infoDate = document.getElementById('infoDate');
    const infoLocation = document.getElementById('infoLocation');
    const infoTypes = document.getElementById('infoTypes');
    const infoDetails = document.getElementById('infoDetails');
    const infoImagesContainer = document.getElementById('infoImagesContainer');
    const infoImagesGallery = document.getElementById('infoImagesGallery');

    // Conditional Fields
    const fieldAssign = document.getElementById('fieldAssign');
    const fieldCannotProceed = document.getElementById('fieldCannotProceed');
    const fieldCannotFix = document.getElementById('fieldCannotFix');

    // Radio Listeners for Modal
    const considerationRadios = document.querySelectorAll('input[name="considerationStatus"]');
    const actionResultRadios = document.querySelectorAll('input[name="actionResult"]');

    // Form inputs
    const assignedToInput = document.getElementById('assignedTo');
    const reasonCannotProceedInput = document.getElementById('reasonCannotProceed');
    const reasonCannotFixInput = document.getElementById('reasonCannotFix');
    const repairDetailsInput = document.getElementById('repairDetails');
    const saveBtn = document.getElementById('saveBtn');
    const saveBtnText = saveBtn.querySelector('.btn-text');
    const saveLoader = saveBtn.querySelector('.loader');

    // Initialize Page
    init();

    function init() {
        if(window.eofficeRegisterModuleRefresh)window.eofficeRegisterModuleRefresh(fetchRequests);
        else fetchRequests();
        setupEventListeners();
    }

    // Event Listeners Setup
    function setupEventListeners() {
        refreshBtn.addEventListener('click', fetchRequests);
        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            searchInput.value = '';
            filterStatus.value = filterResult.value = filterType.value = 'all';
            queueFilter = 'all';
            applyFilters();
        });
        queueButtons.forEach(button => button.addEventListener('click', () => {
            queueFilter = button.dataset.queue;
            filterStatus.value = filterResult.value = 'all';
            applyFilters();
        }));
        sortOrder.addEventListener('change', applyFilters);
        prevPageBtn.addEventListener('click', () => changePage(-1));
        nextPageBtn.addEventListener('click', () => changePage(1));
        editModal.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
            if (event.key !== 'Tab') return;
            const controls = [...editModal.querySelectorAll('button, input, select, textarea, a[href]')].filter(node => !node.disabled && node.getClientRects().length);
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        // Real-time filters
        searchInput.addEventListener('input', applyFilters);
        filterStatus.addEventListener('change', applyFilters);
        filterResult.addEventListener('change', applyFilters);
        filterType.addEventListener('change', applyFilters);

        // Close Modal
        closeModalBtn.addEventListener('click', closeModal);
        cancelModalBtn.addEventListener('click', closeModal);
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) closeModal();
        });

        // Toggle Admin Conditional Fields
        considerationRadios.forEach(radio => {
            radio.addEventListener('change', handleConsiderationChange);
        });

        actionResultRadios.forEach(radio => {
            radio.addEventListener('change', handleActionResultChange);
        });

        // Dynamic Materials Action
        addMaterialBtn.addEventListener('click', () => addMaterialRow('', '', true));

        // Form Submit
        adminActionForm.addEventListener('submit', handleFormSubmit);
    }

    // Fetch maintenance list from API
    async function fetchRequests() {
        const revision=++requestsRevision;
        refreshBtn.disabled = true;
        dataStatus.textContent = 'กำลังโหลดข้อมูลใบแจ้งซ่อม…';
        try {
            // ดึงข้อมูลรายการแจ้งซ่อมทั้งหมดโดยระบุ limit 1000 รายการ
            const response = await fetch('api/get_maintenance.php?limit=1000');
            const result = await response.json();
            if(revision!==requestsRevision)return;

            if (response.ok && result.status === 'success' && Array.isArray(result.data)) {
                allRequests = result.data;
                
                // คำนวณแดชบอร์ดและวาดตาราง
                updateDashboardStats(allRequests);
                renderCharts(allRequests);
                applyFilters();
                dataStatus.textContent = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'})} • ${allRequests.length} รายการ` + (Number(result.total) > allRequests.length ? ` จากทั้งหมด ${result.total} รายการ (แสดงล่าสุด 1,000 รายการ)` : '');
            } else {
                showErrorPlaceholder(result.message || 'ไม่สามารถดึงข้อมูลรายการแจ้งซ่อมได้');
            }
        } catch (error) {
            if(revision!==requestsRevision)return;
            console.error('Fetch error:', error);
            showErrorPlaceholder('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        } finally {
            if (revision === requestsRevision) refreshBtn.disabled = false;
        }
    }

    // Error rendering inside table
    function showErrorPlaceholder(message) {
        dataStatus.textContent = 'โหลดข้อมูลไม่สำเร็จ กรุณากดรีเฟรชข้อมูลเพื่อลองอีกครั้ง';
        requestsCount.innerText = 'โหลดไม่สำเร็จ';
        prevPageBtn.disabled = nextPageBtn.disabled = true;
        document.getElementById('pageSummary').textContent = '';
        const errorHtml = `<tr><td colspan="8" class="loading-placeholder error-placeholder">${escapeHTML(message)}</td></tr>`;
        requestsTableBody.innerHTML = errorHtml;
        requestsMobileList.innerHTML = `<div class="loading-placeholder error-placeholder">${escapeHTML(message)}</div>`;
    }

    // Update Dashboard Stats Counters
    function updateDashboardStats(requests) {
        let total = requests.length;
        let pending = 0;
        let active = 0; // can_proceed and repair result is pending
        let success = 0; // fixed
        let failed = 0; // cannot_proceed or cannot_fix

        requests.forEach(raw => {
            const req = escapeRecord(raw);
            const cond = req.consideration_status;
            const res = req.action_result;

            if (cond === 'pending') {
                pending++;
            } else if (cond === 'cannot_proceed') {
                failed++;
            } else if (cond === 'can_proceed') {
                if (res === 'pending') {
                    active++;
                } else if (res === 'fixed') {
                    success++;
                } else if (res === 'cannot_fix') {
                    failed++;
                }
            }
        });

        // Set value counters in UI
        document.getElementById('stat-total').innerText = total;
        document.getElementById('stat-pending').innerText = pending;
        document.getElementById('stat-active').innerText = active;
        document.getElementById('stat-success').innerText = success;
        document.getElementById('stat-failed').innerText = failed;
    }

    // Render / Update Charts (Chart.js)
    function renderCharts(requests) {
        if (typeof Chart === 'undefined') return;
        // 1. Status breakdown
        let pending = 0, active = 0, success = 0, failed = 0;
        requests.forEach(raw => {
            const req = escapeRecord(raw);
            const cond = req.consideration_status;
            const res = req.action_result;
            if (cond === 'pending') pending++;
            else if (cond === 'cannot_proceed') failed++;
            else if (cond === 'can_proceed') {
                if (res === 'pending') active++;
                else if (res === 'fixed') success++;
                else if (res === 'cannot_fix') failed++;
            }
        });

        const statusData = [pending, active, success, failed];

        // 2. Categories breakdown
        const categories = {
            'ไฟฟ้า': 0,
            'เครื่องปรับอากาศ': 0,
            'ประปาและสุขภัณฑ์': 0,
            'ประตู หน้าต่าง / กระจก': 0,
            'โต๊ะ / เก้าอี้': 0,
            'สัญญาณอินเตอร์เน็ต': 0,
            'อื่นๆ': 0
        };

        requests.forEach(req => {
            if (req.repair_types) {
                // Split comma-separated string
                const types = req.repair_types.split(',');
                types.forEach(t => {
                    const cleanType = t.trim();
                    if (categories[cleanType] !== undefined) {
                        categories[cleanType]++;
                    } else {
                        categories['อื่นๆ']++;
                    }
                });
            }
        });

        const categoryLabels = Object.keys(categories);
        const categoryData = Object.values(categories);

        // Render Status Donut Chart
        if (statusChartInstance) {
            statusChartInstance.destroy();
        }
        const ctxStatus = document.getElementById('statusChart').getContext('2d');
        statusChartInstance = new Chart(ctxStatus, {
            type: 'doughnut',
            data: {
                labels: ['รอดำเนินการ', 'กำลังดำเนินการ', 'ซ่อมสำเร็จแล้ว', 'ไม่สามารถดำเนินการ/ซ่อมได้'],
                datasets: [{
                    data: statusData,
                    backgroundColor: ['#d97706', '#4f46e5', '#16a34a', '#dc2626'],
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: { family: 'Prompt', size: 12 }
                        }
                    }
                }
            }
        });

        // Render Category Bar Chart
        if (categoryChartInstance) {
            categoryChartInstance.destroy();
        }
        const ctxCategory = document.getElementById('categoryChart').getContext('2d');
        categoryChartInstance = new Chart(ctxCategory, {
            type: 'bar',
            data: {
                labels: categoryLabels,
                datasets: [{
                    label: 'จำนวนงานแจ้งซ่อม',
                    data: categoryData,
                    backgroundColor: '#3b82f6',
                    borderColor: '#2563eb',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { family: 'Prompt' }
                        }
                    },
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0, font: { family: 'Prompt', size: 10 } }
                    }
                }
            }
        });
    }

    // Render request entries in Table & Mobile Layout
    function renderRequestsList(requests) {
        requestsCount.innerText = `${requests.length} รายการ`;
        const total = requests.length;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        currentPage = Math.min(currentPage, pages);
        const start = (currentPage - 1) * pageSize;
        document.getElementById('pageSummary').textContent = total ? `แสดง ${start + 1}–${Math.min(start + pageSize, total)} จาก ${total} รายการ • หน้า ${currentPage}/${pages}` : 'ไม่มีรายการที่จะแสดง';
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === pages;
        requests = requests.slice(start, start + pageSize).map(escapeRecord);

        if (requests.length === 0) {
            const message = allRequests.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง ลองเปลี่ยนคำค้นหาหรือกด “ล้างตัวกรอง”' : 'ยังไม่มีใบแจ้งซ่อมในระบบ';
            requestsTableBody.innerHTML = `<tr><td colspan="8" class="loading-placeholder">${message}</td></tr>`;
            requestsMobileList.innerHTML = `<div class="loading-placeholder">${message}</div>`;
            return;
        }

        // 1. Desktop Render
        let tableHtml = '';
        requests.forEach(req => {
            const formattedDate = formatDate(req.request_date);
            const deptText = [req.position, req.department].filter(Boolean).join(' / ');
            const locationText = `อาคาร ${req.building || '-'} ห้อง ${req.room || '-'}`;
            
            const condBadge = getConsiderationBadge(req.consideration_status);
            const resBadge = getResultBadge(req.action_result);

            tableHtml += `
                <tr data-id="${req.id}">
                    <td><strong>#${req.id}</strong></td>
                    <td>${formattedDate}</td>
                    <td>
                        <div class="font-medium">${req.requester_name}</div>
                        <div class="text-xs text-slate-500">${deptText}</div>
                    </td>
                    <td><span class="text-xs">${req.repair_types}</span></td>
                    <td>${locationText}</td>
                    <td>${condBadge}</td>
                    <td>${resBadge}</td>
                    <td>
                        <button class="manage-btn print-btn" onclick="printRequest(${Number(req.id)})">พิมพ์</button>
                        <button class="manage-btn" onclick="openManageModal(${Number(req.id)})">จัดการ</button>
                    </td>
                </tr>
            `;
        });
        requestsTableBody.innerHTML = tableHtml;

        // 2. Mobile Render
        let mobileHtml = '';
        requests.forEach(req => {
            const formattedDate = formatDate(req.request_date);
            const condBadge = getConsiderationBadge(req.consideration_status);
            const resBadge = getResultBadge(req.action_result);

            mobileHtml += `
                <div class="mobile-request-card" data-id="${req.id}">
                    <div class="card-row title">
                        <span>#${req.id} - ${req.requester_name}</span>
                        <span>${formattedDate}</span>
                    </div>
                    <div class="card-detail">
                        <strong>ประเภท:</strong> ${req.repair_types}<br>
                        <strong>สถานที่:</strong> อาคาร ${req.building || '-'} ห้อง ${req.room || '-'}<br>
                        <strong>ลักษณะ:</strong> ${req.damage_details || '-'}
                    </div>
                    <div class="card-row">
                        <div>${condBadge}</div>
                        <div>${resBadge}</div>
                    </div>
                    <div class="card-actions">
                        <button class="manage-btn print-btn" onclick="printRequest(${Number(req.id)})">พิมพ์รายงาน</button>
                        <button class="manage-btn" onclick="openManageModal(${Number(req.id)})">จัดการสถานะงาน</button>
                    </div>
                </div>
            `;
        });
        requestsMobileList.innerHTML = mobileHtml;
    }

    // Apply Filter & Search Inputs
    function changePage(delta) {
        currentPage += delta;
        renderRequestsList(filteredRequests);
        document.querySelector('.requests-card')?.scrollIntoView({behavior:'smooth', block:'start'});
    }

    function applyFilters() {
        currentPage = 1;
        queueButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.queue === queueFilter)));
        const query = searchInput.value.toLowerCase().trim();
        const stat = filterStatus.value;
        const res = filterResult.value;
        const type = filterType.value;

        filteredRequests = allRequests.filter(req => {
            // Search Input Match
            const matchesSearch = !query || String(req.id).includes(query.replace(/^#/, '')) ||
                String(req.requester_name || '').toLowerCase().includes(query) ||
                (req.position && req.position.toLowerCase().includes(query)) ||
                (req.department && req.department.toLowerCase().includes(query)) ||
                (req.building && req.building.toLowerCase().includes(query)) ||
                (req.room && req.room.toLowerCase().includes(query)) ||
                (req.damage_details && req.damage_details.toLowerCase().includes(query)) ||
                (req.assigned_to && req.assigned_to.toLowerCase().includes(query));

            // Status Filter Match
            const matchesStatus = stat === 'all' || req.consideration_status === stat;

            // Result Filter Match
            const matchesResult = res === 'all' || req.action_result === res;

            // Type Filter Match
            const matchesType = type === 'all' || (req.repair_types && req.repair_types.includes(type));

            const queue = req.consideration_status === 'pending' ? 'pending' : req.consideration_status === 'cannot_proceed' || req.action_result === 'cannot_fix' ? 'failed' : req.action_result === 'fixed' ? 'success' : 'active';
            return matchesSearch && matchesStatus && matchesResult && matchesType && (queueFilter === 'all' || queue === queueFilter);
        });
        filteredRequests.sort((a, b) => sortOrder.value === 'oldest' ? Number(a.id) - Number(b.id) : Number(b.id) - Number(a.id));

        renderRequestsList(filteredRequests);
    }

    // Get color badges
    function getConsiderationBadge(status) {
        switch(status) {
            case 'pending': return '<span class="status-badge pending">รอดำเนินการ</span>';
            case 'can_proceed': return '<span class="status-badge can_proceed">อนุมัติแล้ว</span>';
            case 'cannot_proceed': return '<span class="status-badge cannot_proceed">ไม่อนุมัติ</span>';
            default: return '<span class="status-badge">' + status + '</span>';
        }
    }

    function getResultBadge(result) {
        switch(result) {
            case 'pending': return '<span class="status-badge result-pending">รอตรวจ/กำลังซ่อม</span>';
            case 'fixed': return '<span class="status-badge result-fixed">ซ่อมสำเร็จ</span>';
            case 'cannot_fix': return '<span class="status-badge result-cannot_fix">ซ่อมไม่ได้</span>';
            default: return '<span class="status-badge">' + result + '</span>';
        }
    }

    // Format SQL Date -> Thai Date
    function formatDate(dateString) {
        if (!dateString) return '-';
        const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const date = new Date(dateString);
        if (isNaN(date)) return dateString;
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear() + 543;
        return `${day} ${month} ${year}`;
    }

    // Modal conditional display handling
    function handleConsiderationChange() {
        const val = document.querySelector('input[name="considerationStatus"]:checked')?.value;
        if (val === 'can_proceed') {
            fieldAssign.classList.remove('hidden');
            fieldCannotProceed.classList.add('hidden');
        } else if (val === 'cannot_proceed') {
            fieldAssign.classList.add('hidden');
            fieldCannotProceed.classList.remove('hidden');
        } else {
            fieldAssign.classList.add('hidden');
            fieldCannotProceed.classList.add('hidden');
        }
    }

    function handleActionResultChange() {
        const val = document.querySelector('input[name="actionResult"]:checked')?.value;
        if (val === 'cannot_fix') {
            fieldCannotFix.classList.remove('hidden');
        } else {
            fieldCannotFix.classList.add('hidden');
        }
    }

    // Expose openManageModal globally so inline onclick handlers can call it
    window.openManageModal = function(id) {
  
        // 💡 แปลงเป็น String ทั้งสองฝั่ง เพื่อตัดปัญหาเรื่อง Data Type จาก Server
        const req = allRequests.find(r => String(r.id) === String(id));
        
        if (!req) {
            console.error("หาใบแจ้งซ่อมไม่พบ ID:", id); // พิมพ์บอกใน Console เผื่อหาไม่เจอจริงๆ
            return;
        }

        formGeneration++;

        // Populate read-only text fields
        modalRequestId.innerText = req.id;
        formRequestId.value = req.id;
        infoName.innerText = req.requester_name;
        infoPhone.innerText = req.phone || '-';
        infoDept.innerText = [req.position, req.department].filter(Boolean).join(' / ') || '-';
        infoDate.innerText = formatDate(req.request_date);
        infoLocation.innerText = `อาคาร ${req.building || '-'} ห้อง ${req.room || '-'}`;
        infoTypes.innerText = req.repair_types + (req.other_type_detail ? ` (${req.other_type_detail})` : '');
        infoDetails.innerText = req.damage_details || 'ไม่ได้ระบุ';

        // Populate images
        infoImagesGallery.innerHTML = '';
        if (req.images && Array.isArray(req.images) && req.images.length > 0) {
            req.images.forEach(imageUrl => {
                const item = document.createElement('a');
                item.href = imageUrl;
                item.target = '_blank';
                item.className = 'admin-gallery-item';
                
                const img = document.createElement('img');
                img.src = driveUrlToThumbnail(imageUrl);
                img.alt = 'ภาพประกอบการแจ้งซ่อม';
                
                item.appendChild(img);
                infoImagesGallery.appendChild(item);
            });
            infoImagesContainer.classList.remove('hidden');
        } else {
            infoImagesContainer.classList.add('hidden');
        }

        // Reset radio buttons
        setRadioChecked('considerationStatus', req.consideration_status);
        setRadioChecked('actionResult', req.action_result);

        // Reset text inputs
        assignedToInput.value = req.assigned_to || '';
        reasonCannotProceedInput.value = req.reason_cannot_proceed || '';
        reasonCannotFixInput.value = req.reason_cannot_fix || '';
        repairDetailsInput.value = req.repair_details || '';

        // Trigger changes to toggle appropriate fields
        handleConsiderationChange();
        handleActionResultChange();

        // Clear and reload dynamic materials rows
        modalMaterialsList.innerHTML = '';
        if (req.materials && Array.isArray(req.materials)) {
            req.materials.forEach(item => {
                addMaterialRow(item.name, item.qty);
            });
        }
        
        // If materials is empty, add one empty row for quick usage
        if (modalMaterialsList.children.length === 0) {
            addMaterialRow('', '');
        }

        markFormClean();

        // Show Modal
        lastModalFocus = document.activeElement;
        savedBodyOverflow = document.body.style.overflow;
        editModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Lock background scrolling
        closeModalBtn.focus?.();
    }

    // Expose printRequest globally
    window.printRequest = function(id) {
        const source = allRequests.find(r => String(r.id) === String(id));
        const req = source ? escapeRecord(source) : null;
        if (!req) {
            console.error("หาใบแจ้งซ่อมไม่พบ ID:", id);
            return;
        }

        const condText = req.consideration_status === 'pending' ? 'รอดำเนินการ' : (req.consideration_status === 'can_proceed' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ');
        const resText = req.action_result === 'pending' ? 'รอตรวจ/กำลังซ่อม' : (req.action_result === 'fixed' ? 'ซ่อมสำเร็จ' : 'ซ่อมไม่ได้');
        const images = Array.isArray(source.images) ? source.images.filter(url => typeof url === 'string' && url.trim()) : [];

        let html = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <title>ใบแจ้งซ่อม #${req.id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600&display=swap" rel="stylesheet">
            <style>
                * { box-sizing: border-box; }
                body { font-family: 'Sarabun', sans-serif; margin: 0; background: #edf1f5; color: #172b3a; line-height: 1.5; }
                .report { max-width: 210mm; margin: 24px auto; padding: 18mm; background: white; box-shadow: 0 4px 20px #182b3a1a; }
                .report-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; border-bottom: 2px solid #234f65; padding-bottom: 16px; margin-bottom: 24px; }
                .eyebrow { color: #557485; font-size: 12px; font-weight: 600; letter-spacing: .04em; }
                h2 { font-size: 24px; margin: 3px 0 0; }
                .report-number { text-align: right; color: #557485; font-size: 13px; white-space: nowrap; }
                .report-number strong { display: block; color: #234f65; font-size: 20px; }
                .section { margin-bottom: 22px; }
                .section-title { font-weight: 600; margin-bottom: 10px; border-bottom: 1px solid #d9e2e7; padding-bottom: 7px; font-size: 16px; color: #234f65; }
                .row { display: flex; gap: 12px; margin-bottom: 5px; font-size: 14px; }
                .label { flex: 0 0 145px; color: #526675; font-weight: 600; }
                .value { flex: 1; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
                table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
                th, td { border: 1px solid #d9e2e7; padding: 7px 10px; text-align: left; }
                th { background: #f1f5f7; }
                .image-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
                .image-card { margin: 0; border: 1px solid #d9e2e7; padding: 6px; break-inside: avoid; page-break-inside: avoid; }
                .image-card img { display: block; width: 100%; height: 55mm; object-fit: contain; }
                .image-card figcaption { color: #526675; font-size: 12px; padding-top: 4px; }
                .image-error { display: none; min-height: 25mm; padding: 10px; color: #884c42; font-size: 13px; }
                .image-card.failed img { display: none; }
                .image-card.failed .image-error { display: block; }
                .print-btn-container { text-align: center; padding: 0 0 24px; }
                .print-btn-container button { padding: 10px 24px; font-size: 16px; cursor: pointer; background: #234f65; color: white; border: none; border-radius: 6px; font-family: inherit; }
                @page { size: A4; margin: 15mm; }
                @media print {
                    body { background: white; color: #000; }
                    .report { max-width: none; margin: 0; padding: 0; box-shadow: none; }
                    .section-title { break-after: avoid; page-break-after: avoid; }
                    tr { break-inside: avoid; page-break-inside: avoid; }
                    .print-btn-container { display: none; }
                }
            </style>
        </head>
        <body>
            <main class="report">
            <header class="report-header">
                <div><div class="eyebrow">ระบบแจ้งซ่อม</div><h2>รายงานใบแจ้งซ่อม</h2></div>
                <div class="report-number">เลขที่ใบแจ้งซ่อม<strong>#${req.id}</strong></div>
            </header>
            
            <div class="section">
                <div class="section-title">ข้อมูลผู้แจ้ง</div>
                <div class="row"><div class="label">ชื่อ-สกุล:</div><div class="value">${req.requester_name || '-'}</div></div>
                <div class="row"><div class="label">เบอร์โทรศัพท์:</div><div class="value">${req.phone || '-'}</div></div>
                <div class="row"><div class="label">ตำแหน่ง/ฝ่าย:</div><div class="value">${[req.position, req.department].filter(Boolean).join(' / ') || '-'}</div></div>
                <div class="row"><div class="label">วันที่แจ้ง:</div><div class="value">${formatDate(req.request_date)}</div></div>
            </div>

            <div class="section">
                <div class="section-title">รายละเอียดงานซ่อม</div>
                <div class="row"><div class="label">สถานที่:</div><div class="value">อาคาร ${req.building || '-'} ห้อง ${req.room || '-'}</div></div>
                <div class="row"><div class="label">ประเภทงานซ่อม:</div><div class="value">${req.repair_types + (req.other_type_detail ? ` (${req.other_type_detail})` : '')}</div></div>
                <div class="row"><div class="label">ลักษณะที่ชำรุด:</div><div class="value">${req.damage_details || '-'}</div></div>
            </div>

            <div class="section">
                <div class="section-title">ส่วนของเจ้าหน้าที่</div>
                <div class="row"><div class="label">สถานะการพิจารณา:</div><div class="value">${condText}</div></div>
                ${req.consideration_status === 'can_proceed' ? `<div class="row"><div class="label">มอบหมายให้:</div><div class="value">${req.assigned_to || '-'}</div></div>` : ''}
                ${req.consideration_status === 'cannot_proceed' ? `<div class="row"><div class="label">เหตุผลที่ไม่อนุมัติ:</div><div class="value">${req.reason_cannot_proceed || '-'}</div></div>` : ''}
                
                <div class="row" style="margin-top: 15px;"><div class="label">ผลการดำเนินการ:</div><div class="value">${resText}</div></div>
                ${req.action_result === 'cannot_fix' ? `<div class="row"><div class="label">เหตุผลที่ซ่อมไม่ได้:</div><div class="value">${req.reason_cannot_fix || '-'}</div></div>` : ''}
                <div class="row"><div class="label">รายละเอียดการซ่อม:</div><div class="value">${req.repair_details || '-'}</div></div>
                
                <div style="margin-top:20px; font-weight:bold;">รายการวัสดุ/อุปกรณ์ที่ใช้:</div>
        `;

        if (req.materials && req.materials.length > 0) {
            html += `
                <table>
                    <thead><tr><th>ชื่อวัสดุ</th><th>จำนวน</th></tr></thead>
                    <tbody>
            `;
            req.materials.forEach(m => {
                html += `<tr><td>${escapeHTML(m.name)}</td><td>${escapeHTML(m.qty)}</td></tr>`;
            });
            html += `</tbody></table>`;
        } else {
            html += `<div style="margin-top: 5px;">- ไม่มี -</div>`;
        }

        html += `
            </div>
            ${images.length ? `
            <div class="section">
                <div class="section-title">ภาพประกอบการแจ้งซ่อม</div>
                <div class="image-grid">
                    ${images.map((url, index) => `<figure class="image-card"><img src="${escapeHTML(driveUrlToThumbnail(url, 1200))}" alt="ภาพประกอบการแจ้งซ่อม ${index + 1}" onload="this.parentElement.classList.remove('failed')" onerror="this.parentElement.classList.add('failed')"><div class="image-error">ไม่สามารถโหลดภาพได้</div><figcaption>ภาพที่ ${index + 1}</figcaption></figure>`).join('')}
                </div>
            </div>` : ''}
            </main>
            <div class="print-btn-container">
                <button onclick="window.print()">พิมพ์เอกสารรายงาน</button>
            </div>
            <script>
                // Wait for images and fonts, but don't block printing indefinitely on a slow connection.
                const imagesReady = Array.from(document.images, img => img.complete ? Promise.resolve() : new Promise(resolve => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', resolve, { once: true });
                }));
                const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
                Promise.race([Promise.all([...imagesReady, fontsReady]), new Promise(resolve => setTimeout(resolve, 12000))])
                    .then(() => {
                        Array.from(document.images).filter(img => !img.complete).forEach(img => img.parentElement.classList.add('failed'));
                        window.print();
                    });
            </script>
        </body>
        </html>
        `;

        const printWindow = window.open('', '_blank');
        if (!printWindow) { showToast('กรุณาอนุญาตหน้าต่างป๊อปอัปเพื่อพิมพ์ใบแจ้งซ่อม', 'error'); return; }
        printWindow.document.write(html);
        printWindow.document.close();
    }

    function setRadioChecked(name, value) {
        const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
    }

    function closeModal() {
        formGeneration++;
        editModal.classList.add('hidden');
        document.body.style.overflow = savedBodyOverflow;
        markFormClean();
        lastModalFocus?.focus?.();
    }

    // Dynamic Materials Input Rows
    function addMaterialRow(name = '', qty = '', userChange = false) {
        const row = document.createElement('div');
        row.className = 'material-row';
        row.innerHTML = `
            <input type="text" class="material-name" aria-label="ชื่อวัสดุ" placeholder="ชื่อวัสดุ" value="${escapeHTML(name)}">
            <input type="text" class="material-qty" aria-label="จำนวนวัสดุ" placeholder="จำนวน" style="max-width: 90px;" value="${escapeHTML(qty)}">
            <button type="button" class="eo-btn eo-btn--danger-text eo-btn--icon remove-row-btn" title="ลบรายการนี้" aria-label="ลบวัสดุรายการนี้">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        
        // Setup Delete button event
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            row.remove();
            markFormDirty();
        });

        modalMaterialsList.appendChild(row);
        if (userChange) markFormDirty();
    }

    function formSnapshot() {
        return JSON.stringify([formRequestId.value,
            document.querySelector('input[name="considerationStatus"]:checked')?.value,
            document.querySelector('input[name="actionResult"]:checked')?.value,
            assignedToInput.value,reasonCannotProceedInput.value,reasonCannotFixInput.value,repairDetailsInput.value,
            [...modalMaterialsList.querySelectorAll('.material-row')].map(row => [row.querySelector('.material-name').value,row.querySelector('.material-qty').value])]);
    }

    // Submit form logic to update API
    async function handleFormSubmit(e) {
        e.preventDefault();
        if (savePending) return;
        const submittedRevision = formRevision, submittedGeneration = formGeneration, submittedSnapshot = formSnapshot();
        savePending = true;

        // Show loading spinner
        saveBtnText.classList.add('hidden');
        saveLoader.classList.remove('hidden');
        saveBtn.disabled = true;

        const id = parseInt(formRequestId.value);
        const considerationStatus = document.querySelector('input[name="considerationStatus"]:checked').value;
        const actionResult = document.querySelector('input[name="actionResult"]:checked').value;

        // Build materials payload
        const materials = [];
        modalMaterialsList.querySelectorAll('.material-row').forEach(row => {
            const name = row.querySelector('.material-name').value.trim();
            const qty = row.querySelector('.material-qty').value.trim();
            if (name) {
                materials.push({ name, qty });
            }
        });

        const payload = {
            id: id,
            considerationStatus: considerationStatus,
            assignedTo: considerationStatus === 'can_proceed' ? assignedToInput.value.trim() : '',
            reasonCannotProceed: considerationStatus === 'cannot_proceed' ? reasonCannotProceedInput.value.trim() : '',
            materials: materials,
            actionResult: actionResult,
            reasonCannotFix: actionResult === 'cannot_fix' ? reasonCannotFixInput.value.trim() : '',
            repairDetails: repairDetailsInput.value.trim()
        };

        try {
            const response = await fetch('api/update_maintenance.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                showToast(result.message || 'บันทึกสถานะงานเรียบร้อยแล้ว!', 'success');
                if (submittedGeneration === formGeneration && submittedRevision === formRevision && submittedSnapshot === formSnapshot()) {
                    markFormClean();
                    closeModal();
                } else if (submittedGeneration === formGeneration) {
                    markFormDirty();
                    showToast('บันทึกข้อมูลที่ส่งไปแล้ว แต่มีการแก้ไขเพิ่มเติมที่ยังไม่ได้บันทึก', 'success');
                }
                // Re-fetch all requests to refresh Dashboard counters, graphs, and the data list
                fetchRequests();
            } else {
                showToast(result.message || 'ไม่สามารถบันทึกข้อมูลได้', 'error');
            }
        } catch (error) {
            console.error('Update submit error:', error);
            showToast('เชื่อมต่อเซิร์ฟเวอร์ผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
        } finally {
            savePending = false;
            // Restore button state
            saveBtnText.classList.remove('hidden');
            saveLoader.classList.add('hidden');
            saveBtn.disabled = false;
        }
    }

    // Helper Toast Notification
    function showToast(message, type = 'success') {
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = type === 'success' 
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

        toast.innerHTML = `
            <span class="toast-icon ${type}">${icon}</span>
            <span class="toast-message">${escapeHTML(message)}</span>
        `;

        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    // แปลง Google Drive URL ให้เป็น URL ที่สามารถใช้แสดงรูปภาพใน <img> ได้
    // URL แบบ /file/d/FILE_ID/view ไม่สามารถใช้ <img src> ได้ ต้องแปลงเป็น thumbnail URL
    function driveUrlToThumbnail(url, width = 400) {
        if (!url) return '';

        // ดึง File ID จาก URL แบบต่างๆ ของ Google Drive
        let fileId = '';

        // รูปแบบ: https://drive.google.com/file/d/FILE_ID/view
        const match1 = url.match(/\/file\/d\/([^\/\?]+)/);
        if (match1) {
            fileId = match1[1];
        }

        // รูปแบบ: https://drive.google.com/open?id=FILE_ID
        if (!fileId) {
            const match2 = url.match(/[?&]id=([^&]+)/);
            if (match2) {
                fileId = match2[1];
            }
        }

        if (fileId) {
            // ใช้ thumbnail endpoint ของ Google Drive ที่แสดงภาพจริงได้
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
        }

        // ถ้าไม่ใช่ Google Drive URL ให้ใช้ URL เดิม
        return url;
    }
});
// ฟังก์ชันคำนวณและส่งความสูงของฟอร์มแจ้งซ่อมไปให้หน้าแม่

