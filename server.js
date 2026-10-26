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
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✅ تم إنشاء مجلد uploads بنجاح');
}

// الاتصال بقاعدة البيانات
const db = mysql.createPool({
    connectionLimit: 3,
    host: 'bdj70168ffojqcl967nx-mysql.services.clever-cloud.com',
    user: 'urc79o1ctr3bctj4', 
    password: 'lWO2Nxj2VAJxCZ7K2KIL', 
    database: 'bdj70168ffojqcl967nx'
});

db.getConnection((err, connection) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.code, err.sqlMessage);
    else {
        console.log('✅ تم الاتصال بنجاح بقاعدة البيانات MySQL');
        connection.release();
    }
});

// إعدادات الرفع
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ==========================================
// مسارات السيرفر (تم تحويل جميع أسماء الجداول إلى حروف صغيرة)
// ==========================================

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE Username = ? AND PasswordHash = ?', [username, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'خطأ في السيرفر الداخلي' });
        if (results.length > 0) {
            const user = results[0];
            res.json({ success: true, user: { id: user.UserID, fullName: user.FullName, role: user.Role } });
        } else {
            res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
    });
});

app.get('/api/stats', (req, res) => {
    const stats = {};
    db.query('SELECT COUNT(*) as total FROM complaints', (err, res1) => {
        if(err) return res.json({ success: false });
        stats.total = res1[0].total;
        db.query('SELECT COUNT(*) as pending FROM complaints WHERE Status = "تسجيل أولي" OR Status = "قيد دراسة المدير"', (err, res2) => {
            stats.pending = res2[0].pending;
            db.query('SELECT COUNT(*) as accepted FROM complaints WHERE Status = "مقبولة"', (err, res3) => {
                stats.accepted = res3[0].accepted;
                db.query('SELECT COUNT(*) as rejected FROM complaints WHERE Status = "مرفوضة"', (err, res4) => {
                    stats.rejected = res4[0].rejected;
                    res.json({ success: true, stats });
                });
            });
        });
    });
});

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

app.get('/api/complaints', (req, res) => {
    db.query('SELECT * FROM complaints ORDER BY ComplaintID DESC', (err, results) => res.json({ success: true, complaints: results || [] }));
});

app.post('/api/complaints', upload.single('file'), (req, res) => {
    const { title, complaintType, description, createdBy_FullName, createdBy_Role } = req.body;
    const filePath = req.file ? 'uploads/' + req.file.filename : null;
    
    db.query('INSERT INTO complaints (Title, ComplaintType, Description, FilePath, CreatedBy_FullName, CreatedBy_Role) VALUES (?, ?, ?, ?, ?, ?)', 
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
    db.query('DELETE FROM complaints WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err }));
});

app.put('/api/complaints/:id/schedule', (req, res) => {
    db.query('UPDATE complaints SET HearingDate = ?, HearingTime = ? WHERE ComplaintID = ?', [req.body.date, req.body.time, req.params.id], err => res.json({ success: !err }));
});
app.put('/api/complaints/:id/legal', (req, res) => {
    db.query('UPDATE complaints SET LegalOpinion = ?, Status = "قيد دراسة المدير" WHERE ComplaintID = ?', [req.body.legalOpinion, req.params.id], err => res.json({ success: !err }));
});
app.put('/api/complaints/:id/admin', (req, res) => {
    db.query('UPDATE complaints SET AdminDecision = ?, Status = ? WHERE ComplaintID = ?', [req.body.adminDecision, req.body.status, req.params.id], err => res.json({ success: !err }));
});
app.put('/api/complaints/:id/ai', (req, res) => {
    db.query('UPDATE complaints SET AIOpinion = "بناءً على المعطيات، يُنصح بالرجوع إلى المادة 42 من النظام الداخلي للمؤسسة المتعلقة بالنزاعات، وإجراء جلسة صلح بين الأطراف كخطوة أولى." WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err }));
});

app.put('/api/complaints/:id/read', (req, res) => {
    const query = `UPDATE complaints SET IsRead = TRUE, ViewedAt = CURRENT_TIMESTAMP, Deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY) WHERE ComplaintID = ?`;
    db.query(query, [req.params.id], err => res.json({ success: !err }));
});
app.put('/api/complaints/:id/stage', (req, res) => {
    db.query('UPDATE complaints SET CurrentStage = ? WHERE ComplaintID = ?', [req.body.stage, req.params.id], err => res.json({ success: !err }));
});
app.put('/api/complaints/:id/reassign', (req, res) => {
    const { newAssignee, previousOutcomes } = req.body;
    const query = `UPDATE complaints 
                   SET AssignedTo = ?, 
                       PreviousOutcomes = CONCAT(IFNULL(PreviousOutcomes, ''), '\n--- حيثيات سابقة ---\n', ?), 
                       Deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY) 
                   WHERE ComplaintID = ?`;
    db.query(query, [newAssignee, previousOutcomes, req.params.id], err => res.json({ success: !err }));
});

app.get('/api/backup', (req, res) => {
    db.query('SELECT * FROM complaints', (err, complaints) => {
        if (err) return res.status(500).json({ success: false });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="Sauvegarde_CadetsMitidja.json"');
        res.send(JSON.stringify({ date_sauvegarde: new Date(), donnees: complaints }, null, 2));
    });
});

app.get('/api/lawyers', (req, res) => {
    db.query('SELECT * FROM lawyers', (err, results) => res.json({ success: true, lawyers: results || [] }));
});
app.post('/api/lawyers', (req, res) => {
    const { fullName, email, phone } = req.body;
    db.query('INSERT INTO lawyers (FullName, Email, PhoneNumber) VALUES (?, ?, ?)', [fullName, email, phone], err => res.json({ success: !err }));
});
app.delete('/api/lawyers/:id', (req, res) => {
    db.query('DELETE FROM lawyers WHERE LawyerID = ?', [req.params.id], err => res.json({ success: !err }));
});
app.post('/api/contracts', upload.single('file'), (req, res) => {
    const { employeeName, contractType, lawyerId, createdBy } = req.body;
    const filePath = req.file ? 'uploads/' + req.file.filename : '';
    db.query('INSERT INTO contracts (EmployeeName, ContractType, FilePath, LawyerID, CreatedBy_FullName) VALUES (?, ?, ?, ?, ?)',
    [employeeName, contractType, filePath, lawyerId, createdBy], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.sqlMessage });
        res.json({ success: true });
    });
});

app.get('/api/laws', (req, res) => {
    db.query('SELECT * FROM laws', (err, results) => res.json({ success: true, laws: results || [] }));
});
app.put('/api/laws', (req, res) => {
    const { type, content } = req.body;
    db.query('UPDATE laws SET Content = ? WHERE LawType = ?', [content, type], err => res.json({ success: !err }));
});

app.get('/api/notifications/count', (req, res) => {
    db.query('SELECT COUNT(*) as count FROM complaints WHERE Status = "تسجيل أولي"', (err, results) => {
        if (err) return res.json({ count: 0 });
        res.json({ count: results[0].count });
    });
});

app.get('/api/inquiries', (req, res) => {
    db.query('SELECT * FROM inquiries ORDER BY InquiryID DESC', (err, results) => res.json({ success: true, inquiries: results || [] }));
});
app.post('/api/inquiries', (req, res) => {
    const { title, content, createdBy } = req.body;
    db.query('INSERT INTO inquiries (Title, Content, CreatedBy) VALUES (?, ?, ?)', [title, content, createdBy], err => res.json({ success: !err }));
});
app.put('/api/inquiries/:id/admin', (req, res) => {
    db.query('UPDATE inquiries SET AdminReply = ?, Status = "تم الرد" WHERE InquiryID = ?', [req.body.reply, req.params.id], err => res.json({ success: !err }));
});

app.get('/api/warnings', (req, res) => {
    db.query('SELECT * FROM warnings ORDER BY WarningID DESC', (err, results) => res.json({ success: true, warnings: results || [] }));
});
app.post('/api/warnings', (req, res) => {
    const { employeeName, reason, createdBy } = req.body;
    db.query('INSERT INTO warnings (EmployeeName, Reason, CreatedBy) VALUES (?, ?, ?)', [employeeName, reason, createdBy], err => res.json({ success: !err }));
});
app.put('/api/warnings/:id/admin', (req, res) => {
    db.query('UPDATE warnings SET AdminDecision = ?, Status = "مؤكد" WHERE WarningID = ?', [req.body.decision, req.params.id], err => res.json({ success: !err }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال بنجاح على المنفذ ${PORT}`);
});
