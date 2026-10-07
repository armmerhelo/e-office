-- =============================================
-- ตาราง: maintenance_requests
-- ระบบใบแจ้งซ่อม - กลุ่มบริหารทั่วไป โรงเรียนศรียานุสรณ์
-- =============================================

CREATE TABLE IF NOT EXISTS `maintenance_requests` (
    `id`                    INT AUTO_INCREMENT PRIMARY KEY,
    `User_Id`               INT DEFAULT NULL COMMENT 'รหัสผู้ใช้งาน (จาก t_user, NULL = Guest)',

    -- ═══════════════════════════════════════════
    -- ส่วนที่ 1: ข้อมูลผู้แจ้งซ่อม
    -- ═══════════════════════════════════════════
    `requester_name`        VARCHAR(255) NOT NULL COMMENT 'ชื่อ-นามสกุล ผู้แจ้ง',
    `position`              VARCHAR(255) DEFAULT NULL COMMENT 'ตำแหน่ง',
    `department`            VARCHAR(255) DEFAULT NULL COMMENT 'กลุ่มสาระการเรียนรู้ / งาน / ฝ่าย',
    `request_date`          DATE NOT NULL COMMENT 'วันที่แจ้งซ่อม',
    `repair_types`          VARCHAR(500) NOT NULL COMMENT 'ประเภทการซ่อม (comma-separated เช่น ไฟฟ้า,ประปาและสุขภัณฑ์)',
    `other_type_detail`     VARCHAR(255) DEFAULT NULL COMMENT 'รายละเอียดอื่นๆ (ถ้าเลือกอื่นๆ)',
    `building`              VARCHAR(255) DEFAULT NULL COMMENT 'อาคาร',
    `room`                  VARCHAR(255) DEFAULT NULL COMMENT 'ห้อง',
    `damage_details`        TEXT DEFAULT NULL COMMENT 'ลักษณะการชำรุด / รายละเอียด',

    -- ═══════════════════════════════════════════
    -- ส่วนที่ 2: สำหรับเจ้าหน้าที่ (กลุ่มบริหารทั่วไป)
    -- ═══════════════════════════════════════════

    -- 2.1 การพิจารณาเบื้องต้น
    `consideration_status`  ENUM('pending', 'can_proceed', 'cannot_proceed') DEFAULT 'pending' COMMENT 'สถานะการพิจารณา',
    `assigned_to`           VARCHAR(255) DEFAULT NULL COMMENT 'มอบหมายให้ (ชื่อผู้รับผิดชอบ)',
    `reason_cannot_proceed` VARCHAR(500) DEFAULT NULL COMMENT 'เหตุผลที่ไม่สามารถดำเนินการได้',
    `materials`             JSON DEFAULT NULL COMMENT 'วัสดุที่ต้องใช้ซ่อมบำรุง [{name:"...", qty:"..."}]',

    -- 2.2 ผลการดำเนินการ
    `action_result`         ENUM('pending', 'fixed', 'cannot_fix') DEFAULT 'pending' COMMENT 'ผลการดำเนินการ',
    `reason_cannot_fix`     VARCHAR(500) DEFAULT NULL COMMENT 'เหตุผลที่ไม่สามารถซ่อมได้',
    `repair_details`        TEXT DEFAULT NULL COMMENT 'รายละเอียดการซ่อม',

    -- ═══════════════════════════════════════════
    -- Metadata
    -- ═══════════════════════════════════════════
    `created_at`            TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'วันที่สร้างรายการ',
    `updated_at`            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'วันที่อัปเดตล่าสุด'

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='ตารางใบแจ้งซ่อม - กลุ่มบริหารทั่วไป โรงเรียนศรียานุสรณ์';
