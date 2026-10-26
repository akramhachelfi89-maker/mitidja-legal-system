const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // مكتبة جديدة للتعامل مع الملفات والمجلدات

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================
// 0. إنشاء مجلد المرفقات أوتوماتيكياً لتفادي خطأ Render
// ==========================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ تم إنشاء مجلد uploads بنجاح');
}

// ==========================================
// 1. الاتصال بقاعدة البيانات 
// ==========================================
const db = mysql.createPool({
    connectionLimit: 3, // تم التخفيض لتفادي بلوك Clever Cloud
    host: 'bdj70168ffojqcl967nx-mysql.services.clever-cloud.com',
    user: 'urc79o1ctr3bctj4', 
    password: 'lWO2Nxj2VAJxCZ7K2KIL', 
    database: 'bdj70168ffojqcl967nx'
});

db.getConnection((err, connection) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.code, err.sqlMessage);
    else {
        console.log('✅ تم الاتصال بنجاح بقاعدة البيانات MySQL (نظام Pool)');
        connection.release();
    }
});

// 2. إعدادات رفع الملفات (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ==========================================
// مسارات السيرفر (API Endpoints)
// ==========================================

// --- تسجيل الدخول ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE Username = ? AND PasswordHash = ?', [username, password], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'خطأ في السيرفر الداخلي' });
        }
        if (results.length > 0) {
            const user = results[0];
            res.json({ success: true, user: { id: user.UserID, fullName: user.FullName, role: user.Role } });
        } else {
            res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
    });
});

// --- الإحصائيات (المدير العام) ---
app.get('/api/stats', (req, res) => {
    const stats = {};
    db.query('SELECT COUNT(*) as total FROM Complaints', (err, res1) => {
        if(err) return res.json({ success: false });
        stats.total = res1[0].total;
        db.query('SELECT COUNT(*) as pending FROM Complaints WHERE Status = "تسجيل أولي" OR Status = "قيد دراسة المدير"', (err, res2) => {
            stats.pending = res2[0].pending;
            db.query('SELECT COUNT(*) as accepted FROM Complaints WHERE Status = "مقبولة"', (err, res3) => {
                stats.accepted = res3[0].accepted;
                db.query('SELECT COUNT(*) as rejected FROM Complaints WHERE Status = "مرفوضة"', (err, res4) => {
                    stats.rejected = res4[0].rejected;
                    res.json({ success: true, stats });
                });
            });
        });
    });
});

// --- إدارة المستخدمين ---
app.get('/api/users', (req, res) => {
    db.query('SELECT * FROM users', (err, results) => res.json({ success: true, users: results || [] }));
});
app.post('/api/users', (req, res) => {
    const { fullName, username, password, role } = req.body;
    db.query('INSERT INTO users (FullName, Username, PasswordHash, Role) VALUES (?, ?, ?, ?)', [fullName, username, password, role], err => res.json({ success: !err }));
});
app.delete('/api/users/:id', (req, res) => {
    db.query('DELETE FROM users WHERE UserID = ?', [req.params.id], err => res.json({ success: !err }));
});

// --- إدارة النزاعات والملفات ---
app.get('/api/complaints', (req, res) => {
    db.query('SELECT * FROM Complaints ORDER BY ComplaintID DESC', (err, results) => res.json({ success: true, complaints: results || [] }));
});

// (تم تحديث هذه الدالة لإرجاع الخطأ الحقيقي)
app.post('/api/complaints', upload.single('file'), (req, res) => {
    const { title, complaintType, description, createdBy_FullName, createdBy_Role } = req.body;
    const filePath = req.file ? 'uploads/' + req.file.filename : null;
    
    db.query('INSERT INTO Complaints (Title, ComplaintType, Description, FilePath, CreatedBy_FullName, CreatedBy_Role) VALUES (?, ?, ?, ?, ?, ?)', 
    [title, complaintType, description, filePath, createdBy_FullName, createdBy_Role], 
    (err, results) => {
        if (err) {
            console.error('Database Error Insert Complaint:', err.sqlMessage);
            return res.status(500).json({ success: false, error: err.sqlMessage || err.message });
        }
        res.json({ success: true });
    });
});

app.delete('/api/complaints/:id', (req, res) => {
    db.query('DELETE FROM Complaints WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err }));
});

// برمجة الجلسة (الاستماع)
app.put('/api/complaints/:id/schedule', (req, res) => {
    db.query('UPDATE Complaints SET HearingDate = ?, HearingTime = ? WHERE ComplaintID = ?', [req.body.date, req.body.time, req.params.id], err => res.json({ success: !err }));
});
// رأي الشؤون القانونية
app.put('/api/complaints/:id/legal', (req, res) => {
    db.query('UPDATE Complaints SET LegalOpinion = ?, Status = "قيد دراسة المدير" WHERE ComplaintID = ?', [req.body.legalOpinion, req.params.id], err => res.json({ success: !err }));
});
// قرار المدير العام
app.put('/api/complaints/:id/admin', (req, res) => {
    db.query('UPDATE Complaints SET AdminDecision = ?, Status = ? WHERE ComplaintID = ?', [req.body.adminDecision, req.body.status, req.params.id], err => res.json({ success: !err }));
});
// الذكاء الاصطناعي
app.put('/api/complaints/:id/ai', (req, res) => {
    db.query('UPDATE Complaints SET AIOpinion = "بناءً على المعطيات، يُنصح بالرجوع إلى المادة 42 من النظام الداخلي للمؤسسة المتعلقة بالنزاعات، وإجراء جلسة صلح بين الأطراف كخطوة أولى." WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err }));
});

// ==========================================
// إضافات معايير الأيزو (ISO) الخاصة بالمدير
// ==========================================

// 1. تسجيل قراءة الشكوى وبدء مهلة 7 أيام
app.put('/api/complaints/:id/read', (req, res) => {
    const query = `UPDATE Complaints SET IsRead = TRUE, ViewedAt = CURRENT_TIMESTAMP, Deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY) WHERE ComplaintID = ?`;
    db.query(query, [req.params.id], err => res.json({ success: !err }));
});

// 2. تحديث مراحل القضية (للمدير)
app.put('/api/complaints/:id/stage', (req, res) => {
    db.query('UPDATE Complaints SET CurrentStage = ? WHERE ComplaintID = ?', [req.body.stage, req.params.id], err => res.json({ success: !err }));
});

// 3. تحويل القضية وتمديد 7 أيام أخرى
app.put('/api/complaints/:id/reassign', (req, res) => {
    const { newAssignee, previousOutcomes } = req.body;
    const query = `UPDATE Complaints 
                   SET AssignedTo = ?, 
                       PreviousOutcomes = CONCAT(IFNULL(PreviousOutcomes, ''), '\n--- حيثيات سابقة ---\n', ?), 
                       Deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY) 
                   WHERE ComplaintID = ?`;
    db.query(query, [newAssignee, previousOutcomes, req.params.id], err => res.json({ success: !err }));
});

// 4. زر النسخ الاحتياطي (SAUVEGARDE)
app.get('/api/backup', (req, res) => {
    db.query('SELECT * FROM Complaints', (err, complaints) => {
        if (err) return res.status(500).json({ success: false });
        const backupData = {
            date_sauvegarde: new Date(),
            donnees: complaints
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="Sauvegarde_CadetsMitidja.json"');
        res.send(JSON.stringify(backupData, null, 2));
    });
});

// ==========================================
// إدارة المحامين، العقود، القوانين والإنذارات
// ==========================================

// --- إدارة المحامين والعقود ---
app.get('/api/lawyers', (req, res) => {
    db.query('SELECT * FROM Lawyers', (err, results) => res.json({ success: true, lawyers: results || [] }));
});
app.post('/api/lawyers', (req, res) => {
    const { fullName, email, phone } = req.body;
    db.query('INSERT INTO Lawyers (FullName, Email, PhoneNumber) VALUES (?, ?, ?)', [fullName, email, phone], err => res.json({ success: !err }));
});
app.delete('/api/lawyers/:id', (req, res) => {
    db.query('DELETE FROM Lawyers WHERE LawyerID = ?', [req.params.id], err => res.json({ success: !err }));
});
app.post('/api/contracts', upload.single('file'), (req, res) => {
    const { employeeName, contractType, lawyerId, createdBy } = req.body;
    const filePath = req.file ? 'uploads/' + req.file.filename : '';
    db.query('INSERT INTO Contracts (EmployeeName, ContractType, FilePath, LawyerID, CreatedBy_FullName) VALUES (?, ?, ?, ?, ?)',
    [employeeName, contractType, filePath, lawyerId, createdBy], 
    (err) => {
        if (err) return res.status(500).json({ success: false, error: err.sqlMessage });
        res.json({ success: true });
    });
});

// --- القوانين ---
app.get('/api/laws', (req, res) => {
    db.query('SELECT * FROM Laws', (err, results) => res.json({ success: true, laws: results || [] }));
});
app.put('/api/laws', (req, res) => {
    const { type, content } = req.body;
    db.query('UPDATE Laws SET Content = ? WHERE LawType = ?', [content, type], err => res.json({ success: !err }));
});

// --- جرس الإشعارات والتنبيهات ---
app.get('/api/notifications/count', (req, res) => {
    db.query('SELECT COUNT(*) as count FROM Complaints WHERE Status = "تسجيل أولي"', (err, results) => {
        if (err) return res.json({ count: 0 });
        res.json({ count: results[0].count });
    });
});

// --- الاستفسارات ---
app.get('/api/inquiries', (req, res) => {
    db.query('SELECT * FROM Inquiries ORDER BY InquiryID DESC', (err, results) => res.json({ success: true, inquiries: results || [] }));
});
app.post('/api/inquiries', (req, res) => {
    const { title, content, createdBy } = req.body;
    db.query('INSERT INTO Inquiries (Title, Content, CreatedBy) VALUES (?, ?, ?)', [title, content, createdBy], err => res.json({ success: !err }));
});
app.put('/api/inquiries/:id/admin', (req, res) => {
    db.query('UPDATE Inquiries SET AdminReply = ?, Status = "تم الرد" WHERE InquiryID = ?', [req.body.reply, req.params.id], err => res.json({ success: !err }));
});

// --- الإنذارات ---
app.get('/api/warnings', (req, res) => {
    db.query('SELECT * FROM Warnings ORDER BY WarningID DESC', (err, results) => res.json({ success: true, warnings: results || [] }));
});
app.post('/api/warnings', (req, res) => {
    const { employeeName, reason, createdBy } = req.body;
    db.query('INSERT INTO Warnings (EmployeeName, Reason, CreatedBy) VALUES (?, ?, ?)', [employeeName, reason, createdBy], err => res.json({ success: !err }));
});
app.put('/api/warnings/:id/admin', (req, res) => {
    db.query('UPDATE Warnings SET AdminDecision = ?, Status = "مؤكد" WHERE WarningID = ?', [req.body.decision, req.params.id], err => res.json({ success: !err }));
});

// ==========================================
// تشغيل السيرفر 
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال بنجاح على المنفذ ${PORT}`);
});
