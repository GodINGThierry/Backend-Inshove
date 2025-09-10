const express = require('express');
const multer = require('multer');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Configuration FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffmpegStatic.replace('ffmpeg', 'ffprobe'));

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration sécurité
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requêtes par IP par fenêtre
  message: { error: 'Trop de requêtes, essayez plus tard' }
});
app.use('/api/', limiter);

// Créer les dossiers nécessaires
const createDirectories = () => {
  const dirs = ['uploads', 'processed', 'tmp'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Dossier créé: ${dir}/`);
    }
  });
};

createDirectories();

// Configuration Multer optimisée
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    cb(null, `${timestamp}-${randomId}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB max
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/quicktime', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez MP4, AVI, ou MOV.'));
    }
  }
});

// Fonction de traitement vidéo optimisée
const processVideoOptimized = (inputPath, outputPath, segments) => {
  return new Promise((resolve, reject) => {
    console.log('🎬 Début traitement vidéo optimisé...');
    console.log('📊 Segments à conserver:', segments.length);
    
    if (segments.length === 0) {
      return reject(new Error('Aucun segment à traiter'));
    }

    // Créer les filtres FFmpeg pour découper et concaténer en une seule passe
    let filterComplex = '';
    let inputs = [];
    
    if (segments.length === 1) {
      // Cas simple : un seul segment
      const segment = segments[0];
      console.log(`✂️ Extraction segment unique: ${segment.start}s - ${segment.end}s`);
      
      ffmpeg(inputPath)
        .seekInput(segment.start)
        .duration(segment.end - segment.start)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset ultrafast',
          '-crf 23',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🔧 Commande FFmpeg:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`⏳ Progression: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          console.log('✅ Traitement terminé avec succès');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erreur FFmpeg:', err.message);
          reject(err);
        })
        .run();
        
    } else {
      // Cas multiple : utiliser filter_complex pour traitement optimisé
      console.log('🔗 Traitement multi-segments avec filter_complex...');
      
      const filters = segments.map((segment, index) => {
        return `[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}]; [0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`;
      });
      
      const videoInputs = segments.map((_, i) => `[v${i}]`).join('');
      const audioInputs = segments.map((_, i) => `[a${i}]`).join('');
      
      filterComplex = filters.join('; ') + `; ${videoInputs}concat=n=${segments.length}:v=1:a=0[outv]; ${audioInputs}concat=n=${segments.length}:v=0:a=1[outa]`;
      
      ffmpeg(inputPath)
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [outv]',
          '-map [outa]',
          '-c:v libx264',
          '-c:a aac',
          '-preset ultrafast',
          '-crf 23',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('🔧 Commande FFmpeg complexe:', commandLine.substring(0, 200) + '...');
        })
        .on('progress', (progress) => {
          console.log(`⏳ Progression: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          console.log('✅ Traitement multi-segments terminé');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erreur FFmpeg complexe:', err.message);
          reject(err);
        })
        .run();
    }
  });
};

// Fonction de nettoyage
const cleanupFiles = (files, delay = 300000) => { // 5 minutes par défaut
  setTimeout(() => {
    files.forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`🧹 Fichier nettoyé: ${file}`);
        } catch (error) {
          console.warn(`⚠️ Impossible de supprimer ${file}:`, error.message);
        }
      }
    });
  }, delay);
};

// Endpoint principal de traitement
app.post('/api/process-video', upload.single('video'), async (req, res) => {
  console.log('🚀 NOUVELLE REQUÊTE DE TRAITEMENT VIDÉO');
  
  const startTime = Date.now();
  let inputPath = null;
  let outputPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'Aucun fichier vidéo fourni',
        details: 'Le champ "video" est requis'
      });
    }

    const segments = JSON.parse(req.body.segments || '[]');
    
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ 
        error: 'Segments invalides',
        details: 'Au moins un segment doit être fourni'
      });
    }

    inputPath = req.file.path;
    const outputFilename = `processed-${Date.now()}-${Math.random().toString(36).substring(2, 15)}.mp4`;
    outputPath = path.join('processed', outputFilename);

    console.log('📄 Fichier reçu:', req.file.originalname);
    console.log('📊 Taille:', (req.file.size / (1024 * 1024)).toFixed(2), 'MB');
    console.log('🎯 Segments à traiter:', segments.length);

    // Validation des segments
    const validSegments = segments.filter(seg => 
      typeof seg.start === 'number' && 
      typeof seg.end === 'number' && 
      seg.start >= 0 && 
      seg.end > seg.start
    );

    if (validSegments.length === 0) {
      return res.status(400).json({ 
        error: 'Aucun segment valide',
        details: 'Tous les segments doivent avoir start et end numériques positifs'
      });
    }

    console.log('✅ Segments validés:', validSegments.length);

    // Traitement de la vidéo
    await processVideoOptimized(inputPath, outputPath, validSegments);

    // Vérifier que le fichier de sortie existe
    if (!fs.existsSync(outputPath)) {
      throw new Error('Fichier de sortie non généré');
    }

    const outputStats = fs.statSync(outputPath);
    const processingTime = (Date.now() - startTime) / 1000;

    console.log('🎉 TRAITEMENT RÉUSSI:');
    console.log('- Temps de traitement:', processingTime.toFixed(2), 's');
    console.log('- Taille finale:', (outputStats.size / (1024 * 1024)).toFixed(2), 'MB');

    // Définir les headers appropriés
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Length': outputStats.size,
      'Content-Disposition': `attachment; filename="${outputFilename}"`
    });

    // Envoyer le fichier et programmer le nettoyage
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log('📤 Envoi terminé');
      cleanupFiles([inputPath, outputPath]);
    });

    fileStream.on('error', (error) => {
      console.error('❌ Erreur envoi fichier:', error);
      cleanupFiles([inputPath, outputPath], 5000); // Nettoyage immédiat en cas d'erreur
    });

  } catch (error) {
    console.error('❌ ERREUR TRAITEMENT:', error);
    
    // Nettoyage immédiat en cas d'erreur
    if (inputPath) cleanupFiles([inputPath], 5000);
    if (outputPath) cleanupFiles([outputPath], 5000);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.status(500).json({ 
      error: 'Erreur de traitement vidéo',
      details: error.message,
      processingTime: processingTime.toFixed(2)
    });
  }
});

// Page d'accueil informative
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Inshove Backend - API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; margin: 40px; line-height: 1.6; color: #222; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    a { color: #0b5fff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Inshove Backend - API</h1>
  <p>Serveur en ligne. Utilisez les endpoints ci-dessous:</p>
  <ul>
    <li><a href="/health">/health</a> - statut</li>
    <li><a href="/api/test">/api/test</a> - test</li>
  </ul>
</body>
</html>`);
});

// Endpoint de santé
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();
  
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB'
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

// Endpoint de test
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Serveur de traitement vidéo opérationnel',
    version: '1.0.0',
    endpoints: ['/health', '/api/process-video', '/api/test']
  });
});

// 404 pour routes non définies
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.originalUrl
  });
});

// Gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error('❌ Erreur serveur:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: 'Fichier trop volumineux',
        details: 'Taille maximale: 2GB'
      });
    }
  }
  
  res.status(500).json({ 
    error: 'Erreur serveur interne',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne'
  });
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Arrêt du serveur (Ctrl+C)...');
  process.exit(0);
});

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 ===================================');
  console.log(`🎬 Serveur de traitement vidéo démarré`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Dossiers: uploads/, processed/, tmp/`);
  console.log(`⚡ FFmpeg: ${ffmpegStatic}`);
  console.log('🚀 ===================================');
});
