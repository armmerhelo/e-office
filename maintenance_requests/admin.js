document.addEventListener('DOMContentLoaded', () => {
    // Global State
    let allRequests = [];
    let filteredRequests = [];
    let statusChartInstance = null;
    let categoryChartInstance = null;

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
        fetchRequests();
        setupEventListeners();
    }

    // Event Listeners Setup
    function setupEventListeners() {
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
        addMaterialBtn.addEventListener('click', () => addMaterialRow('', ''));

        // Form Submit
        adminActionForm.addEventListener('submit', handleFormSubmit);
    }

    // Fetch maintenance list from API
    async function fetchRequests() {
        try {
            // ดึงข้อมูลรายการแจ้งซ่อมทั้งหมดโดยระบุ limit 1000 รายการ
            const response = await fetch('api/get_maintenance.php?limit=1000');
            const result = await response.json();

            if (result.status === 'success' && Array.isArray(result.data)) {
                allRequests = result.data;
                filteredRequests = [...allRequests];
                
                // คำนวณแดชบอร์ดและวาดตาราง
                updateDashboardStats(allRequests);
                renderCharts(allRequests);
                renderRequestsList(filteredRequests);
            } else {
                showErrorPlaceholder(result.message || 'ไม่สามารถดึงข้อมูลรายการแจ้งซ่อมได้');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            showErrorPlaceholder('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        }
    }

    // Error rendering inside table
    function showErrorPlaceholder(message) {
        const errorHtml = `<tr><td colspan="8" class="loading-placeholder text-red-600">${message}</td></tr>`;
        requestsTableBody.innerHTML = errorHtml;
        requestsMobileList.innerHTML = `<div class="loading-placeholder text-red-600">${message}</div>`;
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
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            font: { family: 'Prompt' }
                        }
                    },
                    x: {
                        ticks: { font: { family: 'Prompt', size: 10 } }
                    }
                }
            }
        });
    }

    // Render request entries in Table & Mobile Layout
    function renderRequestsList(requests) {
        requests = requests.map(escapeRecord);
        requestsCount.innerText = `${requests.length} รายการ`;

        if (requests.length === 0) {
            requestsTableBody.innerHTML = `<tr><td colspan="8" class="loading-placeholder">ไม่พบรายการแจ้งซ่อมที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
            requestsMobileList.innerHTML = `<div class="loading-placeholder">ไม่พบรายการแจ้งซ่อมที่ตรงกับเงื่อนไขการค้นหา</div>`;
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
                        <button class="manage-btn" style="background-color: #10b981; margin-bottom: 4px;" onclick="printRequest(${req.id})">พิมพ์</button>
                        <button class="manage-btn" onclick="openManageModal(${req.id})">จัดการ</button>
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
                        <button class="manage-btn" style="background-color: #10b981; margin-bottom: 4px;" onclick="printRequest(${req.id})">พิมพ์รายงาน</button>
                        <button class="manage-btn" onclick="openManageModal(${req.id})">จัดการสถานะงาน</button>
                    </div>
                </div>
            `;
        });
        requestsMobileList.innerHTML = mobileHtml;
    }

    // Apply Filter & Search Inputs
    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        const stat = filterStatus.value;
        const res = filterResult.value;
        const type = filterType.value;

        filteredRequests = allRequests.filter(req => {
            // Search Input Match
            const matchesSearch = !query || 
                req.requester_name.toLowerCase().includes(query) ||
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

            return matchesSearch && matchesStatus && matchesResult && matchesType;
        });

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

        // Show Modal
        editModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Lock background scrolling
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

        let html = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <title>ใบแจ้งซ่อม #${req.id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Sarabun', sans-serif; padding: 20px; line-height: 1.5; color: #000; }
                h2 { text-align: center; font-weight: 600; margin-bottom: 30px; }
                .section { margin-bottom: 20px; border: 1px solid #ccc; padding: 15px; border-radius: 8px; }
                .section-title { font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; font-size: 1.1em; }
                .row { display: flex; margin-bottom: 8px; }
                .label { width: 160px; font-weight: bold; }
                .value { flex: 1; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
                th { background-color: #f9fafb; }
                .print-btn-container { text-align: center; margin-top: 30px; }
                .print-btn-container button { padding: 10px 24px; font-size: 16px; cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 4px; font-family: 'Sarabun'; }
                @media print {
                    body { padding: 0; }
                    .section { border: none; padding: 0; border-radius: 0; margin-bottom: 30px; }
                    .print-btn-container { display: none; }
                }
            </style>
        </head>
        <body>
            <h2>รายงานใบแจ้งซ่อม #${req.id}</h2>
            
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
            <div class="print-btn-container">
                <button onclick="window.print()">พิมพ์เอกสารรายงาน</button>
            </div>
            <script>
                // Auto print dialog after page fully loaded
                window.onload = function() {
                    setTimeout(function() { window.print(); }, 500);
                }
            </script>
        </body>
        </html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(html);
        printWindow.document.close();
    }

    function setRadioChecked(name, value) {
        const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (radio) radio.checked = true;
    }

    function closeModal() {
        editModal.classList.add('hidden');
        document.body.style.overflow = ''; // Restore scrolling
    }

    // Dynamic Materials Input Rows
    function addMaterialRow(name = '', qty = '') {
        const row = document.createElement('div');
        row.className = 'material-row';
        row.innerHTML = `
            <input type="text" class="material-name" placeholder="ชื่อวัสดุ" value="${escapeHTML(name)}">
            <input type="text" class="material-qty" placeholder="จำนวน" style="max-width: 90px;" value="${escapeHTML(qty)}">
            <button type="button" class="remove-row-btn" title="ลบรายการนี้">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
        `;
        
        // Setup Delete button event
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            row.remove();
        });

        modalMaterialsList.appendChild(row);
    }

    // Submit form logic to update API
    async function handleFormSubmit(e) {
        e.preventDefault();

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

            if (result.status === 'success') {
                showToast(result.message || 'บันทึกสถานะงานเรียบร้อยแล้ว!', 'success');
                closeModal();
                // Re-fetch all requests to refresh Dashboard counters, graphs, and the data list
                fetchRequests();
            } else {
                showToast(result.message || 'ไม่สามารถบันทึกข้อมูลได้', 'error');
            }
        } catch (error) {
            console.error('Update submit error:', error);
            showToast('เชื่อมต่อเซิร์ฟเวอร์ผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
        } finally {
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

        const icon = type === 'success' 
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

        toast.innerHTML = `
            <span class="toast-icon ${type}">${icon}</span>
            <span class="toast-message">${message}</span>
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
    function driveUrlToThumbnail(url) {
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
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
        }

        // ถ้าไม่ใช่ Google Drive URL ให้ใช้ URL เดิม
        return url;
    }
});
// ฟังก์ชันคำนวณและส่งความสูงของฟอร์มแจ้งซ่อมไปให้หน้าแม่

