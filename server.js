const express = require('express');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const mysql = require('mysql');
const multer = require('multer');
const jwt = require('jsonwebtoken'); 
const path = require('path');
const cors = require('cors');
const fs = require('fs');


// Configuración de entorno
dotenv.config({ path: './configuracion.env' });

const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());
app.use(cors());

// Configuración de nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
    },
});

// Conexión a la base de datos
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS, // Asegúrate de que esté vacío si no tienes contraseña
    database: process.env.DB_NAME,
    port: process.env.DB_PORT // Especifica el puerto, aunque 3306 es el predeterminado


    
});

db.connect((err) => {
    if (err) {
        console.error('Error de conexión a la base de datos:', err);
        return;
    }
    console.log('Conectado a la base de datos MySQL');
});

// Configuración de multer para manejar imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploadAvatar/'); // Carpeta donde se guardarán las imágenes
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${fileExtension}`); // Nombre único para cada archivo
    },
});

const upload = multer({ storage });

// Hacer accesible la carpeta "uploadAvatar"
app.use('/uploadAvatar', express.static(path.join(__dirname, 'uploadAvatar')));

// Variables globales
const verificationCodes = {}; // Almacena códigos de verificación

// Rutas de la aplicación

// Ruta para subir imágenes
app.post('/uploadImage', upload.single('avatar'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ninguna imagen.' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploadAvatar/${req.file.filename}`;
    res.status(200).json({ message: 'Imagen subida con éxito.', imageUrl });
});

// Ruta para actualizar avatar
app.post('/updateAvatar', (req, res) => {
    const { userId, avatar } = req.body;
    if (!userId || !avatar) return res.status(400).json({ message: 'El userId y avatar son necesarios.' });

    const updateAvatarQuery = 'UPDATE usuarios SET avatar = ? WHERE id = ?';
    db.query(updateAvatarQuery, [avatar, userId], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error al actualizar el avatar.' });

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        const getRoleQuery = 'SELECT rol FROM usuarios WHERE id = ?';
        db.query(getRoleQuery, [userId], (err, result) => {
            if (err) return res.status(500).json({ message: 'Error al obtener el rol del usuario.' });

            const rol = result[0].rol;
            res.status(200).json({ message: 'Avatar actualizado correctamente.', rol });
        });
    });
});


// Enviar código de verificación
app.post('/sendVerificationEmail', (req, res) => {
    const { email } = req.body;

    db.query('SELECT * FROM usuarios WHERE email = ?', [email], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Error al verificar el correo en la base de datos' });
        }

        if (results.length > 0) {
            return res.status(400).json({ message: 'Este correo ya tiene una cuenta', redirect: 'login' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationCodes[email] = code;

        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Código de Verificación',
            text: `Tu código de verificación es: ${code}`,
        };

        transporter.sendMail(mailOptions, (error) => {
            if (error) {
                return res.status(500).json({ message: 'Error al enviar el correo' });
            }
            res.status(200).json({ message: 'Correo enviado con éxito', verificationCode: code });
        });
    });
});

// Validar código recibido
app.post('/validateCode', (req, res) => {
    const { email, code } = req.body;

    const storedCode = verificationCodes[email];
    if (storedCode === code) {
        delete verificationCodes[email]; // Eliminar código una vez validado
        res.status(200).send({ message: 'Código válido' });
    } else {
        res.status(400).send({ message: 'Código incorrecto' });
    }
});

// Ruta de registro
app.post('/register', (req, res) => {
    console.log("Datos recibidos en /register:", req.body); // <-- Agregar esto para depuración

    const { email, nombres, apellidos, tipoDocumento, documento, rol, contrasena, avatar, nombreEmpresa } = req.body;

    const emailTrimmed = email.trim();
    const contrasenaTrimmed = contrasena.trim();
    const rolTrimmed = rol.trim();

    if (nombreEmpresa) {
        if (!emailTrimmed || !nombreEmpresa.trim() || !rolTrimmed || !contrasenaTrimmed) {
            return res.status(400).json({ message: 'Todos los campos de la empresa son obligatorios.' });
        }
    } else {
        if (!emailTrimmed || !nombres.trim() || !apellidos.trim() || !tipoDocumento.trim() || !documento.trim() || !rolTrimmed || !contrasenaTrimmed) {
            return res.status(400).json({ message: 'Todos los campos del usuario son obligatorios.' });
        }
    }

    db.query('SELECT * FROM usuarios WHERE email = ?', [emailTrimmed], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error al consultar la base de datos.' });

        if (results.length > 0) {
            return res.status(400).json({ message: 'El correo ya está en uso.' });
        }

        let insertUserQuery;
        let values;

        if (nombreEmpresa) {
            insertUserQuery = 'INSERT INTO usuarios (email, nombres, rol, contrasena) VALUES (?, ?, ?, ?)';
            values = [emailTrimmed, nombreEmpresa.trim(), rolTrimmed, contrasenaTrimmed];
        } else {
            insertUserQuery = 'INSERT INTO usuarios (email, nombres, apellidos, tipo_documento, documento, rol, contrasena, avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            values = [emailTrimmed, nombres.trim(), apellidos.trim(), tipoDocumento.trim(), documento.trim(), rolTrimmed, contrasenaTrimmed, avatar];
        }

        db.query(insertUserQuery, values, (err, results) => {
            if (err) return res.status(500).json({ message: 'Error al registrar el usuario o empresa.' });

            const userId = results.insertId;
            res.status(200).json({ message: 'Registro exitoso.', userId });
        });
    });
});





// Ruta de inicio de sesión
app.post('/login', (req, res) => {
    const { email, contrasena } = req.body;

    if (!email || !contrasena) return res.status(400).json({ message: 'El correo y la contraseña son obligatorios.' });

    db.query('SELECT * FROM usuarios WHERE email = ?', [email], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error al consultar la base de datos.' });

        if (results.length === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });

        const user = results[0];
        if (user.contrasena !== contrasena) return res.status(400).json({ message: 'Contraseña incorrecta.' });

        // Enviar el rol junto con los demás datos
        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            userId: user.id,
            avatar: user.avatar,
            userName: user.nombres,
            rol: user.rol,  // Incluir el rol
        });
    });
});


// Ruta de verificación de usuario con Google
app.get('/googleverification', (req, res) => {
    const { email } = req.query;

    if (!email) return res.status(400).json({ message: 'El email es obligatorio.' });

    const trimmedEmail = email.trim().toLowerCase();

    db.query('SELECT * FROM Usuarios WHERE email = ?', [trimmedEmail], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error del servidor.' });

        if (results.length > 0) {
            return res.status(200).json({
                exists: true,
                userId: results[0].id,  // Enviar ID del usuario
                avatar: results[0].avatar, // Enviar avatar
                userName: results[0].nombres, // Enviar nombre
                rol: results[0].rol // 🔥 Agregando el rol aquí
            });
        } else {
            return res.status(200).json({ exists: false });
        }
    });
});



// Ruta para generar enlace de recuperación de contraseña
app.post('/generatePasswordResetLink', (req, res) => {
    const { email } = req.body;

    db.query('SELECT * FROM usuarios WHERE email = ?', [email], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error al verificar el correo en la base de datos' });

        if (results.length === 0) return res.status(404).json({ message: 'Correo no encontrado' });

        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Recuperación de Contraseña',
            text: `Haz clic en el siguiente enlace para recuperar tu contraseña: ${resetLink}`,
        };

        transporter.sendMail(mailOptions, (error) => {
            if (error) return res.status(500).json({ message: 'Error al enviar el correo' });

            res.status(200).json({ message: 'Enlace de recuperación enviado' });
        });
    });
});


// Ruta para obtener información del usuario por ID
app.get('/getUserInfo', (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        console.log("Error: El userId es obligatorio.");
        return res.status(400).json({ message: 'El userId es obligatorio.' });
    }

    const query = 'SELECT id, email, nombres, apellidos, tipo_documento, documento, rol, avatar FROM usuarios WHERE id = ?';

    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error("Error en la consulta:", err);
            return res.status(500).json({ message: 'Error al consultar la base de datos.', error: err });
        }

        if (results.length === 0) {
            console.log(`No se encontró usuario con id: ${userId}`);
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        console.log(`Datos enviados para el usuario ${userId}:`, results[0]);
        res.status(200).json({ message: 'Usuario encontrado.', user: results[0] });
    });
});


// Crear carpeta si no existe
const uploadDir = path.join(__dirname, 'uploadLocal');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Configuración de Multer
const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `local-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const localUpload = multer({ storage: localStorage });

// Hacer accesible la carpeta de imágenes
app.use('/uploadLocal', express.static(uploadDir));

// Ruta para subir una sola imagen
app.post('/uploadLocalImage', localUpload.single('localImage'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ninguna imagen.' });
    }
    const imageUrl = `${req.protocol}://${req.get('host')}/uploadLocal/${req.file.filename}`;
    res.status(200).json({ message: 'Imagen subida con éxito.', imageUrl });
});

// Ruta para registrar un local con imágenes y PDF (PDF obligatorio)
app.post('/registrarLocal', localUpload.fields([
    { name: 'imagenes', maxCount: 10 },  // Hasta 10 imágenes
    { name: 'contrato', maxCount: 1 }    // 1 contrato obligatorio
]), (req, res) => {
    const { nombre, proveedorId } = req.body;
    const direccion = null;  // Como no se envía, establecer en NULL

    if (!req.files['contrato']) {
        return res.status(400).json({ message: 'El contrato (PDF) es obligatorio' });
    }

    if (!nombre || !proveedorId) {
        return res.status(400).json({ message: 'Faltan datos obligatorios' });
    }

    // Obtener URL del contrato
    const contratoFile = req.files['contrato'][0];
    const contrato_url = `${req.protocol}://${req.get('host')}/uploadLocal/${contratoFile.filename}`;

    // Guardar en la base de datos
    const queryLocal = 'INSERT INTO Locales (nombre, direccion, proveedor_id, contrato_url) VALUES (?, ?, ?, ?)';
    db.query(queryLocal, [nombre, direccion, proveedorId, contrato_url], (err, result) => {
        if (err) {
            console.error('❌ ERROR al registrar local:', err);
            return res.status(500).json({ message: 'Error al registrar el local.', error: err });
        }

        const localId = result.insertId;
        console.log('✅ Local registrado con ID:', localId);

        // Si no hay imágenes, devolver solo el ID del local y el contrato
        if (!req.files['imagenes'] || req.files['imagenes'].length === 0) {
            return res.status(200).json({ message: 'Local registrado sin imágenes', localId, contrato_url });
        }

        // Guardar imágenes
        const imagenesUrls = req.files['imagenes'].map(file => `${req.protocol}://${req.get('host')}/uploadLocal/${file.filename}`);
        const queryImagenes = 'INSERT INTO ImagenesLocales (local_id, url_imagen) VALUES ?';
        const values = imagenesUrls.map(url => [localId, url]);

        db.query(queryImagenes, [values], (err) => {
            if (err) {
                console.error('❌ ERROR al guardar imágenes:', err);
                return res.status(500).json({ message: 'Error guardando imágenes.', error: err });
            }
            console.log('✅ Imágenes guardadas correctamente');
            res.status(200).json({ message: 'Local registrado con imágenes y contrato', localId, imagenesUrls, contrato_url });
        });
    });
});

// Ruta para obtener la información del usuario
app.get('/api/local/:userId', (req, res) => {
    const { userId } = req.params;

    console.log(`🔍 Recibiendo solicitud para obtener locales del proveedor con ID: ${userId}`);

    const query = `
        SELECT 
            l.id AS local_id,
            l.nombre,
            l.direccion,
            l.fecha_registro,
            l.contrato_url,
            l.pdf_url,
            l.proveedor_id,
            GROUP_CONCAT(i.url_imagen SEPARATOR ', ') AS imagenes
        FROM Locales l
        LEFT JOIN ImagenesLocales i ON l.id = i.local_id
        WHERE l.proveedor_id = ?
        GROUP BY l.id;
    `;

    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('❌ Error al obtener locales:', err);
            return res.status(500).json({ error: 'Error al obtener locales.' });
        }

        if (results.length === 0) {
            console.log(`⚠️ No se encontraron locales para el proveedor con ID: ${userId}`);
            return res.status(404).json({ message: 'No se encontraron locales.' });
        }

        const locales = results.map(row => ({
            local_id: row.local_id,
            nombre: row.nombre,
            direccion: row.direccion,
            fecha_registro: row.fecha_registro,
            contrato_url: row.contrato_url,
            pdf_url: row.pdf_url,
            proveedor_id: row.proveedor_id,
            imagenes: row.imagenes ? row.imagenes.split(', ') : []
        }));

        console.log(`✅ Locales encontrados:`, locales);

        res.status(200).json(locales);
    });
});

// RUTA PARA TRAER UN LOCAL ESPECIFICO POR EL ID
app.get('/api/local/info/:localId', (req, res) => {
    const { localId } = req.params;

    console.log(`🔍 Recibiendo solicitud para obtener información del local con ID: ${localId}`);

    const query = `
        SELECT 
            l.id AS local_id,
            l.nombre,
            l.direccion,
            l.fecha_registro,
            l.contrato_url,
            l.pdf_url,
            l.proveedor_id,
            GROUP_CONCAT(i.url_imagen SEPARATOR ', ') AS imagenes
        FROM Locales l
        LEFT JOIN ImagenesLocales i ON l.id = i.local_id
        WHERE l.id = ?
        GROUP BY l.id;
    `;

    db.query(query, [localId], (err, results) => {
        if (err) {
            console.error('❌ Error al obtener el local:', err);
            return res.status(500).json({ error: 'Error al obtener el local.' });
        }

        if (results.length === 0) {
            console.log(`⚠️ No se encontró el local con ID: ${localId}`);
            return res.status(404).json({ message: 'No se encontró el local.' });
        }

        const local = {
            local_id: results[0].local_id,
            nombre: results[0].nombre,
            direccion: results[0].direccion,
            fecha_registro: results[0].fecha_registro,
            contrato_url: results[0].contrato_url,
            pdf_url: results[0].pdf_url,
            proveedor_id: results[0].proveedor_id,
            imagenes: results[0].imagenes ? results[0].imagenes.split(', ') : []
        };

        console.log(`✅ Información del local encontrada:`, local);

        res.status(200).json(local);
    });
});


  


// eliminnar local en proceso de registro
app.delete('/eliminarLocal/:localId', (req, res) => {
    const localId = req.params.localId;

    // Obtener las imágenes asociadas al local
    const getImagesQuery = 'SELECT url_imagen FROM ImagenesLocales WHERE local_id = ?';
    db.query(getImagesQuery, [localId], (err, results) => {
        if (err) {
            console.error('❌ Error al obtener imágenes:', err);
            return res.status(500).json({ message: 'Error al obtener imágenes del local.', error: err });
        }

        // Eliminar físicamente los archivos de la carpeta
        results.forEach((row) => {
            const imagePath = path.join(__dirname, '/uploadLocal', row.url_imagen); // Reemplaza con la ruta de tu carpeta
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, (err) => {
                    if (err) {
                        console.error(`❌ Error al eliminar imagen ${row.url_imagen}:`, err);
                    } else {
                        console.log(`🗑️ Imagen eliminada: ${row.url_imagen}`);
                    }
                });
            }
        });

        // Luego, eliminar las imágenes de la base de datos
        const deleteImagesQuery = 'DELETE FROM ImagenesLocales WHERE local_id = ?';
        db.query(deleteImagesQuery, [localId], (err) => {
            if (err) {
                console.error('❌ Error al eliminar imágenes de la base de datos:', err);
                return res.status(500).json({ message: 'Error al eliminar imágenes del local.', error: err });
            }

            // Finalmente, eliminar el local
            const deleteLocalQuery = 'DELETE FROM Locales WHERE id = ?';
            db.query(deleteLocalQuery, [localId], (err) => {
                if (err) {
                    console.error('❌ Error al eliminar el local:', err);
                    return res.status(500).json({ message: 'Error al eliminar el local.', error: err });
                }
                console.log(`✅ Local con ID ${localId} eliminado correctamente.`);
                res.status(200).json({ message: 'Local e imágenes eliminados correctamente.' });
            });
        });
    });
});


// 📂 Crear carpeta "papeles_locales" si no existe
const pdfUploadDir = path.join(__dirname, 'papeles_locales');
if (!fs.existsSync(pdfUploadDir)) {
    fs.mkdirSync(pdfUploadDir, { recursive: true });
}


// 🗂️ Configurar Multer para guardar archivos PDF en "papeles_locales"
const pdfStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, pdfUploadDir); // Guardar en "papeles_locales"
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `doc-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});


// 📌 Filtro para aceptar solo archivos PDF
const pdfUpload = multer({
    storage: pdfStorage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten archivos PDF"), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 📏 Máximo 5MB por archivo
});


// 🖥️ Servir archivos desde "papeles_locales"
app.use('/papeles_locales', express.static(pdfUploadDir));



// 🔄 Subir un PDF y obtener su URL
app.post('/uploadLocalPDF', pdfUpload.single('pdfFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo PDF.' });
    }

    const pdfUrl = `${req.protocol}://${req.get('host')}/papeles_locales/${req.file.filename}`;
    res.status(200).json({ message: 'PDF subido con éxito.', pdfUrl });
});

// 🔄 Ruta para actualizar local con dirección y PDF
app.put('/actualizar_local/:localId', pdfUpload.single('pdf'), (req, res) => {
    const { localId } = req.params;
    const { direccion } = req.body;

    if (!localId || !direccion) {
        return res.status(400).json({ message: 'El localId y la dirección son obligatorios.' });
    }

    let pdfUrl = null;
    if (req.file) {
        pdfUrl = `${req.protocol}://${req.get('host')}/papeles_locales/${req.file.filename}`;
    }

    let query = "UPDATE locales SET direccion = ?";
    let params = [direccion];

    if (pdfUrl) {
        
        query += ", pdf_url = ?";
        params.push(pdfUrl);
    }

    query += " WHERE id = ?";
    params.push(localId);

  
    db.query(query, params, (err, result) => {
        if (err) {
            console.error('❌ Error al actualizar el local:', err);
            return res.status(500).json({ message: 'Error al actualizar el local.' });
        }
        res.status(200).json({ message: 'Local actualizado correctamente.', pdfUrl });
    });
});







// Habilitar CORS para permitir solicitudes desde otros orígenes (como tu app Android)
app.use(cors());

app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});
