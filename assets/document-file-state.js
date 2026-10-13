(() => {
    const named = (row,name) => row.querySelector(`[name="${name}[]"]`);
    const fileRows = form => [...form.querySelectorAll('#file_send > div')];
    const linkRows = form => [...form.querySelectorAll('#doc_file_link_main > div')];
    window.captureDocumentFileState = form => ({
        files:fileRows(form).map(row => ({row, upload:named(row,'doc_upload'), file:named(row,'doc_upload')?.files[0]})),
        links:linkRows(form).map(row => ({row, url:named(row,'doc_url').value, caption:named(row,'doc_url_name').value}))
    });
    window.reconcileDocumentFiles = (form, submitted, result) => {
        const state = result.files;
        // Receipt-only writes never modify shared attachments.
        if (!state) return;
        if (!Array.isArray(state.entries) || !Array.isArray(state.imported) ||
            state.entries.length !== submitted.files.length) throw new Error('ข้อมูลไฟล์หลังบันทึกไม่ครบ กรุณาตรวจสอบเอกสารก่อนบันทึกอีกครั้ง');
        const valid = item => Number.isInteger(item.file_id) && item.file_id > 0 && typeof item.path === 'string' && item.path.length > 0;
        const indexes = new Set();
        for (const item of state.entries) {
            if (!valid(item) || !Number.isInteger(item.input_index) || !submitted.files[item.input_index] || indexes.has(item.input_index))
                throw new Error('ข้อมูลอ้างอิงไฟล์หลังบันทึกไม่ถูกต้อง');
            indexes.add(item.input_index);
        }
        const imports = new Set();
        for (const item of state.imported) {
            if (!valid(item) || !Number.isInteger(item.link_index) || !submitted.links[item.link_index] || imports.has(item.link_index))
                throw new Error('ข้อมูลไฟล์นำเข้าหลังบันทึกไม่ถูกต้อง');
            imports.add(item.link_index);
        }
        for (const item of state.entries) {
            const old = submitted.files[item.input_index];
            if (!form.contains(old.row)) continue; // Keep the user's removal.
            named(old.row,'file_id').value = item.file_id;
            named(old.row,'file_version').value = item.path;
            // Clear only the uploaded File from that request. A newer selection
            // on the same row still belongs to the next save.
            if (old.upload && old.upload.files[0] === old.file) {
                old.upload.value = '';
                const display = old.row.querySelector('[id^="display-"]');
                if (display) display.textContent = '';
            }
            const href = `e-sign/e-sign.php?Doc_Id=${encodeURIComponent(result.doc_id)}&File_Path=${encodeURIComponent(item.path)}&Year=${encodeURIComponent(state.year)}`;
            const link = old.row.querySelector('a[href*="e-sign.php"]');
            if (link) link.href = href;
            else {
                const savedLink = document.createElement('a');savedLink.href = href;savedLink.setAttribute('aria-label','เปิดไฟล์ที่บันทึกแล้วเพื่อลงนาม');
                const icon = document.createElement('img');icon.src = 'img/e-sign.png';icon.alt = '';icon.className = 'w-13 h-10';
                savedLink.append(icon);old.row.querySelector('div').append(savedLink);
            }
        }
        for (const item of state.imported) {
            const old = submitted.links[item.link_index];
            if (!form.contains(old.row) || named(old.row,'doc_url').value !== old.url) continue;
            // A renamed caption is a later edit; preserve it on the imported PDF.
            const caption = named(old.row,'doc_url_name').value;
            window.addNewInputFile(caption === old.caption ? item.detail : caption, item.file_id, result.doc_id, item.path, state.year, false);
            old.row.remove();
        }
    };
})();
