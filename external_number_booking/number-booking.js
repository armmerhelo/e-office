(() => {
    const el = id => document.getElementById(id);
    const API_URL = 'external_number_booking.php';
    const requestTimeout = 30000;
    const currentYear = new Date().getFullYear() + 543;
    const pageSize = 20;
    const numberFormat = new Intl.NumberFormat('th-TH');
    let cachedBookings = [], filteredBookings = [], page = 1, requestSequence = 0;
    let apiSequence = 0, authenticationRequest = 0, authenticated = true;
    let isAdmin = false, bookingBusy = false, editBusy = false, loading = false, loadFailed = false;
    let copyNoticeTimer;
    let resultId = '', resultNumber = '', editTrigger = null, suspendedEdit = false, initialEditDetail = '';
    const deleting = new Set();
    const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4" stroke-linejoin="round"/></svg>';

    el('docYear').value = currentYear;
    el('bookingYearLabel').textContent = currentYear;
    for (let i = 0; i < 5; i++) {
        const option = document.createElement('option');
        option.value = currentYear - i;
        option.textContent = currentYear - i;
        el('yearFilter').append(option);
    }

    function message(id, text = '') {
        el(id).textContent = text;
        el(id).hidden = !text;
    }

    function showUnauthorizedScreen() {
        el('unauthorizedScreen').hidden = false;
        el('mainApp').hidden = true;
        if (el('editModal').open) {
            suspendedEdit = true;
            el('editModal').close();
        }
    }

    function resumeEdit() {
        if (!authenticated || document.hidden || !suspendedEdit || !el('editId').value) return;
        suspendedEdit = false;
        if (!el('editModal').open) el('editModal').showModal();
    }

    function handleUnauthorized(error) {
        if (error.status !== 401) return;
        if (error.request < authenticationRequest && authenticated) {
            error.message = 'คำขอนี้ไม่สำเร็จเนื่องจากเซสชันเดิมหมดอายุ กรุณาลองทำรายการอีกครั้ง';
        }
    }

    // Reads and writes share one authentication clock. An older success must
    // not reopen an expired session, just as an older 401 must not lock it.
    function recordAuthentication(request, success) {
        if (request < authenticationRequest) return;
        authenticationRequest = request;
        authenticated = success;
        if (success) {
            el('unauthorizedScreen').hidden = true;
            el('mainApp').hidden = false;
            resumeEdit();
        } else showUnauthorizedScreen();
    }

    async function api(options = {}, year) {
        const request = ++apiSequence;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new DOMException('การเชื่อมต่อใช้เวลานานเกินไป', 'TimeoutError')), requestTimeout);
        try {
            const response = await fetch(API_URL + (year ? '?year=' + encodeURIComponent(year) : ''), {
                credentials: 'same-origin',
                ...options,
                signal: controller.signal,
                headers: {'Content-Type': 'application/json', ...options.headers}
            });
            if (response.status === 401) {
                recordAuthentication(request, false);
                const error = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
                error.status = 401;
                error.request = request;
                throw error;
            }
            const data = await response.json();
            if (!response.ok || data.status !== 'success') throw new Error(data.message || 'ไม่สามารถทำรายการได้ กรุณาลองอีกครั้ง');
            recordAuthentication(request, true);
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    function tableState(title, description, actionLabel, action) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'booking-table-state';
        const heading = document.createElement('strong');
        heading.textContent = title;
        cell.append(heading);
        if (description) {
            const hint = document.createElement('p');
            hint.textContent = description;
            cell.append(hint);
        }
        if (action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'booking-button';
            button.textContent = actionLabel;
            button.addEventListener('click', action);
            cell.append(button);
        }
        row.append(cell);
        el('tableBody').replaceChildren(row);
    }

    async function fetchBookings() {
        const request = ++requestSequence;
        const year = el('yearFilter').value;
        loading = true;
        loadFailed = false;
        el('displayYear').textContent = year;
        el('registerContent').setAttribute('aria-busy', 'true');
        el('refreshBookings').disabled = true;
        el('totalBookings').textContent = '';
        el('tableSummary').textContent = 'กำลังโหลดข้อมูล…';
        el('paginationControls').hidden = true;
        tableState('กำลังโหลดทะเบียนการจอง…', 'ปี พ.ศ. ' + year);
        try {
            const data = await api({}, year);
            if (request !== requestSequence || !authenticated) return;
            isAdmin = Boolean(data.isAdmin);
            cachedBookings = Array.isArray(data.data) ? data.data : [];
            const latestResult = cachedBookings.find(item => String(item.id) === resultId);
            if (latestResult) el('resultDetail').textContent = latestResult.Doc_Detail;
            else if (resultId && String(year) === String(currentYear)) {
                resultId = resultNumber = '';
                el('bookingResult').hidden = true;
            }
            el('totalBookings').textContent = numberFormat.format(cachedBookings.length) + ' รายการ';
            loading = false;
            filterTable(false);
        } catch (error) {
            if (request !== requestSequence) return;
            handleUnauthorized(error);
            loadFailed = true;
            cachedBookings = [];
            filteredBookings = [];
            el('tableSummary').textContent = 'ยังโหลดข้อมูลไม่สำเร็จ';
            tableState('โหลดทะเบียนการจองไม่สำเร็จ', 'ตรวจสอบการเชื่อมต่อ แล้วลองโหลดข้อมูลอีกครั้ง', 'ลองอีกครั้ง', fetchBookings);
        } finally {
            if (request === requestSequence) {
                loading = false;
                el('registerContent').setAttribute('aria-busy', 'false');
                el('refreshBookings').disabled = false;
            }
        }
    }

    function filterTable(resetPage = true) {
        if (resetPage) page = 1;
        if (loading || loadFailed) return;
        const keyword = el('tableSearch').value.trim().toLocaleLowerCase('th');
        filteredBookings = cachedBookings.filter(item =>
            [item.External_Number, item.Doc_Detail, item.User_Name, item.Doc_Year]
                .some(value => String(value ?? '').toLocaleLowerCase('th').includes(keyword)));
        renderTable();
    }

    function renderTable() {
        const total = filteredBookings.length, pages = Math.max(1, Math.ceil(total / pageSize));
        page = Math.max(1, Math.min(page, pages));
        const start = (page - 1) * pageSize;
        el('paginationControls').hidden = total <= pageSize;
        el('pageLabel').textContent = page + ' / ' + pages;
        el('previousPage').disabled = page <= 1;
        el('nextPage').disabled = page >= pages;
        el('bookingsTable').querySelector('th.action-column').hidden = !isAdmin;
        el('tableSummary').textContent = total
            ? 'แสดง ' + numberFormat.format(start + 1) + '–' + numberFormat.format(Math.min(start + pageSize, total)) + ' จาก ' + numberFormat.format(total) + ' รายการ'
            : '0 รายการ';
        if (el('tableSearch').value.trim() && cachedBookings.length) {
            el('tableSummary').textContent += ' · ทั้งหมด ' + numberFormat.format(cachedBookings.length) + ' รายการในปีนี้';
        }
        if (!total) {
            const searching = Boolean(el('tableSearch').value.trim());
            tableState(searching ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีการจองในปี ' + el('yearFilter').value,
                searching ? 'ลองค้นหาด้วยเลขคำสั่ง ชื่อเรื่อง หรือชื่อผู้จอง' : 'เมื่อจองเลขสำเร็จ รายการจะแสดงที่นี่',
                searching ? 'ล้างคำค้น' : '', searching ? () => { el('tableSearch').value = ''; filterTable(); el('tableSearch').focus(); } : null);
            return;
        }
        const fragment = document.createDocumentFragment();
        filteredBookings.slice(start, start + pageSize).forEach((item, index) => {
            const row = document.createElement('tr');
            const cell = (className, text) => {
                const td = document.createElement('td');
                td.className = className;
                if (text != null) td.textContent = text;
                row.append(td);
                return td;
            };
            cell('booking-col-index', start + index + 1);
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'booking-number-copy';
            copy.title = 'คัดลอกเลขคำสั่ง ' + item.External_Number;
            copy.setAttribute('aria-label', copy.title);
            const number = document.createElement('span');
            number.textContent = item.External_Number;
            copy.append(number);
            copy.insertAdjacentHTML('beforeend', copyIcon);
            copy.addEventListener('click', () => copyToClipboard(item.External_Number, copy));
            cell('booking-col-number').append(copy);
            cell('booking-col-detail', item.Doc_Detail);
            cell('booking-col-user', item.User_Name || 'ไม่ระบุชื่อ');
            if (isAdmin) {
                const actions = document.createElement('div');
                actions.className = 'booking-row-actions';
                const edit = document.createElement('button'), remove = document.createElement('button');
                edit.type = remove.type = 'button';
                edit.className = 'booking-text-button';
                edit.textContent = 'แก้ไข';
                edit.setAttribute('aria-label', 'แก้ไขคำสั่ง ' + item.External_Number);
                edit.addEventListener('click', () => openEditModal(item, edit));
                remove.className = 'booking-text-button booking-delete';
                remove.textContent = 'ลบ';
                remove.setAttribute('aria-label', 'ลบการจอง ' + item.External_Number);
                remove.addEventListener('click', () => deleteBooking(item, remove));
                actions.append(edit, remove);
                cell('booking-col-actions').append(actions);
            }
            fragment.append(row);
        });
        el('tableBody').replaceChildren(fragment);
    }

    async function copyToClipboard(text, button) {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                const input = document.createElement('textarea');
                input.value = text;
                input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                document.body.append(input);
                input.select();
                let copied;
                try { copied = document.execCommand('copy'); } finally { input.remove(); button?.focus(); }
                if (!copied) throw new Error('Copy failed');
            }
            el('copyStatus').textContent = 'คัดลอกเลขคำสั่ง ' + text + ' แล้ว';
            clearTimeout(copyNoticeTimer);
            copyNoticeTimer = setTimeout(() => { el('copyStatus').textContent = ''; }, 2400);
            if (button === el('copyResult')) {
                button.textContent = 'คัดลอกแล้ว';
                setTimeout(() => { button.textContent = 'คัดลอกเลขคำสั่ง'; }, 2000);
            } else {
                button.title = 'คัดลอกแล้ว';
                setTimeout(() => { button.title = 'คัดลอกเลขคำสั่ง ' + text; }, 2000);
            }
        } catch {
            Swal.fire({icon: 'info', title: 'คัดลอกเลขคำสั่ง', text: 'คัดลอกเลข ' + text + ' ด้วยตนเองได้เลย', confirmButtonText: 'ปิด'});
        }
    }

    function updateDetailCount() {
        el('detailCount').textContent = el('docDetail').value.length + ' / 300';
        el('docDetail').setCustomValidity('');
        message('bookingError');
    }

    el('bookingForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (bookingBusy) return;
        const detail = el('docDetail').value.trim();
        if (!detail) {
            el('docDetail').setCustomValidity('กรุณาระบุเรื่องคำสั่ง');
            el('docDetail').reportValidity();
            return;
        }
        bookingBusy = true;
        message('bookingError');
        el('docDetail').readOnly = true;
        el('reserveButton').disabled = true;
        el('reserveButton').setAttribute('aria-busy', 'true');
        el('reserveButton').querySelector('span').textContent = 'กำลังจองเลข…';
        try {
            const result = await api({method: 'POST', body: JSON.stringify({docDetail: detail, docYear: String(currentYear)})});
            resultId = String(result.data.id);
            resultNumber = result.data.External_Number;
            el('resultNumber').textContent = resultNumber;
            el('resultDetail').textContent = result.data.Doc_Detail;
            el('copyResult').textContent = 'คัดลอกเลขคำสั่ง';
            el('bookingResult').hidden = false;
            el('docDetail').value = '';
            updateDetailCount();
            el('bookingForm').dispatchEvent(new Event('eoffice:form-saved', {bubbles: true}));
            el('yearFilter').value = currentYear;
            el('tableSearch').value = '';
            page = 1;
            if (!document.hidden) el('resultHeading').focus({preventScroll: true});
            await fetchBookings();
        } catch (error) {
            handleUnauthorized(error);
            message('bookingError', 'จองเลขไม่สำเร็จ: ' + error.message + ' หากขาดการเชื่อมต่อระหว่างบันทึก ให้ตรวจทะเบียนก่อนจองซ้ำ');
        } finally {
            bookingBusy = false;
            el('docDetail').readOnly = false;
            el('reserveButton').disabled = false;
            el('reserveButton').setAttribute('aria-busy', 'false');
            el('reserveButton').querySelector('span').textContent = 'จองเลขคำสั่ง';
        }
    });

    function openEditModal(item, trigger) {
        if (editBusy) return;
        editTrigger = trigger;
        el('editId').value = item.id;
        el('editExternalNumber').value = item.External_Number;
        el('editDocDetail').value = item.Doc_Detail;
        initialEditDetail = item.Doc_Detail;
        message('editError');
        el('editModal').showModal();
        el('editDocDetail').focus();
    }

    function closeEditModal() {
        if (editBusy) return;
        suspendedEdit = false;
        el('editModal').close();
        el('editForm').reset();
        editTrigger?.focus();
    }

    el('editModal').addEventListener('cancel', event => {
        event.preventDefault();
        closeEditModal();
    });
    el('editForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (editBusy) return;
        const detail = el('editDocDetail').value.trim();
        if (!detail) { message('editError', 'กรุณาระบุเรื่องคำสั่ง'); el('editDocDetail').focus(); return; }
        const id = el('editId').value;
        editBusy = true;
        message('editError');
        el('editDocDetail').readOnly = true;
        for (const id of ['saveEdit', 'cancelEdit', 'closeEdit']) el(id).disabled = true;
        el('saveEdit').textContent = 'กำลังบันทึก…';
        try {
            await api({method: 'PUT', body: JSON.stringify({id, docDetail: detail})});
            if (String(id) === resultId) el('resultDetail').textContent = detail;
            suspendedEdit = false;
            el('editForm').dispatchEvent(new Event('eoffice:form-saved', {bubbles: true}));
            el('editModal').close();
            el('editForm').reset();
            await fetchBookings();
            if (!document.hidden) el('tableSearch').focus({preventScroll: true});
        } catch (error) {
            handleUnauthorized(error);
            const uncertain = ['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError'].includes(error.name);
            message('editError', uncertain
                ? 'ยังยืนยันผลการบันทึกไม่ได้ ระบบอาจบันทึกแล้ว กรุณาปิดหน้าต่างและโหลดทะเบียนเพื่อตรวจสอบก่อนบันทึกซ้ำ'
                : error.message);
        } finally {
            editBusy = false;
            el('editDocDetail').readOnly = false;
            for (const id of ['saveEdit', 'cancelEdit', 'closeEdit']) el(id).disabled = false;
            el('saveEdit').textContent = 'บันทึกการแก้ไข';
        }
    });

    async function deleteBooking(item, button) {
        if (deleting.has(item.id)) return;
        deleting.add(item.id);
        button.disabled = true;
        try {
            const result = await Swal.fire({
                title: 'ลบการจอง ' + item.External_Number + '?',
                text: 'รายการนี้จะถูกลบจากทะเบียน และไม่สามารถกู้คืนได้',
                icon: 'warning', showCancelButton: true,
                confirmButtonText: 'ลบการจอง', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#b13e46'
            });
            if (!result.isConfirmed) return;
            await api({method: 'DELETE', body: JSON.stringify({id: item.id})});
            if (resultId === String(item.id)) {
                resultId = resultNumber = '';
                el('bookingResult').hidden = true;
            }
            await fetchBookings();
        } catch (error) {
            handleUnauthorized(error);
            Swal.fire({icon: 'error', title: 'ลบการจองไม่สำเร็จ', text: error.message, confirmButtonText: 'ปิด'});
        } finally {
            deleting.delete(item.id);
            button.disabled = false;
        }
    }

    el('docDetail').addEventListener('input', updateDetailCount);
    el('copyResult').addEventListener('click', () => copyToClipboard(resultNumber, el('copyResult')));
    el('tableSearch').addEventListener('input', () => filterTable());
    el('yearFilter').addEventListener('change', () => { page = 1; fetchBookings(); });
    el('refreshBookings').addEventListener('click', fetchBookings);
    el('previousPage').addEventListener('click', () => { page--; renderTable(); });
    el('nextPage').addEventListener('click', () => { page++; renderTable(); });
    el('closeEdit').addEventListener('click', closeEditModal);
    el('cancelEdit').addEventListener('click', closeEditModal);
    window.eofficeRegisterModuleSuspend?.(() => {
        if (el('editModal').open) suspendedEdit = true;
    });
    window.eofficeRegisterModuleResume?.(resumeEdit);
    const hasRetainedChanges = () => Boolean((!authenticated && el('docDetail').value.trim()) ||
        (suspendedEdit && el('editDocDetail').value !== initialEditDetail));
    window.eofficeRegisterModuleChanges?.(hasRetainedChanges);
    window.addEventListener?.('beforeunload', event => {
        // An expired session hides forms, so the shell's visible-form guard
        // cannot see their retained text until authentication recovers.
        if (hasRetainedChanges()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.eofficeRegisterModuleRefresh) fetchBookings();
    });
    window.eofficeRegisterModuleRefresh?.(fetchBookings);
})();
