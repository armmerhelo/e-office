document.addEventListener('DOMContentLoaded', () => {
    // 1. Set default date to today
    const dateInput = document.getElementById('requestDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }

    // 1.1 Prefill requester name from Cookie if exists
    const requesterNameInput = document.getElementById('requesterName');
    if (requesterNameInput) {
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

    if (otherCheckbox && otherContainer) {
        otherCheckbox.addEventListener('change', function() {
            if (this.checked) {
                otherContainer.classList.remove('hidden');
                otherDetailInput.setAttribute('required', 'required');
                otherDetailInput.focus();
            } else {
                otherContainer.classList.add('hidden');
                otherDetailInput.removeAttribute('required');
                otherDetailInput.value = '';
            }
        });
    }

    // 3. Handle Image Upload & Previews
    const imageFilesInput = document.getElementById('imageFiles');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    let selectedImages = []; // เก็บออบเจกต์ภาพ { filename, mimeType, base64Data }

    if (imageFilesInput && imagePreviewContainer) {
        imageFilesInput.addEventListener('change', function(e) {
            const files = Array.from(e.target.files);
            
            files.forEach(file => {
                if (!file.type.startsWith('image/')) {
                    showToast('กรุณาเลือกไฟล์ภาพเท่านั้น', 'error');
                    return;
                }
                
                if (file.size > 5 * 1024 * 1024) {
                    showToast(`ไฟล์ ${file.name} มีขนาดใหญ่เกินไป (ไม่เกิน 5MB)`, 'error');
                    return;
                }

                const reader = new FileReader();
                reader.onload = function(evt) {
                    const base64Data = evt.target.result;
                    const imageObj = {
                        filename: file.name,
                        mimeType: file.type,
                        base64Data: base64Data
                    };
                    
                    selectedImages.push(imageObj);
                    renderImagePreviews();
                };
                reader.readAsDataURL(file);
            });
            
            imageFilesInput.value = '';
        });
    }

    function renderImagePreviews() {
        imagePreviewContainer.innerHTML = '';
        selectedImages.forEach((img, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-image-wrapper';
            
            const image = document.createElement('img');
            image.className = 'preview-image';
            image.src = img.base64Data;
            
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-preview-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', () => {
                selectedImages.splice(index, 1);
                renderImagePreviews();
            });
            
            wrapper.appendChild(image);
            wrapper.appendChild(removeBtn);
            imagePreviewContainer.appendChild(wrapper);
        });
    }

    // 4. Handle Form Submission — เชื่อมต่อ API จริง
    const form = document.getElementById('maintenanceForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const loader = submitBtn.querySelector('.loader');

    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Basic validation check
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // ตรวจสอบว่าเลือกประเภทการซ่อมอย่างน้อย 1 อย่าง
            const repairCheckboxes = document.querySelectorAll('input[name="repairType"]:checked');
            if (repairCheckboxes.length === 0) {
                showToast('กรุณาเลือกประเภทการแจ้งซ่อมอย่างน้อย 1 ข้อ', 'error');
                return;
            }

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

                if (result.status === 'success') {
                    showToast('ส่งใบแจ้งซ่อมเรียบร้อยแล้ว!', 'success');
                    
                    // รีเซ็ตฟอร์ม
                    form.reset();
                    // ตั้งค่าวันที่กลับเป็นวันนี้
                    if (dateInput) {
                        dateInput.value = new Date().toISOString().split('T')[0];
                    }
                    // ซ่อนช่อง "อื่นๆ" กลับ
                    if (otherContainer) {
                        otherContainer.classList.add('hidden');
                    }

                    // รีเซ็ตรูปภาพประกอบ
                    selectedImages = [];
                    renderImagePreviews();

                } else {
                    showToast(result.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
                }

            } catch (error) {
                console.error('Submit error:', error);
                showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง', 'error');
            } finally {
                // Reset button state
                btnText.classList.remove('hidden');
                loader.classList.add('hidden');
                submitBtn.disabled = false;
            }
        });
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
        
        // เลือกไอคอนตามประเภท
        const icon = type === 'success' 
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        
        toast.innerHTML = `
            <span class="toast-icon ${type}">${icon}</span>
            <span class="toast-message">${message}</span>
        `;
        
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
