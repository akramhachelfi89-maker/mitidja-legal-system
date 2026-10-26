const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); 

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// إنشاء مجلد المرفقات أوتوماتيكياً
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

// الاتصال بقاعدة البيانات
const db = mysql.createPool({
    connectionLimit: 3,
    host: 'bdj70168ffojqcl967nx-mysql.services.clever-cloud.com',
    user: 'urc79o1ctr3bctj4', 
    password: 'lWO2Nxj2VAJxCZ7K2KIL', 
    database: 'bdj70168ffojqcl967nx',
    dateStrings: true // لقراءة التواريخ بشكل صحيح
});

db.getConnection((err, connection) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.sqlMessage);
    else {
        console.log('✅ تم الاتصال بنجاح بقاعدة البيانات MySQL');
        // إضافة أعمدة الأيزو أوتوماتيكياً إذا لم تكن موجودة
        const alterQuery = `ALTER TABLE complaints 
                            ADD COLUMN IsRead BOOLEAN DEFAULT FALSE, 
                            ADD COLUMN ViewedAt DATETIME, 
                            ADD COLUMN Deadline DATETIME, 
                            ADD COLUMN ProgressReports TEXT,
                            ADD COLUMN AssignedTo VARCHAR(255)`;
        connection.query(alterQuery, () => connection.release());
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ==========================================
// مسارات السيرفر (API Endpoints)
// ==========================================

// --- تسجيل الدخول والإحصائيات ---
app.post('/api/login', (req, res) => {
    db.query('SELECT * FROM users WHERE Username = ? AND PasswordHash = ?', [req.body.username, req.body.password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'خطأ داخلي' });
        if (results.length > 0) res.json({ success: true, user: { id: results[0].UserID, fullName: results[0].FullName, role: results[0].Role } });
        else res.status(401).json({ success: false, message: 'معلومات الدخول خاطئة' });
    });
});

app.get('/api/stats', (req, res) => {
    const stats = {};
    db.query('SELECT COUNT(*) as total FROM complaints', (err, res1) => {
        if(err) return res.json({ success: false });
        stats.total = res1[0].total;
        db.query('SELECT COUNT(*) as pending FROM complaints WHERE Status = "قيد المعالجة" OR Status = "تسجيل أولي"', (err, res2) => {
            stats.pending = res2[0].pending;
            db.query('SELECT COUNT(*) as accepted FROM complaints WHERE Status = "تم الحل" OR Status = "مقبولة"', (err, res3) => {
                stats.accepted = res3[0].accepted;
                db.query('SELECT COUNT(*) as rejected FROM complaints WHERE Status = "مرفوضة"', (err, res4) => {
                    stats.rejected = res4[0].rejected;
                    res.json({ success: true, stats });
                });
            });
        });
    });
});

// --- إدارة الشكاوى ---
app.get('/api/complaints', (req, res) => {
    db.query('SELECT * FROM complaints ORDER BY ComplaintID DESC', (err, results) => res.json({ success: true, complaints: results || [] }));
});

app.post('/api/complaints', upload.single('file'), (req, res) => {
    const fp = req.file ? 'uploads/' + req.file.filename : null;
    db.query('INSERT INTO complaints (Title, ComplaintType, Description, FilePath, CreatedBy_FullName, CreatedBy_Role, Status) VALUES (?, ?, ?, ?, ?, ?, "تسجيل أولي")', 
    [req.body.title, req.body.complaintType, req.body.description, fp, req.body.createdBy_FullName, req.body.createdBy_Role], 
    (err) => res.json({ success: !err, error: err?.sqlMessage }));
});

app.delete('/api/complaints/:id', (req, res) => {
    db.query('DELETE FROM complaints WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

// --- دوال الأيزو والمهلة (ISO & SLA) ---
app.put('/api/complaints/:id/start', (req, res) => {
    db.query(`UPDATE complaints SET IsRead = 1, ViewedAt = NOW(), Deadline = DATE_ADD(NOW(), INTERVAL 7 DAY), Status = 'قيد المعالجة' WHERE ComplaintID = ?`, [req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

app.put('/api/complaints/:id/progress', (req, res) => {
    db.query(`UPDATE complaints SET ProgressReports = CONCAT(IFNULL(ProgressReports, ''), '\n📌 [', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i'), '] ', ?) WHERE ComplaintID = ?`, [req.body.report, req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

app.put('/api/complaints/:id/extend', (req, res) => {
    db.query(`UPDATE complaints SET Deadline = DATE_ADD(Deadline, INTERVAL 7 DAY) WHERE ComplaintID = ?`, [req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

app.put('/api/complaints/:id/resolve', (req, res) => {
    db.query(`UPDATE complaints SET LegalOpinion = ?, Status = 'تم الحل' WHERE ComplaintID = ?`, [req.body.opinion, req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

app.put('/api/complaints/:id/reassign', (req, res) => {
    db.query(`UPDATE complaints SET AssignedTo = ?, Status = 'محولة إداريا' WHERE ComplaintID = ?`, [req.body.assignee, req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

app.put('/api/complaints/:id/admin', (req, res) => {
    db.query('UPDATE complaints SET AdminDecision = ?, Status = ? WHERE ComplaintID = ?', [req.body.adminDecision, req.body.status, req.params.id], err => res.json({ success: !err, error: err?.sqlMessage }));
});

// --- باقي الأقسام ---
app.get('/api/users', (req, res) => { db.query('SELECT * FROM users', (err, results) => res.json({ success: true, users: results || [] })); });
app.post('/api/users', (req, res) => { db.query('INSERT INTO users (FullName, Username, PasswordHash, Role) VALUES (?, ?, ?, ?)', [req.body.fullName, req.body.username, req.body.password, req.body.role], err => res.json({ success: !err })); });
app.delete('/api/users/:id', (req, res) => { db.query('DELETE FROM users WHERE UserID = ?', [req.params.id], err => res.json({ success: !err })); });

app.get('/api/laws', (req, res) => { db.query('SELECT * FROM laws', (err, results) => res.json({ success: true, laws: results || [] })); });
app.put('/api/laws', (req, res) => { db.query('UPDATE laws SET Content = ? WHERE LawType = ?', [req.body.content, req.body.type], err => res.json({ success: !err })); });

app.get('/api/lawyers', (req, res) => { db.query('SELECT * FROM lawyers', (err, results) => res.json({ success: true, lawyers: results || [] })); });
app.post('/api/lawyers', (req, res) => { db.query('INSERT INTO lawyers (FullName, Email, PhoneNumber) VALUES (?, ?, ?)', [req.body.fullName, req.body.email, req.body.phone], err => res.json({ success: !err })); });
app.delete('/api/lawyers/:id', (req, res) => { db.query('DELETE FROM lawyers WHERE LawyerID = ?', [req.params.id], err => res.json({ success: !err })); });
app.post('/api/contracts', upload.single('file'), (req, res) => { const fp = req.file ? 'uploads/' + req.file.filename : ''; db.query('INSERT INTO contracts (EmployeeName, ContractType, FilePath, LawyerID, CreatedBy_FullName) VALUES (?, ?, ?, ?, ?)', [req.body.employeeName, req.body.contractType, fp, req.body.lawyerId, req.body.createdBy], err => res.json({ success: !err })); });

app.get('/api/backup', (req, res) => { db.query('SELECT * FROM complaints', (err, complaints) => { if (err) return res.status(500).json({ success: false }); res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', 'attachment; filename="Sauvegarde_Cadets.json"'); res.send(JSON.stringify({ date_sauvegarde: new Date(), donnees: complaints }, null, 2)); }); });

app.get('/api/notifications/count', (req, res) => { db.query('SELECT COUNT(*) as count FROM complaints WHERE Status = "تسجيل أولي"', (err, r) => res.json({ count: err ? 0 : r[0].count })); });
app.get('/api/inquiries', (req, res) => { db.query('SELECT * FROM inquiries ORDER BY InquiryID DESC', (err, results) => res.json({ success: true, inquiries: results || [] })); });
app.post('/api/inquiries', (req, res) => { db.query('INSERT INTO inquiries (Title, Content, CreatedBy) VALUES (?, ?, ?)', [req.body.title, req.body.content, req.body.createdBy], err => res.json({ success: !err })); });
app.put('/api/inquiries/:id/admin', (req, res) => { db.query('UPDATE inquiries SET AdminReply = ?, Status = "تم الرد" WHERE InquiryID = ?', [req.body.reply, req.params.id], err => res.json({ success: !err })); });
app.get('/api/warnings', (req, res) => { db.query('SELECT * FROM warnings ORDER BY WarningID DESC', (err, results) => res.json({ success: true, warnings: results || [] })); });
app.post('/api/warnings', (req, res) => { db.query('INSERT INTO warnings (EmployeeName, Reason, CreatedBy) VALUES (?, ?, ?)', [req.body.employeeName, req.body.reason, req.body.createdBy], err => res.json({ success: !err })); });
app.put('/api/warnings/:id/admin', (req, res) => { db.query('UPDATE warnings SET AdminDecision = ?, Status = "مؤكد" WHERE WarningID = ?', [req.body.decision, req.params.id], err => res.json({ success: !err })); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`✅ السيرفر شغال بنجاح على المنفذ ${PORT}`); });
