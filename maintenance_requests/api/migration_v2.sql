-- =========================================================================
-- Database Migration Script (V2)
-- สำหรับระบบแจ้งซ่อม: เพิ่มระบบอัปโหลดภาพถ่ายแยกตามปี และเบอร์โทรศัพท์ติดต่อ
-- โรงเรียนศรียานุสรณ์
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. สร้างตารางสำหรับเก็บข้อมูลโฟลเดอร์ Google Drive แยกตามปี พ.ศ. (Caching)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `maintenance_year_folders` (
    `year` INT PRIMARY KEY COMMENT 'ปี พ.ศ. ของกลุ่มเอกสารแจ้งซ่อม',
    `drive_folder_id` VARCHAR(255) NOT NULL COMMENT 'Google Drive Folder ID สำหรับอัปโหลดรูปภาพ',
    `drive_folder_url` VARCHAR(500) DEFAULT NULL COMMENT 'ลิงก์เข้าถึงโฟลเดอร์บน Google Drive',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='ตารางเก็บ ID โฟลเดอร์แยกตามปีเพื่อป้องกันการสร้างโฟลเดอร์ซ้ำ';

-- -------------------------------------------------------------------------
-- 2. เพิ่มคอลัมน์ images (สำหรับเก็บลิ้งค์ภาพ) และ phone (เบอร์โทรติดต่อ)
-- -------------------------------------------------------------------------
ALTER TABLE `maintenance_requests`
    ADD COLUMN `images` TEXT DEFAULT NULL COMMENT 'JSON array ของลิงก์รูปภาพใน Google Drive' AFTER `damage_details`,
    ADD COLUMN `phone` VARCHAR(50) DEFAULT NULL COMMENT 'เบอร์โทรศัพท์ติดต่อของผู้แจ้ง' AFTER `department`;
