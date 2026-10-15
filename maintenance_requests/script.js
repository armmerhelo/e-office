document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('maintenanceForm');
    const lifecycle = window.eofficeCreateFormLifecycle;
    const markEdited = () => form.dispatchEvent(new Event('eoffice:form-dirty', {bubbles:true}));
    // 1. Set default date to today
    const dateInput = document.getElementById('requestDate');
    if (dateInput && !dateInput.value) {
        const today = window.eofficeDates.today();
        dateInput.value = today;
    }

    // 1.1 Prefill requester name from Cookie if exists
    const requesterNameInput = document.getElementById('requesterName');
    if (requesterNameInput && !requesterNameInput.value) {
        const userDisplayName = getCookie('User_DisplayName');
        if (userDisplayName) {
            try {
                const decodedName = decodeURIComponent(userDisplayName).replace(/\+/g, ' ');
                requesterNameInput.value = decodedName;
            } catch (err) {
                console.error('Error decoding User_DisplayName cookie:', err);
                requesterNameInput.value = userDisplayName;
            }
        }
    }

    // 2. Toggle "Other" detail input
    const otherCheckbox = document.getElementById('otherTypeCheckbox');
    const otherContainer = document.getElementById('otherTypeContainer');
    const otherDetailInput = document.getElementById('otherTypeDetail');

    // Keep native validation and show persistent guidance beside the affected field.
    form.addEventListener('invalid', event => {
        const field = event.target;
        if (!field.id || !field.closest('.form-group')) return;
        let error = document.getElementById(`${field.id}Error`);
        if (!error) {
            error = document.createElement('p');
            error.id = `${field.id}Error`;
            error.className = 'field-error';
            field.closest('.form-group').appendChild(error);
            field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
        }
        error.textContent = field.validity.valueMissing ? 'กรุณากรอกข้อมูลช่องนี้' : 'กรุณาตรวจสอบข้อมูลช่องนี้ให้ถูกต้อง';
        error.classList.remove('hidden');
        field.setAttribute('aria-invalid', 'true');
    }, true);
    form.addEventListener('input', event => {
        const field = event.target;
        if (field.validity?.valid) {
            field.removeAttribute('aria-invalid');
            const error = document.getElementById(`${field.id}Error`);
            if (error) {error.textContent = '';error.classList.add('hidden');}
        }
    });
    const repairTypeError = document.getElementById('repairTypeError');
    form.addEventListener('change', event => {
        if (event.target.name === 'repairType' && document.querySelectorAll('input[name="repairType"]:checked').length) {
            repairTypeError.textContent = '';
            repairTypeError.classList.add('hidden');
        }
    });
    const dateHint = document.getElementById('requestDateHint');
    const updateDateHint = () => {
        const date = dateInput.valueAsDate;
        dateHint.textContent = date && !Number.isNaN(date.getTime())
            ? new Intl.DateTimeFormat('th-TH', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'}).format(date) : '';
    };
    dateInput.addEventListener('input', updateDateHint);
    dateInput.addEventListener('change', updateDateHint);
    form.addEventListener('eoffice:draft-restored', updateDateHint);
    updateDateHint();

    if (otherCheckbox && otherContainer) {
        otherCheckbox.addEventListener('change', function(event) {
            if (this.checked) {
                otherContainer.classList.remove('hidden');
                otherDetailInput.setAttribute('required', 'required');
                if (event.isTrusted) otherDetailInput.focus();
            } else {
                otherContainer.classList.add('hidden');
                otherDetailInput.removeAttribute('required');
                otherDetailInput.value = '';
                otherDetailInput.removeAttribute('aria-invalid');
                const error = document.getElementById('otherTypeDetailError');
                if (error) {error.textContent = '';error.classList.add('hidden');}
            }
        });
    }

    // 3. Handle Image Upload & Previews
    const imageFilesInput = document.getElementById('imageFiles');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    let selectedImages = []; // เก็บออบเจกต์ภาพ { filename, mimeType, base64Data }
    const pendingImages = new Set();
    let imageGeneration = 0, imageReadFailed = false;
    const imageStatus = document.getElementById('imageStatus');
    const updateImageStatus = () => {
        imageStatus.textContent = pendingImages.size
            ? `กำลังอ่านรูปภาพ ${pendingImages.size} รูป…`
            : selectedImages.length ? `แนบแล้ว ${selectedImages.length} / 5 รูป` : '';
    };
    document.getElementById('addImagesBtn').addEventListener('click', () => {
        if (!lifecycle.busy(form)) imageFilesInput.click();
    });

    if (imageFilesInput && imagePreviewContainer) {
        imageFilesInput.addEventListener('change', function(e) {
            if (lifecycle.busy(form)) return;
            const files = Array.from(e.target.files);
            let acceptedRetry=false;
            
            files.forEach(file => {
                if (!['image/jpeg', 'image/png'].includes(file.type)) {
                    showToast('กรุณาเลือกภาพ JPG หรือ PNG เท่านั้น', 'error');
                    return;
                }
                
                if (file.size > 5 * 1024 * 1024) {
                    showToast(`ไฟล์ ${file.name} มีขนาดใหญ่เกินไป (ไม่เกิน 5MB)`, 'error');
                    return;
                }
                if (selectedImages.length + pendingImages.size >= 5) {
                    showToast('แนบรูปได้สูงสุด 5 รูป กรุณาลบรูปเดิมก่อนเพิ่มรูปใหม่', 'error');
                    return;
                }

                if (!acceptedRetry) {imageReadFailed=false;acceptedRetry=true;}
                const reader = new FileReader();
                const generation = imageGeneration;
                pendingImages.add(reader);
                updateImageStatus();
                reader.onload = function(evt) {
                    if (!pendingImages.delete(reader) || generation !== imageGeneration) return;
                    const base64Data = evt.target.result;
                    const imageObj = {
                        filename: file.name,
                        mimeType: file.type,
                        base64Data: base64Data
                    };
                    
                    selectedImages.push(imageObj);
                    renderImagePreviews();
                    markEdited();
                };
                reader.onerror = reader.onabort = () => {
                    if (!pendingImages.delete(reader) || generation !== imageGeneration) return;
                    imageReadFailed = true;showToast('อ่านรูปภาพไม่สำเร็จ กรุณาเลือกใหม่', 'error');
                    updateImageStatus();
                };
                try {reader.readAsDataURL(file);} catch {reader.onerror();}
            });
            
            imageFilesInput.value = '';
        });
    }

    function renderImagePreviews() {
        imagePreviewContainer.innerHTML = '';
        updateImageStatus();
        selectedImages.forEach((img, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-image-wrapper';
            
            const image = document.createElement('img');
            image.className = 'preview-image';
            image.src = img.base64Data;
            image.alt = img.filename;
            
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-preview-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.setAttribute('aria-label', `ลบรูป ${img.filename}`);
            removeBtn.addEventListener('click', () => {
                if (lifecycle.busy(form)) return;
                selectedImages.splice(index, 1);
                renderImagePreviews();
                const remainingButtons = imagePreviewContainer.querySelectorAll('button');
                (remainingButtons[Math.min(index, remainingButtons.length - 1)] || document.getElementById('addImagesBtn')).focus();
                markEdited();
            });
            
            wrapper.appendChild(image);
            wrapper.appendChild(removeBtn);
            imagePreviewContainer.appendChild(wrapper);
        });
    }

    // 4. Handle Form Submission — เชื่อมต่อ API จริง
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const loader = submitBtn.querySelector('.loader');

    if (form) {
        form.addEventListener('reset', () => {
            form.querySelectorAll('.field-error').forEach(error => {
                error.classList.add('hidden');
                error.textContent = '';
            });
            form.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
            imageGeneration++;selectedImages=[];imageReadFailed=false;
            const readers = [...pendingImages];pendingImages.clear();
            for (const reader of readers) if (reader.readyState === 1) reader.abort();
            renderImagePreviews();
            if (otherContainer) otherContainer.classList.add('hidden');
            otherDetailInput?.removeAttribute('required');
            const generation=imageGeneration;
            queueMicrotask(()=>{
                if (generation===imageGeneration && !lifecycle.busy(form) && dateInput && !dateInput.value) dateInput.value=window.eofficeDates.today();
                updateDateHint();
            });
        });
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (lifecycle.busy(form)) return;
            if (pendingImages.size) {showToast('กำลังอ่านรูปภาพ กรุณารอสักครู่ก่อนส่ง', 'error');return;}
            if (imageReadFailed) {showToast('มีรูปภาพที่อ่านไม่สำเร็จ กรุณาเลือกใหม่หรือรีเซ็ตฟอร์มก่อนส่ง', 'error');return;}
            
            // Basic validation check
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // ตรวจสอบว่าเลือกประเภทการซ่อมอย่างน้อย 1 อย่าง
            const repairCheckboxes = document.querySelectorAll('input[name="repairType"]:checked');
            if (repairCheckboxes.length === 0) {
                repairTypeError.textContent = 'กรุณาเลือกประเภทงานซ่อมอย่างน้อย 1 ประเภท';
                repairTypeError.classList.remove('hidden');
                document.querySelector('input[name="repairType"]').focus();
                return;
            }

            const token = lifecycle.begin(form);
            if (!token) return;
            // Show loading state
            btnText.classList.add('hidden');
            loader.classList.remove('hidden');
            submitBtn.disabled = true;

            // ═══════════════════════════════════════════
            // รวบรวมข้อมูลจากฟอร์มเป็น JSON
            // ═══════════════════════════════════════════

            // ประเภทการซ่อม (checkboxes → array)
            const repairTypes = [];
            repairCheckboxes.forEach(cb => repairTypes.push(cb.value));


            // สร้าง payload
            const payload = {
                _expected_owner: token.owner,
                // ข้อมูลผู้ใช้จาก Cookie
                user_token:      getCookie('User_Token') || '1',

                // ส่วนที่ 1: ข้อมูลผู้แจ้ง
                requesterName:   document.getElementById('requesterName').value.trim(),
                position:        document.getElementById('position').value.trim(),
                department:      document.getElementById('department').value.trim(),
                phone:           document.getElementById('phone').value.trim(),
                requestDate:     document.getElementById('requestDate').value,
                repairTypes:     repairTypes,
                otherTypeDetail: document.getElementById('otherTypeDetail')?.value?.trim() || '',
                building:        document.getElementById('building').value.trim(),
                room:            document.getElementById('room').value.trim(),
                damageDetails:   document.getElementById('damageDetails').value.trim(),
                images:          selectedImages
            };

            // ═══════════════════════════════════════════
            // ส่งข้อมูลไปยัง API
            // ═══════════════════════════════════════════
            try {
                const response = await fetch('api/submit_maintenance.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8'
                    },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                if (response.status===401 || result.code==='form_owner_changed') window.dispatchEvent(new Event('eoffice:permissions-changed'));

                if (response.ok && result.status === 'success') {
                    lifecycle.recordCommitted(token,result);
                    const applied = await lifecycle.applyCommitted(token, () => {
                        showToast('ส่งใบแจ้งซ่อมเรียบร้อยแล้ว!', 'success');
                        form.reset();
                        if (dateInput) dateInput.value = window.eofficeDates.today();
                    });
                    if (!applied) showToast('ส่งใบแจ้งซ่อมชุดที่ส่งไปแล้ว โดยรักษาการแก้ไขใหม่ที่ยังไม่ได้ส่งไว้', 'success');

                } else {
                    showToast(result.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
                }

            } catch (error) {
                console.error('Submit error:', error);
                showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง', 'error');
            } finally {
                lifecycle.end(token);
                // Reset button state
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
            }
        });
    }

    if (form) {
        form.dataset.eofficeDraftReady = 'true';
        submitBtn.disabled=false;
        form.dispatchEvent(new Event('eoffice:form-ready'));
        if (imageFilesInput?.files?.length) imageFilesInput.dispatchEvent(new Event('change',{bubbles:true}));
    }

    // ═══════════════════════════════════════════
    // ฟังก์ชันอ่าน Cookie
    // ═══════════════════════════════════════════
    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // ═══════════════════════════════════════════
    // Toast Notification (แทน alert)
    // ═══════════════════════════════════════════
    function showToast(message, type = 'success') {
        // ลบ toast เก่าถ้ามี
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        
        // เลือกไอคอนตามประเภท
        const icon = type === 'success' 
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        
        toast.innerHTML = `
            <span class="toast-icon ${type}">${icon}</span>
            <span class="toast-message"></span>
        `;
        
        toast.querySelector('.toast-message').textContent = message;
        document.body.appendChild(toast);

        // แสดง toast ด้วย animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // ซ่อนหลังจาก 4 วินาที
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }
});
