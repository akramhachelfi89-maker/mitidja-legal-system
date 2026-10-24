const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
// تعديل المنفذ ليتوافق مع الاستضافة السحابية أو يعمل على 3000 محلياً
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname)); 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// معلومات الاتصال بقاعدة البيانات السحابية (Clever Cloud)
const db = mysql.createConnection({
    host: 'bdj70168ffojqcl967nx-mysql.services.clever-cloud.com',
    user: 'urc79o1ctr3bctj4',
    password: 'lWO2Nxj2VAJxCZ7K2KIL',
    database: 'bdj70168ffojqcl967nx',
    port: 3306
});

db.connect(err => { 
    if (err) console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message); 
    else console.log('✅ تم الاتصال بقاعدة البيانات السحابية بنجاح!'); 
});

const upload = multer({ 
    storage: multer.diskStorage({ 
        destination: (req, file, cb) => cb(null, 'uploads/'), 
        filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) 
    }) 
});

// --- الدخول والمستخدمين ---
app.post('/api/login', (req, res) => {
    db.query('SELECT * FROM Users WHERE Username = ? AND PasswordHash = ?', [req.body.username, req.body.password], (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ success: false, message: 'بيانات الدخول خاطئة' });
        res.json({ success: true, user: { id: results[0].UserID, fullName: results[0].FullName, role: results[0].Role } });
    });
});
app.get('/api/users', (req, res) => { db.query('SELECT UserID, FullName, Username, Role FROM Users', (err, results) => res.json({ success: !err, users: results })); });
app.post('/api/users', (req, res) => { db.query('INSERT INTO Users (FullName, Username, PasswordHash, Role) VALUES (?, ?, ?, ?)', [req.body.fullName, req.body.username, req.body.password, req.body.role], err => res.json({ success: !err })); });
app.delete('/api/users/:id', (req, res) => { db.query('DELETE FROM Users WHERE UserID = ?', [req.params.id], err => res.json({ success: !err })); });

// --- الإحصائيات ---
app.get('/api/stats', (req, res) => {
    db.query(`SELECT COUNT(*) as total, SUM(CASE WHEN Status = 'مقبولة' THEN 1 ELSE 0 END) as accepted, SUM(CASE WHEN Status = 'مرفوضة' THEN 1 ELSE 0 END) as rejected, SUM(CASE WHEN Status NOT IN ('مقبولة', 'مرفوضة') THEN 1 ELSE 0 END) as pending FROM Complaints`, (err, results) => {
        res.json({ success: !err, stats: results[0] });
    });
});

// --- الشكاوى والملفات ---
app.post('/api/complaints', upload.single('file'), (req, res) => {
    const filePath = req.file ? req.file.path.replace(/\\/g, "/") : null;
    db.query(`INSERT INTO Complaints (Title, ComplaintType, Description, FilePath, CreatedBy_FullName, CreatedBy_Role, Status) VALUES (?, ?, ?, ?, ?, ?, 'تسجيل أولي')`, 
        [req.body.title, req.body.complaintType, req.body.description, filePath, req.body.createdBy_FullName, req.body.createdBy_Role], err => res.json({ success: !err }));
});
app.get('/api/complaints', (req, res) => { db.query('SELECT * FROM Complaints ORDER BY CreatedAt DESC', (err, results) => res.json({ success: !err, complaints: results })); });
app.delete('/api/complaints/:id', (req, res) => { db.query('DELETE FROM Complaints WHERE ComplaintID = ?', [req.params.id], err => res.json({ success: !err })); });
app.put('/api/complaints/:id/schedule', (req, res) => { db.query('UPDATE Complaints SET HearingDate = ?, HearingTime = ?, Status = "مبرمجة للإنصات" WHERE ComplaintID = ?', [req.body.date, req.body.time, req.params.id], err => res.json({ success: !err })); });
app.put('/api/complaints/:id/ai', (req, res) => { const aiOpinion = "تحليل الذكاء الاصطناعي: يُنصح بإجراء تحقيق إداري."; db.query('UPDATE Complaints SET AIOpinion = ? WHERE ComplaintID = ?', [aiOpinion, req.params.id], err => res.json({ success: !err })); });
app.put('/api/complaints/:id/legal', (req, res) => { db.query('UPDATE Complaints SET LegalOpinion = ?, Status = "قيد دراسة المدير" WHERE ComplaintID = ?', [req.body.legalOpinion, req.params.id], err => res.json({ success: !err })); });
app.put('/api/complaints/:id/admin', (req, res) => { db.query('UPDATE Complaints SET AdminDecision = ?, Status = ? WHERE ComplaintID = ?', [req.body.adminDecision, req.body.status, req.params.id], err => res.json({ success: !err })); });

// --- القوانين ---
app.get('/api/laws', (req, res) => { db.query('SELECT * FROM Laws', (err, results) => res.json({ success: !err, laws: results })); });
app.put('/api/laws', (req, res) => { db.query('UPDATE Laws SET Content = ? WHERE LawType = ?', [req.body.content, req.body.type], err => res.json({ success: !err })); });

// --- المحامين والعقود ---
app.post('/api/lawyers', (req, res) => { db.query('INSERT INTO Lawyers (FullName, Email, PhoneNumber) VALUES (?, ?, ?)', [req.body.fullName, req.body.email, req.body.phone], err => res.json({ success: !err })); });
app.get('/api/lawyers', (req, res) => { db.query('SELECT * FROM Lawyers', (err, results) => res.json({ success: !err, lawyers: results })); });
app.delete('/api/lawyers/:id', (req, res) => { db.query('DELETE FROM Lawyers WHERE LawyerID = ?', [req.params.id], err => res.json({ success: !err })); });
app.post('/api/contracts', upload.single('file'), (req, res) => {
    const filePath = req.file ? req.file.path.replace(/\\/g, "/") : null;
    db.query('INSERT INTO Contracts (EmployeeName, ContractType, FilePath, LawyerID, CreatedBy_FullName) VALUES (?, ?, ?, ?, ?)', [req.body.employeeName, req.body.contractType, filePath, req.body.lawyerId, req.body.createdBy], err => res.json({ success: !err }));
});

app.listen(PORT, () => console.log(`🚀 السيرفر شغال على المنفذ ${PORT}`));